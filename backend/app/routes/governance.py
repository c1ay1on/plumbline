"""Governance endpoints: approval timing, ambiguous rule alerts and guideline versions."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database.db import connect
from app.routes.auth import require_user
from app.services import ambiguity, metrics, versioning

router = APIRouter(prefix="/api/governance", tags=["governance"])


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_workspace_value(db, workspace_id: str, key: str, default: Any) -> Any:
    row = db.execute(
        "SELECT payload_json FROM workspace_data WHERE workspace_id=? AND data_key=?", (workspace_id, key)
    ).fetchone()
    if not row:
        return default
    try:
        return json.loads(row["payload_json"])
    except json.JSONDecodeError:
        return default


def load_alert_states(db, workspace_id: str) -> dict[str, dict]:
    rows = db.execute("SELECT * FROM rule_alerts WHERE workspace_id=?", (workspace_id,)).fetchall()
    states: dict[str, dict] = {}
    for row in rows:
        state = dict(row)
        state["suggestion"] = json.loads(row["suggestion_json"]) if row["suggestion_json"] else None
        states[row["rule_id"]] = state
    return states


def load_table_disputes(db, workspace_id: str, rule_id: str | None = None) -> list[dict]:
    query = "SELECT * FROM rule_disputes WHERE workspace_id=?"
    params: list[Any] = [workspace_id]
    if rule_id:
        query += " AND rule_id=?"
        params.append(rule_id)
    return [dict(row) for row in db.execute(query + " ORDER BY created_at", params).fetchall()]


def current_alerts(db, workspace_id: str, include_closed: bool = False) -> list[dict]:
    posts = load_workspace_value(db, workspace_id, "posts", [])
    guidelines = load_workspace_value(db, workspace_id, "guidelines", {})
    alerts = ambiguity.detect_ambiguous_rules(
        posts, guidelines, load_table_disputes(db, workspace_id), load_alert_states(db, workspace_id),
        include_closed=include_closed,
    )
    for alert in alerts:
        if not alert.get("suggestion") and alert["status"] == "open":
            reasons = [item["reason"] for item in alert["topReasons"]]
            alert["suggestion"] = ambiguity.build_fallback_suggestion(alert, reasons, alert["disputeCount"], alert["flagCount"])
    return alerts


def upsert_alert_state(db, workspace_id: str, rule_id: str, user: dict, **fields: Any) -> None:
    existing = db.execute("SELECT 1 FROM rule_alerts WHERE workspace_id=? AND rule_id=?", (workspace_id, rule_id)).fetchone()
    if not existing:
        db.execute(
            "INSERT INTO rule_alerts(workspace_id,rule_id,status,updated_by,updated_at) VALUES(?,?,?,?,?)",
            (workspace_id, rule_id, "open", user["name"], now()),
        )
    for column, value in fields.items():
        db.execute(f"UPDATE rule_alerts SET {column}=? WHERE workspace_id=? AND rule_id=?", (value, workspace_id, rule_id))
    db.execute("UPDATE rule_alerts SET updated_by=?, updated_at=? WHERE workspace_id=? AND rule_id=?",
               (user["name"], now(), workspace_id, rule_id))


@router.get("/approval-time")
async def approval_time(user: dict = Depends(require_user)):
    with connect() as db:
        posts = load_workspace_value(db, user["workspaceId"], "posts", [])
    return metrics.approval_time_stats(posts)


@router.get("/summary")
async def governance_summary(user: dict = Depends(require_user)):
    with connect() as db:
        posts = load_workspace_value(db, user["workspaceId"], "posts", [])
        guidelines = load_workspace_value(db, user["workspaceId"], "guidelines", {})
        alerts = current_alerts(db, user["workspaceId"])
    return {
        "approvalTime": metrics.approval_time_stats(posts),
        "alerts": alerts,
        "thresholds": ambiguity.thresholds(),
        "currentVersion": guidelines.get("version", "v1"),
    }


class DisputeBody(BaseModel):
    rule_id: str = Field(min_length=1, max_length=200)
    rule_label: str = Field(default="", max_length=300)
    post_id: str = Field(default="", max_length=200)
    finding_id: str = Field(min_length=1, max_length=200)
    reason: str = Field(default="", max_length=2000)
    guideline_version: str = Field(default="", max_length=40)


@router.post("/disputes")
async def record_dispute(body: DisputeBody, user: dict = Depends(require_user)):
    dispute_id = str(uuid.uuid4())
    with connect() as db:
        db.execute(
            """INSERT INTO rule_disputes(id,workspace_id,rule_id,rule_label,post_id,finding_id,reason,guideline_version,disputed_by,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(workspace_id,finding_id) DO UPDATE SET reason=excluded.reason, rule_id=excluded.rule_id,
            rule_label=excluded.rule_label""",
            (dispute_id, user["workspaceId"], body.rule_id, body.rule_label, body.post_id, body.finding_id,
             body.reason.strip(), body.guideline_version, user["name"], now()),
        )
        alerts = current_alerts(db, user["workspaceId"])
    alert = next((item for item in alerts if item["ruleId"] == body.rule_id), None)
    return {"status": "recorded", "ruleId": body.rule_id, "alert": alert}


@router.get("/disputes")
async def list_disputes(rule_id: str | None = None, user: dict = Depends(require_user)):
    with connect() as db:
        return load_table_disputes(db, user["workspaceId"], rule_id)


@router.get("/alerts")
async def list_alerts(include_closed: bool = False, user: dict = Depends(require_user)):
    with connect() as db:
        return {"alerts": current_alerts(db, user["workspaceId"], include_closed), "thresholds": ambiguity.thresholds()}


def find_alert(db, workspace_id: str, rule_id: str) -> dict:
    alert = next((item for item in current_alerts(db, workspace_id, include_closed=True) if item["ruleId"] == rule_id), None)
    if not alert:
        raise HTTPException(status_code=404, detail="No ambiguity alert exists for this rule.")
    return alert


@router.post("/alerts/{rule_id}/suggestion")
async def suggest_clarification(rule_id: str, user: dict = Depends(require_user)):
    with connect() as db:
        alert = find_alert(db, user["workspaceId"], rule_id)
        disputes = load_table_disputes(db, user["workspaceId"], rule_id)
    reasons = [item["reason"] for item in alert["topReasons"]] + [row["reason"] for row in disputes if row["reason"]]
    suggestion = await ambiguity.generate_suggestion(alert, list(dict.fromkeys(reasons)), alert["disputeCount"], alert["flagCount"])
    with connect() as db:
        upsert_alert_state(db, user["workspaceId"], rule_id, user, suggestion_json=json.dumps(suggestion))
    return {**alert, "suggestion": suggestion}


class AlertActionBody(BaseModel):
    note: str = Field(default="", max_length=1000)
    version: str = Field(default="", max_length=40)


@router.post("/alerts/{rule_id}/dismiss")
async def dismiss_alert(rule_id: str, body: AlertActionBody | None = None, user: dict = Depends(require_user)):
    body = body or AlertActionBody()
    with connect() as db:
        upsert_alert_state(db, user["workspaceId"], rule_id, user, status="dismissed", closed_at=now(),
                           resolution_note=body.note)
    return {"status": "dismissed", "ruleId": rule_id}


@router.post("/alerts/{rule_id}/resolve")
async def resolve_alert(rule_id: str, body: AlertActionBody | None = None, user: dict = Depends(require_user)):
    body = body or AlertActionBody()
    with connect() as db:
        upsert_alert_state(db, user["workspaceId"], rule_id, user, status="resolved", closed_at=now(),
                           resolved_version=body.version or None, resolution_note=body.note)
    return {"status": "resolved", "ruleId": rule_id, "version": body.version}


class VersionBody(BaseModel):
    id: str | None = Field(default=None, max_length=80)
    previous_id: str | None = Field(default=None, max_length=80)
    version_number: int = Field(ge=1)
    change_summary: str = Field(default="", max_length=2000)
    rules: dict | None = None
    previous_rules: dict | None = None


def version_row(row, include_rules: bool = False) -> dict:
    item = {
        "id": row["id"], "versionNumber": row["version_number"], "version": f"v{row['version_number']}",
        "changeSummary": row["change_summary"], "createdBy": row["created_by"], "createdAt": row["created_at"],
    }
    if include_rules:
        item["rules"] = json.loads(row["rules_json"])
    return item


def load_changes(db, version_id: str) -> list[dict]:
    rows = db.execute("SELECT * FROM guideline_rule_changes WHERE version_id=?", (version_id,)).fetchall()
    return [{
        "ruleId": row["rule_id"], "kind": row["rule_kind"], "label": row["rule_label"], "changeType": row["change_type"],
        "fields": json.loads(row["fields_json"]),
        "before": json.loads(row["before_json"]) if row["before_json"] else None,
        "after": json.loads(row["after_json"]) if row["after_json"] else None,
    } for row in rows]


def store_version(db, workspace_id: str, number: int, rules: dict, summary: str, created_by: str,
                  previous: dict | None, client_id: str | None = None) -> tuple[str, list[dict]]:
    changes = versioning.diff_rules(previous, rules) if previous is not None else []
    existing = db.execute("SELECT id FROM guideline_versions WHERE workspace_id=? AND version_number=?",
                          (workspace_id, number)).fetchone()
    # The client sends the id it stamped on reviews so both sides use the same version id.
    version_id = existing["id"] if existing else (client_id or str(uuid.uuid4()))
    if existing:
        # Saving the same version twice (for example a retried request) replaces its record.
        db.execute("DELETE FROM guideline_rule_changes WHERE version_id=?", (version_id,))
        db.execute("UPDATE guideline_versions SET rules_json=?, change_summary=?, created_by=? WHERE id=?",
                   (json.dumps(rules), summary, created_by, version_id))
    else:
        db.execute(
            "INSERT INTO guideline_versions(id,workspace_id,version_number,rules_json,change_summary,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
            (version_id, workspace_id, number, json.dumps(rules), summary, created_by, now()),
        )
    for change in changes:
        db.execute(
            """INSERT INTO guideline_rule_changes(id,version_id,workspace_id,rule_id,rule_kind,rule_label,change_type,fields_json,before_json,after_json)
            VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (str(uuid.uuid4()), version_id, workspace_id, change["ruleId"], change["kind"], change["label"],
             change["changeType"], json.dumps(change["fields"]),
             json.dumps(change["before"]) if change["before"] is not None else None,
             json.dumps(change["after"]) if change["after"] is not None else None),
        )
    return version_id, changes


