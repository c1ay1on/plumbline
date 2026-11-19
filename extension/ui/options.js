const send = (type, payload) => new Promise(r => chrome.runtime.sendMessage({ type, payload }, res => r(res || { ok: false, error: 'No response' })));
const $ = id => document.getElementById(id);
const msg = (id, text, ok = true) => { $(id).textContent = text; $(id).className = `msg ${ok ? 'ok' : 'bad'}`; };

async function load() {
  const s = (await send('getSettings')).data;
  ['groqKey', 'geminiKey', 'backendUrl'].forEach(k => { $(k).value = s[k] || $(k).value; });
  $('groqModel').value = s.groqModel; $('geminiModel').value = s.geminiModel;
  $('disableEmbeddings').checked = !!s.disableEmbeddings;
  $('autoCheck').checked = s.autoCheck !== false;
  $('loginBox').hidden = !!s.backendToken; $('loggedBox').hidden = !s.backendToken;
  if (s.backendUser) $('who').textContent = `${s.backendUser.name} (${s.backendUser.email})`;
  const g = (await send('getGuidelines')).data;
  if (g) {
    const { rulebookText, ...rest } = g;
    $('glJson').value = JSON.stringify(rest, null, 2);
    $('rulebook').value = rulebookText || '';
  }
  const st = (await send('status')).data;
  $('glStatus').textContent = st.guidelines
    ? `Loaded ${st.guidelines.version || ''}: ${st.guidelines.terms} terminology rules, ${st.guidelines.facts} facts, ${st.guidelines.tones} tones · ${st.meta?.source || ''} ${st.meta?.syncedAt ? new Date(st.meta.syncedAt).toLocaleString() : ''}`
    : 'No guidelines loaded yet.';
}

$('saveKeys').onclick = async () => {
  await send('saveSettings', {
    groqKey: $('groqKey').value.trim(), geminiKey: $('geminiKey').value.trim(),
    groqModel: $('groqModel').value, geminiModel: $('geminiModel').value,
    disableEmbeddings: $('disableEmbeddings').checked,
    autoCheck: $('autoCheck').checked
  });
  msg('keysMsg', 'Saved.');
};

$('testKeys').onclick = async () => {
  $('saveKeys').click();
  msg('keysMsg', 'Testing…');
  const r = await send('testKeys');
  if (!r.ok) return msg('keysMsg', r.error, false);
  const parts = Object.entries(r.data).map(([k, v]) => `${k}: ${v}`);
  msg('keysMsg', parts.length ? parts.join(' · ') : 'Add at least one key.', parts.every(p => p.endsWith('ok')));
};

$('login').onclick = async () => {
  await send('saveSettings', { backendUrl: $('backendUrl').value.trim().replace(/\/$/, '') });
  msg('syncMsg', 'Signing in…');
  const r = await send('backendLogin', { email: $('email').value.trim(), password: $('password').value });
  $('password').value = '';
  if (!r.ok) return msg('syncMsg', r.error, false);
  msg('syncMsg', `Synced ${r.data.version}: ${r.data.counts.terms} terms, ${r.data.counts.facts} facts.`);
  load();
};
$('sync').onclick = async () => {
  const r = await send('syncGuidelines');
  r.ok ? msg('syncMsg', `Synced ${r.data.version}.`) : msg('syncMsg', r.error, false);
  load();
};
$('logout').onclick = async () => { await send('backendLogout'); load(); };

$('saveGl').onclick = async () => {
  let g;
  try { g = JSON.parse($('glJson').value || '{}'); } catch (e) { return msg('glMsg', `Invalid JSON: ${e.message}`, false); }
  g.rulebookText = $('rulebook').value;
  const r = await send('saveGuidelines', { guidelines: g });
  r.ok ? msg('glMsg', `Saved: ${r.data.counts.terms} terms, ${r.data.counts.facts} facts.`) : msg('glMsg', r.error, false);
  load();
};
$('loadSample').onclick = async () => {
  const g = await (await fetch(chrome.runtime.getURL('sample-guidelines.json'))).json();
  const { rulebookText, ...rest } = g;
  $('glJson').value = JSON.stringify(rest, null, 2);
  $('rulebook').value = rulebookText || '';
  msg('glMsg', 'Sample loaded. Press Save to use it.');
};

load();
