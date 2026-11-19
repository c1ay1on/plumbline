"""Grounded audit engine shared by the web app and the Chrome extension.

Pipeline: deterministic rule checks -> hybrid retrieval (BM25 + vectors, RRF)
-> grounded LLM audit (Groq) -> validation -> merge -> citation gate -> risk score.

Citation gate: every finding must cite at least one real passage (by id) from the
context. Findings with no valid citation, or that quote text that is not in the
draft, are dropped and counted in meta.dropped.
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from typing import Any

import httpx

from app.rag import embeddings
from app.rag.chunking import guideline_chunks, sha
from app.rag.retrieval import applies_to, cosine, draft_queries, hybrid_retrieve
from app.rag.store import get_store

CATEGORIES = {"unsupported_claim", "outdated_info", "tone_mismatch", "terminology",
              "incorrect_messaging", "accessibility", "alt_text_missing"}
SEVERITIES = {"critical", "warning", "suggestion"}
DEFAULT_MODEL = "openai/gpt-oss-120b"

CLAIM_PATTERNS = [
    re.compile(r"\b(number\s*one|number\s*1|no\.?\s*1|first|best|largest|leading|top[- ]ranked)\b|#1\b", re.I),
    re.compile(r"\b(certified|accredited|award[- ]winning|guarantee[ds]?|official partner)\b", re.I),
    re.compile(r"\b\d+(?:\.\d+)?\s*%", re.I),
]


def _fid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _source_of(chunk: dict) -> str:
    cid = chunk["id"]
    if cid.startswith("D:"):
        return "Uploaded rulebook"
    if cid.startswith("S:") or "(Plumbline default)" in chunk.get("label", ""):
        return "Plumbline baseline"
    return "Brand Knowledge"


def citation(chunk: dict) -> dict:
    c = {"id": chunk["id"], "label": chunk["label"], "text": chunk["text"][:600], "source": _source_of(chunk)}
    if chunk.get("filename"):
        c["filename"] = chunk["filename"]
    if chunk.get("page"):
        c["page"] = chunk["page"]
    return c


# ---------------- deterministic checks ----------------

def rule_findings(text: str, platforms: list[str], chunks: list[dict], guidelines: dict,
                  has_media: bool, alt_text: str | None, version: str) -> list[dict]:
    out: list[dict] = []
    lower = text.lower()
    for c in chunks:
        if c.get("kind") != "terminology" or not c.get("bannedTerm") or not applies_to(c, platforms):
            continue
        banned = c["bannedTerm"]
        m = re.search(r"(?<![\w])" + re.escape(banned.lower()) + r"(?![\w])", lower)
        if not m:
            continue
        out.append({
            "id": _fid("rule"), "origin": "rules", "category": "terminology", "severity": "warning",
            "issueTitle": f"Restricted term: \u201c{banned}\u201d",
            "description": f"This term is restricted by your terminology rules. {c['text']}",
            "affectedContent": text[m.start():m.end()],
            "suggestedCorrection": c.get("preferredTerm") or "Rephrase this term.",
            "cites": [c["id"]], "confidence": 1.0,
        })

    approved = " ".join((f.get("fact") or "").lower() for f in (guidelines.get("facts") or [])
                        if f.get("approvalStatus") == "approved")
    for pat in CLAIM_PATTERNS:
        m = pat.search(text)
        if not m or m.group(0).lower() in approved:
            continue
        out.append({
            "id": _fid("rule"), "origin": "rules", "category": "unsupported_claim", "severity": "warning",
            "issueTitle": "Claim needs an approved fact",
            "description": "This wording makes a ranking, credential, guarantee or percentage claim that no approved fact backs.",
            "affectedContent": m.group(0),
            "suggestedCorrection": "Add an approved fact with a source, or remove or soften the claim.",
            "cites": ["S:claims"], "confidence": 0.75,
        })

    if has_media and not (alt_text or "").strip():
        out.append({
            "id": _fid("rule"), "origin": "rules", "category": "alt_text_missing", "severity": "suggestion",
            "issueTitle": "Add alt text to the attached media",
            "description": "The attached media has no alternative text for screen reader users.",
            "affectedContent": "Attached media",
            "suggestedCorrection": "Describe the main subject, the action and any text shown in the image.",
            "cites": ["S:alt"], "confidence": 1.0,
        })
    for f in out:
        f["guidelineVersion"] = version
        f["status"] = "open"
    return out


# ---------------- vectors ----------------

async def _vector_rankings(ws: str, chunks: list[dict], doc_chunks: list[dict], queries: list[str]):
    """For each query, chunk indexes (into `chunks`) ordered by similarity. None when vectors are off."""
    if not embeddings.enabled():
        return None, "BM25 only (set GEMINI_API_KEY to add vector search)"
    store = get_store()
    try:
        q_vecs = await embeddings.embed(queries, "RETRIEVAL_QUERY")
        g_chunks = [c for c in chunks if not c["id"].startswith("D:")]
        hashes = [sha(c["text"]) for c in g_chunks]
        cached = store.cached_vectors(hashes)
        missing = [(h, c) for h, c in zip(hashes, g_chunks) if h not in cached]
        if missing:
            vecs = await embeddings.embed([c["text"] for _, c in missing], "RETRIEVAL_DOCUMENT")
            new = {h: v for (h, _), v in zip(missing, vecs)}
            store.cache_vectors(new)
            cached.update(new)
        index = {c["id"]: i for i, c in enumerate(chunks)}
        rankings = []
        for qv in q_vecs:
            sims = [(c["id"], cosine(qv, cached[h])) for h, c in zip(hashes, g_chunks) if h in cached]
            sims = [s for s in sims if s[1] > 0.35]
            if doc_chunks:
                sims += store.rank_document_chunks(ws, qv, doc_chunks)
            sims.sort(key=lambda x: -x[1])
            rankings.append([index[cid] for cid, _ in sims if cid in index])
        return rankings, f"hybrid (BM25 + Gemini vectors, {store.vector_search})"
    except Exception as exc:
        return None, f"BM25 only (vectors unavailable: {str(exc)[:120]})"


# ---------------- LLM ----------------

def _prompt(text: str, platforms: list[str], context: list[dict], has_media: bool, alt_text: str | None) -> tuple[str, str]:
    ctx = "\n".join(f"[{c['id']}] {c['text']}" for c in context)
    system = f"""You are Plumbline, a brand-governance auditor. AI flags and suggests; humans decide.