@router.post("/versions")
async def create_version(body: VersionBody, user: dict = Depends(require_user)):
    workspace_id = user["workspaceId"]
    with connect() as db:
        rules = body.rules or versioning.snapshot_rules(load_workspace_value(db, workspace_id, "guidelines", {}))
        previous_row = db.execute(
            "SELECT * FROM guideline_versions WHERE workspace_id=? AND version_number<? ORDER BY version_number DESC LIMIT 1",
            (workspace_id, body.version_number),
        ).fetchone()
        if previous_row:
            previous = json.loads(previous_row["rules_json"])
        elif body.previous_rules is not None and body.version_number > 1:
            # First version recorded on the server: keep the baseline the client edited from.
            previous = body.previous_rules
            store_version(db, workspace_id, body.version_number - 1, previous, "Baseline before first tracked change",
                          user["name"], None, body.previous_id)
        else:
            previous = body.previous_rules
        version_id, changes = store_version(db, workspace_id, body.version_number, rules, body.change_summary,
                                            user["name"], previous, body.id)
        posts = load_workspace_value(db, workspace_id, "posts", [])
        row = db.execute("SELECT * FROM guideline_versions WHERE id=?", (version_id,)).fetchone()
    return {"version": version_row(row), "changes": changes,
            "impact": versioning.compute_impact(posts, changes, body.version_number)}


