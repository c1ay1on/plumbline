"""Guideline snapshots, rule diffs and change-impact checks.

A snapshot keeps only the parts of the guidelines that audits use (terminology,
facts and voice). Reviews store the version they were checked against, so an
old review never has to be re-evaluated when the guidelines move on.
"""
from __future__ import annotations

import re
from typing import Any

PENDING_STATUSES = {"draft", "in_review", "changes_requested"}

TERM_FIELDS = ("context", "preferredTerm", "bannedTerm", "explanation", "platforms")
FACT_FIELDS = ("fact", "source", "category", "approvalStatus")
VOICE_FIELDS = ("tones", "customToneDescription", "platformRules")


def version_number(version: Any) -> int:
    """Turns 'v3', '3' or 3 into 3. Unknown values count as version 1."""
    if isinstance(version, int):
        return version
    match = re.search(r"\d+", str(version or ""))
    return int(match.group()) if match else 1


def snapshot_rules(guidelines: dict | None) -> dict:
    guidelines = guidelines or {}
    voice = guidelines.get("voice") or {}
    return {
        "terminology": [
            {"id": rule.get("id", ""), **{field: rule.get(field) for field in TERM_FIELDS}}
            for rule in guidelines.get("terminology") or []
        ],
        "facts": [
            {"id": fact.get("id", ""), **{field: fact.get(field) for field in FACT_FIELDS}}
            for fact in guidelines.get("facts") or []
        ],
        "voice": {field: voice.get(field) for field in VOICE_FIELDS},
    }


def term_label(rule: dict) -> str:
    banned = rule.get("bannedTerm") or ""
    preferred = rule.get("preferredTerm") or ""
    return f'"{banned}" -> "{preferred}"' if preferred else f'"{banned}"'


def _diff_by_id(kind: str, before: list[dict], after: list[dict], fields: tuple[str, ...], label) -> list[dict]:
    changes: list[dict] = []
    old = {item.get("id"): item for item in before if item.get("id")}
    new = {item.get("id"): item for item in after if item.get("id")}
    for rule_id, item in new.items():
        if rule_id not in old:
            changes.append({"ruleId": rule_id, "kind": kind, "label": label(item), "changeType": "added",
                            "fields": [], "before": None, "after": item})
            continue
        changed = [field for field in fields if old[rule_id].get(field) != item.get(field)]
        if changed:
            changes.append({"ruleId": rule_id, "kind": kind, "label": label(item), "changeType": "modified",
                            "fields": changed, "before": old[rule_id], "after": item})
    for rule_id, item in old.items():
        if rule_id not in new:
            changes.append({"ruleId": rule_id, "kind": kind, "label": label(item), "changeType": "removed",
                            "fields": [], "before": item, "after": None})
    return changes


def diff_rules(previous: dict | None, current: dict | None) -> list[dict]:
    previous = previous or snapshot_rules({})
    current = current or snapshot_rules({})
    changes = _diff_by_id("terminology", previous.get("terminology") or [], current.get("terminology") or [],
                          TERM_FIELDS, term_label)
    changes += _diff_by_id("fact", previous.get("facts") or [], current.get("facts") or [], FACT_FIELDS,
                           lambda fact: (fact.get("fact") or "")[:80])
    old_voice = previous.get("voice") or {}
    new_voice = current.get("voice") or {}
    voice_fields = [field for field in VOICE_FIELDS if old_voice.get(field) != new_voice.get(field)]
    if voice_fields:
        changes.append({"ruleId": "voice", "kind": "voice", "label": "Voice and tone", "changeType": "modified",
                        "fields": voice_fields, "before": old_voice, "after": new_voice})
    return changes


def post_text(post: dict) -> str:
    parts = [post.get("title") or "", post.get("originalDescription") or ""]
    for variant in (post.get("platformVariants") or {}).values():
        if isinstance(variant, dict):
            parts.append(variant.get("description") or "")
    return "\n".join(parts).lower()


def checked_version(post: dict) -> str:
    if post.get("guidelineVersion"):
        return post["guidelineVersion"]
    for finding in post.get("findings") or []:
        if finding.get("guidelineVersion"):
            return finding["guidelineVersion"]
    return "v1"


def _finding_matches_term(finding: dict, rule: dict | None) -> bool:
    if not rule:
        return False
    if finding.get("ruleId") == rule.get("id"):
        return True
    banned = (rule.get("bannedTerm") or "").strip().lower()
    return bool(banned) and not finding.get("ruleId") and finding.get("category") == "terminology" \
        and banned in (finding.get("affectedContent") or "").lower()


def change_reasons(post: dict, change: dict) -> list[str]:
    """Why one rule change affects one post. Empty list means not affected."""
    findings = post.get("findings") or []
    text = post_text(post)
    reasons: list[str] = []
    kind, change_type = change["kind"], change["changeType"]
    if kind == "terminology":
        if change_type in ("modified", "removed") and any(_finding_matches_term(f, change.get("before")) for f in findings):
            reasons.append(f"was flagged by {change['label']}, which was {change_type}")
        after = change.get("after") or {}
        banned = (after.get("bannedTerm") or "").strip().lower()
        if change_type in ("added", "modified") and banned and banned in text and not reasons:
            reasons.append(f'contains "{after.get("bannedTerm")}" which the {change_type} rule now covers')
    elif kind == "fact":
        if any(f.get("category") == "unsupported_claim" or f.get("ruleId") == "check:unsupported_claim" for f in findings):
            reasons.append("has a claim finding and an approved fact changed")
    elif kind == "voice":
        if any(f.get("category") == "tone_mismatch" for f in findings):
            reasons.append("has a tone finding and the voice rules changed")
    return reasons


def compute_impact(posts: list[dict], changes: list[dict], new_version: Any) -> dict:
    """Pending posts checked under an older version that the changes touch.

    Approved and published posts are counted separately and never marked for re-check.
    """
    target = version_number(new_version)
    affected: list[dict] = []
    locked = 0
    for post in posts:
        older = version_number(checked_version(post)) < target
        if not older:
            continue
        reasons = [reason for change in changes for reason in change_reasons(post, change)]
        if not reasons:
            continue
        if post.get("status") not in PENDING_STATUSES:
            locked += 1
            continue
        affected.append({
            "postId": post.get("id"), "title": post.get("title") or "Untitled",
            "status": post.get("status"), "checkedVersion": checked_version(post), "reasons": reasons,
        })
    by_version: dict[str, int] = {}
    for item in affected:
        by_version[item["checkedVersion"]] = by_version.get(item["checkedVersion"], 0) + 1
    if affected:
        parts = [f"{count} pending review{'s' if count != 1 else ''} checked under {version}"
                 for version, count in sorted(by_version.items(), key=lambda pair: version_number(pair[0]))]
        summary = f"{', '.join(parts)} affected by this change."
    else:
        summary = "No pending reviews are affected by this change."
    return {"version": f"v{target}", "affected": affected, "affectedCount": len(affected),
            "lockedHistoryCount": locked, "summary": summary}
