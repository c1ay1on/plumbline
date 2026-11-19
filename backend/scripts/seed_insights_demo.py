"""Opt-in demo data for Governance Insights screenshots and judging.

Creates (or reuses) a workspace with an owner + 4 creators across 3 teams and
~24 posts with realistic findings, contests and review timestamps.

    cd backend
    python -m scripts.seed_insights_demo           # prints the login
    python -m scripts.seed_insights_demo --reset   # wipe the demo workspace first

Never run this against a real workspace: it overwrites the 'posts' key.
"""
from __future__ import annotations

import argparse
import json
import random
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from app.database.db import connect, init_db
from app.routes.auth import hash_password

OWNER_EMAIL = "demo.owner@plumbline-demo.com"
PASSWORD = "plumbline-demo"
PEOPLE = [("Asha Rao", "Marketing"), ("Ravi Patil", "Admissions"),
          ("Neha Joshi", "Marketing"), ("Kabir Shah", "Alumni Relations")]
RULES = [
    ("Terminology §2.1 — say 'learners', not 'students' in campaigns", "terminology", "warning"),
    ("Claims §4.3 — rankings need a cited source", "unsupported_claim", "critical"),
    ("Tone §1.2 — LinkedIn stays formal", "tone_mismatch", "warning"),
    ("Facts §3.4 — fee figures must match 2026 prospectus", "outdated_info", "critical"),
    ("Accessibility §6.1 — every image needs alt text", "alt_text_missing", "suggestion"),
    ("Visual §5.2 — use the primary logo on light backgrounds", "wrong_logo", "warning"),
]


def risk_score(findings: list[dict]) -> dict:
    open_ = [f for f in findings if f["status"] in ("open", "contested")]
    c = sum(f["severity"] == "critical" for f in open_)
    w = sum(f["severity"] == "warning" for f in open_)
    s = sum(f["severity"] == "suggestion" for f in open_)
    score = min(100, c * 30 + w * 10 + s * 5)
    return {"overallScore": score, "riskCategory": "high" if score > 50 else "medium" if score > 20 else "low",
            "breakdown": {"unsupportedClaims": 0, "visualAssets": 0, "messagingViolations": 0, "terminology": 0,
                          "accessibility": 0, "toneInconsistencies": 0},
            "criticalCount": c, "warningCount": w, "suggestionCount": s}


def iso(dt: datetime) -> str:
    return dt.isoformat()


