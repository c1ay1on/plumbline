"""Governance Insights analytics API.

GET /api/analytics/governance        -> every dashboard metric, filtered
GET /api/analytics/governance.csv    -> the same data as a CSV report
"""
from __future__ import annotations

import csv
import io
import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.database.db import connect
from app.routes.auth import require_user
from app.services.governance_metrics import build_insights

router = APIRouter(prefix="/api/analytics", tags=["analytics"])
INSIGHT_ROLES = {"owner", "admin", "manager", "approver"}


def _load(workspace_id: str) -> tuple[list[dict], list[dict], dict | None]:
    with connect() as db:
        row = db.execute(
            "SELECT payload_json FROM workspace_data WHERE workspace_id=? AND data_key='posts'", (workspace_id,)
        ).fetchone()
        g_row = db.execute(
            "SELECT payload_json FROM workspace_data WHERE workspace_id=? AND data_key='guidelines'", (workspace_id,)
        ).fetchone()
        users = db.execute(
            "SELECT id,full_name,role,department FROM users WHERE workspace_id=? ORDER BY created_at", (workspace_id,)
        ).fetchall()
    try:
        posts = json.loads(row["payload_json"]) if row else []
    except (json.JSONDecodeError, TypeError):
        posts = []
    try:
        guidelines = json.loads(g_row["payload_json"]) if g_row else None
    except (json.JSONDecodeError, TypeError):
        guidelines = None
    members = [{"id": u["id"], "name": u["full_name"], "role": u["role"], "department": u["department"] or ""} for u in users]
    return (posts if isinstance(posts, list) else []), members, (guidelines if isinstance(guidelines, dict) else None)


def _insights(user: dict, days: int | None, team: str | None, platform: str | None, creator_id: str | None) -> dict:
    posts, members, guidelines = _load(user["workspaceId"])
    # Creators only ever see their own history; reviewers and admins see the workspace.
    if user["role"] not in INSIGHT_ROLES:
        creator_id = user["id"]
        team = None
    return build_insights(posts, members, guidelines, days=days, team=team or None,
                          platform=platform or None, creator_id=creator_id or None)


@router.get("/governance")
async def governance_insights(
    days: int | None = Query(default=None, ge=1, le=3650, description="Only posts created in the last N days"),
    team: str | None = Query(default=None),
    platform: Literal["linkedin", "instagram", "x", "facebook", "threads", "youtube"] | None = None,
    creator_id: str | None = None,
    user: dict = Depends(require_user),
):
    return _insights(user, days, team, platform, creator_id)


@router.get("/governance.csv")
async def governance_report_csv(
    days: int | None = Query(default=None, ge=1, le=3650),
    team: str | None = None,
    platform: str | None = None,
    creator_id: str | None = None,
    user: dict = Depends(require_user),
):
    if user["role"] not in INSIGHT_ROLES:
        raise HTTPException(status_code=403, detail="Reports are available to reviewers and admins.")
    data = _insights(user, days, team, platform, creator_id)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Plumbline Governance Insights", data["generatedAt"]])
    w.writerow(["Posts in scope", data["postsInScope"]])
    a, f = data["approvalTime"], data["fixedBeforeReview"]
    w.writerow(["Average approval time (hours)", a["avgHours"] if a["avgHours"] is not None else "n/a"])
    w.writerow(["Median approval time (hours)", a["medianHours"] if a["medianHours"] is not None else "n/a"])
    w.writerow(["Drafts fixed before review", f["draftsFixedBeforeReview"], "of", f["submittedDrafts"]])
    w.writerow([])
    w.writerow(["Most violated rules"])
    w.writerow(["Rule", "Rule ID", "Category", "Violations", "Posts affected", "Critical", "Warning", "Suggestion", "Disputed"])
    for r in data["mostViolatedRules"]:
        w.writerow([r["rule"], r["ruleId"], r["category"], r["count"], r["postsAffected"], r["critical"], r["warning"], r["suggestion"], r["contested"]])
    w.writerow([])
    w.writerow(["Error rate by team"])
    w.writerow(["Team", "Posts", "Posts with errors", "Error rate %", "Avg serious findings/post"])
    for r in data["errorRateByTeam"]:
        w.writerow([r["team"], r["posts"], r["postsWithErrors"], r["rate"], r["avgSeriousFindingsPerPost"]])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=plumbline-governance-insights.csv"})
