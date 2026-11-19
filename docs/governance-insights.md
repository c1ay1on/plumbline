# Governance Insights — metrics reference

Page: **Insights** (`/app/insights`) · API: `GET /api/analytics/governance` · Report: `GET /api/analytics/governance.csv`
Code: `backend/app/services/governance_metrics.py` (pure functions, unit-tested) · `backend/app/routes/analytics.py` · `src/pages/Insights/GovernanceInsightsPage.tsx`

Every number is computed from data Plumbline already records. Nothing is estimated. A metric with no data returns `null` and the UI shows "—" with an explanation, never a fake zero.

## Data sources
| Source | Used for |
|---|---|
| `posts[].findings[]` (`category`, `severity`, `sourceReference`, `status`, `statusUpdatedAt`) | violations, contests, fixes |
| `posts[].reviewTrail[]` (`action`, `timestamp`, `findingsSnapshot`) | submission / approval / revision timing |
| `users.department` | team for error-rate-by-team |

New fields added in this round (backwards compatible, all optional):
- `AuditFinding.statusUpdatedAt` — set whenever a creator or reviewer changes a finding's status.
- `ReviewTrailItem.findingsSnapshot` — `{total, open, resolved, critical}` frozen at each "Submitted for approval".
- `users.department` — added by an automatic migration on startup; set from Team management.

## Metrics
**Most violated rules.** Findings grouped by the rule passage they cite (`sourceReference`); when a finding has no citation it falls back to its category label. Findings the creator *rejected* are false positives and are excluded. Per rule: total violations, distinct posts affected, split by severity, and how many were contested.

**Error rate by team.** For each team: posts with at least one critical or warning finding (not rejected) ÷ audited posts, as a percentage. Also shows serious findings per post. Members with no team appear as "Unassigned".

**Drafts fixed before review.** Of drafts that were submitted, the share where at least one finding was resolved (`accepted`, `fixed`, `resolved`) *before the first submission*, using `statusUpdatedAt`; the submission snapshot is the fallback for older posts. A fix made after submission does not count.

**Average time to approve.** Hours from a post's **first** "Submitted for approval" to the first "Approved for publishing" after it — the whole time in review, including revision rounds. Also median, fastest and slowest. Posts not yet approved are excluded.

**Contested flags / Most contested rules.** Findings with status or user action `contested`, grouped by rule. This is the input signal for the Ambiguous Rule Alerts module; "Open rule" links to `/app/brand-knowledge?rule=<rule>`.

**Weekly trend.** Posts created, real findings, critical findings and posts later approved, bucketed by the ISO week the post was created. Window follows the date filter (4–12 weeks).

## Filters and access
Query params: `days`, `team`, `platform`, `creator_id`. Owners, admins, managers and approvers see the whole workspace and can export CSV. Employees automatically see only their own posts (team and creator filters are ignored for them).

## Team management
`PATCH /api/workspace/members/{id}` with `{department?, role?}`. Owners/admins/managers can set teams; only owners/admins can change roles; the owner's role is locked.

## Testing
```
cd backend
pip install -r requirements-dev.txt
pytest -q                                  # 9 tests: every metric + API + permissions
python -m scripts.seed_insights_demo       # opt-in demo workspace for screenshots
```
Demo login: `demo.owner@plumbline-demo.com` / `plumbline-demo`.

## Integration with Rohan's governance module (round 3)
- **Approval time** on Insights now uses `app.services.metrics.review_cycles`, the same logic as `GET /api/governance/approval-time` and the Dashboard card, so both screens always show the same number (submission → approval, per review cycle).
- **Rules** are grouped by the same `ruleId` the Ambiguous Rule Alerts use (`resolve_rule_id`), with the same labels (e.g. `"kids" -> "students"`). Each row carries `ruleId`, and **Open rule** goes to `/app/brand-knowledge?rule=<ruleId>`, which opens Rohan's clarification editor on that rule.
- "Contested" is shown as **Disputed** to match the review page wording.
- Insights counts a post's *current* findings. After a re-check, the earlier findings live in `auditHistory` ("Earlier checks") and are not double counted.
