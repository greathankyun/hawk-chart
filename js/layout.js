// Multi-chart layouts (up to 6 charts) with multi-timeframe sync:
// the first cell is the full-featured main chart; the other cells are lighter
// charts with their own symbol / timeframe / indicator preset, linked to the
// main chart by symbol, crosshair and time range.
import { IndicatorLayer } from './render.js';
import { el, esc, select } from './ui.js';

const LC = window.LightweightCharts;
export const LAYOUTS = [
  { k: '1', name: '單圖', n: 1 },
  { k: '2h', name: '左右兩圖', n: 2 },
  { k: '2v', name: '上下兩圖', n: 2 },
  { k: '3', name: '一大兩小', n: 3 },
  { k: '3h', name: '三欄', n: 3 },
  { k: '4', name: '四宮格', n: 4 },
  { k: '6', name: '六宮格', n: 6 },
];
const LAYOUT_ICONS = {
  1: '<rect x="3" y="4" width="18" height="16" rx="1"/>',
  '2h': '<rect x="3" y="4" width="8.5" height="16" rx="1"/><rect x="12.5" y="4" width="8.5" height="16" rx="1"/>',
  '2v': '<rect x="3" y="4" width="18" height="7.5" rx="1"/><rect x="3" y="12.5" width="18" height="7.5" rx="1"/>',
  3: '<rect x="3" y="4" width="11" height="16" rx="1"/><rect x="15" y="4" width="6" height="7.5" rx="1"/><rect x="15" y="12.5" width="6" height="7.5" rx="1"/>',
  '3h': '<rect x="3" y="4" width="5.3" height="16" rx="1"/><rect x="9.35" y="4" width="5.3" height="16" rx="1"/><rect x="15.7" y="4" width="5.3" height="16" rx="1"/>',
  4: '<rect x="3" y="4" width="8.5" height="7.5" rx="1"/><rect x="12.5" y="4" width="8.5" height="7.5" rx="1"/><rect x="3" y="12.5" width="8.5" height="7.5" rx="1"/><rect x="12.5" y="12.5" width="8.5" height="7.5" rx="1"/>',
  6: '<rect x="3" y="4" width="5.3" height="7.5" rx="1"/><rect x="9.35" y="4" width="5.3" height="7.5" rx="1"/><rect x="15.7" y="4" width="5.3" height="7.5" rx="1"/><rect x="3" y="12.5" width="5.3" height="7.5" rx="1"/><rect x="9.35" y="12.5" width="5.3" height="7.5" rx="1"/><rect x="15.7" y="12.5" width="5.3" height="7.5" rx="1"/>',
};
export const layoutIcon = k => `<svg viewBox="0 0 24 24" class="ico">${LAYOUT_ICONS[k]}</svg>`;
const PRESETS = {
  main: '同主圖指標', ma: '均線 MA20/60', boll: '布林通道', vol: '成交量', macd: 'MACD', rsi: 'RSI', kd: 'KD', none: '無指標',
};
function presetIndicators(k, S) {
  const L = (type, p, color) => ({ id: type + JSON.stringify(p), type, p, color });
  switch (k) {
    case 'main': return S.indicators.filter(x => x.type !== 'VP');
    case 'ma': return [L('MA', { n: 20 }, '#f5a524'), L('MA', { n: 60 }, '#38bdf8')];
    case 'boll': return [L('BOLL', { n: 20, m: 2 }, '#a78bfa')];
    case 'vol': return [L('VOL', { n: 20 }, '#64748b')];
    case 'macd': return [L('MACD', { f: 12, s: 26, g: 9 }, '#38bdf8')];
    case 'rsi': return [L('RSI', { n: 14 }, '#c084fc')];
    case 'kd': return [L('KD', { n: 9 }, '#f5a524')];
    default: return [];
  }
}
const DEFAULT_IV = ['4h', '1d', '15m', '1w', '5m'];