Audit the DRAFT for these platforms: {', '.join(platforms) or 'generic'}.
Use ONLY the numbered brand context below. Every finding MUST cite one or more context ids in "citations".
A finding you cannot tie to a context passage must not be reported.
Flag: claims, superlatives, stats or credentials not backed by an approved fact (unsupported_claim, critical);
use of facts marked outdated or pending (outdated_info, critical); banned or discouraged terms (terminology, warning);
tone that breaks the brand voice or a platform rule (tone_mismatch, warning); statements that contradict an approved fact
or a rulebook passage (incorrect_messaging, critical).
Do not invent rules. If the draft is clean, return an empty list.
"affectedContent" MUST be an exact substring copied from the draft.
Return ONLY JSON:
{{"findings":[{{"category":"...","severity":"critical|warning|suggestion","issueTitle":"...","description":"...","affectedContent":"...","suggestedCorrection":"replacement text for affectedContent","citations":["F:..."],"confidence":0.0}}]}}

BRAND CONTEXT:
{ctx or '(no guidelines configured)'}"""
    media = f"\nAttached media: yes, alt text: {alt_text or 'NONE'}" if has_media else ""
    return system, f'DRAFT:\n"""{text}"""{media}'


async def _groq(system: str, user: str) -> tuple[dict, str]:
    key = os.getenv("GROQ_API_KEY", "").strip()
    from app.routes.ai import resolve_model
    model = resolve_model(None)
    body: dict[str, Any] = {
        "model": model, "temperature": 0.1, "max_tokens": 2000,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_object"},
    }
    if model.startswith("openai/gpt-oss"):
        body["reasoning_effort"] = "low"
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post("https://api.groq.com/openai/v1/chat/completions",
                                headers={"Authorization": f"Bearer {key}"}, json=body)
    if res.status_code == 429:
        raise RuntimeError("Groq rate limit reached; showing rule checks only. Try again in a minute.")
    if res.is_error:
        try:
            msg = res.json().get("error", {}).get("message", res.text)
        except Exception:
            msg = res.text
        raise RuntimeError(f"Groq {res.status_code}: {msg[:200]}")
    content = res.json()["choices"][0]["message"].get("content") or "{}"
    m = re.search(r"\{.*\}", content, re.S)
    return json.loads(m.group(0) if m else "{}"), model


def _validate(raw: dict, text: str, allowed: dict[str, dict], version: str) -> tuple[list[dict], int]:
    lower = text.lower()
    kept, dropped = [], 0
    for f in raw.get("findings") or []:
        if not isinstance(f, dict):
            dropped += 1
            continue
        cites = [c for c in (f.get("citations") or []) if isinstance(c, str) and c in allowed]
        affected = (f.get("affectedContent") or "").strip()
        category = f.get("category") if f.get("category") in CATEGORIES else "tone_mismatch"
        grounded = bool(affected) and affected.lower() in lower
        if not cites or (not grounded and category != "tone_mismatch"):
            dropped += 1
            continue
        if grounded:
            i = lower.index(affected.lower())
            affected = text[i:i + len(affected)]
        conf = f.get("confidence")
        kept.append({
            "id": _fid("ai"), "origin": "ai", "category": category,
            "severity": f.get("severity") if f.get("severity") in SEVERITIES else "warning",
            "issueTitle": str(f.get("issueTitle") or "Brand rule alert")[:140],
            "description": str(f.get("description") or "")[:800],
            "affectedContent": affected if grounded else "",
            "suggestedCorrection": str(f.get("suggestedCorrection") or "")[:600],
            "cites": cites, "confidence": float(conf) if isinstance(conf, (int, float)) else 0.8,
            "guidelineVersion": version, "status": "open",
        })
    return kept, dropped


def _merge(rules: list[dict], ai: list[dict]) -> list[dict]:
    key = lambda f: f"{f['category']}|{f['affectedContent'].lower()}"
    seen = {key(f) for f in rules}
    out = list(rules)
    for f in ai:
        if key(f) in seen:
            continue
        if f["category"] == "unsupported_claim":
            hit = next((r for r in rules if r["category"] == "unsupported_claim"
                        and r["affectedContent"].lower() in f["affectedContent"].lower()), None)
            if hit:  # AI explains a claim the rules caught: upgrade instead of duplicating
                hit.update(severity=f["severity"], description=f["description"] or hit["description"],
                           suggestedCorrection=f["suggestedCorrection"] or hit["suggestedCorrection"],
                           cites=list(dict.fromkeys(hit["cites"] + f["cites"])), origin="rules+ai")
                continue
        seen.add(key(f))
        out.append(f)
    return out


def risk_score(findings: list[dict]) -> dict:
    b = {"unsupportedClaims": 0, "visualAssets": 0, "messagingViolations": 0,
         "terminology": 0, "accessibility": 0, "toneInconsistencies": 0}
    counts = {"critical": 0, "warning": 0, "suggestion": 0}
    weights = {"unsupported_claim": ("unsupportedClaims", 30), "outdated_info": ("unsupportedClaims", 30),
               "incorrect_messaging": ("messagingViolations", 20), "terminology": ("terminology", 10),
               "accessibility": ("accessibility", 10), "alt_text_missing": ("accessibility", 10),
               "tone_mismatch": ("toneInconsistencies", 5)}
    for f in findings:
        if f.get("status") not in ("open", "contested"):
            continue
        counts[f["severity"]] = counts.get(f["severity"], 0) + 1
        if f["category"] in weights:
            k, w = weights[f["category"]]
            b[k] += w
    total = min(100, sum(b.values()))
    return {"overallScore": total, "riskCategory": "high" if total > 50 else "medium" if total > 20 else "low",
            "breakdown": b, "criticalCount": counts["critical"], "warningCount": counts["warning"],
            "suggestionCount": counts["suggestion"]}


async def run_audit(ws: str, text: str, platforms: list[str], guidelines: dict,
                    has_media: bool = False, alt_text: str | None = None, k: int = 8) -> dict:
    started = time.time()
    platforms = [p for p in platforms if p] or ["generic"]
    version = str(guidelines.get("version") or "v1")
    store = get_store()

    g_chunks = guideline_chunks(guidelines, platforms)
    d_chunks = store.load_chunks(ws)
    chunks = g_chunks + [{k_: v for k_, v in c.items() if k_ != "vec"} for c in d_chunks]
    by_id = {c["id"]: c for c in chunks}

    queries = draft_queries(text)
    rankings, retrieval_mode = await _vector_rankings(ws, chunks, d_chunks, queries)
    retrieved = hybrid_retrieve(chunks, queries, platforms, rankings, k)
    allowed = {c["id"]: c for c in retrieved}

    rules = rule_findings(text, platforms, g_chunks, guidelines, has_media, alt_text, version)

    ai, dropped, provider, ai_error = [], 0, None, None
    if os.getenv("GROQ_API_KEY", "").strip():
        try:
            raw, model = await _groq(*_prompt(text, platforms, retrieved, has_media, alt_text))
            provider = f"groq:{model}"
            ai, dropped = _validate(raw, text, allowed, version)
        except Exception as exc:
            ai_error = str(exc)[:240]
    else:
        ai_error = "GROQ_API_KEY is not set on the backend; showing rule checks only."

    findings = []
    for f in _merge(rules, ai):
        cites = [by_id[c] for c in f.pop("cites") if c in by_id]
        if not cites:  # citation gate
            dropped += 1
            continue
        f["citations"] = [citation(c) for c in cites]
        f["sourceReference"] = "; ".join(c["label"] for c in cites)
        findings.append(f)

    return {
        "findings": findings,
        "score": risk_score(findings),
        "retrieved": [{"id": c["id"], "label": c["label"], "text": c["text"][:400], "score": c.get("score"),
                       "source": _source_of(c)} for c in retrieved],
        "meta": {
            "provider": provider, "aiError": ai_error, "retrieval": retrieval_mode,
            "store": store.kind, "chunks": len(chunks), "documentChunks": len(d_chunks),
            "dropped": dropped, "guidelineVersion": version, "ms": int((time.time() - started) * 1000),
        },
    }
