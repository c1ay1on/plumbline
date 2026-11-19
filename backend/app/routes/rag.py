"""Rulebook upload + grounded audit API (shared by the web app and the Chrome extension)."""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.database.db import connect
from app.rag import embeddings
from app.rag.chunking import RulebookParseError, parse_markdown, parse_pdf, rulebook_chunks
from app.rag.engine import run_audit
from app.rag.store import get_store
from app.routes.auth import require_user

router = APIRouter(prefix="/api/rag", tags=["rag"])

MAX_BYTES = 10 * 1024 * 1024
TYPES = {".pdf": "pdf", ".md": "markdown", ".markdown": "markdown", ".txt": "text"}
EDITOR_ROLES = {"owner", "admin", "manager"}


def _doc_out(d: dict) -> dict:
    return {
        "id": d["id"], "filename": d["filename"], "fileType": d["file_type"], "sizeBytes": d["size_bytes"],
        "pages": d.get("pages"), "chunkCount": d["chunk_count"], "embedded": bool(d["embedded"]),
        "uploadedBy": d["uploaded_by"], "uploadedAt": d["uploaded_at"],
    }


@router.get("/status")
async def rag_status(user: dict = Depends(require_user)):
    store = get_store()
    return {"store": store.kind, "vectorSearch": store.vector_search, "embeddings": embeddings.enabled()}


@router.get("/rulebooks")
async def list_rulebooks(user: dict = Depends(require_user)):
    return [_doc_out(d) for d in get_store().list_documents(user["workspaceId"])]


@router.post("/rulebooks", status_code=201)
async def upload_rulebook(file: UploadFile = File(...), user: dict = Depends(require_user)):
    if user.get("role") not in EDITOR_ROLES:
        raise HTTPException(status_code=403, detail="Only workspace owners, admins and managers can upload rulebooks.")
    name = (file.filename or "rulebook").strip().replace("\\", "/").split("/")[-1][:180] or "rulebook"
    ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in TYPES:
        raise HTTPException(status_code=415, detail="Upload a PDF (.pdf) or Markdown (.md) file.")
    raw = await file.read(MAX_BYTES + 1)
    if not raw:
        raise HTTPException(status_code=400, detail="The file is empty.")
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="The file is larger than 10 MB.")
    if TYPES[ext] == "pdf" and not raw.startswith(b"%PDF"):
        raise HTTPException(status_code=422, detail="This file has a .pdf name but is not a PDF.")

    ws = user["workspaceId"]
    store = get_store()
    digest = hashlib.sha256(raw).hexdigest()
    existing = store.find_by_sha(ws, digest)
    if existing:
        raise HTTPException(status_code=409, detail=f"This rulebook is already uploaded as \u201c{existing['filename']}\u201d.")

    try:
        sections = parse_pdf(raw) if TYPES[ext] == "pdf" else parse_markdown(raw)
    except RulebookParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    doc_id = str(uuid.uuid4())
    chunks = rulebook_chunks(doc_id, name, sections)
    if not chunks:
        detail = ("No selectable text was found in this PDF. Scanned PDFs need OCR, which is not supported yet."
                  if TYPES[ext] == "pdf" else "No rule text was found in this file.")
        raise HTTPException(status_code=422, detail=detail)
    if len(chunks) > 2000:
        raise HTTPException(status_code=413, detail="This rulebook is too long (over 2,000 passages). Split it into smaller files.")

    vectors, warning = None, None
    if embeddings.enabled():
        try:
            vectors = await embeddings.embed([c["text"] for c in chunks], "RETRIEVAL_DOCUMENT")
        except Exception as exc:
            warning = f"Indexed for keyword search only. Vector embeddings failed: {str(exc)[:150]}"

    pages = max((s.get("page") or 0) for s in sections) or None
    doc = {"id": doc_id, "filename": name, "file_type": TYPES[ext], "size_bytes": len(raw), "pages": pages,
           "sha256": digest, "uploaded_by": user.get("name") or user.get("email") or "user",
           "uploaded_at": datetime.now(timezone.utc).isoformat()}
    try:
        store.add_document(ws, doc, chunks, vectors)
    except Exception as exc:
        if store.find_by_sha(ws, digest):  # double-click race: the other request already saved it
            raise HTTPException(status_code=409, detail="This rulebook was just uploaded.")
        raise HTTPException(status_code=500, detail=f"Could not save the rulebook: {str(exc)[:150]}")
    doc["chunk_count"], doc["embedded"] = len(chunks), 1 if vectors else 0
    return {**_doc_out(doc), "warning": warning,
            "preview": [{"id": c["id"], "label": c["label"], "text": c["text"][:300]} for c in chunks[:3]]}


@router.get("/rulebooks/{doc_id}/chunks")
async def rulebook_chunks_preview(doc_id: str, user: dict = Depends(require_user)):
    rows = get_store().document_chunks(user["workspaceId"], doc_id, limit=200)
    if not rows:
        raise HTTPException(status_code=404, detail="Rulebook not found.")
    return rows


@router.delete("/rulebooks/{doc_id}")
async def delete_rulebook(doc_id: str, user: dict = Depends(require_user)):
    if user.get("role") not in EDITOR_ROLES:
        raise HTTPException(status_code=403, detail="Only workspace owners, admins and managers can remove rulebooks.")
    if not get_store().delete_document(user["workspaceId"], doc_id):
        raise HTTPException(status_code=404, detail="Rulebook not found. It may already be removed.")
    return {"status": "deleted", "id": doc_id}


class AuditBody(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    platforms: list[str] = Field(default_factory=list, max_length=20)
    guidelines: dict[str, Any] | None = None
    hasMedia: bool = False
    mediaAltText: str | None = None
    topK: int = Field(default=8, ge=1, le=20)


def _stored_guidelines(ws: str) -> dict:
    with connect() as db:
        row = db.execute("SELECT payload_json FROM workspace_data WHERE workspace_id=? AND data_key='guidelines'", (ws,)).fetchone()
    try:
        return json.loads(row["payload_json"]) if row else {}
    except (json.JSONDecodeError, TypeError):
        return {}


@router.post("/audit")
async def audit(body: AuditBody, user: dict = Depends(require_user)):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Add some text to audit.")
    guidelines = body.guidelines if body.guidelines else _stored_guidelines(user["workspaceId"])
    platforms = [p.strip().lower()[:30] for p in body.platforms if p and p.strip()]
    return await run_audit(user["workspaceId"], text, platforms, guidelines or {},
                           body.hasMedia, body.mediaAltText, body.topK)