def main(reset: bool) -> None:
    init_db()
    rnd = random.Random(42)
    now = datetime.now(timezone.utc)
    with connect() as db:
        owner = db.execute("SELECT * FROM users WHERE email=?", (OWNER_EMAIL,)).fetchone()
        if owner and reset:
            db.execute("DELETE FROM users WHERE workspace_id=?", (owner["workspace_id"],))
            db.execute("DELETE FROM workspace_data WHERE workspace_id=?", (owner["workspace_id"],))
            owner = None
        if not owner:
            ws = str(uuid.uuid4())
            people = [("Demo Owner", OWNER_EMAIL, "owner", "Brand Office")] + [
                (n, f"{n.split()[0].lower()}@plumbline-demo.com", "employee", d) for n, d in PEOPLE]
            for name, email, role, dept in people:
                salt = secrets.token_hex(16)
                db.execute(
                    "INSERT INTO users(id,full_name,email,password_hash,password_salt,role,workspace_id,created_at,last_login,department) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (str(uuid.uuid4()), name, email, hash_password(PASSWORD, salt), salt, role, ws, iso(now), iso(now), dept))
            owner = db.execute("SELECT * FROM users WHERE email=?", (OWNER_EMAIL,)).fetchone()
        ws = owner["workspace_id"]
        creators = db.execute("SELECT id,full_name FROM users WHERE workspace_id=? AND role='employee'", (ws,)).fetchall()

        posts = []
        for i in range(24):
            c = creators[i % len(creators)]
            created = now - timedelta(days=rnd.uniform(0, 55))
            weight = 1.8 if "Ravi" in c["full_name"] else 1.0
            findings = []
            for j, (rule, cat, sev) in enumerate(RULES):
                if rnd.random() < 0.28 * weight * (1.6 if j == 0 else 1):
                    status = rnd.choices(["open", "fixed", "accepted", "contested", "rejected"], [3, 3, 2, 2 if j == 0 else 0.5, 1])[0]
                    findings.append({
                        "id": f"f-{uuid.uuid4()}", "category": cat, "severity": sev, "issueTitle": rule.split(" — ")[1],
                        "description": "", "affectedContent": "", "sourceReference": rule, "guidelineVersion": "v3",
                        "suggestedCorrection": "", "confidence": 0.8, "status": status,
                        "statusUpdatedAt": iso(created + timedelta(minutes=rnd.randint(5, 90))),
                        **({"userAction": "contested", "contestedReason": "Rule is unclear for this audience"} if status == "contested" else {}),
                    })
            trail = [{"id": f"r-{uuid.uuid4()}", "version": "v1", "timestamp": iso(created), "userName": c["full_name"],
                      "userRole": "Social Media Creator", "action": "Created post draft"}]
            status = "draft"
            if rnd.random() < 0.85:
                submitted = created + timedelta(hours=rnd.uniform(2, 6))
                trail.append({"id": f"r-{uuid.uuid4()}", "version": "v2", "timestamp": iso(submitted), "userName": c["full_name"],
                              "userRole": "Social Media Creator", "action": "Submitted for approval"})
                status = "in_review"
                if rnd.random() < 0.75 and submitted < now - timedelta(hours=30):
                    t = submitted
                    if rnd.random() < 0.3:
                        t += timedelta(hours=rnd.uniform(3, 20))
                        trail.append({"id": f"r-{uuid.uuid4()}", "version": "v2", "timestamp": iso(t), "userName": "Demo Owner",
                                      "userRole": "Manager", "action": "Requested revisions"})
                        t += timedelta(hours=rnd.uniform(1, 6))
                        trail.append({"id": f"r-{uuid.uuid4()}", "version": "v3", "timestamp": iso(t), "userName": c["full_name"],
                                      "userRole": "Social Media Creator", "action": "Submitted for approval"})
                    t += timedelta(hours=rnd.uniform(1.5, 26) * weight)
                    trail.append({"id": f"r-{uuid.uuid4()}", "version": "v3", "timestamp": iso(t), "userName": "Demo Owner",
                                  "userRole": "Manager", "action": "Approved for publishing"})
                    status = "approved"
            posts.append({
                "id": f"post-{uuid.uuid4()}", "campaign": "Admissions 2027", "title": f"Campaign post {i + 1}",
                "originalDescription": "", "creatorId": c["id"], "creatorName": c["full_name"], "creatorRole": "employee",
                "platforms": rnd.sample(["linkedin", "instagram", "x", "facebook"], k=rnd.randint(1, 2)),
                "mediaUrls": [], "mediaType": "image", "platformVariants": {}, "status": status,
                "brandRiskScore": risk_score(findings), "findings": findings, "reviewTrail": trail,
                "version": "v3", "createdAt": iso(created), "updatedAt": iso(created),
            })
        db.execute("""INSERT INTO workspace_data(workspace_id,data_key,payload_json,updated_at) VALUES(?,?,?,?)
                      ON CONFLICT(workspace_id,data_key) DO UPDATE SET payload_json=excluded.payload_json""",
                   (ws, "posts", json.dumps(posts), iso(now)))
        db.execute("""INSERT OR IGNORE INTO workspace_data VALUES(?,?,?,?)""", (ws, "onboarding_completed", "true", iso(now)))
    print(f"Seeded {len(posts)} posts.\nLogin: {OWNER_EMAIL} / {PASSWORD}\nWorkspace: {ws}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true")
    main(ap.parse_args().reset)
