# Plumbline — real-account test build

Plumbline is a brand-governance and social-publishing workspace. This build removes the seeded university scenario and simulated publish/reply actions. New workspaces start empty. Real social accounts are connected with official OAuth consent screens, and the backend records a post as published or a reply as sent only after the provider API returns success.

> **Testing build:** this is intended for localhost testing with real accounts you own or administer. Do not expose the backend publicly. The SQLite test database stores OAuth access tokens in plaintext; replace this with encrypted token storage, a managed database, HTTPS, secure cookies, CSRF controls, and production access controls before any shared/public deployment.

## Requirements

- Node.js 20 or newer and npm
- Python 3.11 or newer
- Developer applications/credentials for each social network you plan to connect
- A Groq API key (optional; deterministic local rule checks still work without it)

## Run locally (Windows PowerShell)

### 1. Configure the backend

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env` and add your credentials. Start with the Groq entries:

```dotenv
GROQ_API_KEY=your_real_groq_api_key
GROQ_MODEL=openai/gpt-oss-120b
```

You can change `GROQ_MODEL` to any model ID currently enabled for your Groq account, for example `openai/gpt-oss-120b` or `openai/gpt-oss-20b`. Groq's active model catalogue is available at <https://console.groq.com/docs/models>. Keep this key in `backend/.env`; never put it in a `VITE_` variable or frontend source.

Start the API server from the `backend` directory:

```powershell
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The API docs are at <http://localhost:8000/docs>.

### 2. Configure and run the frontend

In a second terminal, from the project root:

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Open <http://localhost:5173>. `VITE_DEMO_MODE` must remain `false`.

### 3. Create the first workspace and add personnel

1. Open Register and create the first account. It becomes the workspace owner.
2. Open Profile and copy the **Workspace ID**.
3. Give that ID only to colleagues who should join the same test workspace.
4. A colleague registers and enters the Workspace ID in the optional “Join an existing workspace” field. They become an employee in that workspace.
5. Drafts, comments, and brand guidelines are shared through the backend. Social accounts remain private to the person who connected them.

Team invitations/email delivery are not implemented yet; use the Workspace ID during registration for the test.

## Configure social OAuth providers

Plumbline does **not** ask users for their social-media username/password. The user selects Connect, signs in directly on the platform, reviews permissions, and returns through the configured OAuth callback. This is required by the platforms and avoids handling social passwords in Plumbline.

Create the relevant developer app, add the exact redirect URL below to its allowed callback list, then paste the app credentials into `backend/.env`. Restart the backend after editing `.env`.

| Platform | Backend environment variables | OAuth redirect URL |
|---|---|---|
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI` | `http://localhost:8000/api/social/callback/linkedin` |
| Facebook Pages + linked Instagram | `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI` | `http://localhost:8000/api/social/callback/meta` |
| Threads | `THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_REDIRECT_URI` | `http://localhost:8000/api/social/callback/threads` |
| X | `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` | `http://localhost:8000/api/social/callback/x` |
| YouTube | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | `http://localhost:8000/api/social/callback/youtube` |

### Provider requirements and current integration limits

