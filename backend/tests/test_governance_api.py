"""End-to-end check of the governance routes against a temporary SQLite database."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ["DATABASE_PATH"] = str(Path(tempfile.mkdtemp()) / "test.sqlite3")
os.environ.pop("GROQ_API_KEY", None)

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402

RULE = {"id": "term-kids", "context": "Student body", "preferredTerm": "students", "bannedTerm": "kids",
        "explanation": "Avoid informal words where possible.", "platforms": ["all"]}


def snapshot(explanation: str) -> dict:
    return {"terminology": [{**RULE, "explanation": explanation}], "facts": [],
            "voice": {"tones": [], "customToneDescription": "", "platformRules": {}}}


def make_post(index: int, status: str = "in_review") -> dict:
    return {
        "id": f"post-{index}", "title": f"Post {index}", "status": status, "originalDescription": "Our kids rock",
        "platformVariants": {}, "guidelineVersion": "v1", "createdAt": "2026-11-01T00:00:00+00:00",
        "reviewTrail": [
            {"action": "Submitted for approval", "timestamp": "2026-11-01T00:00:00+00:00"},
            *([{"action": "Approved for publishing", "timestamp": f"2026-11-01T0{index + 1}:00:00+00:00"}] if status == "approved" else []),
        ],
        "findings": [{"id": f"finding-{index}", "ruleId": "term-kids", "category": "terminology", "status": "open",
                      "affectedContent": "kids", "guidelineVersion": "v1"}],
    }


def test_governance_flow():
    with TestClient(app) as client:
        auth = client.post("/api/auth/register", json={"full_name": "Rohan Test", "email": "rohan@example.com",
                                                       "password": "password123"}).json()
        headers = {"Authorization": f"Bearer {auth['token']}"}

        empty = client.get("/api/governance/approval-time", headers=headers).json()
        assert empty["meanApprovalHours"] is None

        posts = [make_post(1, "approved"), make_post(2, "approved"), make_post(3), make_post(4)]
        guidelines = {"version": "v1", "terminology": [RULE], "facts": [], "voice": {}}
        saved = client.put("/api/workspace/data", headers=headers, json={"data": {"posts": posts, "guidelines": guidelines}})
        assert saved.status_code == 200

        timing = client.get("/api/governance/approval-time", headers=headers).json()
        assert timing["approvedCount"] == 2 and timing["meanApprovalHours"] == 2.5 and timing["medianApprovalHours"] == 2.5

        for index in (1, 2, 3):
            response = client.post("/api/governance/disputes", headers=headers, json={
                "rule_id": "term-kids", "rule_label": '"kids" -> "students"', "post_id": f"post-{index}",
                "finding_id": f"finding-{index}", "reason": "It is a direct quote", "guideline_version": "v1"})
            assert response.status_code == 200
        alert = response.json()["alert"]
        assert alert and alert["disputeCount"] == 3 and alert["flagCount"] == 4
        assert alert["suggestion"]["source"] == "rules"

        suggestion = client.post("/api/governance/alerts/term-kids/suggestion", headers=headers).json()
        assert "direct quotations" in suggestion["suggestion"]["proposedText"]

        first = client.post("/api/governance/versions", headers=headers, json={
            "version_number": 2, "change_summary": "Clarified kids rule", "rules": snapshot("Use students. Exception: quotes."),
            "previous_rules": snapshot(RULE["explanation"])}).json()
        assert [change["changeType"] for change in first["changes"]] == ["modified"]
        assert first["impact"]["affectedCount"] == 2
        assert "2 pending reviews checked under v1" in first["impact"]["summary"]
        assert first["impact"]["lockedHistoryCount"] == 2

        versions = client.get("/api/governance/versions", headers=headers).json()
        assert [item["version"] for item in versions] == ["v2", "v1"]
        diff = client.get("/api/governance/versions/2/diff", headers=headers).json()
        assert diff["against"] == "v1" and diff["changes"][0]["fields"] == ["explanation"]
        assert client.get("/api/governance/impact", headers=headers).json()["affectedCount"] == 2

        assert client.post("/api/governance/alerts/term-kids/resolve", headers=headers, json={"version": "v2"}).status_code == 200
        assert client.get("/api/governance/alerts", headers=headers).json()["alerts"] == []
        closed = client.get("/api/governance/alerts?include_closed=true", headers=headers).json()["alerts"]
        assert closed[0]["status"] == "resolved" and closed[0]["resolvedVersion"] == "v2"
