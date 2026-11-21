from datetime import datetime, timezone
import os

from fastapi import APIRouter

from app.database.db import connect
from app.services.groq_client import groq_configured, groq_key, groq_post  # noqa: F401

router = APIRouter(tags=["Health"])


@router.get("/health")
def health_check():
    database_connected = False
    try:
        with connect() as db:
            db.execute("SELECT 1").fetchone()
        database_connected = True
    except Exception:
        database_connected = False

    ai_configured = groq_configured()
    healthy = database_connected
    return {
        "status": "ok" if healthy else "degraded",
        "service": "plumbline-backend",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "mode": os.getenv("ENVIRONMENT", "development"),
        "database": "connected" if database_connected else "unavailable",
        "ai_engine": "configured" if ai_configured else "not_configured",
        "version": "2.0.0",
    }