- **LinkedIn:** member profile text-post publishing is wired through the Posts API using version `202610` and `w_member_social`. Organization Page posting and LinkedIn comment sync/replies are not wired. LinkedIn API products and scopes must be approved for your developer app. The Posts API documents `w_member_social` for member posting and `w_organization_social` for organization posting. See <https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api> and <https://learn.microsoft.com/en-us/linkedin/marketing/versioning>.
- **Facebook Pages:** text/image publishing and reading/replying to Page comments are wired. Only Pages returned by `/me/accounts` are connected; personal profiles are not publish targets. Grant the app the required Page permissions and make sure the authorizing person has the relevant Page access.
- **Instagram:** the supported flow is an Instagram **Business or Creator** account linked to a Facebook Page. Feed publishing requires a publicly accessible HTTPS image/video URL. Personal consumer accounts are not supported by this API integration.
- **Threads:** text publishing is wired. Threads comment sync/replies are not implemented in this build.
- **X:** post publishing and reading/replying to mentions are wired. You need an X developer app with OAuth 2.0 user-context scopes (`tweet.read`, `tweet.write`, `users.read`, `offline.access`) and API access appropriate to your account/tier.
- **YouTube:** channel connection and video-comment sync/replies are wired. Access tokens are refreshed where the provider issues refresh tokens; LinkedIn refresh depends on the developer app being approved for that provider capability, otherwise it will request reconnection when the token expires. `comments.insert` replies to an existing comment with `youtube.force-ssl`; the Data API does not provide a text-only Community-post publishing endpoint in this build. Video uploading has not been wired into the composer. See <https://developers.google.com/youtube/data/reference/rest/v3/comments/insert>.
- **Analytics:** reach, impressions, follower history, and engagement rates are not fetched. The dashboard intentionally does not invent those metrics.
- **Brand documents:** document uploads/parsing are not included. Add brand tone, terminology, facts, sources, and visual rules in Brand Knowledge. The UI does not mark local file names as indexed.

Meta Graph API defaults to `v27.0`; you can override `META_GRAPH_VERSION` if your app is pinned to another supported version. See <https://developers.facebook.com/docs/graph-api/>

## Publishing workflow

1. Connect an account from **Channels**.
2. Create a post and select the target platform(s).
3. Add a publicly accessible HTTPS image/video URL when the selected provider requires media.
4. Run the local rule checks and, optionally, the Groq audit/variant generation.
5. Submit for review. An authorized workspace reviewer approves it.
6. Publish from the review screen. The API calls the real connected provider; each platform is marked published only if the provider returns success. A failed platform remains unpublished and shows the API error.
7. Sync comments from the Comments page. Generated replies are drafts; pressing Send reply calls the real platform API.

## Review governance

- **Average approval time:** the Dashboard shows the mean and median time from submission to approval (`GET /api/governance/approval-time`).
- **Ambiguous rule alerts:** on a review, **Dispute this flag** records a dispute against the rule that raised it (reason optional). A rule disputed 3 or more times, or on at least 40% of 3 or more flags, appears in the Dashboard and Brand Knowledge alert panels with its top dispute reasons and a suggested clarification (Groq when configured, otherwise rule-based). Thresholds are set with `AMBIGUITY_*` in `backend/.env`.
- **Guideline versioning:** every saved guideline change creates a version with a rule snapshot and a rule-level diff (Brand Knowledge > Version History). Each review stores the version it was checked against and shows "Checked against guidelines vN". After a rule changes, pending reviews checked under an older version are listed with a **Re-check** option; approved and published reviews are never changed. Re-checked reviews keep their earlier results under "Earlier checks".

Endpoints are documented in `docs/frontend-api-contract.md`. Backend tests:

```powershell
cd backend
pip install -r requirements-dev.txt
python -m pytest tests
```

## Configuration reference

`backend/.env.example` contains the complete backend settings. `DATABASE_PATH` defaults to `backend/data/plumbline.sqlite3`. The frontend settings are in the root `.env.example`:

```dotenv
VITE_API_BASE_URL=http://localhost:8000
VITE_DEMO_MODE=false
VITE_APP_NAME=Plumbline
VITE_APP_VERSION=2.0.0
```

Never commit either `.env` file. The repository includes `.env.example` files only.

## Grounded RAG audit and rulebook upload

One audit engine runs on the backend and serves both the web app (Create Post, Review) and the Chrome extension.

How it works:

1. **Rule checks** run first: terminology rules, claim patterns and missing alt text.
2. **Hybrid retrieval** searches Brand Knowledge (voice, platform rules, terminology, facts) and every uploaded rulebook passage. It combines BM25 keyword search with Gemini embeddings, merged by Reciprocal Rank Fusion.
3. **Groq** audits the draft using only the retrieved passages, and each finding must cite passage ids.
4. **Citation gate**: findings with no valid citation, or that quote text not in the draft, are dropped. `meta.dropped` counts them.
5. Each finding stores a snapshot of the exact passage it cites, with the guideline version. Later rule changes do not rewrite old reviews.

