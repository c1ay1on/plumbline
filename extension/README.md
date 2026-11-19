# Plumbline Brand Guard (Chrome extension)

Brings Plumbline's brand audit into apps the backend can't publish to (Instagram personal, LinkedIn pages/comments, Threads replies, Reddit, WhatsApp Web, Discord, Telegram, Bluesky, Medium, Quora…). Live mode: type in the app's own post box; the pill instantly shows rule issues and, after a 2.5 s pause, the grounded AI audit opens by itself with fixes you can apply. Runs on any website composer (WeChat Web etc. included); not desktop/mobile apps. Right-click "Check with Plumbline" works too.

## Pipeline (lib/)
1. `rules.js` – exact port of `AIAuditEngine` (terminology + claim regex + same risk score).
2. `rag.js` – guidelines → chunks (voice, platform rules, terminology, facts, pasted rulebook passages) → hybrid retrieval: local BM25 + Gemini embeddings, merged with Reciprocal Rank Fusion; platform rule always pinned.
3. `llm.js` – Groq (`openai/gpt-oss-20b`) primary, Gemini (`gemini-3.5-flash-lite`) fallback on 429/errors, `gemini-embedding-001` for vectors.
4. `pipeline.js` – grounded audit: LLM sees only top-k retrieved chunks, must cite chunk ids; findings whose quote isn't in the draft or with no valid citation are dropped; merged with rule findings and scored. Also `runRewrite` and `runReply`.
Works with no key (rules + BM25 only).

## Install
1. Unzip the download, open the Chrome Extensions page (chrome://extensions), turn on Developer mode, click Load unpacked and pick the folder that contains manifest.json.
2. In Options, keep Backend URL as https://plumbline-gqa2.onrender.com (or http://localhost:8000 when running locally), then sign in with your Plumbline account and click Sign in & sync. Signed in, the audit runs on the shared backend engine with your uploaded rulebooks, and no API keys are needed.
3. Not signed in: click "Load sample" and Save, and optionally add free Groq and Gemini keys for the AI step.
4. Click into any website's post box, type, then click the "Plumbline check" pill.

## Test
`node extension/test/pipeline.test.mjs`

## Note for the web app
`llama-3.3-70b-versatile` (README + groqService default) is Enterprise-only on Groq's free plan now; use `openai/gpt-oss-120b` or `openai/gpt-oss-20b` in `backend/.env`.
