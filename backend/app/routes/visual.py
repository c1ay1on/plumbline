"""Improvement 2 API: visual and accessibility audit for an uploaded creative."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.rag.engine import risk_score
from app.routes.auth import require_user
from app.visual import vision
from app.visual.analysis import ImageError
from app.visual.engine import run_visual_audit

router = APIRouter(prefix="/api/visual", tags=["visual"])

MAX_DATA_URL = 8 * 1024 * 1024  # about 6 MB of image


class LogoIn(BaseModel):
    name: str = ""
    variant: str = "primary"
    url: str = ""


class VisualAuditBody(BaseModel):
    image: str = Field(min_length=30, description="data:image/...;base64,... (videos: a thumbnail frame)")
    colors: dict[str, str] | None = None
    logos: list[LogoIn] = []
    altText: str = ""
    guidelineVersion: str = "v1"
    mediaKind: str = "image"
    useAi: bool = True


@router.get("/status")
async def visual_status(user: dict = Depends(require_user)):
    return {"visionModel": vision.available()}


@router.post("/audit")
async def visual_audit(body: VisualAuditBody, user: dict = Depends(require_user)):
    if len(body.image) > MAX_DATA_URL:
        raise HTTPException(status_code=413, detail="The image is too large. Use one under 6 MB.")
    logos = [l.model_dump() for l in body.logos if len(l.url) <= 1_200_000]
    try:
        result = await run_visual_audit(body.image, body.colors, logos, body.altText,
                                        body.guidelineVersion, body.useAi, body.mediaKind)
    except ImageError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    result["score"] = risk_score(result["findings"])
    return result
