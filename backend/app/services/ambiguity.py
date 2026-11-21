"""Ambiguous rule detection and clarification suggestions.

A rule is "ambiguous" when people keep disputing the flags it raises. Disputes
come from two places that are merged by finding id: the rule_disputes table
(written when someone presses "Dispute this flag") and the findings stored in
the shared posts data (status contested or rejected), so a dispute made while
the API was unreachable is still counted once the workspace syncs.
"""
from __future__ import annotations

import json
import os
import re
from collections import Counter
from typing import Any

import httpx

DISPUTED_STATUSES = {"contested", "rejected"}


def thresholds() -> dict:
    return {
        "minDisputes": int(os.getenv("AMBIGUITY_MIN_DISPUTES", "3")),
        "minFlagsForRate": int(os.getenv("AMBIGUITY_MIN_FLAGS", "3")),
        "disputeRate": float(os.getenv("AMBIGUITY_DISPUTE_RATE", "0.4")),
    }


# Checks that are not stored as terminology rules but still raise findings.
BUILTIN_CHECKS = {
    "check:unsupported_claim": {
        "label": "Unsupported claims check",
        "text": "Ranking, credential, guarantee or percentage claims must match an approved fact.",
        "editorTab": "facts",
    },
    "check:alt_text_missing": {
        "label": "Media alt text check",
        "text": "Every attached image or video needs an accessibility description.",
        "editorTab": "voice",
    },
    "check:tone_mismatch": {
        "label": "Voice and tone rules",
        "text": "Posts should match the workspace voice and the platform tone rules.",
        "editorTab": "voice",
    },
    "check:visual_palette": {
        "label": "Brand palette check",
        "text": "Most of a creative's colour should come from the brand palette (white, black and greys allowed).",
        "editorTab": "colors",
    },
    "check:visual_contrast": {
        "label": "WCAG contrast check",
        "text": "Text on a creative needs 4.5:1 contrast, or 3:1 for large text (WCAG 2.1 AA).",
        "editorTab": "colors",
    },
    "check:visual_logo": {
        "label": "Logo usage check",
        "text": "Use an approved logo variant, scaled proportionally and not recoloured or distorted.",
        "editorTab": "assets",
    },
}

VAGUE_WORDS = {
    "appropriate": "name the exact cases where it is allowed",
    "inappropriate": "list what counts as inappropriate",
    "avoid": 'say "do not use" and list any allowed exceptions',
    "sometimes": "state when exactly",
    "generally": "state the rule and its exceptions",
    "usually": "state the rule and its exceptions",
    "where possible": "say when it is not possible",
    "when necessary": "say who decides it is necessary",
    "reasonable": "give a measurable limit",
    "excessive": "give a measurable limit",
    "too": "give a measurable limit",
    "overly": "give a measurable limit",
    "may": 'use "must" or "must not"',
    "might": 'use "must" or "must not"',
    "should": 'use "must" if it is a hard rule',
    "informal": "give an example of informal wording",
    "some": "list which ones",
    "often": "state when exactly",
}

WORD_REPLACEMENTS = {
    "avoid using": "do not use",
    "avoid": "do not use",
    "where possible": "",
    "when possible": "",
    "generally": "",
    "usually": "",
    "sometimes": "",
}

EXCEPTION_HINTS = [
    (r"quot", "direct quotations from named people"),
    (r"\bname|brand|product|title|proper", "official names, product names and titles"),
    (r"event|campaign|partner|sponsor", "partner, sponsor or event names we do not control"),
    (r"hashtag|handle|@", "hashtags and account handles"),
    (r"casual|informal|tone|audience|student|community|slang", "informal community channels where the audience uses the term themselves"),
    (r"legal|regulat|complian|statut", "wording required by legal or regulatory text"),
    (r"source|cite|citation|verified|official|report", "claims that cite a named, dated official source in the post"),
    (r"context|meaning|different sense|not referring", "uses of the word with a different meaning than the rule targets"),
]


def find_vague_terms(text: str) -> list[str]:
    lowered = (text or "").lower()
    return [word for word in VAGUE_WORDS if re.search(rf"\b{re.escape(word)}\b", lowered)]


def rule_catalogue(guidelines: dict | None) -> dict[str, dict]:
    catalogue: dict[str, dict] = {}
    for rule in (guidelines or {}).get("terminology") or []:
        if not rule.get("id"):
            continue
        banned, preferred = rule.get("bannedTerm") or "", rule.get("preferredTerm") or ""
        catalogue[rule["id"]] = {
            "ruleId": rule["id"], "kind": "terminology", "editorTab": "terminology",
            "label": f'"{banned}" -> "{preferred}"' if preferred else f'"{banned}"',
            "text": rule.get("explanation") or "", "context": rule.get("context") or "",
            "bannedTerm": banned, "preferredTerm": preferred,
        }
    for rule_id, check in BUILTIN_CHECKS.items():
        catalogue[rule_id] = {"ruleId": rule_id, "kind": "check", "context": "", "bannedTerm": "",
                              "preferredTerm": "", **check}
    return catalogue