class MiniChart {
  constructor(app, cell, cfg, hub) {
    this.app = app; this.cfg = cfg; this.hub = hub; this.bars = []; this.disp = [];
    this.root = cell;
    cell.innerHTML = '';
    this.head = el('div', 'mini-head');
    this.box = el('div', 'mini-chart');
    this.legend = el('div', 'mini-legend');
    cell.append(this.head, this.box, this.legend);
    this.chart = LC.createChart(this.box, app.baseOptions(() => this.cfg.interval));
    this.chart.applyOptions(app.themeOptions());
    this.chart.applyOptions({ timeScale: { barSpacing: 5 } });
    this.layer = new IndicatorLayer({ chart: this.chart, upDown: app.upDown, priceDec: () => this.dec, getScript: sid => (app.S.scripts || []).find(x => x.id === sid) });
    this.dec = 2;
    this.chart.subscribeCrosshairMove(p => { this.renderLegend(p.logical != null && p.point ? Math.round(p.logical) : null); hub.crosshair(this, p); });
    this.chart.timeScale().subscribeVisibleTimeRangeChange(r => hub.range(this, r));
    this.renderHead();
    this.load();
  }
  renderHead() {
    const { app, cfg } = this;
    this.head.innerHTML = '';
    const sb = el('button', 'mini-sym', esc(app.symLabel(cfg.symbol)));
    sb.title = '更換商品';
    sb.onclick = () => app.openSearch('', s => { this.hub.setCellSymbol(this, s); });
    const iv = select(app.data.INTERVALS.map(i => [i.k, i.label]), cfg.interval, v => { cfg.interval = v; this.hub.persist(); this.load(); });
    iv.title = '週期';
    const ind = select(Object.entries(PRESETS), cfg.ind || 'ma', v => { cfg.ind = v; this.hub.persist(); this.rebuild(); });
    ind.title = '指標';
    const swap = el('button', 'icon-btn', '⤢'); swap.title = '與主圖交換';
    swap.onclick = () => this.hub.swap(this);
    this.px = el('span', 'mini-px');
    this.head.append(sb, iv, ind, this.px, el('span', 'sp'), swap);
  }
  async load() {
    const { app, cfg } = this;
    this.stream?.close();
    const token = (this.token = {});
    try {
      const rows = await app.data.fetchKlines(cfg.symbol, cfg.interval, { limit: 600 });
      if (token !== this.token) return;
      const intraday = app.data.intervalSec(cfg.interval) < 86400;
      this.bars = rows.map(r => ({ ...r, intraday }));
      if (this.bars.length) this.dec = app.decFor(cfg.symbol, this.bars[this.bars.length - 1].close);
      this.rebuild(true);
      this.stream = app.data.subscribeKlines(cfg.symbol, cfg.interval, b => this.onBar(b));
    } catch (e) { this.legend.textContent = '載入失敗'; }
  }
  onBar(b) {
    if (!b || !this.bars.length) return;
    const bar = { ...b, intraday: this.bars[0].intraday };
    const last = this.bars[this.bars.length - 1];
    if (bar.utc === last.utc) this.bars[this.bars.length - 1] = bar; else if (bar.utc > last.utc) this.bars.push(bar); else return;
    if (this.tickT) return;
    this.tickT = setTimeout(() => {
      this.tickT = null;
      this.makeDisp(); const n = this.bars.length - 1;
      this.series.update(this.disp[n]); this.layer.updateLast(this.bars, this.disp);
      this.renderLegend(null);
    }, 300);
  }
  makeDisp() { const off = this.app.tzOffset(); this.disp = this.bars.map(b => ({ time: b.utc + off, open: b.open, high: b.high, low: b.low, close: b.close })); }
  rebuild(resetRange) {
    const { app } = this;
    this.layer.clear();
    if (this.series) try { this.chart.removeSeries(this.series); } catch {}
    while (this.chart.panes().length > 1) this.chart.removePane(this.chart.panes().length - 1);
    const { up, down } = app.upDown();
    const pf = { type: 'price', precision: this.dec, minMove: 1 / 10 ** this.dec };
    this.series = this.chart.addSeries(LC.CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceFormat: pf });
    const inds = presetIndicators(this.cfg.ind || 'ma', app.S);
    this.layer.build(inds, this.bars);
    this.chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
    const hasVol = inds.some(x => x.type === 'VOL');
    this.series.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: hasVol ? 0.22 : 0.08 } });
    this.makeDisp();
    this.series.setData(this.disp);
    this.layer.setData(this.bars, this.disp);
    if (resetRange && this.bars.length) this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, this.bars.length - 120), to: this.bars.length + 5 });
    this.renderLegend(null);
  }
  renderLegend(idx) {
    const { app } = this, n = this.bars.length;
    if (!n) return;
    const i = idx == null || idx < 0 || idx >= n ? n - 1 : idx;
    const b = this.bars[i], prev = this.bars[i - 1];
    const chg = prev ? (b.close / prev.close - 1) * 100 : 0;
    this.px.innerHTML = `<b class="${app.cls(chg)}">${app.fmtP(b.close, this.dec)}</b> <small class="${app.cls(chg)}">${app.pct(chg)}</small>`;
    this.legend.innerHTML = this.layer.values(i).filter(r => r.pane === 0 && r.def.special !== 'vol')
      .map(r => `<span style="color:${r.ind.color}">${esc(app.I.label(r.ind))} ${r.vals.map(v => (v == null ? '—' : app.fmtP(v, this.dec))).join('/')}</span>`).join(' ');
  }
  applyTheme() { this.chart.applyOptions(this.app.themeOptions()); this.rebuild(); }
  destroy() { this.stream?.close(); clearTimeout(this.tickT); try { this.chart.remove(); } catch {} }
}