@router.get("/versions")
async def list_versions(user: dict = Depends(require_user)):
    with connect() as db:
        rows = db.execute("SELECT * FROM guideline_versions WHERE workspace_id=? ORDER BY version_number DESC",
                          (user["workspaceId"],)).fetchall()
        counts = {row["version_id"]: row["total"] for row in db.execute(
            "SELECT version_id, COUNT(*) AS total FROM guideline_rule_changes WHERE workspace_id=? GROUP BY version_id",
            (user["workspaceId"],)).fetchall()}
    return [{**version_row(row), "changeCount": counts.get(row["id"], 0)} for row in rows]


def get_version_row(db, workspace_id: str, number: int):
    row = db.execute("SELECT * FROM guideline_versions WHERE workspace_id=? AND version_number=?",
                     (workspace_id, number)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Guideline version v{number} was not found.")
    return row


@router.get("/versions/{number}")
async def get_version(number: int, user: dict = Depends(require_user)):
    with connect() as db:
        row = get_version_row(db, user["workspaceId"], number)
        return {**version_row(row, include_rules=True), "changes": load_changes(db, row["id"])}


@router.get("/versions/{number}/diff")
async def diff_version(number: int, against: int | None = None, user: dict = Depends(require_user)):
    with connect() as db:
        row = get_version_row(db, user["workspaceId"], number)
        if against is None:
            base = db.execute(
                "SELECT * FROM guideline_versions WHERE workspace_id=? AND version_number<? ORDER BY version_number DESC LIMIT 1",
                (user["workspaceId"], number),
            ).fetchone()
        else:
            base = get_version_row(db, user["workspaceId"], against)
    base_rules = json.loads(base["rules_json"]) if base else versioning.snapshot_rules({})
    return {"version": f"v{number}", "against": f"v{base['version_number']}" if base else None,
            "changes": versioning.diff_rules(base_rules, json.loads(row["rules_json"]))}


@router.get("/impact")
async def change_impact(version: int | None = None, user: dict = Depends(require_user)):
    """Pending reviews affected by the rule changes saved in a version (latest by default)."""
    with connect() as db:
        if version is None:
            row = db.execute("SELECT * FROM guideline_versions WHERE workspace_id=? ORDER BY version_number DESC LIMIT 1",
                             (user["workspaceId"],)).fetchone()
            if not row:
                return versioning.compute_impact([], [], 1)
        else:
            row = get_version_row(db, user["workspaceId"], version)
        changes = load_changes(db, row["id"])
        posts = load_workspace_value(db, user["workspaceId"], "posts", [])
    return {**versioning.compute_impact(posts, changes, row["version_number"]), "changes": changes}
