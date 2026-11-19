// Run: node extension/test/pipeline.test.mjs   (Node 18+, no deps)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditDeterministic, calculateRiskScore } from '../lib/rules.js';
import { buildChunks, retrieve, draftQueries, splitPassages } from '../lib/rag.js';
import { runAudit } from '../lib/pipeline.js';

const g = JSON.parse(readFileSync(new URL('../sample-guidelines.json', import.meta.url)));
const draft = 'Hey guys! Plumbine is the best tool for clubs and cuts review time by 70%. Guaranteed placement for every member!';

// 1. rules
const rf = auditDeterministic(draft, 'instagram', g);
const cats = rf.map(f => f.category + ':' + f.affectedContent.toLowerCase());
assert.ok(cats.includes('terminology:plumbine'));
assert.ok(cats.includes('terminology:guys'));
assert.ok(cats.includes('terminology:guaranteed placement'));
assert.ok(cats.some(c => c.startsWith('unsupported_claim:best')));
assert.ok(cats.some(c => c.startsWith('unsupported_claim:70%')));
console.log('✓ rules:', rf.length, 'findings, score', calculateRiskScore(rf).overallScore);

// 2. chunking + retrieval
const chunks = buildChunks(g, 'instagram');
assert.ok(chunks.find(c => c.id === 'P:instagram' && c.pinned));
assert.ok(chunks.some(c => c.kind === 'document'));
const top = retrieve(chunks, draftQueries(draft), { k: 8, platform: 'instagram' });
const ids = top.map(c => c.id);
assert.ok(ids.includes('P:instagram'), 'platform rule pinned');
assert.ok(ids.includes('F:f3'), 'pending 70% fact retrieved');
assert.ok(ids.includes('T:t2'), 'guaranteed placement rule retrieved');
console.log('✓ retrieval top-8:', ids.join(', '));
assert.equal(splitPassages('a. '.repeat(500), 200, 40).every(p => p.length <= 200), true);

// 3. full pipeline with a mocked Groq response (includes one hallucinated finding that must be dropped)
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).includes('groq.com'));
  const body = JSON.parse(init.body);
  assert.ok(body.messages[0].content.includes('[F:f3]'), 'retrieved context is in the prompt');
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ findings: [
    { category: 'outdated_info', severity: 'critical', issueTitle: 'Uses a pending metric', description: 'The 70% figure is pending approval.', affectedContent: 'cuts review time by 70%', suggestedCorrection: 'helps clubs review posts faster', citations: ['F:f3'], confidence: 0.9 },
    { category: 'unsupported_claim', severity: 'critical', issueTitle: 'Invented', description: 'x', affectedContent: 'won a national award', suggestedCorrection: '', citations: ['F:f1'], confidence: 0.9 },
    { category: 'tone_mismatch', severity: 'warning', issueTitle: 'Too hype-y', description: 'Exclamation-heavy hype breaks the plain-spoken voice.', affectedContent: 'Guaranteed placement for every member!', suggestedCorrection: 'Placement support is available for members.', citations: ['V:tone'], confidence: 0.8 }
  ] }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const mem = new Map();
const cache = { get: async k => mem.get(k), set: async (k, v) => mem.set(k, v) };
const res = await runAudit({ text: draft, platform: 'instagram', guidelines: g, settings: { groqKey: 'test', groqModel: 'openai/gpt-oss-20b' }, cache });
assert.equal(res.meta.provider, 'groq');
assert.ok(!res.findings.some(f => f.issueTitle === 'Invented'), 'hallucinated quote dropped');
assert.ok(res.findings.some(f => f.category === 'outdated_info'));
assert.equal(res.score.riskCategory, 'high');
console.log('✓ pipeline:', res.findings.length, 'findings,', res.score.overallScore, res.score.riskCategory, '·', res.meta.retrieval);

// 4. no key → rules only, still works
const r2 = await runAudit({ text: draft, platform: 'linkedin', guidelines: g, settings: {}, cache });
assert.equal(r2.meta.provider, null);
assert.ok(r2.findings.length >= 5);
console.log('✓ offline fallback works');
console.log('All tests passed.');
