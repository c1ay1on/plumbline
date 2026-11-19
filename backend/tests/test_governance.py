"""Tests for ambiguity detection, guideline versioning and approval timing."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services import ambiguity, metrics, versioning  # noqa: E402

GUIDELINES = {
    "version": "v3",
    "terminology": [
        {"id": "term-kids", "context": "Student body", "preferredTerm": "students", "bannedTerm": "kids",
         "explanation": "Avoid informal words where possible.", "platforms": ["all"]},
        {"id": "term-cheap", "context": "Pricing", "preferredTerm": "affordable", "bannedTerm": "cheap",
         "explanation": "Cheap sounds low quality.", "platforms": ["all"]},
    ],
    "facts": [{"id": "fact-1", "fact": "Accredited by NAAC A+", "source": "NAAC 2025", "category": "Accreditation",
               "approvalStatus": "approved"}],
    "voice": {"tones": ["Professional"], "customToneDescription": "Clear", "platformRules": {"linkedin": "Formal"}},
}


def finding(fid, rule_id, status="open", reason="", category="terminology", version="v3"):
    return {"id": fid, "ruleId": rule_id, "category": category, "status": status, "contestedReason": reason,
            "affectedContent": "kids", "guidelineVersion": version, "disputedAt": "2026-11-10T10:00:00+00:00"}


def post(pid, findings, status="in_review", text="Our kids love campus", version="v3"):
    return {"id": pid, "title": pid, "status": status, "originalDescription": text, "platformVariants": {},
            "findings": findings, "guidelineVersion": version, "createdAt": "2026-11-01T10:00:00+00:00"}


def test_rule_with_three_disputes_is_ambiguous():
    posts = [
        post("p1", [finding("f1", "term-kids", "contested", "It is a quote from a parent")]),
        post("p2", [finding("f2", "term-kids", "contested", "Quoting a student directly")]),
        post("p3", [finding("f3", "term-kids", "rejected", "It is a quote from a parent")]),
        post("p4", [finding("f4", "term-kids")]),
        post("p5", [finding("f5", "term-cheap")]),
    ]
    alerts = ambiguity.detect_ambiguous_rules(posts, GUIDELINES)
    assert [alert["ruleId"] for alert in alerts] == ["term-kids"]
    alert = alerts[0]
    assert alert["disputeCount"] == 3 and alert["flagCount"] == 4
    assert alert["topReasons"][0] == {"reason": "It is a quote from a parent", "count": 2}


def test_dispute_rate_threshold_and_below_threshold():
    limits = {"minDisputes": 3, "minFlagsForRate": 3, "disputeRate": 0.4}
    assert ambiguity.is_ambiguous(5, 2, limits)       # 40 percent of 5 flags
    assert not ambiguity.is_ambiguous(6, 2, limits)   # 33 percent
    assert not ambiguity.is_ambiguous(2, 1, limits)   # not enough flags for the rate rule
    assert ambiguity.is_ambiguous(10, 3, limits)      # absolute count


def test_table_disputes_merge_with_post_findings_without_double_counting():
    posts = [post("p1", [finding("f1", "term-kids", "contested", "quote")]), post("p2", [finding("f2", "term-kids")]),
             post("p3", [finding("f3", "term-kids")])]
    table = [{"rule_id": "term-kids", "finding_id": "f1", "reason": "quote", "created_at": "2026-11-10T10:00:00+00:00"},
             {"rule_id": "term-kids", "finding_id": "f2", "reason": "name of a club", "created_at": "2026-11-10T11:00:00+00:00"}]
    alerts = ambiguity.detect_ambiguous_rules(posts, GUIDELINES, table)
    assert alerts[0]["disputeCount"] == 2 and alerts[0]["flagCount"] == 3


def test_resolved_alert_only_counts_new_disputes():
    posts = [post(f"p{i}", [finding(f"f{i}", "term-kids", "contested", "quote")]) for i in range(4)]
    states = {"term-kids": {"status": "resolved", "closed_at": "2026-11-11T00:00:00+00:00", "resolved_version": "v4"}}
    assert ambiguity.detect_ambiguous_rules(posts, GUIDELINES, [], states) == []
    closed = ambiguity.detect_ambiguous_rules(posts, GUIDELINES, [], states, include_closed=True)
    assert closed[0]["status"] == "resolved"


def test_fallback_suggestion_uses_reasons_and_flags_vague_words():
    rule = ambiguity.rule_catalogue(GUIDELINES)["term-kids"]
    suggestion = ambiguity.build_fallback_suggestion(rule, ["It is a direct quote", "Name of the Kids Club"], 3, 4)
    assert suggestion["source"] == "rules"
    assert "avoid" in suggestion["vagueTerms"] and "where possible" in suggestion["vagueTerms"]
    assert "direct quotations" in suggestion["proposedText"]
    assert "official names" in suggestion["proposedText"]
    assert 'Use "students" instead of "kids"' in suggestion["proposedText"]


@pytest.mark.anyio
async def test_generate_suggestion_without_key_falls_back(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    rule = ambiguity.rule_catalogue(GUIDELINES)["term-kids"]
    result = await ambiguity.generate_suggestion(rule, ["quote"], 3, 3)
    assert result["source"] == "rules"


def test_diff_rules_detects_added_modified_removed():
    before = versioning.snapshot_rules(GUIDELINES)
    changed = {**GUIDELINES, "terminology": [
        {**GUIDELINES["terminology"][0], "explanation": "Use students. Exceptions: direct quotes."},
        {"id": "term-guys", "context": "General", "preferredTerm": "everyone", "bannedTerm": "guys",
         "explanation": "", "platforms": ["all"]},
    ]}
    changes = versioning.diff_rules(before, versioning.snapshot_rules(changed))
    by_type = {(change["ruleId"], change["changeType"]) for change in changes}
    assert by_type == {("term-kids", "modified"), ("term-guys", "added"), ("term-cheap", "removed")}
    modified = next(change for change in changes if change["changeType"] == "modified")
    assert modified["fields"] == ["explanation"]


def test_impact_only_marks_pending_posts_from_older_versions():
    before = versioning.snapshot_rules(GUIDELINES)
    after_guidelines = {**GUIDELINES, "terminology": [{**GUIDELINES["terminology"][0], "explanation": "changed"}]}
    changes = versioning.diff_rules(before, versioning.snapshot_rules(after_guidelines))
    posts = [
        post("pending-old", [finding("a", "term-kids")], status="in_review", version="v3"),
        post("draft-old-cheap", [finding("b", "term-cheap")], status="draft", text="cheap fees", version="v2"),
        post("approved-old", [finding("c", "term-kids")], status="approved", version="v3"),
        post("pending-new", [finding("d", "term-kids")], status="in_review", version="v4"),
        post("pending-unrelated", [], status="in_review", text="hello", version="v3"),
    ]
    impact = versioning.compute_impact(posts, changes, 4)
    assert sorted(item["postId"] for item in impact["affected"]) == ["draft-old-cheap", "pending-old"]
    assert impact["lockedHistoryCount"] == 1
    assert "1 pending review checked under v2" in impact["summary"]
    assert "1 pending review checked under v3" in impact["summary"]


def test_approval_time_mean_and_median():
    posts = [
        {"id": "a", "status": "approved", "createdAt": "2026-11-01T00:00:00+00:00", "reviewTrail": [
            {"action": "Created post draft", "timestamp": "2026-11-01T00:00:00+00:00"},
            {"action": "Submitted for approval", "timestamp": "2026-11-01T01:00:00+00:00"},
            {"action": "Approved for publishing", "timestamp": "2026-11-01T03:00:00+00:00"}]},
        {"id": "b", "status": "approved", "createdAt": "2026-11-02T00:00:00+00:00", "reviewTrail": [
            {"action": "Submitted for approval", "timestamp": "2026-11-02T00:00:00+00:00"},
            {"action": "Requested revisions", "timestamp": "2026-11-02T01:00:00+00:00"},
            {"action": "Submitted for approval", "timestamp": "2026-11-02T02:00:00+00:00"},
            {"action": "Approved for publishing", "timestamp": "2026-11-02T12:00:00+00:00"}]},
        {"id": "c", "status": "approved", "createdAt": "2026-11-03T00:00:00+00:00", "reviewTrail": [
            {"action": "Created post draft", "timestamp": "2026-11-03T00:00:00+00:00"},
            {"action": "Approved for publishing", "timestamp": "2026-11-03T05:00:00+00:00"}]},
    ]
    stats = metrics.approval_time_stats(posts)
    assert stats["approvedCount"] == 3
    assert stats["meanApprovalHours"] == pytest.approx((2 + 10 + 5) / 3, rel=1e-3)
    assert stats["medianApprovalHours"] == 5
    assert stats["decisionCount"] == 4


def test_approval_time_with_no_data():
    stats = metrics.approval_time_stats([])
    assert stats["meanApprovalHours"] is None and stats["approvedCount"] == 0