**Upload a rulebook.** Go to Brand Knowledge, then Rulebooks, then Upload rulebook. It accepts PDF with selectable text, Markdown or .txt, up to 10 MB. PDFs are split per page, and Markdown is split under its headings. Owners, admins and managers can upload and remove rulebooks. Everyone in the workspace can see them. Sample files in `public/sample-rulebooks/` are listed automatically in the Rulebooks tab's download menu; add another supported file there and it appears in the menu (immediately in development, or after the next build in a deployed app).

**Storage.** By default, rulebooks are stored in the backend SQLite file and cosine similarity runs in Python. If `RAG_DATABASE_URL` is a Postgres URL (for example Supabase) and you run `pip install "psycopg[binary]"`, rulebooks are stored in Postgres and vector search runs in SQL with pgvector (`<=>`).

**Keys.** `GROQ_API_KEY` powers the AI layer. Without it, the cited rule checks still run. `GEMINI_API_KEY` is optional and free from AI Studio. It adds vector search; without it, retrieval uses BM25.

**API** (all need `Authorization: Bearer <token>`):

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/rag/rulebooks` | multipart `file`; parse, chunk, embed, index |
| GET | `/api/rag/rulebooks` | list rulebooks |
| GET | `/api/rag/rulebooks/{id}/chunks` | indexed passages |
| DELETE | `/api/rag/rulebooks/{id}` | remove a rulebook |
| POST | `/api/rag/audit` | `{text, platforms[], guidelines?, hasMedia?, mediaAltText?}` returns findings with `citations`, score, retrieved passages and meta |
| GET | `/api/rag/status` | storage and vector mode |

**Extension.** When the extension is signed in, it calls `/api/rag/audit`, so it uses the same engine, rulebooks and citations as the web app. If the backend can't be reached, it falls back to its local pipeline.

**Tests.** From the `backend` folder with the venv active, run `python tests/test_rag.py`. It uses a temporary database and a mocked Groq, and covers upload, parsing, duplicate and bad files, roles, citations, the citation gate, Groq being down, and delete. For the extension, run `node extension/test/pipeline.test.mjs`.

## Visual and accessibility audit (Improvement 2)

When a creator attaches an image or video in Create Post, Plumbline now analyses the creative itself, not just whether alt text exists. For a video it checks the thumbnail frame (1 second in), captured in the browser.

What it checks:

1. **Brand palette.** The creative's dominant colours are extracted and compared with the brand colours in Brand Knowledge, Colours and Fonts, using CIEDE2000 colour distance. White, black and greys are always allowed. If 15% or more of the creative is off-palette, that is a suggestion; 35% or more is a warning.
2. **WCAG contrast.** For each block of text on the image, Plumbline separates text pixels from background pixels and computes the WCAG 2.1 contrast ratio. AA needs 4.5:1 for normal text and 3:1 for large text. The vision model finds where the text is and reads it. Without a vision key, an edge heuristic estimates the text areas instead.
3. **Logo usage.** If a PNG or JPG logo is uploaded in Brand Knowledge, Logos and Assets, the vision model compares the logo on the creative with the approved files (variant, recolouring, skew). Plumbline also compares the logo's aspect ratio on the creative with the approved file; more than 15% off counts as distorted. When both checks agree, the finding is critical.
4. **Alt text draft.** The vision model writes an alt-text suggestion. The creator edits it and clicks **Use as alt text**.

Findings feed the existing 0-100 risk score. Palette and logo findings count under the visual assets weight (25 each), and contrast and alt-text findings count under the accessibility weight (10 each). They are saved with the post and appear in Review. Governance Insights groups disputes under `check:visual_palette`, `check:visual_contrast` and `check:visual_logo`.

**Keys.** The check uses the backend's `GROQ_API_KEY` with the free vision model `qwen/qwen3.8-27b` (`GROQ_VISION_MODEL`). `GEMINI_API_KEY` (`gemini-2.5-flash-lite`) is the fallback. With no key, the palette and contrast checks still run.

**Try it.** `public/sample-creatives/` has `northwind-logo-primary.png`, `good-poster.png` and `bad-poster.png`. Set the colours to Primary `#1F6FEB`, Secondary `#0B1D3A`, Accent `#E0457B` and Background `#FFFFFF`, then upload the logo as a primary logo. In Create Post, attach `good-poster.png`: the only finding should be the alt-text prompt. Then attach `bad-poster.png`: expect an off-palette warning, low-contrast warnings and a logo distortion finding, and the risk score goes up.

