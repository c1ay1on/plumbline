"""Vision-model step for Improvement 2: text regions, logo check and an alt-text draft.

Groq (Qwen 3.8 27B vision) first, Gemini 2.5 Flash-Lite as a fallback.
Everything the model says is checked again by the deterministic code in analysis.py.
"""
from __future__ import annotations

import json
import os
import re

import httpx

DEFAULT_GROQ_VISION = "qwen/qwen3.8-27b"
DEFAULT_GEMINI_VISION = "gemini-2.5-flash-lite"

PROMPT = """You audit a social media creative for a brand-governance tool.
Image 1 is the creative.{logo_note}
Return ONLY a JSON object with these keys:
{{
  "altText": "one or two plain sentences describing the important subject, action and any essential on-image text, under 250 characters, no 'image of'",
  "textRegions": [{{"text": "exact visible words", "box": [x0, y0, x1, y1], "large": true}}],
  "logo": {{"present": true, "box": [x0, y0, x1, y1], "matchesApproved": true, "variantSeen": "primary|monochrome|light|dark|unknown", "distorted": false, "issues": ["short phrase"]}}
}}
Rules: boxes are fractions of the creative's width and height from 0 to 1, top-left origin.
List up to 5 text regions; "large" means roughly 24px or larger / bold headline.
If no logo is visible, set logo.present to false and leave box empty.
"distorted" means stretched, squashed, skewed, cropped, recoloured or with effects compared with the approved logo.
If no approved logo was given, set matchesApproved to null."""


def _prompt(logo_count: int, variants: list[str]) -> str:
    if not logo_count:
        return PROMPT.format(logo_note=" No approved logo file was supplied.")
    names = ", ".join(variants) or "primary"
    return PROMPT.format(logo_note=f" Images 2 onward are the approved logo variants ({names}).")


def _parse(content: str) -> dict:
    content = re.sub(r"<think>.*?</think>", "", content or "", flags=re.S)
    m = re.search(r"\{.*\}", content, re.S)
    if not m:
        raise RuntimeError("The vision model did not return JSON.")
    data = json.loads(m.group(0))
    if not isinstance(data, dict):
        raise RuntimeError("The vision model returned an unexpected shape.")
    return data


async def _groq(image_url: str, logos: list[dict]) -> tuple[dict, str]:
    key = os.getenv("GROQ_API_KEY", "").strip()
    model = os.getenv("GROQ_VISION_MODEL", "").strip() or DEFAULT_GROQ_VISION
    content = [{"type": "text", "text": _prompt(len(logos), [l.get("variant", "") for l in logos])},
               {"type": "image_url", "image_url": {"url": image_url}}]
    content += [{"type": "image_url", "image_url": {"url": l["url"]}} for l in logos[:2]]  # Groq allows 3 images
    body = {"model": model, "temperature": 0.1, "max_completion_tokens": 900,
            "messages": [{"role": "user", "content": content}],
            "response_format": {"type": "json_object"}}
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post("https://api.groq.com/openai/v1/chat/completions",
                                headers={"Authorization": f"Bearer {key}"}, json=body)
    if res.status_code == 429:
        raise RuntimeError("Groq rate limit reached for the vision model.")
    if res.is_error:
        try:
            msg = res.json().get("error", {}).get("message", res.text)
        except Exception:  # noqa: BLE001
            msg = res.text
        raise RuntimeError(f"Groq vision {res.status_code}: {msg[:200]}")
    return _parse(res.json()["choices"][0]["message"].get("content") or ""), f"groq:{model}"


def _inline(data_url: str) -> dict:
    mime, data = data_url.split(";base64,", 1)
    return {"inline_data": {"mime_type": mime.replace("data:", ""), "data": data}}


async def _gemini(image_url: str, logos: list[dict]) -> tuple[dict, str]:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_VISION_MODEL", "").strip() or DEFAULT_GEMINI_VISION
    parts = [{"text": _prompt(len(logos), [l.get("variant", "") for l in logos])}, _inline(image_url)]
    parts += [_inline(l["url"]) for l in logos[:3]]
    body = {"contents": [{"parts": parts}],
            "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}}
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": key}, json=body)
    if res.is_error:
        raise RuntimeError(f"Gemini vision {res.status_code}: {res.text[:200]}")
    cand = (res.json().get("candidates") or [{}])[0]
    text = "".join(p.get("text", "") for p in cand.get("content", {}).get("parts", []))
    return _parse(text), f"gemini:{model}"


def available() -> bool:
    return bool(os.getenv("GROQ_API_KEY", "").strip() or os.getenv("GEMINI_API_KEY", "").strip())


async def describe(image_url: str, logos: list[dict]) -> tuple[dict, str]:
    """Returns (raw model JSON, provider). Raises RuntimeError when every provider fails."""
    errors = []
    if os.getenv("GROQ_API_KEY", "").strip():
        try:
            return await _groq(image_url, logos)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc)[:200])
    if os.getenv("GEMINI_API_KEY", "").strip():
        try:
            return await _gemini(image_url, logos)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc)[:200])
    raise RuntimeError("; ".join(errors) or "No vision model key is set (GROQ_API_KEY or GEMINI_API_KEY).")
