"""Optional dense embeddings (Gemini free tier, gemini-embedding-001 at 768 dims).

If GEMINI_API_KEY is not set, or the call fails or is rate limited, retrieval
falls back to BM25 only. Nothing breaks.
"""
from __future__ import annotations

import math
import os

import httpx

MODEL = "gemini-embedding-001"
DIMS = 768
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:batchEmbedContents"


def enabled() -> bool:
    return bool(os.getenv("GEMINI_API_KEY", "").strip()) and os.getenv("RAG_DISABLE_EMBEDDINGS", "").lower() not in {"1", "true", "yes"}


def _norm(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


async def embed(texts: list[str], task: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set")
    out: list[list[float]] = []
    async with httpx.AsyncClient(timeout=40) as client:
        for i in range(0, len(texts), 100):
            batch = texts[i:i + 100]
            res = await client.post(URL, headers={"x-goog-api-key": key}, json={
                "requests": [{"model": f"models/{MODEL}", "content": {"parts": [{"text": t[:8000]}]},
                              "taskType": task, "outputDimensionality": DIMS} for t in batch]
            })
            if res.is_error:
                try:
                    msg = res.json().get("error", {}).get("message", res.text)
                except Exception:
                    msg = res.text
                raise RuntimeError(f"Gemini embeddings {res.status_code}: {msg[:200]}")
            out.extend(_norm(e.get("values") or []) for e in res.json().get("embeddings", []))
    if len(out) != len(texts):
        raise RuntimeError("Gemini returned a different number of embeddings than requested")
    return out
