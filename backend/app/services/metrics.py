"""Review timing metrics built from each post's review trail."""
from __future__ import annotations

from datetime import datetime
from statistics import mean, median

SUBMIT_ACTION = "submitted for approval"
APPROVE_ACTION = "approved for publishing"
CHANGES_ACTION = "requested revisions"


def _parse(timestamp: str | None) -> datetime | None:
    if not timestamp:
        return None
    try:
        return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return None


def review_cycles(post: dict) -> list[dict]:
    """Pairs each decision with the submission that started it.

    A post created straight into review has no explicit submit step in older
    data, so the post's creation time is used as the submission in that case.
    """
    trail = sorted(post.get("reviewTrail") or [], key=lambda item: item.get("timestamp") or "")
    cycles: list[dict] = []
    submitted_at = None
    seen_submit = False
    for item in trail:
        action = (item.get("action") or "").lower()
        when = _parse(item.get("timestamp"))
        if when is None:
            continue
        if action.startswith(SUBMIT_ACTION):
            submitted_at, seen_submit = when, True
        elif action.startswith(APPROVE_ACTION) or action.startswith(CHANGES_ACTION):
            start = submitted_at or (None if seen_submit else _parse(post.get("createdAt")))
            if start and when >= start:
                cycles.append({
                    "postId": post.get("id"),
                    "decision": "approved" if action.startswith(APPROVE_ACTION) else "changes_requested",
                    "hours": (when - start).total_seconds() / 3600,
                })
            submitted_at = None
    return cycles


def approval_time_stats(posts: list[dict]) -> dict:
    cycles = [cycle for post in posts for cycle in review_cycles(post)]
    approvals = [cycle["hours"] for cycle in cycles if cycle["decision"] == "approved"]
    decisions = [cycle["hours"] for cycle in cycles]
    return {
        "approvedCount": len(approvals),
        "decisionCount": len(decisions),
        "meanApprovalHours": round(mean(approvals), 3) if approvals else None,
        "medianApprovalHours": round(median(approvals), 3) if approvals else None,
        "meanDecisionHours": round(mean(decisions), 3) if decisions else None,
        "medianDecisionHours": round(median(decisions), 3) if decisions else None,
        "pendingCount": sum(1 for post in posts if post.get("status") == "in_review"),
    }
