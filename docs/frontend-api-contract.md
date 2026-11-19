# Plumbline API contract (test build)

The React frontend communicates with a FastAPI backend. This document describes the endpoints currently implemented; it is not a specification of planned features.

## Authentication

- `POST /api/auth/register` accepts `full_name`, `email`, `password`, and optional `workspace_id`. The first registrant creates a workspace; colleagues can join it using its Workspace ID.
- `POST /api/auth/login` accepts `email` and `password`.
- `GET /api/auth/me` returns the signed-in user.
- `POST /api/auth/logout` revokes the current session.

Authenticated API calls use `Authorization: Bearer <session_token>`.

## Workspace

- `GET /api/workspace/data` returns shared workspace records.
- `PUT /api/workspace/data` saves workspace fields: `workspace`, `guidelines`, `guideline_versions`, `posts`, `comments`, `onboarding_completed`, and `clean_workspace`.
- `GET /api/workspace/members` returns registered users who joined the same workspace.

## Social accounts

- `GET /api/social/config` reports which provider OAuth applications have been configured on the server.
- `GET /api/social/connections` lists only the current Plumbline user's authorized accounts.
- `POST /api/social/{platform}/connect` returns an official provider authorization URL.
- `GET /api/social/callback/{platform}` exchanges the authorization code on the server and stores the resulting provider token.
- `DELETE /api/social/{platform}/disconnect?account_id=...` disconnects one account (omit `account_id` to disconnect all accounts for that platform).
- `POST /api/social/{platform}/publish` publishes supported text/media content to a connected account. The request can include `account_id`, `text`, `image_url`, or `video_url` depending on the provider.
- `GET /api/social/comments` retrieves comments/mentions for providers enabled in this build. Each returned comment includes `accountId` so replies are sent from the same account.
- `POST /api/social/comments/{comment_id}/reply` accepts `platform`, `reply_text`, and `account_id`.

Provider APIs enforce their own scopes, app review, account eligibility, quotas, and media rules. Unsupported actions return an explicit API error; they are not simulated.

## AI

- `GET /api/ai/status` reports whether `GROQ_API_KEY` is configured and which model is selected.
- `POST /api/ai/test` verifies the Groq configuration.
- `POST /api/ai/chat/completions` proxies a chat-completion request to Groq.

The Groq API key is read from `backend/.env` only. It is never stored in frontend configuration.

## Governance

All governance routes are scoped to the signed-in user's workspace. They read the shared `posts` and `guidelines` workspace data, plus the governance tables in SQLite (`guideline_versions`, `guideline_rule_changes`, `rule_disputes`, `rule_alerts`).

### Approval time

- `GET /api/governance/approval-time` returns `approvedCount`, `decisionCount`, `meanApprovalHours`, `medianApprovalHours`, `meanDecisionHours`, `medianDecisionHours` and `pendingCount`. A review cycle starts at the latest "Submitted for approval" trail entry (or the post's creation time for older posts created straight into review) and ends at "Approved for publishing" or "Requested revisions". Values are `null` when there is no data.
- `GET /api/governance/summary` returns `approvalTime`, open `alerts`, the ambiguity `thresholds` and the `currentVersion` in one call.

### Disputes and ambiguous rule alerts

- `POST /api/governance/disputes` records a disputed flag: `rule_id`, `rule_label`, `post_id`, `finding_id`, optional `reason`, `guideline_version`. One record per finding (re-sending updates the reason). Returns the rule's alert if it is now ambiguous.
- `GET /api/governance/disputes?rule_id=...` lists recorded disputes.
- `GET /api/governance/alerts?include_closed=false` lists ambiguous rules: `ruleId`, `label`, `text`, `flagCount`, `disputeCount`, `disputeRate`, `topReasons`, `status` (`open`, `dismissed`, `resolved`), `reopened` and a `suggestion` (`source`, `summary`, `proposedText`, `notes`, `vagueTerms`).
- `POST /api/governance/alerts/{rule_id}/suggestion` generates and stores a clarification suggestion. Uses Groq when `GROQ_API_KEY` is set, otherwise a deterministic suggestion built from the rule text and dispute reasons.
- `POST /api/governance/alerts/{rule_id}/dismiss` with optional `note`.
- `POST /api/governance/alerts/{rule_id}/resolve` with optional `version` (the guideline version that clarified the rule) and `note`.

A rule is ambiguous when it has at least `AMBIGUITY_MIN_DISPUTES` disputes (default 3), or when at least `AMBIGUITY_DISPUTE_RATE` (default 0.4) of its flags were disputed and it has at least `AMBIGUITY_MIN_FLAGS` flags (default 3). Disputes are counted from the `rule_disputes` table and from findings with status `contested` or `rejected` in the shared posts, merged by finding id. After an alert is dismissed or resolved, only newer flags and disputes count, so it reopens only if the rule keeps being disputed.

Built-in checks use the rule ids `check:unsupported_claim`, `check:alt_text_missing` and `check:tone_mismatch`; terminology rules use their own ids.

### Guideline versions

- `POST /api/governance/versions` records a version: `version_number`, `change_summary`, `rules` (snapshot of `terminology`, `facts`, `voice`), optional `id`, and optional `previous_rules`/`previous_id` used as the baseline when the server has no earlier version. Returns `version`, rule-level `changes` (`ruleId`, `kind`, `label`, `changeType` added/modified/removed, `fields`, `before`, `after`) and `impact`. Re-sending the same `version_number` replaces that record.
- `GET /api/governance/versions` lists versions with `changeCount`.
- `GET /api/governance/versions/{number}` returns the snapshot and its changes.
- `GET /api/governance/versions/{number}/diff?against=...` diffs a version against the previous one (or `against`).
- `GET /api/governance/impact?version=...` lists pending posts (draft, in review, changes requested) checked under an older version that the version's rule changes affect, with a `summary` such as "2 pending reviews checked under v3 affected by this change." Approved and published posts are only counted in `lockedHistoryCount` and are never changed.

Each post stores `guidelineVersion`, `guidelineVersionId`, `guidelineSnapshot` and `checkedAt` from the moment it was audited. Re-checking a pending post moves its previous findings into `auditHistory` instead of overwriting them.

## Health

- `GET /health` returns API health status.

## Not implemented in this build

Invitation email delivery, document parsing, scheduled publishing, cross-platform analytics, and provider-specific moderation actions are not implemented. Local comment triage labels do not perform moderation actions on the social platform.
