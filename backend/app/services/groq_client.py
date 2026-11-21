"""Groq keys with automatic fallback.

GROQ_API_KEY is the main key. GROQ_API_KEY_2 (or GROQ_FALLBACK_API_KEY) is an optional
backup on a different Groq account. Same model, same request: when the main key is out of
tokens or rate-limited (429/413), rejected (401/403) or Groq has a server error, the request
is retried once with the backup key.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import httpx

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
_PLACEHOLDERS = {"", "your_real_groq_api_key", "your_groq_api_key"}
# 413 is what Groq returns when a request exceeds the tokens-per-minute budget; 498 is flex capacity.
_FALLBACK_STATUSES = {401, 403, 413, 429, 498, 500, 502, 503, 504}

log = logging.getLogger("plumbline.groq")


def groq_keys() -> list[str]:
    keys: list[str] = []
    for name in ("GROQ_API_KEY", "GROQ_API_KEY_2", "GROQ_FALLBACK_API_KEY"):
        value = os.getenv(name, "").strip()
        if value not in _PLACEHOLDERS and value not in keys:
            keys.append(value)
    return keys


def groq_key() -> str:
    """The first usable key, or '' when none is configured."""
    keys = groq_keys()
    return keys[0] if keys else ""


def groq_configured() -> bool:
    return bool(groq_keys())


async def groq_post(client: httpx.AsyncClient, json: dict[str, Any]) -> httpx.Response:
    """POST a chat completion, falling back to the backup key when the main one is exhausted."""
    keys = groq_keys()
    if not keys:
        raise RuntimeError("GROQ_API_KEY is not set on the backend.")
    last: httpx.Response | None = None
    last_exc: Exception | None = None
    for i, key in enumerate(keys):
        try:
            last = await client.post(GROQ_CHAT_URL, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json=json)
            last_exc = None
        except httpx.HTTPError as exc:  # network trouble: try the next key too
            last_exc = exc
            continue
        if last.status_code not in _FALLBACK_STATUSES:
            return last
        if i + 1 < len(keys):
            log.warning("Groq key #%d returned %s; retrying with backup key", i + 1, last.status_code)
    if last is None:
        raise last_exc or RuntimeError("Groq request failed.")
    return last
