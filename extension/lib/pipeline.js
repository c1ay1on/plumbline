// The AI pipeline: rules → retrieve → grounded LLM audit → validate → merge → score.
// Philosophy kept from the web app: "AI flags and suggests. Your reviewers decide. Nothing is rewritten silently."

import { auditDeterministic, calculateRiskScore } from './rules.js';
import { buildChunks, retrieve, draftQueries } from './rag.js';
import { chat, parseJson, embed } from './llm.js';

const CATEGORIES = ['unsupported_claim', 'outdated_info', 'tone_mismatch', 'terminology', 'incorrect_messaging', 'accessibility'];

export const PLATFORM_HINTS = {
  instagram: 'visual and conversational, short caption, hashtags at the end',
  linkedin: 'professional, insight-led, no slang',
  threads: 'conversational and brief',
  reddit: 'plain, non-promotional, community-first; marketing tone is penalised',
  whatsapp: 'short, personal, direct',
  discord: 'casual community chat',
  telegram: 'short announcement style',
  bluesky: 'concise, under 300 characters',
  medium: 'long-form, explanatory',
  quora: 'helpful answer first, no hard selling',
  pinterest: 'descriptive, keyword-rich',
  tumblr: 'casual, creative',
  youtube: 'informative, friendly',
  x: 'concise, under 280 characters',
  facebook: 'community-oriented',
  generic: 'clear and on-brand'
};

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

/** Embeds chunks once and caches vectors by content hash (cache is any get/set store). */
async function vectorsFor(settings, chunks, queries, cache) {
  if (!settings.geminiKey || settings.disableEmbeddings) return null;
  try {
    const hashes = await Promise.all(chunks.map(c => sha(c.text)));
    const cached = (await cache.get('embeddings')) || {};
    const missing = chunks.map((c, i) => [c, i]).filter(([, i]) => !cached[hashes[i]]);
    if (missing.length) {
      const vecs = await embed(settings.geminiKey, missing.map(([c]) => c.text), 'RETRIEVAL_DOCUMENT');
      missing.forEach(([, i], j) => { cached[hashes[i]] = vecs[j]; });
      await cache.set('embeddings', cached);
    }
    const queryVecs = await embed(settings.geminiKey, queries, 'RETRIEVAL_QUERY');
    return { chunkVecs: hashes.map(h => cached[h]), queryVecs };
  } catch (e) {
    console.warn('[Plumbline] embeddings unavailable, using BM25 only:', e.message);
    return null;
  }
}

function contextBlock(chunks) {
  return chunks.map(c => `[${c.id}] ${c.text}`).join('\n');
}

function auditPrompt(text, platform, context) {
  const system = `You are Plumbline, a brand-governance auditor. AI flags and suggests; humans decide.
Audit the DRAFT for platform "${platform}" (${PLATFORM_HINTS[platform] || PLATFORM_HINTS.generic}).
Use ONLY the numbered brand context below. Every finding must cite at least one context id, except tone findings based on the platform norm.
Flag: claims, superlatives, stats or credentials not backed by an approved fact (unsupported_claim, critical);
use of facts marked outdated/pending (outdated_info, critical); banned or discouraged terms (terminology, warning);
tone that breaks the brand voice or platform rule (tone_mismatch, warning); statements that contradict an approved fact (incorrect_messaging, critical).
Do not invent rules that are not in the context. If the draft is clean, return an empty list.
"affectedContent" MUST be an exact substring copied from the draft.
Return ONLY JSON:
{"findings":[{"category":"...","severity":"critical|warning|suggestion","issueTitle":"...","description":"...","affectedContent":"...","suggestedCorrection":"replacement text for affectedContent","citations":["F:..."],"confidence":0.0}]}

BRAND CONTEXT:
${context || '(no guidelines configured)'}`;
  return { system, user: `DRAFT:\n"""${text}"""` };
}

function validate(raw, text, retrieved, version) {
  const ids = new Map(retrieved.map(c => [c.id, c]));
  const lower = text.toLowerCase();
  return (raw.findings || []).map((f, i) => {
    const citations = (f.citations || []).filter(id => ids.has(id));
    const affected = (f.affectedContent || '').trim();
    const grounded = affected && lower.includes(affected.toLowerCase());
    if (!grounded && f.category !== 'tone_mismatch') return null;          // hallucinated quote
    if (!citations.length && f.category !== 'tone_mismatch') return null;   // no evidence
    const category = CATEGORIES.includes(f.category) ? f.category : 'tone_mismatch';
    return {
      id: `llm-${i}-${Date.now()}`, origin: 'ai', category,
      severity: ['critical', 'warning', 'suggestion'].includes(f.severity) ? f.severity : 'warning',
      issueTitle: f.issueTitle || 'Brand rule alert',
      description: f.description || '',
      affectedContent: grounded ? affected : '',
      suggestedCorrection: f.suggestedCorrection || '',
      citations,
      sourceReference: citations.map(id => ids.get(id).label).join('; ') || 'Platform tone norm',
      guidelineVersion: version,
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.8,
      status: 'open'
    };
  }).filter(Boolean);
}