export function initLayout(app) {
  const { S, save } = app;
  S.layout = { mode: '1', cells: [], ...S.layout };
  S.layout.sync = { symbol: true, crosshair: true, time: false, ...S.layout.sync };
  const main = document.querySelector('.chart-wrap');
  const grid = el('div', 'charts'); grid.id = 'charts';
  main.before(grid); grid.append(main);
  let minis = [];
  let syncing = false;

  // ---- hub: sync between the main chart and minis ----
  const findIdx = (bars, utc) => {
    let lo = 0, hi = bars.length - 1;
    if (!bars.length || utc < bars[0].utc) return -1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m].utc <= utc) lo = m; else hi = m - 1; }
    return lo;
  };
  const mainEntry = { get chart() { return app.chart; }, get series() { return app.mainSeries; }, get bars() { return app.bars; } };
  const entries = () => [mainEntry, ...minis];
  const hub = {
    persist() { S.layout.cells = minis.map(m => m.cfg); save(); },
    crosshair(src, p) {
      if (!S.layout.sync.crosshair || syncing || minis.length === 0) return;
      syncing = true;
      try {
        const off = app.tzOffset();
        for (const t of entries()) {
          if (t === src || !t.series) continue;
          if (!p || p.time == null || !p.point) { t.chart.clearCrosshairPosition(); continue; }
          const i = findIdx(t.bars, p.time - off);
          if (i < 0) { t.chart.clearCrosshairPosition(); continue; }
          t.chart.setCrosshairPosition(t.bars[i].close, t.bars[i].utc + off, t.series);
        }
      } catch {} finally { syncing = false; }
    },
    range(src, r) {
      if (!S.layout.sync.time || syncing || !r || minis.length === 0) return;
      syncing = true;
      try { for (const t of entries()) if (t !== src && t.series) t.chart.timeScale().setVisibleRange(r); } catch {} finally { syncing = false; }
    },
    setCellSymbol(m, sym) {
      if (S.layout.sync.symbol) { app.switchSymbol(sym); return; }
      m.cfg.symbol = sym; hub.persist(); m.renderHead(); m.load();
    },
    swap(m) {
      const { symbol, interval } = m.cfg;
      m.cfg.symbol = S.symbol; m.cfg.interval = S.interval;
      hub.persist();
      m.renderHead(); m.load();
      if (symbol !== S.symbol) app.switchSymbol(symbol);
      if (interval !== S.interval) app.setInterval(interval);
    },
  };
  app.on('crosshair', p => hub.crosshair(mainEntry, p));
  app.chart.timeScale().subscribeVisibleTimeRangeChange(r => hub.range(mainEntry, r));
  app.on('symbol', sym => {
    if (!S.layout.sync.symbol) return;
    for (const m of minis) { m.cfg.symbol = sym; m.renderHead(); m.load(); }
    hub.persist();
  });
  app.on('theme', () => minis.forEach(m => m.applyTheme()));

  function apply() {
    const L = LAYOUTS.find(x => x.k === S.layout.mode) || LAYOUTS[0];
    grid.dataset.layout = L.k;
    minis.forEach(m => { m.destroy(); m.root.remove(); });
    minis = [];
    const cells = S.layout.cells || [];
    for (let i = 1; i < L.n; i++) {
      const cfg = cells[i - 1] || { symbol: S.symbol, interval: DEFAULT_IV[(i - 1) % DEFAULT_IV.length], ind: i === 1 ? 'ma' : 'vol' };
      if (S.layout.sync.symbol) cfg.symbol = S.symbol;
      const cell = el('div', 'mini-cell');
      grid.append(cell);
      minis.push(new MiniChart(app, cell, cfg, hub));
    }
    S.layout.cells = minis.map(m => m.cfg).concat(cells.slice(minis.length));
    save();
    document.body.classList.toggle('multi', L.n > 1);
    if (btn) btn.innerHTML = layoutIcon(L.k) + '<span class="lbl">版面</span>';
  }

  // ---- layout menu ----
  const btn = el('button', 'tb-btn', ''); btn.id = 'layoutBtn'; btn.title = '多圖版面';
  document.getElementById('indBtn').before(btn);
  const menu = el('div', 'pop-menu layout-menu'); menu.hidden = true;
  document.body.append(menu);
  function renderMenu() {
    menu.innerHTML = '<div class="pm-title">版面配置</div>';
    const g = el('div', 'layout-grid');
    for (const L of LAYOUTS) {
      const b = el('button', 'lay-btn' + (L.k === S.layout.mode ? ' on' : ''), layoutIcon(L.k) + `<small>${L.name}</small>`);
      b.onclick = () => { S.layout.mode = L.k; apply(); renderMenu(); };
      g.append(b);
    }
    menu.append(g, el('div', 'pm-title', '多圖同步'));
    for (const [k, label] of [['symbol', '同步商品（多週期看同一檔）'], ['crosshair', '同步十字線'], ['time', '同步時間範圍']]) {
      const r = el('label', 'pm-check');
      const c = el('input'); c.type = 'checkbox'; c.checked = !!S.layout.sync[k];
      c.onchange = () => { S.layout.sync[k] = c.checked; save(); if (k === 'symbol' && c.checked) { for (const m of minis) { m.cfg.symbol = S.symbol; m.renderHead(); m.load(); } hub.persist(); } };
      r.append(c, document.createTextNode(label));
      menu.append(r);
    }
    menu.append(el('div', 'pm-note', '每個小圖可各自選商品、週期與指標；按 ⤢ 可與主圖交換。'));
  }
  btn.onclick = e => {
    e.stopPropagation();
    if (!menu.hidden) { menu.hidden = true; return; }
    renderMenu();
    const r = btn.getBoundingClientRect();
    menu.style.top = r.bottom + 6 + 'px';
    menu.style.left = Math.max(8, Math.min(window.innerWidth - 288, r.left - 120)) + 'px';
    menu.hidden = false;
  };
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) menu.hidden = true; });
  apply();
  app.layout = { apply, get minis() { return minis; } };
}
