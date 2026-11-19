// Screener: scan a universe of symbols (any market the data layer supports)
// on a chosen timeframe with preset and/or custom technical conditions.
import * as I from './indicators.js';
import { ruleSeries, PRESETS } from './conditions.js';
import { ruleEditor } from './condui.js';
import { CATALOG as MKT, CATS } from './markets.js';
import { el, esc, makeModal, select, numInput } from './ui.js';

const COLS = [
  ['sym', '商品'], ['last', '最新價'], ['chg', '漲跌 %'], ['rsi', 'RSI'], ['ma20', '距 MA20 %'], ['volx', '量／均量'], ['atr', 'ATR %'], ['hi', '距 N 高 %'],
];

export function initScreener(app) {
  const { S, save } = app;
  S.scr = { uni: 'crypto', iv: '1d', top: 60, presets: ['maBull'], useCustom: false, custom: { logic: 'and', conds: [] }, showAll: false, sort: 'chg', desc: true, ...S.scr };
  const cfg = S.scr;
  let rows = [], running = null;

  async function universe() {
    if (cfg.uni === 'watch') return S.watchlist.slice();
    if (cfg.uni === 'crypto') {
      const all = await app.data.fetchAllTickers();
      return all.filter(t => app.data.splitSymbol(t.symbol)[1] === 'USDT' && !/^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|AEUR)USDT$/.test(t.symbol))
        .sort((a, b) => b.qvol - a.qvol).slice(0, cfg.top).map(t => t.symbol);
    }
    return MKT.filter(x => x.cat === cfg.uni).map(x => 'Y:' + x.code).slice(0, cfg.top);
  }

  function metrics(bars) {
    const n = bars.length, c = I.closes(bars), last = c[n - 1];
    const r = I.rsi(bars, 14), m = I.sma(c, 20), v = bars.map(b => b.volume), av = I.sma(v, 20), a = I.atr(bars, 14), h = I.highest(bars.map(b => b.high), 52);
    return {
      last, chg: n > 1 ? (last / c[n - 2] - 1) * 100 : 0, rsi: r[n - 1], ma20: m[n - 1] ? (last / m[n - 1] - 1) * 100 : null,
      volx: av[n - 1] ? v[n - 1] / av[n - 1] : null, atr: a[n - 1] ? (a[n - 1] / last) * 100 : null, hi: h[n - 1] ? (last / h[n - 1] - 1) * 100 : null,
    };
  }

  async function run(out, prog) {
    const token = (running = {});
    rows = [];
    const syms = await universe();
    const rules = cfg.presets.map(k => PRESETS[k]).filter(Boolean).map(p => ({ logic: 'and', conds: p.conds }));
    if (cfg.useCustom && cfg.custom.conds.length) rules.push(cfg.custom);
    const intraday = app.data.intervalSec(cfg.iv) < 86400;
    let done = 0;
    const queue = syms.slice();
    const worker = async () => {
      while (queue.length && token === running) {
        const sym = queue.shift();
        try {
          const bars = (await app.data.fetchKlines(sym, cfg.iv, { limit: 300 })).map(b => ({ ...b, intraday }));
          if (bars.length >= 30) {
            const hit = rules.every(r => ruleSeries(r, bars)[bars.length - 1]);
            rows.push({ sym, ...metrics(bars), hit });
          }
        } catch {}
        done++;
        prog.style.width = (done / syms.length) * 100 + '%';
        if (done % 6 === 0) renderTable(out);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (token !== running) return;
    running = null;
    prog.style.width = '0';
    renderTable(out, true);
  }

  function renderTable(out, final) {
    const list = rows.filter(r => cfg.showAll || r.hit);
    const k = cfg.sort;
    list.sort((a, b) => (k === 'sym' ? a.sym.localeCompare(b.sym) : (a[k] ?? -1e18) - (b[k] ?? -1e18)) * (cfg.desc ? -1 : 1));
    const hits = rows.filter(r => r.hit).length;
    const f = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(d));
    out.innerHTML = `<div class="scr-sum">${final ? '完成：' : '掃描中…'}${rows.length} 檔中有 <b>${hits}</b> 檔符合</div>
      <div class="trade-table scr-table"><table><thead><tr>${COLS.map(([c, n]) => `<th data-k="${c}" class="${c === k ? 'on' : ''}">${n}${c === k ? (cfg.desc ? ' ▼' : ' ▲') : ''}</th>`).join('')}<th></th></tr></thead><tbody>
      ${list.map(r => `<tr data-s="${esc(r.sym)}" class="${r.hit ? 'hit' : ''}"><td><b>${esc(app.symLabel(r.sym))}</b></td><td>${app.fmtS(r.sym, r.last)}</td><td class="${app.cls(r.chg)}">${app.pct(r.chg)}</td>
        <td>${f(r.rsi, 1)}</td><td class="${app.cls(r.ma20)}">${f(r.ma20)}</td><td>${f(r.volx)}</td><td>${f(r.atr)}</td><td>${f(r.hi)}</td>
        <td><button class="star ${S.watchlist.includes(r.sym) ? 'on' : ''}" title="加入自選">${S.watchlist.includes(r.sym) ? '★' : '☆'}</button></td></tr>`).join('')}
      </tbody></table>${list.length ? '' : `<div class="muted" style="padding:12px">${final ? '沒有符合條件的商品，試試放寬條件或勾選「顯示全部」' : ''}</div>`}</div>`;
    out.querySelectorAll('th[data-k]').forEach(th => (th.onclick = () => { const kk = th.dataset.k; cfg.desc = cfg.sort === kk ? !cfg.desc : true; cfg.sort = kk; save(); renderTable(out, final); }));
    out.querySelectorAll('tr[data-s]').forEach(tr => (tr.onclick = e => {
      const s = tr.dataset.s;
      if (e.target.closest('.star')) {
        S.watchlist = S.watchlist.includes(s) ? S.watchlist.filter(x => x !== s) : [...S.watchlist, s];
        save(); app.emit('watchlistChanged'); renderTable(out, final); return;
      }
      app.closeModals();
      if (cfg.iv !== S.interval) app.setInterval(cfg.iv);
      app.switchSymbol(s);
    }));
  }

  function open() {
    const M = makeModal(app, 'scrModal', '選股器', 'xwide');
    const b = M.body; b.className = 'mbody scr-body'; b.innerHTML = '';
    const form = el('div', 'scr-form');
    const row = (label, ctrl) => { const r = el('label', 'mini-row', `<span>${label}</span>`); r.append(ctrl); form.append(r); return r; };
    const unis = [['crypto', '加密貨幣（USDT 成交額前 N）'], ['watch', '我的自選清單'], ...CATS.filter(c => c.k !== 'crypto' && MKT.some(x => x.cat === c.k)).map(c => [c.k, c.name + '（熱門清單）'])];
    row('範圍', select(unis, cfg.uni, v => { cfg.uni = v; save(); }));
    row('檔數上限', numInput(cfg.top, v => { cfg.top = Math.max(5, Math.min(300, v | 0)); save(); }, { width: '70px' }));
    row('週期', select(app.data.INTERVALS.map(i => [i.k, i.label]), cfg.iv, v => { cfg.iv = v; save(); }));
    b.append(form);
    const chips = el('div', 'chips');
    for (const [k, p] of Object.entries(PRESETS)) {
      const c = el('button', 'chip' + (cfg.presets.includes(k) ? ' on' : ''), esc(p.name));
      c.onclick = () => { cfg.presets = cfg.presets.includes(k) ? cfg.presets.filter(x => x !== k) : [...cfg.presets, k]; c.classList.toggle('on'); save(); };
      chips.append(c);
    }
    b.append(el('h4', '', '條件（全部都要符合，以最新一根 K 棒判斷）'), chips);
    const cc = el('details', 'scr-custom'); cc.open = cfg.useCustom;
    cc.innerHTML = '<summary>自訂條件</summary>';
    const use = el('label', 'mini', `<input type="checkbox" ${cfg.useCustom ? 'checked' : ''}> 使用自訂條件`);
    use.querySelector('input').onchange = e => { cfg.useCustom = e.target.checked; save(); };
    cc.append(use, ruleEditor(cfg.custom, save));
    b.append(cc);
    const act = el('div', 'actions');
    const all = el('label', 'mini', `<input type="checkbox" ${cfg.showAll ? 'checked' : ''}> 顯示全部（含不符合）`);
    const go = el('button', 'btn primary', '開始掃描');
    const progWrap = el('div', 'prog'); const prog = el('i'); progWrap.append(prog);
    act.append(all, el('span', 'sp'), go);
    const out = el('div', 'scr-out');
    b.append(act, progWrap, out);
    all.querySelector('input').onchange = e => { cfg.showAll = e.target.checked; save(); renderTable(out, !running); };
    go.onclick = async () => {
      go.disabled = true; go.textContent = '掃描中…';
      try { await run(out, prog); } catch (e) { out.innerHTML = `<div class="down">掃描失敗：${esc(e.message)}</div>`; }
      go.disabled = false; go.textContent = '開始掃描';
    };
    if (rows.length) renderTable(out, true);
    M.open();
  }
  app.screener = { open };
}
