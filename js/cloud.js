// Cloud features through the project's Cloudflare Worker (same URL as the market relay):
//  - cross-device sync of settings, watchlist, alerts, scripts, templates and drawings (sync code)
//  - server-side alerts that keep running while the app is closed (ntfy / Telegram push)
import { el, esc } from './ui.js';

const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36) + s.length; };
const newCode = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); };

export function initCloud(app) {
  const { S, save } = app;
  S.cloud = { code: '', auto: true, at: 0, lastHash: '', ntfy: '', tgToken: '', tgChat: '', ...S.cloud };
  const C = S.cloud;
  const base = () => (app.data.getWorkerUrl?.() || '').replace(/\/$/, '');
  const ready = () => !!(base() && C.code);

  async function call(path, opts = {}) {
    const r = await fetch(base() + path, { ...opts, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + C.code, ...(opts.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 409) throw new Error(j.error || 'HTTP ' + r.status);
    return { status: r.status, ...j };
  }
  const snapshot = () => { const d = app.templates.exportAll(); delete d.at; return d; };
  const localHash = () => hash(JSON.stringify(snapshot()));

  // ---------- sync ----------
  let busy = false;
  async function upload(force = false) {
    if (!ready() || busy) return;
    busy = true;
    try {
      const data = snapshot(), h = hash(JSON.stringify(data)), at = Date.now();
      const r = await call('/sync/state' + (force ? '?force=1' : ''), { method: 'PUT', body: JSON.stringify({ at, state: data }) });
      if (r.status === 409) { conflict(r); return; }
      C.at = at; C.lastHash = h; save(); status('已上傳到雲端');
    } catch (e) { status('同步失敗：' + e.message, true); } finally { busy = false; }
  }
  async function pull({ silent = false } = {}) {
    if (!ready()) return;
    try {
      const r = await call('/sync/state');
      if (!r.state) { if (!silent) status('雲端還沒有資料，已上傳本機設定'); return upload(); }
      const remoteHash = hash(JSON.stringify(r.state));
      if (remoteHash === localHash()) { C.at = Math.max(C.at, r.at); C.lastHash = remoteHash; save(); if (!silent) status('已是最新'); return; }
      if (r.at <= C.at) return upload(); // local is newer
      const dirty = localHash() !== C.lastHash;
      if (dirty) return conflict(r);
      apply(r);
    } catch (e) { if (!silent) status('同步失敗：' + e.message, true); }
  }
  function apply(r) {
    if (sessionStorage.getItem('hawk.syncReload') && Date.now() - +sessionStorage.getItem('hawk.syncReload') < 20000) return;
    app.templates.importAll({ ...r.state, app: 'hawk-chart' });
    const st = JSON.parse(localStorage.getItem('hawk.state'));
    st.cloud = { ...C, at: r.at, lastHash: hash(JSON.stringify(r.state)) };
    localStorage.setItem('hawk.state', JSON.stringify(st));
    sessionStorage.setItem('hawk.syncReload', Date.now());
    app.toast('已套用雲端最新設定，重新載入中…');
    setTimeout(() => location.reload(), 500);
  }
  function conflict(r) {
    const bar = banner(`雲端有其他裝置在 ${new Date(r.at).toLocaleString('zh-TW', { hour12: false })} 更新的設定，與這台不同。`);
    const a = el('button', 'btn primary', '用雲端版本'); a.onclick = () => { bar.remove(); apply(r); };
    const b = el('button', 'btn', '用這台覆蓋雲端'); b.onclick = () => { bar.remove(); upload(true); };
    bar.querySelector('.bn-act').append(a, b);
  }
  function banner(text) {
    document.querySelector('.cloud-banner')?.remove();
    const bar = el('div', 'cloud-banner', `<span>☁ ${esc(text)}</span><span class="bn-act"></span><button class="icon-btn" title="關閉">✕</button>`);
    bar.querySelector('.icon-btn').onclick = () => bar.remove();
    document.body.append(bar);
    return bar;
  }
  let statusEl = null;
  function status(msg, err) { if (statusEl) { statusEl.textContent = msg; statusEl.className = 'cloud-status' + (err ? ' down' : ''); } }

  // auto-sync: upload local changes after they settle, pull when the app comes back
  let lastSeen = '', stableSince = 0;
  setInterval(() => {
    if (!ready() || !C.auto) return;
    const h = localHash();
    if (h === C.lastHash) { lastSeen = h; return; }
    if (h !== lastSeen) { lastSeen = h; stableSince = Date.now(); return; }
    if (Date.now() - stableSince > 8000) upload();
  }, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ready() && C.auto) pull({ silent: true }); });
  setInterval(() => { if (ready() && C.auto && document.visibilityState === 'visible') pull({ silent: true }); }, 180000);
  if (ready() && C.auto) setTimeout(() => pull({ silent: true }), 1500);

  // ---------- server-side alerts ----------
  let alertT = null;
  const notifyCfg = () => ({ ntfy: C.ntfy || undefined, tgToken: C.tgToken || undefined, tgChat: C.tgChat || undefined });
  async function pushAlerts() {
    if (!ready()) return;
    const list = S.alerts.filter(a => a.server && !a.fired).map(a => ({ ...a, label: app.symLabel(a.symbol), rule: a.rule ? { logic: a.rule.logic, conds: a.rule.conds } : undefined }));
    try { await call('/alerts', { method: 'PUT', body: JSON.stringify({ alerts: list, notify: notifyCfg() }) }); } catch (e) { app.toast('雲端警示更新失敗：' + esc(e.message)); }
  }
  app.on('alertsChanged', () => { clearTimeout(alertT); alertT = setTimeout(pushAlerts, 1500); });

  // ---------- settings UI ----------
  const sec = el('div', 'cloud-sec');
  [...document.querySelectorAll('#setModal .set-body > .fine')].pop().before(sec);
  function render() {
    const url = base();
    sec.innerHTML = '<h4 class="sec-title">雲端同步與伺服器警示</h4>';
    if (!url) { sec.append(el('p', 'fine', '需要先在上方「行情中繼」填入 Cloudflare Worker 網址（同一個 Worker 也負責同步與警示）。')); return; }
    const codeRow = el('div', 'row');
    codeRow.append(el('span', '', '同步代碼<small class="muted">（在每台裝置填同一組）</small>'));
    const box = el('span', 'inline');
    const inp = el('input', 'code-inp'); inp.value = C.code; inp.placeholder = '貼上或產生'; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.onchange = () => { C.code = inp.value.trim(); C.at = 0; C.lastHash = ''; save(); render(); if (ready()) pull(); };
    const gen = el('button', 'btn', '產生');
    gen.onclick = () => { C.code = newCode(); C.at = 0; C.lastHash = ''; save(); render(); upload(); };
    const cp = el('button', 'btn', '複製');
    cp.onclick = () => { navigator.clipboard?.writeText(C.code).then(() => app.toast('已複製同步代碼'), () => {}); };
    box.append(inp, gen, cp); codeRow.append(box); sec.append(codeRow);
    if (!C.code) { sec.append(el('p', 'fine', '第一次使用：按「產生」建立同步代碼，再到其他裝置貼上同一組代碼即可同步。代碼就是密碼，請勿公開。')); }
    const auto = el('label', 'row', '<span>自動同步</span>');
    const ac = el('input'); ac.type = 'checkbox'; ac.checked = C.auto; ac.onchange = () => { C.auto = ac.checked; save(); };
    auto.append(ac); sec.append(auto);
    const act = el('div', 'row');
    const up = el('button', 'btn', '立即上傳'); up.onclick = () => upload(true);
    const dn = el('button', 'btn', '從雲端下載'); dn.onclick = async () => { try { const r = await call('/sync/state'); if (r.state) apply(r); else status('雲端沒有資料'); } catch (e) { status(e.message, true); } };
    statusEl = el('span', 'cloud-status', C.at ? '上次同步：' + new Date(C.at).toLocaleString('zh-TW', { hour12: false }) : '');
    const g = el('span', 'inline'); g.append(up, dn);
    act.append(statusEl, g); sec.append(act);
    // server alerts
    sec.append(el('h4', 'sec-title', '伺服器端警示（App 關閉也會推播）'));
    const def = el('label', 'row', '<span>新警示預設交給雲端</span>');
    const dc = el('input'); dc.type = 'checkbox'; dc.checked = !!S.settings.serverAlerts; dc.onchange = () => { S.settings.serverAlerts = dc.checked; save(); };
    def.append(dc); sec.append(def);
    const ntfyRow = el('div', 'row');
    ntfyRow.append(el('span', '', 'ntfy 主題<small class="muted">（手機裝 ntfy App 並訂閱同名主題）</small>'));
    const nb = el('span', 'inline');
    const ni = el('input', 'code-inp'); ni.value = C.ntfy; ni.placeholder = '例如 hawk-xxxx';
    ni.onchange = () => { C.ntfy = ni.value.trim(); save(); pushAlerts(); };
    const ng = el('button', 'btn', '產生'); ng.onclick = () => { C.ntfy = 'hawk-' + newCode().slice(0, 12).toLowerCase().replace(/[^a-z0-9]/g, 'x'); save(); render(); pushAlerts(); };
    nb.append(ni, ng); ntfyRow.append(nb); sec.append(ntfyRow);
    const tgRow = el('div', 'row');
    tgRow.append(el('span', '', 'Telegram<small class="muted">（選填：Bot Token 與 Chat ID）</small>'));
    const tb = el('span', 'inline');
    const tt = el('input', 'code-inp'); tt.value = C.tgToken; tt.placeholder = 'Bot Token'; tt.onchange = () => { C.tgToken = tt.value.trim(); save(); pushAlerts(); };
    const tc = el('input', 'code-inp sm'); tc.value = C.tgChat; tc.placeholder = 'Chat ID'; tc.onchange = () => { C.tgChat = tc.value.trim(); save(); pushAlerts(); };
    tb.append(tt, tc); tgRow.append(tb); sec.append(tgRow);
    const testRow = el('div', 'row');
    const n = S.alerts.filter(a => a.server && !a.fired).length;
    testRow.append(el('span', 'muted', `目前交給雲端的警示：${n} 個`));
    const tbtn = el('button', 'btn', '送測試通知');
    tbtn.onclick = async () => {
      if (!ready()) { app.toast('請先設定同步代碼'); return; }
      try { await call('/alerts/test', { method: 'POST', body: JSON.stringify({ notify: notifyCfg() }) }); app.toast('已送出測試通知，請查看手機'); } catch (e) { app.toast('測試失敗：' + esc(e.message)); }
    };
    testRow.append(tbtn); sec.append(testRow);
    sec.append(el('p', 'fine', '雲端每分鐘檢查一次。腳本條件只能在 App 內執行，不會交給雲端。'));
  }
  document.getElementById('setBtn').addEventListener('click', render);
  render();
  app.cloud = { upload, pull, pushAlerts, render };
}
