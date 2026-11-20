"""Storage for uploaded rulebooks, their chunks and embedding vectors.

Two backends, chosen at startup:
  * Postgres + pgvector when RAG_DATABASE_URL (or DATABASE_URL) is a postgres:// URL.
    Vector search runs in SQL with the cosine operator (<=>) on a vector(768) column.
  * SQLite (default, local dev): same tables in the app's SQLite file; cosine runs in Python.
Both expose the same methods, so the engine does not care which one is live.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from app.database.db import connect
from app.rag.retrieval import cosine


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _vec_literal(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


class SQLiteStore:
    kind = "sqlite"
    vector_search = "python cosine"

    def init(self) -> None:
        with connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS rag_documents (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    file_type TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    pages INTEGER,
                    chunk_count INTEGER NOT NULL,
                    embedded INTEGER NOT NULL DEFAULT 0,
                    sha256 TEXT NOT NULL,
                    uploaded_by TEXT NOT NULL,
                    uploaded_at TEXT NOT NULL,
                    UNIQUE(workspace_id, sha256)
                );
                CREATE TABLE IF NOT EXISTS rag_chunks (
                    workspace_id TEXT NOT NULL,
                    id TEXT NOT NULL,
                    document_id TEXT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
                    label TEXT NOT NULL,
                    text TEXT NOT NULL,
                    page INTEGER,
                    heading TEXT,
                    ord INTEGER NOT NULL,
                    embedding_json TEXT,
                    PRIMARY KEY(workspace_id, id)
                );
                CREATE INDEX IF NOT EXISTS ix_rag_chunks_doc ON rag_chunks(document_id);
                CREATE TABLE IF NOT EXISTS rag_embedding_cache (
                    hash TEXT PRIMARY KEY,
                    vector_json TEXT NOT NULL
                );
                """
            )

    def find_by_sha(self, ws: str, sha: str) -> dict | None:
        with connect() as db:
            row = db.execute("SELECT * FROM rag_documents WHERE workspace_id=? AND sha256=?", (ws, sha)).fetchone()
        return dict(row) if row else None

    def add_document(self, ws: str, doc: dict, chunks: list[dict], vectors: list[list[float]] | None) -> None:
        with connect() as db:
            db.execute(
                "INSERT INTO rag_documents(id,workspace_id,filename,file_type,size_bytes,pages,chunk_count,embedded,sha256,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (doc["id"], ws, doc["filename"], doc["file_type"], doc["size_bytes"], doc.get("pages"), len(chunks),
                 1 if vectors else 0, doc["sha256"], doc["uploaded_by"], doc["uploaded_at"]),
            )
            db.executemany(
                "INSERT INTO rag_chunks(workspace_id,id,document_id,label,text,page,heading,ord,embedding_json) VALUES(?,?,?,?,?,?,?,?,?)",
                [(ws, c["id"], doc["id"], c["label"], c["text"], c.get("page"), c.get("heading"), c["ord"],
                  json.dumps(vectors[i]) if vectors else None) for i, c in enumerate(chunks)],
            )

    def list_documents(self, ws: str) -> list[dict]:
        with connect() as db:
            rows = db.execute("SELECT * FROM rag_documents WHERE workspace_id=? ORDER BY uploaded_at DESC", (ws,)).fetchall()
        return [dict(r) for r in rows]

    def delete_document(self, ws: str, doc_id: str) -> bool:
        with connect() as db:
            db.execute("DELETE FROM rag_chunks WHERE workspace_id=? AND document_id=?", (ws, doc_id))
            cur = db.execute("DELETE FROM rag_documents WHERE workspace_id=? AND id=?", (ws, doc_id))
        return cur.rowcount > 0

    def document_chunks(self, ws: str, doc_id: str, limit: int = 50) -> list[dict]:
        with connect() as db:
            rows = db.execute(
                "SELECT id,label,text,page,heading,ord FROM rag_chunks WHERE workspace_id=? AND document_id=? ORDER BY ord LIMIT ?",
                (ws, doc_id, limit)).fetchall()
        return [dict(r) for r in rows]

    def load_chunks(self, ws: str) -> list[dict]:
        with connect() as db:
            rows = db.execute(
                """SELECT c.id,c.label,c.text,c.page,c.heading,c.ord,c.document_id,c.embedding_json,d.filename
                   FROM rag_chunks c JOIN rag_documents d ON d.id=c.document_id
                   WHERE c.workspace_id=? ORDER BY d.uploaded_at, c.ord""", (ws,)).fetchall()
        out = []
        for r in rows:
            c = dict(r)
            raw = c.pop("embedding_json")
            c["vec"] = json.loads(raw) if raw else None
            c["kind"] = "document"
            out.append(c)
        return out

    def rank_document_chunks(self, ws: str, query_vec: list[float], chunks: list[dict], limit: int = 20) -> list[tuple[str, float]]:
        sims = [(c["id"], cosine(query_vec, c["vec"])) for c in chunks if c.get("vec")]
        return [(cid, s) for cid, s in sorted(sims, key=lambda x: -x[1]) if s > 0.35][:limit]

    def cached_vectors(self, hashes: list[str]) -> dict[str, list[float]]:
        if not hashes:
            return {}
        with connect() as db:
            rows = db.execute(f"SELECT hash,vector_json FROM rag_embedding_cache WHERE hash IN ({','.join('?' * len(hashes))})", hashes).fetchall()
        return {r["hash"]: json.loads(r["vector_json"]) for r in rows}

    def cache_vectors(self, items: dict[str, list[float]]) -> None:
        with connect() as db:
            db.executemany("INSERT INTO rag_embedding_cache(hash,vector_json) VALUES(?,?) ON CONFLICT(hash) DO UPDATE SET vector_json=excluded.vector_json",
                           [(h, json.dumps(v)) for h, v in items.items()])


