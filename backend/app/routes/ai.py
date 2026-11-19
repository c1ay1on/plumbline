from __future__ import annotations

import os
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from app.routes.auth import require_user

# Groq shut these down on 2026-08-16; map old .env values to the recommended replacements.
RETIRED_MODELS = {"llama-3.3-70b-versatile": "openai/gpt-oss-120b", "llama-3.1-8b-instant": "openai/gpt-oss-20b"}


def resolve_model(model: str | None) -> str:
    chosen = (model or os.getenv("GROQ_MODEL", "") or "openai/gpt-oss-120b").strip()
    return RETIRED_MODELS.get(chosen, chosen)


router = APIRouter(prefix="/api/ai", tags=["ai"])

class ChatBody(BaseModel):
    messages: list[dict] = Field(min_length=1)
    model: str | None = None
    temperature: float = 0.2
    max_tokens: int = 1500
    response_format: dict | None = None

@router.get("/status")
async def ai_status(user: dict = Depends(require_user)):
    return {"configured": bool(os.getenv("GROQ_API_KEY")), "model": resolve_model(None)}

@router.post("/test")
async def ai_test(user: dict = Depends(require_user)):
    key = os.getenv("GROQ_API_KEY", "").strip()
    model = resolve_model(None)
    if not key:
        raise HTTPException(status_code=503, detail="GROQ_API_KEY is not configured in backend/.env.")
    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": model, "messages": [{"role": "user", "content": "Reply with PLUMBLINE_OK"}], "max_tokens": 10},
        )
    if response.is_error:
        try:
            detail = response.json().get("error", {}).get("message", response.text)
        except Exception:
            detail = response.text
        raise HTTPException(status_code=response.status_code, detail=f"Groq: {detail}")
    return {"success": True, "model": model}

@router.post("/chat/completions")
async def chat_completions(body: ChatBody, user: dict = Depends(require_user)):
    key = os.getenv("GROQ_API_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="GROQ_API_KEY is not configured in backend/.env.")
    model = resolve_model(body.model)
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": model, "messages": body.messages, "temperature": body.temperature, "max_tokens": body.max_tokens, **({"response_format": body.response_format} if body.response_format else {})},
        )
    if response.is_error:
        try:
            detail = response.json().get("error", {}).get("message", response.text)
        except Exception:
            detail = response.text
        raise HTTPException(status_code=response.status_code, detail=f"Groq: {detail}")
    return response.json()