**API:** `POST /api/visual/audit` with `{image: dataURL, colors, logos[], altText, guidelineVersion, mediaKind}` returns findings, score, palette, contrast checks, logo result, suggested alt text and meta. `GET /api/visual/status` reports whether a vision model is configured.

**Tests.** From `backend`, run `python tests/test_visual.py`. It runs 38 checks with generated images and a mocked vision model: colour maths, palette, contrast thresholds, the heuristic fallback, logo variant and distortion, alt text, outage fallback, the API and the score weights.

## Install the Chrome extension (judges)

The extension brings the same grounded audit into post boxes on other websites (X, LinkedIn, Instagram web, Threads, Reddit and more). It works in desktop Chrome or Edge, not in phone apps.

1. Download `public/plumbline-extension.zip` from this repository (or from the Download extension button in the web app) and unzip it. You should get a folder that contains `manifest.json`.
2. Open Chrome and go to the Extensions page (type chrome://extensions in the address bar).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped folder (the one with `manifest.json` directly inside it).
5. The Options page opens. Leave **Backend URL** as `https://plumbline-gqa2.onrender.com`. Enter the email and password of your Plumbline account and click **Sign in & sync**. No API keys are needed when you are signed in. If the server was asleep, the first sign-in can take up to a minute.
6. Open a site such as X or LinkedIn and click into the post box. A **Plumbline check** pill appears at its corner.
7. Type a post, for example: `Join the number one university! Guaranteed placement for every student. Insane value.` The pill shows the issue count. Click it to open the panel with findings, cited rule passages and suggested fixes. The grey line at the bottom says **Shared Plumbline engine** when the backend ran the audit.
8. Upload a rulebook in the web app (Brand Knowledge, then Rulebooks), click **Sync now** in the extension Options, and check again. Findings now cite the rulebook.

Without signing in, the extension still runs the rule checks locally. Click **Load sample** in Options for sample guidelines, or add your own free Groq and Gemini keys for the AI step.

Running locally: set Backend URL to `http://localhost:8000` and sign in with a local account.

## Known test-build limitations

- The visual check reads one image or one video thumbnail frame per post, not every frame of a video. It runs in the web app only; the Chrome extension still checks text. SVG logos are skipped by the logo check (use PNG or JPG).

- Workspace JSON is stored as shared records in a local SQLite database. It is suitable for basic testing but does not provide sophisticated concurrent editing, audit-grade versioning, invitation email delivery, or multi-tenant production hardening.
- OAuth access tokens are stored server-side in the local SQLite test database without encryption at rest. Do not copy the database into source control or share it.
- The browser must be able to reach the backend URL. For another device on the same LAN, update `FRONTEND_URL`, `CORS_ORIGINS`, `VITE_API_BASE_URL`, and the OAuth redirect URLs consistently; OAuth providers generally require HTTPS for public hosts.
- Social networks can reject requests when developer-app review, Page roles, scopes, API tiers, rate limits, media URL accessibility, or account eligibility are insufficient. The exact provider error will be shown in Plumbline.
- Plumbline does not bypass provider restrictions or ask for passwords/one-time login codes. Users authorize through the provider's own consent flow.