class PostgresStore:
    kind = "postgres"

    def __init__(self, url: str):
        import psycopg  # noqa: F401  (fails fast if the driver is missing)
        self.url = url
        self.pgvector = False

    @property
    def vector_search(self) -> str:
        return "pgvector cosine (<=>)" if self.pgvector else "python cosine (pgvector extension unavailable)"

    def _conn(self):
        import psycopg
        from psycopg.rows import dict_row
        return psycopg.connect(self.url, row_factory=dict_row, autocommit=True)

    def init(self) -> None:
        with self._conn() as db:
            try:
                db.execute("CREATE EXTENSION IF NOT EXISTS vector")
                self.pgvector = True
            except Exception:
                self.pgvector = False
            emb = "vector(768)" if self.pgvector else "jsonb"
            db.execute("""
                CREATE TABLE IF NOT EXISTS rag_documents (
                    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, filename TEXT NOT NULL, file_type TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL, pages INTEGER, chunk_count INTEGER NOT NULL, embedded INTEGER NOT NULL DEFAULT 0,
                    sha256 TEXT NOT NULL, uploaded_by TEXT NOT NULL, uploaded_at TEXT NOT NULL, UNIQUE(workspace_id, sha256))""")
            db.execute(f"""
                CREATE TABLE IF NOT EXISTS rag_chunks (
                    workspace_id TEXT NOT NULL, id TEXT NOT NULL,
                    document_id TEXT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
                    label TEXT NOT NULL, text TEXT NOT NULL, page INTEGER, heading TEXT, ord INTEGER NOT NULL,
                    embedding {emb}, PRIMARY KEY(workspace_id, id))""")
            db.execute("CREATE INDEX IF NOT EXISTS ix_rag_chunks_ws ON rag_chunks(workspace_id)")
            db.execute("CREATE TABLE IF NOT EXISTS rag_embedding_cache (hash TEXT PRIMARY KEY, vector_json TEXT NOT NULL)")

    def find_by_sha(self, ws, sha):
        with self._conn() as db:
            return db.execute("SELECT * FROM rag_documents WHERE workspace_id=%s AND sha256=%s", (ws, sha)).fetchone()

    def add_document(self, ws, doc, chunks, vectors):
        with self._conn() as db, db.transaction():
            db.execute(
                "INSERT INTO rag_documents(id,workspace_id,filename,file_type,size_bytes,pages,chunk_count,embedded,sha256,uploaded_by,uploaded_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (doc["id"], ws, doc["filename"], doc["file_type"], doc["size_bytes"], doc.get("pages"), len(chunks),
                 1 if vectors else 0, doc["sha256"], doc["uploaded_by"], doc["uploaded_at"]))
            cast = "%s::vector" if self.pgvector else "%s::jsonb"
            with db.cursor() as cur:
                cur.executemany(
                    f"INSERT INTO rag_chunks(workspace_id,id,document_id,label,text,page,heading,ord,embedding) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,{cast})",
                    [(ws, c["id"], doc["id"], c["label"], c["text"], c.get("page"), c.get("heading"), c["ord"],
                      (_vec_literal(vectors[i]) if self.pgvector else json.dumps(vectors[i])) if vectors else None)
                     for i, c in enumerate(chunks)])

    def list_documents(self, ws):
        with self._conn() as db:
            return db.execute("SELECT * FROM rag_documents WHERE workspace_id=%s ORDER BY uploaded_at DESC", (ws,)).fetchall()

    def delete_document(self, ws, doc_id):
        with self._conn() as db:
            db.execute("DELETE FROM rag_chunks WHERE workspace_id=%s AND document_id=%s", (ws, doc_id))
            return db.execute("DELETE FROM rag_documents WHERE workspace_id=%s AND id=%s", (ws, doc_id)).rowcount > 0

    def document_chunks(self, ws, doc_id, limit=50):
        with self._conn() as db:
            return db.execute("SELECT id,label,text,page,heading,ord FROM rag_chunks WHERE workspace_id=%s AND document_id=%s ORDER BY ord LIMIT %s",
                              (ws, doc_id, limit)).fetchall()

    def load_chunks(self, ws):
        vec_col = "(c.embedding IS NOT NULL) AS has_vec" if self.pgvector else "c.embedding AS vec"
        with self._conn() as db:
            rows = db.execute(f"""SELECT c.id,c.label,c.text,c.page,c.heading,c.ord,c.document_id,d.filename,{vec_col}
                FROM rag_chunks c JOIN rag_documents d ON d.id=c.document_id
                WHERE c.workspace_id=%s ORDER BY d.uploaded_at, c.ord""", (ws,)).fetchall()
        for r in rows:
            r["kind"] = "document"
            if self.pgvector:
                r["vec"] = True if r.pop("has_vec") else None
        return rows

    def rank_document_chunks(self, ws, query_vec, chunks, limit=20):
        if not self.pgvector:
            sims = [(c["id"], cosine(query_vec, c["vec"])) for c in chunks if c.get("vec")]
            return [(cid, s) for cid, s in sorted(sims, key=lambda x: -x[1]) if s > 0.35][:limit]
        with self._conn() as db:
            rows = db.execute(
                """SELECT id, 1 - (embedding <=> %s::vector) AS sim FROM rag_chunks
                   WHERE workspace_id=%s AND embedding IS NOT NULL
                   ORDER BY embedding <=> %s::vector LIMIT %s""",
                (_vec_literal(query_vec), ws, _vec_literal(query_vec), limit)).fetchall()
        return [(r["id"], float(r["sim"])) for r in rows if r["sim"] > 0.35]

    def cached_vectors(self, hashes):
        if not hashes:
            return {}
        with self._conn() as db:
            rows = db.execute("SELECT hash,vector_json FROM rag_embedding_cache WHERE hash = ANY(%s)", (hashes,)).fetchall()
        return {r["hash"]: json.loads(r["vector_json"]) for r in rows}

    def cache_vectors(self, items):
        with self._conn() as db, db.cursor() as cur:
            cur.executemany("INSERT INTO rag_embedding_cache(hash,vector_json) VALUES(%s,%s) ON CONFLICT(hash) DO UPDATE SET vector_json=excluded.vector_json",
                            [(h, json.dumps(v)) for h, v in items.items()])


_store: SQLiteStore | PostgresStore | None = None


def get_store():
    global _store
    if _store is None:
        url = (os.getenv("RAG_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()
        if url.startswith(("postgres://", "postgresql://")):
            try:
                s = PostgresStore(url)
                s.init()
                _store = s
            except Exception as exc:  # keep the app usable if Postgres is misconfigured
                print(f"[rag] Postgres unavailable ({exc}); using SQLite for rulebooks.")
        if _store is None:
            s = SQLiteStore()
            s.init()
            _store = s
    return _store
