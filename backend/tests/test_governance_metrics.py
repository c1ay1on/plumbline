"""Unit + API tests for Governance Insights. Run: cd backend && pytest -q"""
from datetime import datetime, timedelta, timezone

from app.services import governance_metrics as gm

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)


def ts(hours_ago: float) -> str:
    return (NOW - timedelta(hours=hours_ago)).isoformat()


def finding(fid, rule, sev="warning", status="open", cat="terminology", updated=None):
    f = {"id": fid, "category": cat, "severity": sev, "sourceReference": rule, "status": status}
    if updated:
        f["statusUpdatedAt"] = updated
    return f


def post(pid, creator, findings, trail, platforms=("linkedin",), created=48):
    return {"id": pid, "creatorId": creator, "platforms": list(platforms), "createdAt": ts(created),
            "status": "draft", "findings": findings, "brandRiskScore": {"overallScore": 0},
            "reviewTrail": [{"action": a, "timestamp": ts(h)} for a, h in trail]}


MEMBERS = [{"id": "u1", "name": "Asha", "department": "Marketing"},
           {"id": "u2", "name": "Ravi", "department": "Admissions"},
           {"id": "u3", "name": "Neel", "department": ""}]

POSTS = [
    # Marketing: fixed one finding before submitting, approved 10h after submit
    post("p1", "u1",
         [finding("f1", "Terminology §2.1", status="fixed", updated=ts(30)),
          finding("f2", "Claims §4.3", sev="critical")],
         [("Created post draft", 40), ("Submitted for approval", 20), ("Approved for publishing", 10)]),
    # Admissions: contested + rejected (false positive), approved 4h after first submit
    post("p2", "u2",
         [finding("f3", "Terminology §2.1", status="contested"),
          finding("f4", "Tone §1.2", status="rejected")],
         [("Created post draft", 30), ("Submitted for approval", 12), ("Requested revisions", 10),
          ("Submitted for approval", 9), ("Approved for publishing", 8)], platforms=("instagram",)),
    # Unassigned: clean post, never submitted
    post("p3", "u3", [], [("Created post draft", 5)]),
]


def test_most_violated_rules_counts_and_skips_false_positives():
    rows = gm.most_violated_rules(POSTS)
    top = rows[0]
    assert top["ruleId"] == "check:terminology"
    assert top["rule"] == "Terminology §2.1" and top["count"] == 2 and top["postsAffected"] == 2
    assert top["contested"] == 1
    assert all(r["rule"] != "Tone §1.2" for r in rows)  # rejected = not a violation


def test_rule_falls_back_to_category_when_no_citation():
    rows = gm.most_violated_rules([post("p", "u1", [finding("x", "", cat="alt_text_missing")], [])])
    assert rows[0]["rule"] == "Media alt text check"  # same label as the alerts module
    assert rows[0]["ruleId"] == "check:alt_text_missing"


def test_error_rate_by_team():
    members = {m["id"]: m for m in MEMBERS}
    rows = {r["team"]: r for r in gm.error_rate_by_team(POSTS, members)}
    assert rows["Marketing"]["rate"] == 100.0
    assert rows["Admissions"]["rate"] == 100.0  # contested warning still counts until resolved
    assert rows[gm.UNASSIGNED_TEAM]["rate"] == 0.0


def test_drafts_fixed_before_review():
    out = gm.drafts_fixed_before_review(POSTS)
    assert out["submittedDrafts"] == 2
    assert out["draftsFixedBeforeReview"] == 1
    assert out["rate"] == 50.0


def test_fix_after_submission_does_not_count():
    p = post("p", "u1", [finding("f", "R", status="fixed", updated=ts(1))],
             [("Submitted for approval", 5)])
    assert gm.drafts_fixed_before_review([p])["draftsFixedBeforeReview"] == 0


def test_approval_time_matches_review_cycles():
    # p1: submit -> approve = 10h. p2: second submit -> approve = 1h (first cycle ended in revisions).
    out = gm.approval_times(POSTS)
    assert out["approvedPosts"] == 2
    assert out["avgHours"] == 5.5
    assert out["medianHours"] == 5.5


def test_groups_by_stamped_rule_id_and_terminology_rule():
    guidelines = {"terminology": [{"id": "term-kids", "bannedTerm": "kids", "preferredTerm": "students"}]}
    posts = [post("a", "u1", [{"id": "1", "category": "terminology", "severity": "warning", "status": "open",
                              "affectedContent": "Kids won", "issueTitle": "", "sourceReference": "Terminology"}], []),
             post("b", "u1", [{"id": "2", "category": "terminology", "severity": "warning", "status": "contested",
                              "ruleId": "term-kids", "sourceReference": "Other text"}], [])]
    rows = gm.most_violated_rules(posts, guidelines=guidelines)
    assert len(rows) == 1 and rows[0]["ruleId"] == "term-kids" and rows[0]["count"] == 2
    assert rows[0]["rule"] == '"kids" -> "students"' and rows[0]["contested"] == 1


def test_empty_workspace_returns_none_not_zero():
    out = gm.build_insights([], [], now=NOW)
    assert out["approvalTime"]["avgHours"] is None
    assert out["fixedBeforeReview"]["rate"] is None
    assert out["mostViolatedRules"] == []


def test_filters():
    members = {m["id"]: m for m in MEMBERS}
    assert [p["id"] for p in gm.filter_posts(POSTS, members, team="Marketing", now=NOW)] == ["p1"]
    assert [p["id"] for p in gm.filter_posts(POSTS, members, platform="instagram", now=NOW)] == ["p2"]
    assert [p["id"] for p in gm.filter_posts(POSTS, members, days=1, now=NOW)] == []
