(() => {
  if (window.__plumblineLoaded) return;
  window.__plumblineLoaded = true;

  const HOSTS = {
    'instagram.com': 'instagram', 'linkedin.com': 'linkedin', 'threads.net': 'threads', 'threads.com': 'threads',
    'reddit.com': 'reddit', 'web.whatsapp.com': 'whatsapp', 'discord.com': 'discord', 'web.telegram.org': 'telegram',
    'bsky.app': 'bluesky', 'medium.com': 'medium', 'quora.com': 'quora', 'pinterest.com': 'pinterest',
    'tumblr.com': 'tumblr', 'youtube.com': 'youtube', 'x.com': 'x', 'facebook.com': 'facebook'
  };
  const platform = Object.entries(HOSTS).find(([h]) => location.hostname.endsWith(h))?.[1] || 'generic';

  const send = (type, payload) => new Promise(resolve =>
    chrome.runtime.sendMessage({ type, payload }, r => resolve(r || { ok: false, error: chrome.runtime.lastError?.message || 'No response' })));

  // ---------- editable helpers ----------
  const isEditable = el => el && (el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && /^(text|search)$/i.test(el.type)) || el.isContentEditable);

  const rootEditable = el => {
    if (!el) return null;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el;
    let cur = el;
    while (cur.parentElement && cur.parentElement.isContentEditable) cur = cur.parentElement;
    return cur;
  };

  const readText = el => (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') ? el.value : el.innerText;

  function writeText(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    // contenteditable (Lexical / Draft.js / Slate editors): go through the editor's own input pipeline
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges(); sel.addRange(range);
    const ok = document.execCommand('insertText', false, text);
    if (!ok) { el.innerText = text; el.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    return true;
  }

  // ---------- UI (shadow DOM so site CSS can't break it) ----------
  const host = document.createElement('div');
  host.id = 'plumbline-host';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  // keep typing in our panel from triggering the site's keyboard shortcuts
  ['keydown', 'keyup', 'keypress'].forEach(t => host.addEventListener(t, e => e.stopPropagation()));
  shadow.innerHTML = `
    <style>
      :host{all:initial}
      *{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
      .pill{position:fixed;z-index:2147483646;display:none;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;
        background:#111827;color:#fff;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);border:none}
      .pill .dot{width:8px;height:8px;border-radius:50%;background:#9ca3af}
      .panel{position:fixed;z-index:2147483647;right:16px;top:16px;width:380px;max-height:calc(100vh - 32px);overflow:auto;
        background:#fff;color:#111827;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:none;font-size:13px}
      header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #eee;position:sticky;top:0;background:#fff}
      header b{font-size:14px} header button{border:none;background:none;font-size:18px;cursor:pointer;color:#6b7280}
      .body{padding:12px 14px}
      .score{display:flex;align-items:center;gap:12px;margin-bottom:10px}
      .ring{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:#fff}
      .low{background:#16a34a}.medium{background:#d97706}.high{background:#dc2626}
      .f{border:1px solid #eee;border-radius:10px;padding:10px;margin:8px 0}
      .f .t{font-weight:600;margin-bottom:4px}.sev{font-size:10px;text-transform:uppercase;font-weight:700;padding:2px 6px;border-radius:6px;margin-right:6px}
      .critical{background:#fee2e2;color:#991b1b}.warning{background:#fef3c7;color:#92400e}.suggestion{background:#e0f2fe;color:#075985}
      q{display:block;background:#f9fafb;border-left:3px solid #d1d5db;padding:4px 8px;margin:6px 0;font-style:italic}
      .src{font-size:11px;color:#6b7280;margin-top:4px}
      .row{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
      textarea.edt{width:100%;min-height:52px;box-sizing:border-box;margin-top:6px;border:1px solid #d1d5db;border-radius:8px;padding:6px;font:inherit;font-size:12px;resize:vertical}
      button.b{border:1px solid #d1d5db;background:#fff;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer}
      button.p{background:#111827;color:#fff;border-color:#111827}
      details{margin-top:10px;font-size:12px;color:#374151} summary{cursor:pointer;font-weight:600}
      .ctx{font-size:11px;color:#4b5563;margin:4px 0}
      .muted{color:#6b7280;font-size:12px}
      textarea{width:100%;min-height:110px;border:1px solid #d1d5db;border-radius:8px;padding:8px;font-size:13px}
      .err{color:#b91c1c;font-size:12px;margin-top:6px}
    </style>
    <button class="pill" id="pill"><span class="dot" id="dot"></span><span id="plabel">Plumbline check</span></button>
    <div class="panel" id="panel"><header><b>Plumbline · ${platform}</b><button id="close">×</button></header><div class="body" id="body"></div></div>`;

  const $ = id => shadow.getElementById(id);
  let target = null;      // the editor being checked
  let lastText = '';
  let lastResult = null;

  function placePill(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 18) { $('pill').style.display = 'none'; return; }
    const pill = $('pill');
    pill.style.display = 'flex';
    pill.style.top = `${Math.max(4, Math.min(window.innerHeight - 36, r.bottom - 34))}px`;
    pill.style.left = `${Math.max(4, Math.min(window.innerWidth - 150, r.right - 146))}px`;
  }

  const ours = e => e.composedPath?.().includes(host);
  document.addEventListener('focusin', e => {
    const el = e.composedPath?.()[0] || e.target;
    if (ours(e) || !isEditable(el)) return;
    target = rootEditable(el);
    placePill(target);
  }, true);
  window.addEventListener('scroll', () => target && document.contains(target) && placePill(target), true);
  window.addEventListener('resize', () => target && placePill(target));


  // ---------- live mode: user types in the app's own composer, suggestions appear by themselves ----------
  const AI_PAUSE_MS = 2500, AI_MIN_GAP_MS = 10000, MIN_CHARS = 25;
  let rulesTimer = null, aiTimer = null, lastAiAt = 0, lastAiText = '';
  const COLORS = { high: '#dc2626', medium: '#d97706', low: '#16a34a' };
  function setPill(label, risk) {
    $('plabel').textContent = label;
    $('dot').style.background = COLORS[risk] || '#9ca3af';
  }
  document.addEventListener('input', e => {
    const el = e.composedPath?.()[0] || e.target;
    if (ours(e) || !isEditable(el)) return;
    target = rootEditable(el);
    placePill(target);
    clearTimeout(rulesTimer); clearTimeout(aiTimer);
    rulesTimer = setTimeout(async () => {
      const text = readText(target).trim();
      if (!text) return setPill('Plumbline check');
      const r = await send('rules', { text, platform });
      if (!r.ok || !r.data) return;
      if (r.data.noGuidelines) return setPill('Sync guidelines');
      const n = r.data.findings.length;
      setPill(n ? `${n} issue${n > 1 ? 's' : ''}` : 'Looks good', r.data.score?.riskCategory);
      if (!r.data.autoCheck || text.length < MIN_CHARS || text === lastAiText) return;
      aiTimer = setTimeout(() => {
        const now = Date.now();
        if (now - lastAiAt < AI_MIN_GAP_MS) return;   // protect free-tier quota
        lastAiAt = now; lastAiText = text;
        check(text);
      }, AI_PAUSE_MS);
    }, 700);
  }, true);

  $('pill').addEventListener('mousedown', e => e.preventDefault()); // keep editor focus
  $('pill').addEventListener('click', () => target && check(readText(target)));
  $('close').addEventListener('click', () => { $('panel').style.display = 'none'; });

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function show(html) { $('panel').style.display = 'block'; $('body').innerHTML = html; }

  async function check(text) {
    text = (text || '').trim();
    if (!text) return show('<p class="muted">Type your post first, then run the check.</p>');
    lastText = text;
    show('<p class="muted">Retrieving your brand rules and auditing…</p>');
    const r = await send('audit', { text, platform });
    if (!r.ok) return show(`<p class="err">${esc(r.error)}</p><div class="row"><button class="b" id="opt">Open settings</button></div>`), bindOpt();
    lastResult = r.data;
    render(r.data);
  }

  function bindOpt() { const b = $('opt'); if (b) b.onclick = () => send('openOptions'); }

  function render({ findings, score, retrieved, meta }) {
    $('dot').style.background = score.riskCategory === 'high' ? '#dc2626' : score.riskCategory === 'medium' ? '#d97706' : '#16a34a';
    const items = findings.map((f, i) => `
      <div class="f">
        <div class="t"><span class="sev ${f.severity}">${f.severity}</span>${esc(f.issueTitle)}</div>
        <div>${esc(f.description)}</div>
        ${f.affectedContent ? `<q>${esc(f.affectedContent)}</q>` : ''}
        ${f.suggestedCorrection ? `<div><b>Suggestion:</b> ${esc(f.suggestedCorrection)}</div>` : ''}
        <div class="src">Source: ${esc(f.sourceReference)} · ${f.origin === 'ai' ? 'AI' : f.origin === 'rules+ai' ? 'Rules + AI' : 'Rule'} · ${(f.confidence * 100).toFixed(0)}%</div>
        ${(f.citations || []).some(c => c && typeof c === 'object') ? `<details class="cite"><summary>Cited rule${f.citations.length > 1 ? 's' : ''} (${f.citations.length})</summary>${f.citations.map(c => `<div class="ctx"><b>${esc(c.label)}</b>${c.page ? ` (page ${c.page})` : ''}<br>${esc(c.text)}</div>`).join('')}</details>` : ''}
        ${target && f.affectedContent && f.suggestedCorrection && f.suggestedCorrection.length < 200 ? `<div class="row"><button class="b p" data-fix="${i}">Apply</button><button class="b" data-edit="${i}">Edit</button><button class="b" data-dismiss="${i}">Dismiss</button></div>
          <div class="ed" id="ed${i}" style="display:none"><textarea class="edt" id="edt${i}">${esc(f.suggestedCorrection)}</textarea>
          <div class="row"><button class="b p" data-fixed="${i}">Apply my edit</button><button class="b" data-cancel="${i}">Cancel</button></div></div>` : ''}
      </div>`).join('');
    show(`
      <div class="score"><div class="ring ${score.riskCategory}">${score.overallScore}</div>
        <div><b>${score.riskCategory.toUpperCase()} brand risk</b><div class="muted">${findings.length} finding(s) · ${score.criticalCount} critical</div></div></div>
      ${meta.aiError ? `<p class="err">AI layer unavailable (${esc(meta.aiError)}). Showing rule checks only.</p>` : ''}
      ${items || '<p>✅ No brand issues found. Good to post.</p>'}
      <div class="row"><button class="b p" id="rewrite">Rewrite on-brand</button><button class="b" id="recheck">Re-check</button></div>
      <details><summary>Retrieved brand context (${retrieved.length})</summary>
        ${retrieved.map(c => `<div class="ctx"><b>[${esc(c.id)}]</b> ${esc(c.text)}</div>`).join('')}
        <p class="muted">${meta.engine === 'backend' ? 'Shared Plumbline engine · ' : ''}${esc(meta.retrieval)} · ${meta.chunks} chunks indexed${meta.documentChunks ? ` (${meta.documentChunks} from uploaded rulebooks)` : ''}${meta.dropped ? ` · ${meta.dropped} uncited flag(s) dropped` : ''} · ${meta.provider || 'rules only'} · ${meta.ms} ms</p>
      </details>`);

    const applyFix = (i, replacement, btn) => {
      const f = findings[i];
      const current = readText(target);
      const idx = current.toLowerCase().indexOf(f.affectedContent.toLowerCase());
      if (idx < 0) { btn.textContent = 'Text changed, re-check'; return; }
      writeText(target, current.slice(0, idx) + replacement + current.slice(idx + f.affectedContent.length));
      const card = btn.closest('.f'); card.style.opacity = .45;
      card.querySelectorAll('.row,.ed').forEach(n => n.remove());
    };
    shadow.querySelectorAll('[data-fix]').forEach(b => b.onclick = () => applyFix(+b.dataset.fix, findings[+b.dataset.fix].suggestedCorrection, b));
    shadow.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
      const i = b.dataset.edit; $('ed' + i).style.display = 'block'; b.parentElement.style.display = 'none';
      const t = $('edt' + i); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
    });
    shadow.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => {
      const i = b.dataset.cancel; $('ed' + i).style.display = 'none'; shadow.querySelector(`[data-edit="${i}"]`).parentElement.style.display = 'flex';
    });
    shadow.querySelectorAll('[data-fixed]').forEach(b => b.onclick = () => {
      const v = $('edt' + b.dataset.fixed).value.trim(); if (v) applyFix(+b.dataset.fixed, v, b);
    });
    shadow.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = () => b.closest('.f').remove());
    $('recheck').onclick = () => check(target ? readText(target) : lastText);
    $('rewrite').onclick = rewrite;
  }

  async function rewrite() {
    show('<p class="muted">Rewriting with your brand rules…</p>');
    const r = await send('rewrite', { text: lastText, platform, findings: lastResult?.findings || [] });
    if (!r.ok) return show(`<p class="err">${esc(r.error)}</p>`);
    show(`
      <p><b>Suggested on-brand version</b> <span class="muted">(review before using)</span></p>
      <textarea id="rw">${esc(r.data.rewrite)}</textarea>
      ${(r.data.changes || []).length ? `<details open><summary>What changed</summary>${r.data.changes.map(c => `<div class="ctx">• ${esc(c)}</div>`).join('')}</details>` : ''}
      <div class="row">${target ? '<button class="b p" id="use">Replace my draft</button>' : ''}<button class="b" id="copy">Copy</button><button class="b" id="back">Back</button></div>`);
    if ($('use')) $('use').onclick = () => { writeText(target, $('rw').value); check($('rw').value); };
    $('copy').onclick = () => navigator.clipboard.writeText($('rw').value);
    $('back').onclick = () => lastResult && render(lastResult);
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (msg?.type !== 'plumbline:checkSelection') return;
    const active = document.activeElement;
    if (!msg.text && isEditable(active)) target = rootEditable(active);
    else if (msg.text) target = isEditable(active) ? rootEditable(active) : null;
    check(msg.text || (target ? readText(target) : ''));
  });
})();