def resolve_rule_id(finding: dict, guidelines: dict | None) -> str:
    if finding.get("ruleId"):
        return finding["ruleId"]
    if finding.get("category") == "terminology":
        affected = (finding.get("affectedContent") or "").lower()
        title = (finding.get("issueTitle") or "").lower()
        for rule in (guidelines or {}).get("terminology") or []:
            banned = (rule.get("bannedTerm") or "").strip().lower()
            if banned and (banned in affected or banned in title):
                return rule.get("id") or f"check:{finding.get('category')}"
    return f"check:{finding.get('category') or 'unknown'}"


def _post_findings(post: dict) -> list[dict]:
    """Current findings plus findings from earlier checks kept in audit history."""
    items = list(post.get("findings") or [])
    for snapshot in post.get("auditHistory") or []:
        items.extend(snapshot.get("findings") or [])
    return items


def collect_rule_activity(posts: list[dict], guidelines: dict | None, table_disputes: list[dict]) -> dict[str, dict]:
    activity: dict[str, dict] = {}
    seen: set[str] = set()

    def bucket(rule_id: str, label: str = "") -> dict:
        return activity.setdefault(rule_id, {"flags": [], "disputes": {}, "label": label})

    for post in posts:
        flagged_at = post.get("checkedAt") or post.get("createdAt") or ""
        for finding in _post_findings(post):
            finding_id = finding.get("id")
            if not finding_id or finding_id in seen:
                continue
            seen.add(finding_id)
            rule_id = resolve_rule_id(finding, guidelines)
            entry = bucket(rule_id, finding.get("ruleLabel") or "")
            entry["flags"].append({"findingId": finding_id, "postId": post.get("id"), "at": flagged_at})
            if finding.get("status") in DISPUTED_STATUSES:
                entry["disputes"][finding_id] = {
                    "findingId": finding_id, "postId": post.get("id"),
                    "reason": finding.get("contestedReason") or "",
                    "at": finding.get("disputedAt") or post.get("updatedAt") or flagged_at,
                }
    for row in table_disputes:
        entry = bucket(row["rule_id"], row.get("rule_label") or "")
        existing = entry["disputes"].get(row["finding_id"], {})
        entry["disputes"][row["finding_id"]] = {
            "findingId": row["finding_id"], "postId": row.get("post_id") or existing.get("postId"),
            "reason": row.get("reason") or existing.get("reason") or "",
            "at": row.get("created_at") or existing.get("at") or "",
        }
    return activity


def top_reasons(disputes: list[dict], limit: int = 3) -> list[dict]:
    counts: Counter[str] = Counter()
    original: dict[str, str] = {}
    for dispute in disputes:
        reason = " ".join((dispute.get("reason") or "").split())
        if not reason:
            continue
        key = reason.lower().rstrip(".")
        counts[key] += 1
        original.setdefault(key, reason)
    return [{"reason": original[key], "count": count} for key, count in counts.most_common(limit)]


def is_ambiguous(flag_count: int, dispute_count: int, limits: dict | None = None) -> bool:
    limits = limits or thresholds()
    if dispute_count >= limits["minDisputes"]:
        return True
    if flag_count >= limits["minFlagsForRate"] and dispute_count > 0:
        return dispute_count / flag_count >= limits["disputeRate"]
    return False


def detect_ambiguous_rules(
    posts: list[dict],
    guidelines: dict | None,
    table_disputes: list[dict] | None = None,
    alert_states: dict[str, dict] | None = None,
    include_closed: bool = False,
    limits: dict | None = None,
) -> list[dict]:
    """Returns one alert per ambiguous rule.

    After an alert is dismissed or resolved, only flags and disputes newer than
    that moment count, so a clarified rule starts with a clean slate.
    """
    limits = limits or thresholds()
    alert_states = alert_states or {}
    catalogue = rule_catalogue(guidelines)
    alerts: list[dict] = []
    for rule_id, entry in collect_rule_activity(posts, guidelines, table_disputes or []).items():
        state = alert_states.get(rule_id) or {}
        closed_at = state.get("closed_at") if state.get("status") in ("dismissed", "resolved") else None
        flags = entry["flags"]
        disputes = list(entry["disputes"].values())
        if closed_at:
            flags = [item for item in flags if (item.get("at") or "") > closed_at]
            disputes = [item for item in disputes if (item.get("at") or "") > closed_at]
        # A flag raised before the window can still be disputed inside it.
        flag_count = max(len(flags), len(disputes))
        ambiguous = is_ambiguous(flag_count, len(disputes), limits)
        if closed_at and not ambiguous and not include_closed:
            continue
        if not closed_at and not ambiguous:
            continue
        rule = catalogue.get(rule_id) or {
            "ruleId": rule_id, "kind": "terminology" if not rule_id.startswith("check:") else "check",
            "label": entry["label"] or rule_id, "text": "", "context": "", "editorTab": "terminology",
            "bannedTerm": "", "preferredTerm": "", "removed": True,
        }
        status = "open" if ambiguous else state.get("status")
        alerts.append({
            **rule,
            "flagCount": flag_count,
            "disputeCount": len(disputes),
            "disputeRate": round(len(disputes) / flag_count, 3) if flag_count else 0,
            "topReasons": top_reasons(disputes),
            "status": status,
            "reopened": bool(closed_at and ambiguous),
            "closedAt": state.get("closed_at"),
            "resolvedVersion": state.get("resolved_version"),
            "suggestion": state.get("suggestion"),
        })
    alerts.sort(key=lambda alert: (alert["status"] != "open", -alert["disputeCount"], -alert["disputeRate"]))
    return alerts


