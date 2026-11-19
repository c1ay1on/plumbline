"""Governance Insights metrics, computed from real audit history.

Every number here is derived from data Plumbline already records:
  * posts[].findings          -> what the audit flagged, with its rule citation and status
  * posts[].reviewTrail       -> timestamped actions (created, submitted, approved, revisions)
  * users.department          -> which team a creator belongs to

Nothing is estimated or invented. A metric with no data behind it returns
None (or an empty list) so the UI can say "not enough data yet".
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Any, Iterable

from app.services.ambiguity import resolve_rule_id, rule_catalogue
from app.services.metrics import review_cycles

SUBMIT_ACTION = "submitted for approval"
APPROVE_ACTION = "approved for publishing"
REVISION_ACTION = "requested revisions"

RESOLVED_STATUSES = {"accepted", "fixed", "resolved"}
# A finding the creator rejected and the reviewer upheld is a false positive,
# so it is not counted as a violation.
NOT_A_VIOLATION = {"rejected"}
SERIOUS = {"critical", "warning"}
UNASSIGNED_TEAM = "Unassigned"

CATEGORY_LABELS = {
    "unsupported_claim": "Unsupported claim",
    "outdated_info": "Outdated information",
    "tone_mismatch": "Tone mismatch",
    "terminology": "Terminology",
    "incorrect_messaging": "Incorrect messaging",
    "visual_mismatch": "Visual mismatch",
    "wrong_logo": "Wrong logo",
    "incorrect_colours": "Incorrect colours",
    "accessibility": "Accessibility",
    "alt_text_missing": "Alt text missing",
}


# ---------------------------------------------------------------- helpers
def parse_ts(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _trail(post: dict) -> list[dict]:
    items = [i for i in (post.get("reviewTrail") or []) if isinstance(i, dict)]
    return sorted(items, key=lambda i: parse_ts(i.get("timestamp")) or datetime.min.replace(tzinfo=timezone.utc))


def _action_times(post: dict, action: str) -> list[datetime]:
    return [ts for i in _trail(post)
            if str(i.get("action", "")).strip().lower() == action and (ts := parse_ts(i.get("timestamp")))]


def first_submission(post: dict) -> datetime | None:
    times = _action_times(post, SUBMIT_ACTION)
    return times[0] if times else None


def rule_key(finding: dict, guidelines: dict | None = None) -> tuple[str, str, str]:
    """Return (group key, display label, rule id used by the editor link).

    Uses the same rule ids as the Ambiguous Rule Alerts module (ruleId stamped
    on the finding, or a terminology rule matched by its banned term), so the
    Insights page and the alerts always talk about the same rule."""
    category = str(finding.get("category") or "uncategorised")
    rule_id = resolve_rule_id(finding, guidelines)
    catalogue = rule_catalogue(guidelines)
    ref = str(finding.get("sourceReference") or "").strip()
    if ref.lower() in {"n/a", "none", "-", "general"}:
        ref = ""
    label = (finding.get("ruleLabel") or (catalogue.get(rule_id) or {}).get("label") or ref
             or CATEGORY_LABELS.get(category, category.replace("_", " ").title()))
    stamped = bool(finding.get("ruleId")) or not rule_id.startswith("check:")
    # Built-in checks without a stamped id can cite different passages: keep those apart.
    key = rule_id if stamped or not ref else f"{rule_id}|{ref}"
    if not stamped and ref:
        label = ref
    return key, label, rule_id


def is_violation(finding: dict) -> bool:
    return str(finding.get("status", "open")) not in NOT_A_VIOLATION


# ---------------------------------------------------------------- filtering
def filter_posts(posts: Iterable[dict], members: dict[str, dict], *, days: int | None = None,
                 team: str | None = None, platform: str | None = None,
                 creator_id: str | None = None, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(days=days) if days else None
    out = []
    for post in posts:
        if not isinstance(post, dict):
            continue
        created = parse_ts(post.get("createdAt"))
        if since and created and created < since:
            continue
        if platform and platform not in (post.get("platforms") or []):
            continue
        if creator_id and post.get("creatorId") != creator_id:
            continue
        if team and team_of(post, members) != team:
            continue
        out.append(post)
    return out


def team_of(post: dict, members: dict[str, dict]) -> str:
    member = members.get(post.get("creatorId") or "")
    dept = (member or {}).get("department") or ""
    return dept.strip() or UNASSIGNED_TEAM


# ---------------------------------------------------------------- metrics
def most_violated_rules(posts: list[dict], limit: int = 8, guidelines: dict | None = None) -> list[dict]:
    counts: Counter = Counter()
    meta: dict[str, dict] = {}
    posts_hit: dict[str, set] = defaultdict(set)
    severity: dict[str, Counter] = defaultdict(Counter)
    contested: Counter = Counter()
    for post in posts:
        for f in post.get("findings") or []:
            if not isinstance(f, dict) or not is_violation(f):
                continue
            key, label, rule_id = rule_key(f, guidelines)
            meta.setdefault(key, {"rule": label, "ruleId": rule_id, "category": str(f.get("category") or "uncategorised")})
            counts[key] += 1
            posts_hit[key].add(post.get("id"))
            severity[key][f.get("severity", "suggestion")] += 1
            if f.get("status") == "contested" or f.get("userAction") == "contested":
                contested[key] += 1
    return [{
        **meta[key], "count": n,
        "postsAffected": len(posts_hit[key]),
        "critical": severity[key]["critical"],
        "warning": severity[key]["warning"],
        "suggestion": severity[key]["suggestion"],
        "contested": contested[key],
    } for key, n in counts.most_common(limit)]


def error_rate_by_team(posts: list[dict], members: dict[str, dict]) -> list[dict]:
    """Error rate = share of a team's audited posts with at least one critical or
    warning finding that was a real violation (not rejected as a false positive)."""
    totals: Counter = Counter()
    with_errors: Counter = Counter()
    findings: Counter = Counter()
    for post in posts:
        if not post.get("findings") and not post.get("brandRiskScore"):
            continue  # never audited
        team = team_of(post, members)
        totals[team] += 1
        serious = [f for f in post.get("findings") or []
                   if isinstance(f, dict) and is_violation(f) and f.get("severity") in SERIOUS]
        findings[team] += len(serious)
        if serious:
            with_errors[team] += 1
    rows = [{
        "team": team, "posts": n, "postsWithErrors": with_errors[team],
        "rate": round(100 * with_errors[team] / n, 1),
        "avgSeriousFindingsPerPost": round(findings[team] / n, 2),
    } for team, n in totals.items()]
    return sorted(rows, key=lambda r: (-r["rate"], -r["posts"]))


def drafts_fixed_before_review(posts: list[dict]) -> dict:
    """A draft counts as 'fixed before review' when at least one finding was
    resolved by the creator (accepted / fixed / resolved) before the post was
    first submitted. Uses the finding's statusUpdatedAt when recorded, and the
    submission snapshot as a second source."""
    submitted = 0
    fixed_posts = 0
    findings_fixed = 0
    findings_raised = 0
    for post in posts:
        submit_at = first_submission(post)
        if not submit_at:
            continue
        submitted += 1
        resolved_here = 0
        snapshot = next((i.get("findingsSnapshot") for i in _trail(post)
                         if str(i.get("action", "")).lower() == SUBMIT_ACTION and isinstance(i.get("findingsSnapshot"), dict)), None)
        for f in post.get("findings") or []:
            if not isinstance(f, dict):
                continue
            findings_raised += 1
            changed = parse_ts(f.get("statusUpdatedAt"))
            if f.get("status") in RESOLVED_STATUSES and changed and changed <= submit_at:
                resolved_here += 1
        if snapshot and not resolved_here:
            resolved_here = int(snapshot.get("resolved", 0) or 0)
        if resolved_here:
            fixed_posts += 1
            findings_fixed += resolved_here
    return {
        "submittedDrafts": submitted,
        "draftsFixedBeforeReview": fixed_posts,
        "rate": round(100 * fixed_posts / submitted, 1) if submitted else None,
        "findingsFixedBeforeReview": findings_fixed,
        "findingsRaised": findings_raised,
    }


def approval_times(posts: list[dict]) -> dict:
    """Hours from a submission to the approval that closes it, per review cycle.

    Uses the same cycle logic as GET /api/governance/approval-time
    (app.services.metrics.review_cycles), so the Dashboard card and the
    Insights page always show the same average."""
    hours = [c["hours"] for p in posts for c in review_cycles(p) if c["decision"] == "approved"]
    return {
        "approvedPosts": len(hours),
        "avgHours": round(sum(hours) / len(hours), 2) if hours else None,
        "medianHours": round(median(hours), 2) if hours else None,
        "fastestHours": round(min(hours), 2) if hours else None,
        "slowestHours": round(max(hours), 2) if hours else None,
    }


def weekly_trend(posts: list[dict], weeks: int = 8, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(weeks=weeks - 1)
    buckets = [{"weekStart": (start + timedelta(weeks=i)).date().isoformat(),
                "posts": 0, "findings": 0, "critical": 0, "approved": 0} for i in range(weeks)]
    for post in posts:
        created = parse_ts(post.get("createdAt"))
        if not created or created < start:
            continue
        idx = min((created - start).days // 7, weeks - 1)
        b = buckets[idx]
        b["posts"] += 1
        real = [f for f in post.get("findings") or [] if isinstance(f, dict) and is_violation(f)]
        b["findings"] += len(real)
        b["critical"] += sum(1 for f in real if f.get("severity") == "critical")
        if _action_times(post, APPROVE_ACTION):
            b["approved"] += 1
    return buckets


def summary(posts: list[dict]) -> dict:
    statuses = Counter(p.get("status", "draft") for p in posts)
    all_findings = [f for p in posts for f in p.get("findings") or [] if isinstance(f, dict)]
    return {
        "draftsChecked": sum(1 for p in posts if p.get("findings") is not None),
        "totalFindings": sum(1 for f in all_findings if is_violation(f)),
        "contestedFlags": sum(1 for f in all_findings if f.get("status") == "contested" or f.get("userAction") == "contested"),
        "rejectedFlags": sum(1 for f in all_findings if f.get("status") == "rejected"),
        "revisionRequests": sum(len(_action_times(p, REVISION_ACTION)) for p in posts),
        "byStatus": dict(statuses),
        "byCategory": dict(Counter(f.get("category", "uncategorised") for f in all_findings if is_violation(f))),
    }


def build_insights(posts: list[dict], members_list: list[dict], guidelines: dict | None = None, **filters) -> dict:
    members = {m["id"]: m for m in members_list}
    scoped = filter_posts(posts, members, **filters)
    teams = sorted({(m.get("department") or "").strip() or UNASSIGNED_TEAM for m in members_list})
    platforms = sorted({pl for p in posts if isinstance(p, dict) for pl in (p.get("platforms") or [])})
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "filters": {k: v for k, v in filters.items() if k != "now"},
        "available": {"teams": teams, "platforms": platforms,
                      "creators": [{"id": m["id"], "name": m.get("name", "")} for m in members_list]},
        "postsInScope": len(scoped),
        "summary": summary(scoped),
        "mostViolatedRules": most_violated_rules(scoped, guidelines=guidelines),
        "errorRateByTeam": error_rate_by_team(scoped, members),
        "fixedBeforeReview": drafts_fixed_before_review(scoped),
        "approvalTime": approval_times(scoped),
        # Match the trend window to the date filter (4-12 weeks; 12 for "all time").
        "weeklyTrend": weekly_trend(scoped, weeks=max(4, min(12, -(-filters["days"] // 7))) if filters.get("days") else 12,
                                    now=filters.get("now")),
    }
