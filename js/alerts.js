// Alerts: quick price alerts + multi-condition alerts (any indicator, AND/OR,
// any symbol & timeframe), evaluated in the app; optionally mirrored to the
// cloud worker so they also fire while the app is closed.
import { ruleSeries, describeRule } from './conditions.js';
import { ruleEditor } from './condui.js';
import { el, esc, makeModal, select, uid } from './ui.js';

export function initAlerts(app) {
  const { S, save, $ } = app;
  // migrate old {dir, price} alerts
  S.alerts = (S.alerts || []).map(a => (a.kind ? a : { ...a, kind: 'price', freq: 'once' }));
  S.alertLog ||= [];
  let showAll = false, lines = [];

  const changed = () => { save(); renderList(); drawLines(); app.emit('alertsChanged'); };

  // ---------- firing ----------
  let audioCtx;
  function beep() {
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.15, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      o.start(); o.stop(audioCtx.currentTime + 0.5);
    } catch {}
  }
  async function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'hawk-' + Date.now() });
      else new Notification(title, { body });
    } catch {}
  }
  function fire(a, msg) {
    app.toast('🔔 ' + esc(msg), 8000);
    notify('鷹眼看盤 警示', msg);
    if (S.settings.alertSound !== false) beep();
    S.alertLog.unshift({ t: Date.now(), msg });
    S.alertLog = S.alertLog.slice(0, 50);
    if (a.freq === 'once' || a.kind === 'price') a.fired = true;
    changed();
  }

  // ---------- price alerts (tick based) ----------
  const lastSeen = {};
  app.on('price', (sym, price) => {
    if (app.replaying && sym === S.symbol) return;
    const prev = lastSeen[sym];
    lastSeen[sym] = price;
    if (prev == null) return;
    for (const a of S.alerts) {
      if (a.kind !== 'price' || a.fired || a.symbol !== sym) continue;
      if ((a.dir === 'above' && prev < a.price && price >= a.price) || (a.dir === 'below' && prev > a.price && price <= a.price)) {
        fire(a, `${app.symLabel(sym)} ${a.dir === 'above' ? '漲破' : '跌破'} ${app.fmtS(sym, a.price)}（現價 ${app.fmtS(sym, price)}）`);
      }
    }
  });

  // ---------- rule alerts (bar based) ----------
  function evalRule(a, bars) {
    if (bars.length < 3) return;
    let sig;
    try { sig = ruleSeries(a.rule, bars); } catch (e) { a.error = e.message; return; }
    a.error = null;
    const idx = a.freq === 'close' ? bars.length - 2 : bars.length - 1;
    const barT = bars[idx].utc;
    if (!sig[idx] || a.lastBar === barT) return;
    if (a.freq === 'close' && a.lastBar == null && a.created && a.created / 1000 > bars[idx].utc + app.data.intervalSec(a.interval)) { a.lastBar = barT; return; }
    a.lastBar = barT;
    const iv = app.data.INTERVALS.find(x => x.k === a.interval)?.label || a.interval;
    fire(a, `${app.symLabel(a.symbol)} ${iv}：${a.name || describeRule(a.rule)}（價 ${app.fmtS(a.symbol, bars[bars.length - 1].close)}）`);
  }
  let evalPending = false;
  const evalCurrent = () => {
    if (evalPending || app.replaying) return;
    evalPending = true;
    setTimeout(() => {
      evalPending = false;
      for (const a of S.alerts) if (a.kind === 'rule' && !a.fired && a.symbol === S.symbol && a.interval === S.interval) evalRule(a, app.bars);
    }, 800);
  };
  app.on('tick', evalCurrent);
  app.on('loaded', evalCurrent);
  // other symbols / timeframes: poll
  async function poll() {
    const groups = {};
    for (const a of S.alerts) {
      if (a.kind !== 'rule' || a.fired || (a.symbol === S.symbol && a.interval === S.interval)) continue;
      (groups[a.symbol + '|' + a.interval] ||= []).push(a);
    }
    for (const [key, list] of Object.entries(groups)) {
      const [sym, iv] = key.split('|');
      try {
        const intraday = app.data.intervalSec(iv) < 86400;
        const bars = (await app.data.fetchKlines(sym, iv, { limit: 400 })).map(b => ({ ...b, intraday }));
        list.forEach(a => evalRule(a, bars));
      } catch {}
    }
  }
  setInterval(poll, 60000);
  setTimeout(poll, 5000);

  // ---------- price lines on the chart ----------
  function drawLines() {
    const ms = app.mainSeries;
    if (!ms) return;
    for (const l of lines) try { ms.removePriceLine(l); } catch {}
    lines = S.alerts.filter(a => a.kind === 'price' && a.symbol === S.symbol && !a.fired).map(a =>
      ms.createPriceLine({ price: a.price, color: '#f5a524', lineStyle: 1, lineWidth: 1, axisLabelVisible: true, title: '🔔' }));
  }
  app.on('build', () => { lines = []; drawLines(); });

  // ---------- side panel ----------
  const head = $('#alertForm').previousElementSibling;
  const allBtn = el('button', 'icon-btn', '全'); allBtn.title = '顯示全部商品的警示';
  allBtn.onclick = () => { showAll = !showAll; allBtn.classList.toggle('on', showAll); renderList(); };
  const advBtn = el('button', 'btn sm', '＋ 條件警示'); advBtn.title = '用指標組合多個條件';
  advBtn.onclick = () => openEditor();
  const sp = el('span'); sp.style.flex = '1';
  head.append(sp, allBtn, advBtn);

  function renderList() {
    const ul = $('#alerts');
    ul.innerHTML = '';
    const list = S.alerts.filter(a => showAll || a.symbol === S.symbol);
    if (!list.length) { ul.append(el('li', 'empty', showAll ? '尚無警示' : `${esc(app.symLabel(S.symbol))} 尚無警示`)); return; }
    for (const a of list) {
      const li = el('li', a.fired ? 'fired' : '');
      const iv = app.data.INTERVALS.find(x => x.k === a.interval)?.label;
      const txt = a.kind === 'price' ? `${a.dir === 'above' ? '漲破' : '跌破'} <b>${app.fmtS(a.symbol, a.price)}</b>`
        : `<b>${esc(a.name || '條件警示')}</b><small>${iv} · ${esc(describeRule(a.rule))}</small>`;
      li.innerHTML = `<span class="a-txt">${showAll || a.symbol !== S.symbol ? `<i>${esc(app.symLabel(a.symbol))}</i> ` : ''}${txt}${a.error ? `<small class="down">${esc(a.error)}</small>` : ''}</span>${a.server ? '<span class="a-cloud" title="伺服器端警示">☁</span>' : ''}`;
      if (a.kind === 'rule') {
        const ed = el('button', 'icon-btn', '✎'); ed.title = '編輯'; ed.onclick = () => openEditor(a); li.append(ed);
      }
      if (a.fired) { const re = el('button', 'icon-btn', '↻'); re.title = '重新啟用'; re.onclick = () => { a.fired = false; a.lastBar = null; changed(); }; li.append(re); }
      const del = el('button', 'icon-btn danger', '✕'); del.title = '刪除';
      del.onclick = () => { S.alerts = S.alerts.filter(x => x !== a); changed(); };
      li.append(del);
      ul.append(li);
    }
    if (S.alertLog.length) {
      const lg = el('li', 'a-log', `<details><summary>最近觸發（${S.alertLog.length}）</summary>${S.alertLog.slice(0, 15).map(x => `<div><small>${new Date(x.t).toLocaleString('zh-TW', { hour12: false })}</small> ${esc(x.msg)}</div>`).join('')}</details>`);
      ul.append(lg);
    }
  }

  $('#alertForm').onsubmit = e => {
    e.preventDefault();
    const price = parseFloat($('#alertPrice').value);
    if (!(price > 0)) return;
    const dir = $('#alertDir').value;
    S.alerts.push({ id: Date.now(), kind: 'price', symbol: S.symbol, dir, price, fired: false, freq: 'once', server: !!S.settings.serverAlerts });
    changed();
    $('#alertPrice').value = '';
    app.notifyPerm();
    app.toast(`已新增警示：${esc(app.symLabel(S.symbol))} ${dir === 'above' ? '漲破' : '跌破'} ${app.fmtS(S.symbol, price)}`);
  };
  $('#alertPrice').addEventListener('focus', () => {
    const last = app.bars[app.bars.length - 1]?.close;
    if (!$('#alertPrice').value && last) $('#alertPrice').placeholder = app.fmtS(S.symbol, last).replace(/,/g, '');
  });

  // ---------- condition alert editor ----------
  function openEditor(existing) {
    const M = makeModal(app, 'alertModal', '條件警示', 'wide');
    const a = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: uid(), kind: 'rule', symbol: S.symbol, interval: S.interval, freq: 'bar', server: !!S.settings.serverAlerts,
      name: '', rule: { logic: 'and', conds: [{ a: { k: 'ind', type: 'RSI', p: { n: 14 }, o: 0 }, op: 'xup', b: { k: 'num', v: 30 } }] },
    };
    const body = M.body; body.className = 'mbody form-body'; body.innerHTML = '';
    const row = (label, ctrl) => { const r = el('label', 'row', `<span>${label}</span>`); r.append(ctrl); body.append(r); return r; };
    const symBtn = el('button', 'btn', esc(app.symLabel(a.symbol)));
    symBtn.type = 'button';
    symBtn.onclick = () => { M.modal.hidden = true; app.openSearch('', s => { a.symbol = s; symBtn.textContent = app.symLabel(s); M.modal.hidden = false; }); };
    row('商品', symBtn);
    row('週期', select(app.data.INTERVALS.map(i => [i.k, i.label]), a.interval, v => (a.interval = v)));
    const name = el('input'); name.placeholder = '例如：RSI 由下往上穿越 30'; name.value = a.name || ''; name.oninput = () => (a.name = name.value);
    row('名稱（選填）', name);
    body.append(el('h4', '', '條件'));
    body.append(ruleEditor(a.rule));
    const scripts = S.scripts || [];
    if (scripts.length) {
      const sel = select([['', '（不使用）'], ...scripts.map(s => [s.id, s.name])], a.rule.script?.id || '', v => {
        const sc = scripts.find(x => x.id === v);
        a.rule.script = sc ? { id: sc.id, name: sc.name, code: sc.code, use: 'alert' } : undefined;
      });
      row('加上腳本的 alert() 條件', sel);
    }
    row('觸發方式', select([['bar', '每根 K 棒最多一次'], ['close', 'K 棒收盤確認後'], ['once', '只觸發一次']], a.freq, v => (a.freq = v)));
    const srv = el('input'); srv.type = 'checkbox'; srv.checked = !!a.server; srv.onchange = () => (a.server = srv.checked);
    const sr = row('同時交給雲端（App 關閉也通知）', srv);
    if (!S.cloud?.url) { sr.title = '請先在 設定 → 雲端同步 填入雲端服務網址'; srv.disabled = true; sr.append(el('small', 'muted', '需先設定雲端')); }
    const test = el('div', 'muted small');
    const actions = el('div', 'actions');
    const tbtn = el('button', 'btn', '用目前圖表測試');
    tbtn.type = 'button';
    tbtn.onclick = () => {
      if (a.symbol !== S.symbol || a.interval !== S.interval) { test.textContent = '測試只能用目前主圖的商品與週期'; return; }
      try {
        const sig = ruleSeries(a.rule, app.bars);
        const hits = sig.filter(Boolean).length;
        test.textContent = `目前載入的 ${app.bars.length} 根 K 棒中，條件成立 ${hits} 次${sig[sig.length - 1] ? '，最新一根成立中' : ''}。`;
        app.setMarkers(sig.map((v, i) => (v ? { utc: app.bars[i].utc, position: 'aboveBar', shape: 'circle', color: '#f5a524', size: 0.6 } : null)).filter(Boolean));
      } catch (e) { test.textContent = e.message; }
    };
    const ok = el('button', 'btn primary', existing ? '儲存' : '建立警示');
    ok.onclick = () => {
      if (!a.rule.conds.length && !a.rule.script) { test.textContent = '請至少加一個條件'; return; }
      a.fired = false; a.lastBar = null; a.created = Date.now(); a.error = null;
      if (existing) Object.assign(existing, a); else S.alerts.push(a);
      app.setMarkers([]);
      changed(); app.closeModals(); app.notifyPerm();
      app.toast('已' + (existing ? '更新' : '建立') + '條件警示：' + esc(a.name || describeRule(a.rule)));
    };
    actions.append(tbtn, el('span', 'sp'), ok);
    body.append(test, actions);
    M.open();
  }

  app.on('symbol', () => renderList());
  app.openAlerts = openEditor;
  renderList();
}
