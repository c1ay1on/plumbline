// Free-tier model providers.
//   Primary  : Groq  (openai/gpt-oss-20b or gpt-oss-120b) — free plan, 30 RPM / 1K RPD / 8K TPM per model
//   Fallback : Google Gemini (gemini-3.5-flash-lite) — free tier
//   Embeddings: Gemini gemini-embedding-001 — free tier
// NOTE: llama-3.3-70b-versatile is Enterprise-only on Groq now, so it is NOT a default here.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export class RateLimitError extends Error {
  constructor(provider, retryAfter) { super(`${provider} rate limited`); this.provider = provider; this.retryAfter = retryAfter; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function groqChat({ key, model, system, user, temperature = 0.1, maxTokens = 1200, json = true }) {
  const body = {
    model, temperature, max_completion_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    ...(json ? { response_format: { type: 'json_object' } } : {}),
    ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {})
  };
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 429) throw new RateLimitError('groq', Number(res.headers.get('retry-after') || 5));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Groq: ${data?.error?.message || res.statusText}`);
  return data.choices?.[0]?.message?.content || '';
}

async function geminiChat({ key, model, system, user, temperature = 0.1, maxTokens = 1200, json = true }) {
  const res = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) }
    })
  });
  if (res.status === 429) throw new RateLimitError('gemini', 10);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini: ${data?.error?.message || res.statusText}`);
  return (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}

// Uses the team's Plumbline backend AI proxy (Groq key stays server-side), so users only need to sign in.
async function plumblineChat({ backendUrl, token, system, user, temperature = 0.1, maxTokens = 1200, json = true }) {
  const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/ai/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature, max_tokens: maxTokens, ...(json ? { response_format: { type: 'json_object' } } : {})
    })
  });
  if (res.status === 429) throw new RateLimitError('plumbline', 5);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Plumbline backend: ${data?.detail || res.statusText}`);
  return data.choices?.[0]?.message?.content || '';
}

/** Try Groq, wait briefly on a short 429, then fall back to Gemini. */
export async function chat(settings, prompt) {
  const errors = [];
  const providers = [];
  if (settings.groqKey) providers.push(['groq', () => groqChat({ key: settings.groqKey, model: settings.groqModel || 'openai/gpt-oss-20b', ...prompt })]);
  if (settings.geminiKey) providers.push(['gemini', () => geminiChat({ key: settings.geminiKey, model: settings.geminiModel || 'gemini-3.5-flash-lite', ...prompt })]);
  if (settings.backendToken) providers.push(['plumbline', () => plumblineChat({ backendUrl: settings.backendUrl, token: settings.backendToken, ...prompt })]);
  if (!providers.length) throw new Error('No API key set. Sign in to Plumbline or add a free Groq/Gemini key in the extension options.');

  for (const [name, call] of providers) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { text: await call(), provider: name };
      } catch (e) {
        if (e instanceof RateLimitError && attempt === 0 && e.retryAfter <= 4) { await sleep(e.retryAfter * 1000); continue; }
        errors.push(`${name}: ${e.message}`);
        break;
      }
    }
  }
  throw new Error(errors.join(' | '));
}

export function parseJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  throw new Error('Model did not return valid JSON');
}

/** Gemini embeddings, batched, L2-normalised (required for gemini-embedding-001 at 768 dims). */
export async function embed(key, texts, taskType = 'RETRIEVAL_DOCUMENT', dims = 768) {
  const out = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await fetch(`${GEMINI_BASE}/gemini-embedding-001:batchEmbedContents`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: batch.map(text => ({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text }] },
          taskType, outputDimensionality: dims
        }))
      })
    });
    if (res.status === 429) throw new RateLimitError('gemini-embed', 10);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gemini embed: ${data?.error?.message || res.statusText}`);
    (data.embeddings || []).forEach(e => {
      const v = e.values || [];
      const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
      out.push(v.map(x => x / n));
    });
  }
  return out;
}

export async function testGroq(key, model) {
  return groqChat({ key, model, system: 'Reply with JSON {"ok":true}', user: 'ping', maxTokens: 30 });
}
export async function testGemini(key, model) {
  return geminiChat({ key, model, system: 'Reply with JSON {"ok":true}', user: 'ping', maxTokens: 30 });
}
