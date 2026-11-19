const send = (type, payload) => new Promise(r => chrome.runtime.sendMessage({ type, payload }, res => r(res || { ok: false, error: 'No response' })));
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let last = null;

$('opts').onclick = e => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

(async () => {
  const st = (await send('status')).data;
  const keys = [st.hasGroq && 'Groq', st.hasGemini && 'Gemini'].filter(Boolean).join(' + ') || 'no AI key (rules only)';
  $('status').textContent = st.guidelines
    ? `${st.guidelines.terms} terms · ${st.guidelines.facts} facts · ${keys}`
    : 'No brand guidelines yet — open Settings.';
})();

$('check').onclick = async () => {
  const text = $('text').value.trim();
  if (!text) return;
  $('out').innerHTML = '<p class="muted">Checking…</p>';
  const r = await send('audit', { text, platform: $('platform').value });
  if (!r.ok) return ($('out').innerHTML = `<p class="msg bad">${esc(r.error)}</p>`);
  last = r.data;
  const { score, findings, meta } = r.data;
  $('out').innerHTML = `
    <p><span class="badge ${score.riskCategory}">${score.overallScore}</span> <b>${score.riskCategory} risk</b> · ${findings.length} finding(s)</p>
    ${meta.aiError ? `<p class="msg bad">AI: ${esc(meta.aiError)}</p>` : ''}
    ${findings.map(f => `<div class="card"><b>${esc(f.issueTitle)}</b>${f.affectedContent ? `<br><i>“${esc(f.affectedContent)}”</i>` : ''}<br>${esc(f.suggestedCorrection)}<div class="muted">${esc(f.sourceReference)}</div></div>`).join('') || '<p>✅ Clean.</p>'}
    <p class="muted">${esc(meta.retrieval)} · ${meta.provider || 'rules only'} · ${meta.ms} ms</p>`;
};

$('rewrite').onclick = async () => {
  const text = $('text').value.trim();
  if (!text) return;
  $('out').innerHTML = '<p class="muted">Rewriting…</p>';
  const r = await send('rewrite', { text, platform: $('platform').value, findings: last?.findings || [] });
  if (!r.ok) return ($('out').innerHTML = `<p class="msg bad">${esc(r.error)}</p>`);
  $('text').value = r.data.rewrite;
  $('out').innerHTML = `<p class="msg ok">Rewritten — review it above.</p>${(r.data.changes || []).map(c => `<div class="muted">• ${esc(c)}</div>`).join('')}`;
};
