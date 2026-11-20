"""Database access for Plumbline.

Uses PostgreSQL (for example Supabase) when DATABASE_URL is set, so data survives
restarts and redeploys. Without DATABASE_URL it falls back to a local SQLite file
for development and tests. Route code keeps writing SQL with "?" placeholders;
this module translates them for PostgreSQL.

OAuth tokens are stored in the database. Encrypt them at rest before real use.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any, Iterable

BASE_DIR = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.getenv("DATABASE_PATH", str(BASE_DIR / "data" / "plumbline.sqlite3")))
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
USE_POSTGRES = bool(DATABASE_URL)


def _pg_url() -> str:
    url = DATABASE_URL
    if "sslmode=" not in url and "localhost" not in url and "127.0.0.1" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return url


def _to_pg(sql: str) -> str:
    """Convert SQLite-style '?' placeholders to PostgreSQL '%s' (escaping literal '%')."""
    return sql.replace("%", "%%").replace("?", "%s")


def _split_script(script: str) -> list[str]:
    return [statement.strip() for statement in script.split(";") if statement.strip()]


class Connection:
    """Small wrapper so route code works unchanged on SQLite and PostgreSQL."""

    def __init__(self, raw: Any, postgres: bool):
        self.raw = raw
        self.postgres = postgres

    def execute(self, sql: str, params: Iterable[Any] = ()):
        params = tuple(params)
        if self.postgres:
            if params:
                return self.raw.execute(_to_pg(sql), params)
            return self.raw.execute(sql)
        return self.raw.execute(sql, params)

    def executemany(self, sql: str, seq_of_params: Iterable[Iterable[Any]]):
        rows = [tuple(p) for p in seq_of_params]
        if self.postgres:
            cur = self.raw.cursor()
            if rows:
                cur.executemany(_to_pg(sql), rows)
            return cur
        return self.raw.executemany(sql, rows)

    def executescript(self, script: str) -> None:
        if self.postgres:
            for statement in _split_script(script):
                self.raw.execute(statement)
        else:
            self.raw.executescript(script)

    def commit(self) -> None:
        self.raw.commit()

    def __enter__(self) -> "Connection":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        try:
            if exc_type is None:
                self.raw.commit()
            else:
                self.raw.rollback()
        finally:
            self.raw.close()
        return False


def connect() -> Connection:
    if USE_POSTGRES:
        import psycopg
        from psycopg.rows import dict_row

        # prepare_threshold=None keeps it working behind Supabase's transaction pooler (port 6543).
        raw = psycopg.connect(_pg_url(), row_factory=dict_row, prepare_threshold=None, connect_timeout=15)
        return Connection(raw, True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    raw = sqlite3.connect(DB_PATH, timeout=20)
    raw.row_factory = sqlite3.Row
    raw.execute("PRAGMA foreign_keys = ON")
    return Connection(raw, False)


def _schema(postgres: bool) -> str:
    nocase = "" if postgres else " COLLATE NOCASE"
    return f"""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE{nocase},
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'owner',
            workspace_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_login TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS oauth_states (
            state TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code_verifier TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS social_connections (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            platform TEXT NOT NULL,
            account_id TEXT NOT NULL,
            account_name TEXT NOT NULL,
            handle TEXT NOT NULL DEFAULT '',
            access_token TEXT NOT NULL,
            refresh_token TEXT,
            expires_at TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{{}}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, platform, account_id)
        );
        CREATE INDEX IF NOT EXISTS ix_social_connections_user ON social_connections(user_id);
        CREATE TABLE IF NOT EXISTS workspace_data (
            workspace_id TEXT NOT NULL,
            data_key TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(workspace_id, data_key)
        );
        CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            platform TEXT NOT NULL,
            body TEXT NOT NULL,
            provider_post_id TEXT,
            permalink TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            platform TEXT NOT NULL,
            post_id TEXT,
            author_name TEXT NOT NULL DEFAULT '',
            author_handle TEXT NOT NULL DEFAULT '',
            text TEXT NOT NULL,
            created_at TEXT NOT NULL,
            reply_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(user_id, platform, id)
        );
        CREATE TABLE IF NOT EXISTS guideline_versions (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            version_number INTEGER NOT NULL,
            rules_json TEXT NOT NULL,
            change_summary TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            UNIQUE(workspace_id, version_number)
        );
        CREATE TABLE IF NOT EXISTS guideline_rule_changes (
            id TEXT PRIMARY KEY,
            version_id TEXT NOT NULL REFERENCES guideline_versions(id) ON DELETE CASCADE,
            workspace_id TEXT NOT NULL,
            rule_id TEXT NOT NULL,
            rule_kind TEXT NOT NULL,
            rule_label TEXT NOT NULL DEFAULT '',
            change_type TEXT NOT NULL,
            fields_json TEXT NOT NULL DEFAULT '[]',
            before_json TEXT,
            after_json TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_rule_changes_version ON guideline_rule_changes(version_id);
        CREATE TABLE IF NOT EXISTS rule_disputes (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            rule_id TEXT NOT NULL,
            rule_label TEXT NOT NULL DEFAULT '',
            post_id TEXT NOT NULL DEFAULT '',
            finding_id TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            guideline_version TEXT NOT NULL DEFAULT '',
            disputed_by TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            UNIQUE(workspace_id, finding_id)
        );
        CREATE INDEX IF NOT EXISTS ix_rule_disputes_rule ON rule_disputes(workspace_id, rule_id);
        CREATE TABLE IF NOT EXISTS rule_alerts (
            workspace_id TEXT NOT NULL,
            rule_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            suggestion_json TEXT,
            closed_at TEXT,
            resolved_version TEXT,
            updated_by TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL,
            PRIMARY KEY(workspace_id, rule_id)
        )
    """


def init_db() -> None:
    with connect() as db:
        db.executescript(_schema(db.postgres))
        # Columns added after the first release of a table go here so older databases keep working.
        add_column_if_missing(db, "rule_alerts", "resolution_note", "TEXT NOT NULL DEFAULT ''")
        # Governance Insights: team (department) for error-rate-by-team
        add_column_if_missing(db, "users", "department", "TEXT NOT NULL DEFAULT ''")
    lock_down_public_tables()


def add_column_if_missing(db: Connection, table: str, column: str, definition: str) -> None:
    if db.postgres:
        db.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {definition}")
        return
    existing = {row["name"] for row in db.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in existing:
        db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def lock_down_public_tables() -> None:
    """Supabase exposes the public schema through its REST API. Enabling row level
    security with no policies blocks that path; this backend connects as the owner
    role, which bypasses RLS. Safe to call again after other modules create tables."""
    if not USE_POSTGRES:
        return
    with connect() as db:
        tables = [row["tablename"] for row in db.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname='public'").fetchall()]
        for table in tables:
            db.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