function merge(ruleFindings, aiFindings) {
  const key = f => `${f.category}|${(f.affectedContent || '').toLowerCase()}`;
  const seen = new Set(ruleFindings.map(key));
  const claimTexts = ruleFindings.filter(f => f.category === 'unsupported_claim').map(f => f.affectedContent.toLowerCase());
  const extra = aiFindings.filter(f => {
    if (seen.has(key(f))) return false;
    // AI finding covering the same claim as a rule finding: upgrade the rule finding instead of duplicating
    if (f.category === 'unsupported_claim') {
      const hit = claimTexts.find(c => f.affectedContent.toLowerCase().includes(c));
      if (hit) {
        const rf = ruleFindings.find(r => r.category === 'unsupported_claim' && r.affectedContent.toLowerCase() === hit);
        Object.assign(rf, { severity: f.severity, description: f.description, suggestedCorrection: f.suggestedCorrection || rf.suggestedCorrection, citations: f.citations, sourceReference: f.sourceReference, origin: 'rules+ai' });
        return false;
      }
    }
    seen.add(key(f));
    return true;
  });
  return [...ruleFindings, ...extra];
}

/**
 * Improvement 1: when signed in to Plumbline, the full audit runs on the backend's
 * shared grounded RAG engine (same engine as the web app), so uploaded PDF/Markdown
 * rulebooks are searched and every finding cites a real rule passage. Returns null
 * if the backend can't be used, and the caller falls back to the local pipeline.
 */
async function backendAudit({ text, platform, guidelines, settings }) {
  if (!settings.backendToken || !settings.backendUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 70000);
  try {
    const res = await fetch(`${settings.backendUrl.replace(/\/$/, '')}/api/rag/audit`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.backendToken}` },
      body: JSON.stringify({ text, platforms: [platform], guidelines: guidelines || undefined, topK: settings.topK || 8 })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.warn('[Plumbline] backend audit unavailable:', res.status, data.detail || '');
      return null;
    }
    const data = await res.json();
    return {
      findings: data.findings,
      score: data.score,
      retrieved: data.retrieved,
      meta: { ...data.meta, provider: data.meta.provider ? `plumbline backend (${data.meta.provider})` : 'plumbline backend (rules only)', engine: 'backend' }
    };
  } catch (e) {
    console.warn('[Plumbline] backend audit failed, using local pipeline:', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function runAudit({ text, platform, guidelines, settings, cache }) {
  const shared = await backendAudit({ text, platform, guidelines, settings });
  if (shared) return shared;
  const started = Date.now();
  const version = guidelines?.version || 'v1';
  const ruleFindings = auditDeterministic(text, platform, guidelines || {});

  const chunks = buildChunks(guidelines || {}, platform);
  const queries = draftQueries(text);
  const vectors = await vectorsFor(settings, chunks, queries, cache);
  const retrieved = retrieve(chunks, queries, { vectors, k: settings.topK || 8, platform });

  let aiFindings = [], provider = null, aiError = null;
  if (settings.groqKey || settings.geminiKey || settings.backendToken) {
    try {
      const res = await chat(settings, auditPrompt(text, platform, contextBlock(retrieved)));
      provider = res.provider;
      aiFindings = validate(parseJson(res.text), text, retrieved, version);
    } catch (e) { aiError = e.message; }
  }

  const findings = merge(ruleFindings, aiFindings);
  return {
    findings,
    score: calculateRiskScore(findings),
    retrieved: retrieved.map(({ id, label, text: t, score }) => ({ id, label, text: t, score })),
    meta: { provider, aiError, retrieval: vectors ? 'hybrid (BM25 + Gemini vectors)' : 'BM25', ms: Date.now() - started, chunks: chunks.length }
  };
}

export async function runRewrite({ text, platform, guidelines, settings, cache, findings = [] }) {
  const chunks = buildChunks(guidelines || {}, platform);
  const queries = draftQueries(text);
  const vectors = await vectorsFor(settings, chunks, queries, cache);
  const retrieved = retrieve(chunks, queries, { vectors, k: settings.topK || 8, platform });
  const issues = findings.map(f => `- ${f.issueTitle}: "${f.affectedContent}" → ${f.suggestedCorrection}`).join('\n');
  const res = await chat(settings, {
    system: `You rewrite social posts so they follow the brand context exactly, adapted for ${platform} (${PLATFORM_HINTS[platform] || PLATFORM_HINTS.generic}).
Keep the author's meaning. Never add facts, numbers, links, dates or claims that are not in the draft or in an approved fact below.
Remove or soften unsupported claims. Return ONLY JSON: {"rewrite":"...","changes":["short note per change, citing ids like F:1"]}

BRAND CONTEXT:
${contextBlock(retrieved)}`,
    user: `DRAFT:\n"""${text}"""\n${issues ? `KNOWN ISSUES:\n${issues}` : ''}`,
    temperature: 0.3
  });
  const out = parseJson(res.text);
  return { rewrite: out.rewrite || text, changes: out.changes || [], provider: res.provider };
}

export async function runReply({ comment, platform, guidelines, settings, cache }) {
  const chunks = buildChunks(guidelines || {}, platform);
  const queries = draftQueries(comment);
  const vectors = await vectorsFor(settings, chunks, queries, cache);
  const retrieved = retrieve(chunks, queries, { vectors, k: 6, platform });
  const res = await chat(settings, {
    system: `You draft a brand reply to an audience comment on ${platform}. Use only approved facts in the context; never invent dates, links, prices or rankings.
If the context cannot answer, reply politely and offer to follow up. Return ONLY JSON: {"reply":"...","citations":["F:..."]}

BRAND CONTEXT:
${contextBlock(retrieved)}`,
    user: `COMMENT:\n"""${comment}"""`,
    temperature: 0.3
  });
  const out = parseJson(res.text);
  return { reply: out.reply || '', citations: out.citations || [], provider: res.provider };
}