def _exceptions_from_reasons(reasons: list[str]) -> list[str]:
    joined = " ".join(reasons).lower()
    return [hint for pattern, hint in EXCEPTION_HINTS if re.search(pattern, joined)]


def _tighten(text: str) -> str:
    result = text or ""
    for word, replacement in WORD_REPLACEMENTS.items():
        result = re.sub(rf"\b{re.escape(word)}\b", replacement, result, flags=re.IGNORECASE)
    return " ".join(result.split()).strip()


def build_fallback_suggestion(rule: dict, reasons: list[str], dispute_count: int = 0, flag_count: int = 0) -> dict:
    """Deterministic suggestion used when Groq is not configured or fails."""
    rule_text = rule.get("text") or ""
    vague = find_vague_terms(rule_text)
    exceptions = _exceptions_from_reasons(reasons)
    notes: list[str] = []
    if dispute_count:
        notes.append(f"Disputed {dispute_count} time{'s' if dispute_count != 1 else ''} out of {flag_count} flag{'s' if flag_count != 1 else ''}.")
    for word in vague:
        notes.append(f'"{word}" is vague: {VAGUE_WORDS[word]}.')
    if exceptions:
        notes.append("Dispute reasons point to cases the rule does not mention: " + "; ".join(exceptions) + ".")
    else:
        notes.append("Add at least one allowed and one not-allowed example so reviewers apply it the same way.")

    exception_text = "; ".join(exceptions) if exceptions else "none"
    if rule.get("kind") == "terminology" and rule.get("bannedTerm"):
        banned, preferred = rule["bannedTerm"], rule.get("preferredTerm") or "the approved term"
        scope = f" in {rule['context']} content" if rule.get("context") else ""
        parts = [f'Use "{preferred}" instead of "{banned}"{scope} on every platform.']
        tightened = _tighten(rule_text)
        if tightened:
            parts.append(f"Reason: {tightened.rstrip('.')}.")
        parts.append(f"Allowed exceptions: {exception_text}.")
        parts.append(f'Example: "... our {preferred} ..." passes; "... our {banned} ..." is flagged.')
    else:
        parts = [_tighten(rule_text) or rule.get("label", "This rule") + " applies to every post."]
        parts.append(f"Allowed exceptions: {exception_text}.")
        parts.append("Add one example that passes and one that is flagged.")
    return {
        "source": "rules",
        "summary": f"{rule.get('label', 'This rule')} is disputed often. Make the wording explicit and list its exceptions.",
        "proposedText": " ".join(parts),
        "notes": notes,
        "vagueTerms": vague,
    }


async def generate_suggestion(rule: dict, reasons: list[str], dispute_count: int, flag_count: int) -> dict:
    """Uses Groq when GROQ_API_KEY is set, otherwise the deterministic fallback."""
    fallback = build_fallback_suggestion(rule, reasons, dispute_count, flag_count)
    key = os.getenv("GROQ_API_KEY", "").strip()
    if not key or key == "your_real_groq_api_key":
        return fallback
    from app.routes.ai import resolve_model
    model = resolve_model(None)
    prompt = (
        "A brand guideline rule keeps getting disputed by reviewers. Rewrite it so it is unambiguous.\n"
        f"Rule: {rule.get('label')}\nRule text: {rule.get('text') or '(none)'}\n"
        f"Context: {rule.get('context') or 'general'}\n"
        f"Disputed {dispute_count} of {flag_count} times. Dispute reasons:\n"
        + "\n".join(f"- {reason}" for reason in reasons[:10] or ["(no reasons given)"])
        + "\nReturn only JSON: {\"summary\": \"one sentence on why it is ambiguous\", "
        "\"proposedText\": \"the rewritten rule text with explicit exceptions and one example\", "
        "\"notes\": [\"short bullet\", ...]}"
    )
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"model": model, "temperature": 0.2, "max_tokens": 600,
                      "response_format": {"type": "json_object"},
                      "messages": [{"role": "user", "content": prompt}]},
            )
        response.raise_for_status()
        parsed: Any = json.loads(response.json()["choices"][0]["message"]["content"])
        if not parsed.get("proposedText"):
            return fallback
        return {
            "source": "groq",
            "summary": str(parsed.get("summary") or fallback["summary"]),
            "proposedText": str(parsed["proposedText"]),
            "notes": [str(note) for note in parsed.get("notes") or []][:6] or fallback["notes"],
            "vagueTerms": fallback["vagueTerms"],
        }
    except Exception:
        return fallback
