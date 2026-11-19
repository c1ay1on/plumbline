// RAG layer: turn Plumbline brand guidelines into a searchable knowledge base,
// then retrieve only the rules/facts relevant to the draft being checked.
//
// Retrieval is HYBRID:
//   1. BM25 keyword search  — runs locally, no key, always available
//   2. Dense vector search  — Gemini embeddings (free tier), used when a key is set
// Both rankings are merged with Reciprocal Rank Fusion (RRF).

// ---------- 1. Chunking ----------

export function buildChunks(guidelines, platform) {
  const g = guidelines || {};
  const chunks = [];
  const voice = g.voice || {};

  if ((voice.tones || []).length || voice.customToneDescription) {
    chunks.push({
      id: 'V:tone', kind: 'voice', pinned: true,
      label: 'Brand voice',
      text: `Brand voice tones: ${(voice.tones || []).join(', ')}. ${voice.customToneDescription || ''}`.trim()
    });
  }
  if (voice.examplePositive) chunks.push({ id: 'V:good', kind: 'voice', label: 'On-brand example', text: `Good on-brand example: ${voice.examplePositive}` });
  if (voice.exampleNegative) chunks.push({ id: 'V:bad', kind: 'voice', label: 'Off-brand example', text: `Off-brand example to avoid: ${voice.exampleNegative}` });

  Object.entries(voice.platformRules || {}).forEach(([p, rule]) => {
    if (!rule) return;
    chunks.push({ id: `P:${p}`, kind: 'platform', pinned: p === platform, label: `${p} tone rule`, text: `Platform rule for ${p}: ${rule}` });
  });

  (g.terminology || []).forEach((t, i) => {
    const id = `T:${t.id || i}`;
    chunks.push({
      id, kind: 'terminology', label: `Terminology: ${t.bannedTerm || t.preferredTerm}`,
      platforms: t.platforms || ['all'],
      text: `Terminology rule${t.context ? ` (${t.context})` : ''}: avoid "${t.bannedTerm}"${t.preferredTerm ? `, use "${t.preferredTerm}" instead` : ''}. ${t.explanation || ''}`.trim()
    });
  });

  (g.facts || []).forEach((f, i) => {
    chunks.push({
      id: `F:${f.id || i}`, kind: 'fact', status: f.approvalStatus,
      label: `Fact (${f.approvalStatus || 'unknown'})`,
      text: `${f.approvalStatus === 'approved' ? 'Approved fact' : `Fact marked ${f.approvalStatus} — do NOT use as support`}` +
        `${f.category ? ` [${f.category}]` : ''}: ${f.fact}${f.source ? ` (Source: ${f.source})` : ''}${f.validUntil ? ` (valid until ${f.validUntil})` : ''}`
    });
  });

  // Free-text rulebook (pasted policy docs). Split into overlapping passages.
  (g.rulebookText ? [{ title: 'Rulebook', body: g.rulebookText }] : [])
    .concat(g.documents || [])
    .forEach((doc, d) => {
      splitPassages(doc.body || '', 600, 120).forEach((p, j) => {
        chunks.push({ id: `D:${d}.${j}`, kind: 'document', label: `${doc.title || 'Document'} §${j + 1}`, text: p });
      });
    });

  return chunks.filter(c => c.text && c.text.length > 3);
}

export function splitPassages(text, size = 600, overlap = 120) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const out = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const stop = clean.lastIndexOf('. ', end);
      if (stop > start + size * 0.5) end = stop + 1;
    }
    out.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}

// ---------- 2. BM25 ----------

const STOP = new Set('a an and are as at be but by for from has have i in is it its of on or our that the this to was we were will with you your they them their'.split(' '));

export function tokenize(text) {
  return (text || '').toLowerCase()
    .replace(/[^a-z0-9#%@\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t && !STOP.has(t))
    .map(stem);
}

function stem(w) {
  // tiny suffix stripper — good enough for short brand rules
  return w.replace(/(ing|edly|ed|ly|es|s)$/, '') || w;
}

export class BM25 {
  constructor(docs, k1 = 1.4, b = 0.75) {
    this.k1 = k1; this.b = b;
    this.docs = docs.map(d => tokenize(d.text));
    this.avgdl = this.docs.reduce((a, d) => a + d.length, 0) / Math.max(1, this.docs.length);
    this.df = new Map();
    this.docs.forEach(tokens => new Set(tokens).forEach(t => this.df.set(t, (this.df.get(t) || 0) + 1)));
  }
  idf(t) {
    const n = this.docs.length, df = this.df.get(t) || 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }
  scores(query) {
    const q = tokenize(query);
    return this.docs.map(tokens => {
      const tf = new Map();
      tokens.forEach(t => tf.set(t, (tf.get(t) || 0) + 1));
      let s = 0;
      q.forEach(t => {
        const f = tf.get(t);
        if (!f) return;
        s += this.idf(t) * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * tokens.length / this.avgdl));
      });
      return s;
    });
  }
}

// ---------- 3. Vectors ----------

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ---------- 4. Retrieval with RRF ----------

function rankOf(scores) {
  return scores.map((s, i) => [i, s]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([i]) => i);
}

/**
 * @param chunks      output of buildChunks
 * @param queries     list of query strings (full draft + its sentences)
 * @param opts.vectors  optional { chunkVecs: number[][], queryVecs: number[][] }
 * @param opts.k        how many chunks to return
 */
export function retrieve(chunks, queries, { vectors = null, k = 8, platform = null } = {}) {
  if (!chunks.length) return [];
  const bm25 = new BM25(chunks);
  const fused = new Map();
  const add = (idx, rank) => fused.set(idx, (fused.get(idx) || 0) + 1 / (60 + rank));

  queries.forEach((q, qi) => {
    rankOf(bm25.scores(q)).slice(0, 20).forEach((idx, r) => add(idx, r));
    if (vectors && vectors.queryVecs[qi]) {
      const sims = vectors.chunkVecs.map(v => (v ? cosine(vectors.queryVecs[qi], v) : 0));
      rankOf(sims.map(s => (s > 0.35 ? s : 0))).slice(0, 20).forEach((idx, r) => add(idx, r));
    }
  });

  const ranked = [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([i, score]) => ({ ...chunks[i], score }));
  const pinned = chunks.filter(c => c.pinned);
  const out = [];
  const seen = new Set();
  for (const c of [...pinned, ...ranked]) {
    if (seen.has(c.id)) continue;
    if (c.platforms && platform && !c.platforms.includes('all') && !c.platforms.includes(platform)) continue;
    seen.add(c.id); out.push(c);
    if (out.length >= k) break;
  }
  return out;
}

export function draftQueries(text) {
  const sentences = text.split(/(?<=[.!?\n])\s+/).map(s => s.trim()).filter(s => s.length > 12);
  return [text.slice(0, 1500), ...sentences.slice(0, 6)];
}
