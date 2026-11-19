import { runAudit, runRewrite, runReply } from './lib/pipeline.js';
import { testGroq, testGemini } from './lib/llm.js';
import { auditDeterministic, calculateRiskScore } from './lib/rules.js';

const DEFAULT_SETTINGS = {
  groqKey: '', groqModel: 'openai/gpt-oss-20b',
  geminiKey: '', geminiModel: 'gemini-3.5-flash-lite',
  backendUrl: 'https://plumbline-gqa2.onrender.com', backendToken: '', backendUser: null,
  topK: 8, disableEmbeddings: false, autoCheck: true
};

const store = {
  get: async k => (await chrome.storage.local.get(k))[k],
  set: async (k, v) => chrome.storage.local.set({ [k]: v })
};

async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await store.get('settings')) || {}) };
}

async function getGuidelines() {
  return (await store.get('guidelines')) || null;
}

// ---- Plumbline backend sync (same workspace data the web app uses) ----
async function backendLogin({ email, password }) {
  const s = await getSettings();
  const res = await fetch(`${s.backendUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Login failed');
  await store.set('settings', { ...s, backendToken: data.token, backendUser: data.user });
  return syncGuidelines();
}

async function syncGuidelines() {
  const s = await getSettings();
  if (!s.backendToken) throw new Error('Sign in to your Plumbline workspace first.');
  const res = await fetch(`${s.backendUrl}/api/workspace/data`, { headers: { Authorization: `Bearer ${s.backendToken}` } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Plumbline session expired. Sign in again.');
  if (!res.ok) throw new Error(data.detail || 'Could not load workspace');
  if (!data.guidelines) throw new Error('This workspace has no brand guidelines yet. Add them in Plumbline → Brand Knowledge.');
  const local = (await getGuidelines()) || {};
  // keep any extension-only rulebook text the user pasted
  // fill tone rules for apps the web app has no setting for (the workspace's own rules always win)
  const extra = (await (await fetch(chrome.runtime.getURL('sample-guidelines.json'))).json()).voice.platformRules;
  const voice = { ...(data.guidelines.voice || {}) };
  voice.platformRules = { ...extra, ...(voice.platformRules || {}) };
  const merged = { ...data.guidelines, voice, rulebookText: local.rulebookText || data.guidelines.rulebookText || '' };
  await store.set('guidelines', merged);
  await store.set('guidelinesMeta', { source: 'backend', syncedAt: new Date().toISOString() });
  return { ok: true, version: merged.version, counts: counts(merged) };
}

function counts(g) {
  return { terms: (g.terminology || []).length, facts: (g.facts || []).length, tones: (g.voice?.tones || []).length };
}

// ---- message router ----
const handlers = {
  // Instant, free, local check used while the user types in the app's own composer.
  async rules({ text, platform }) {
    const [settings, guidelines] = await Promise.all([getSettings(), getGuidelines()]);
    if (!guidelines) return { findings: [], score: null, autoCheck: settings.autoCheck, noGuidelines: true };
    const findings = auditDeterministic(text, platform, guidelines);
    return { findings, score: calculateRiskScore(findings), autoCheck: settings.autoCheck };
  },
  async audit({ text, platform }) {
    const [settings, guidelines] = await Promise.all([getSettings(), getGuidelines()]);
    if (!guidelines) throw new Error('No brand guidelines loaded. Open the extension options to sync or import them.');
    return runAudit({ text, platform, guidelines, settings, cache: store });
  },
  async rewrite({ text, platform, findings }) {
    const [settings, guidelines] = await Promise.all([getSettings(), getGuidelines()]);
    return runRewrite({ text, platform, findings, guidelines: guidelines || {}, settings, cache: store });
  },
  async reply({ comment, platform }) {
    const [settings, guidelines] = await Promise.all([getSettings(), getGuidelines()]);
    return runReply({ comment, platform, guidelines: guidelines || {}, settings, cache: store });
  },
  getSettings, getGuidelines,
  async status() {
    const [s, g, meta] = await Promise.all([getSettings(), getGuidelines(), store.get('guidelinesMeta')]);
    return { hasGroq: !!s.groqKey, hasBackendAI: !!s.backendToken, hasGemini: !!s.geminiKey, guidelines: g ? { version: g.version, ...counts(g) } : null, meta, user: s.backendUser };
  },
  async saveSettings(patch) {
    const s = await getSettings();
    await store.set('settings', { ...s, ...patch });
    return { ok: true };
  },
  async saveGuidelines({ guidelines }) {
    await store.set('guidelines', guidelines);
    await store.set('guidelinesMeta', { source: 'manual', syncedAt: new Date().toISOString() });
    return { ok: true, counts: counts(guidelines) };
  },
  backendLogin, syncGuidelines,
  async openOptions() { await chrome.runtime.openOptionsPage(); return { ok: true }; },
  async backendLogout() {
    const s = await getSettings();
    await store.set('settings', { ...s, backendToken: '', backendUser: null });
    return { ok: true };
  },
  async testKeys() {
    const s = await getSettings();
    const out = {};
    if (s.groqKey) out.groq = await testGroq(s.groqKey, s.groqModel).then(() => 'ok', e => e.message);
    if (s.geminiKey) out.gemini = await testGemini(s.geminiKey, s.geminiModel).then(() => 'ok', e => e.message);
    return out;
  }
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const fn = handlers[msg?.type];
  if (!fn) return false;
  Promise.resolve(fn(msg.payload || {}))
    .then(data => sendResponse({ ok: true, data }))
    .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
  return true; // async
});

// Right-click "Check with Plumbline" on any selected text, on any site
chrome.runtime.onInstalled.addListener(async () => {
  // Zero-setup start: ship with sample brand rules so the live check works before any sign-in or key.
  if (!(await getGuidelines())) {
    try { await store.set('guidelines', await (await fetch(chrome.runtime.getURL('sample-guidelines.json'))).json()); } catch {}
  }
  chrome.contextMenus.create({ id: 'plumbline-check', title: 'Check with Plumbline', contexts: ['selection', 'editable'] });
  chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'plumbline-check' || !tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'plumbline:checkSelection', text: info.selectionText || '' });
  } catch {
    // Site without the content script: inject it on demand (activeTab grants this after the click)
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/content.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'plumbline:checkSelection', text: info.selectionText || '' });
  }
});
