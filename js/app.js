import * as I from './indicators.js';
import { INTERVALS, intervalSec, fetchKlines, fetchAllTickers, fetchTicker, splitSymbol, isCrypto, symbolMeta, fetchQuotes, subscribeKlines, subscribeTickers, toSym } from './data.js';
import * as D from './data.js';
import { CATALOG, SEED_WATCH } from './markets.js';
import { Drawings, TOOLS, COLORS } from './drawings.js';
import { IndicatorLayer, hexA } from './render.js';
import { initFeatures } from './features.js';

const LC = window.LightweightCharts;
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// ---------- persisted state ----------
const DEFAULTS = {
  symbol: 'BTCUSDT', interval: '1h', chartType: 'candle',
  indicators: I.DEFAULT_INDICATORS,
  watchlist: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'ETHBTC'],
  alerts: [],
  scripts: [], templates: [],
  layout: { mode: '1', cells: [], sync: { symbol: true, crosshair: true, time: false } },
  settings: { colors: 'tw', theme: 'dark', tz: 'local', magnet: false },
  sideHidden: false,
};
let S;
try { S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('hawk.state') || '{}') }; } catch { S = { ...DEFAULTS }; }
S.settings = { ...DEFAULTS.settings, ...S.settings };
// one-time: add Taiwan / US / index / commodity / FX examples to existing watchlists
if (!S.mktSeeded) { S.watchlist = [...S.watchlist, ...SEED_WATCH.filter(s => !S.watchlist.includes(s))]; S.mktSeeded = true; }
const save = () => { try { localStorage.setItem('hawk.state', JSON.stringify(S)); } catch {} };

// ---------- runtime ----------
let chart, mainSeries, layer;
let bars = [], disp = [];
let klineStream, wlStream, loadCtl, loadingMore = false, exhausted = false;
const tickers = {}; // symbol -> {last, chgPct, high, low, vol, qvol}
let drawings;

const CHART_TYPES = [
  { k: 'candle', name: 'K 線', icon: 'M8 3h2v3h2v11h-2v4H8v-4H6V6h2zm7 4h2v3h2v7h-2v3h-2v-3h-2v-7h2z' },
  { k: 'ha', name: '平均 K', icon: 'M6 6h5v12H6zm7 3h5v9h-5zM8 3h1v3H8zm0 15h1v3H8zm7-12h1v3h-1zm0 12h1v3h-1z' },
  { k: 'hollow', name: '空心 K 線', icon: 'M8 3h2v3h2v11h-2v4H8v-4H6V6h2zm0 5v7h2V8zm7-1h2v3h2v7h-2v3h-2v-3h-2v-7h2z' },
  { k: 'bar', name: '美國線', icon: 'M8 3h2v18H8zM5 8h3v2H5zm5 6h3v2h-3zm6-9h2v14h-2zm-3 3h3v2h-3zm5 6h3v2h-3z' },
  { k: 'line', name: '折線', icon: 'M3 17l5-6 4 3 8-9 1.4 1.4-9.2 10.3-4-3-4.6 5.5z' },
  { k: 'area', name: '面積', icon: 'M3 17l5-6 4 3 8-9v16H3z' },
  { k: 'baseline', name: '基準線', icon: 'M2 11h20v2H2zm1-1l4-5 4 3 3-4 1.5 1.2L11 10.4 7.3 7.6 4.6 11zm0 4h18l-3 5-4-3-4 3z' },
];

// ---------- helpers ----------
const tzOffset = () => (S.settings.tz === 'utc' ? 0 : -new Date().getTimezoneOffset() * 60);
function decimals(p) {
  p = Math.abs(p);
  if (!p) return 2;
  if (p >= 50) return 2;
  if (p >= 1) return 3;
  if (p >= 0.1) return 4;
  if (p >= 0.001) return 6;
  return 8;
}
// FX needs more digits than its price level suggests (EUR/USD 1.0845)
function decFor(sym, p) {
  if (!isCrypto(sym) && symbolMeta(sym).cat === 'fx') { p = Math.abs(p || 0); return p < 20 ? 4 : p < 200 ? 3 : 2; }
  return decimals(p);
}
let priceDec = 2;
const fmt = p => (p == null || isNaN(p) ? '—' : (+p).toLocaleString('en-US', { minimumFractionDigits: priceDec, maximumFractionDigits: priceDec }));
const fmtP = (p, d) => (p == null ? '—' : (+p).toLocaleString('en-US', { minimumFractionDigits: d ?? decimals(p), maximumFractionDigits: d ?? decimals(p) }));
function fmtBig(v) {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(2);
}
const pct = v => (v == null || isNaN(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
const cls = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const symLabel = s => symbolMeta(s).label;
const fmtS = (sym, p) => (p == null || isNaN(p) ? '—' : fmtP(p, decFor(sym, p)));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function toast(msg, ms = 3500) { const t = el('div', 'toast', msg); $('#toasts').append(t); setTimeout(() => t.remove(), ms); }
// tiny event bus so feature modules (layout, replay, alerts, …) can follow the main chart
const listeners = {};
const on = (ev, fn) => (listeners[ev] ||= []).push(fn);
const emit = (ev, ...a) => (listeners[ev] || []).forEach(fn => { try { fn(...a); } catch (e) { console.error(e); } });

// ---------- theme ----------
function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme;
  document.documentElement.dataset.colors = S.settings.colors;
  document.querySelector('meta[name="theme-color"]').content = css('--panel');
  if (!chart) return;
  chart.applyOptions(themeOptions());
  emit('theme');
}
function themeOptions() {
  const dark = S.settings.theme === 'dark';
  return {
    layout: { background: { type: LC.ColorType.VerticalGradient, topColor: css('--chart-top'), bottomColor: css('--chart-bottom') }, textColor: css('--muted'), panes: { separatorColor: css('--border'), separatorHoverColor: hexA(css('--accent'), .35) } },
    grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
    rightPriceScale: { borderColor: css('--border') },
    timeScale: { borderColor: css('--border') },
    crosshair: {
      vertLine: { color: hexA(css('--accent'), dark ? .55 : .7), width: 1, style: LC.LineStyle.Dashed, labelBackgroundColor: css('--xh-label') },
      horzLine: { color: hexA(css('--accent'), dark ? .55 : .7), width: 1, style: LC.LineStyle.Dashed, labelBackgroundColor: css('--xh-label') },
    },
  };
}

// ---------- chart ----------
function baseOptions(getInterval = () => S.interval) {
  return {
    autoSize: true,
    layout: { fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang TC", monospace', fontSize: 11, attributionLogo: false },
    crosshair: { mode: LC.CrosshairMode.Normal },
    timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 7, minBarSpacing: 0.5 },
    rightPriceScale: { scaleMargins: { top: 0.12, bottom: 0.08 } },
    localization: {
      locale: 'zh-TW',
      timeFormatter: t => {
        const d = new Date(t * 1000);
        const p = n => String(n).padStart(2, '0');
        const date = `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}`;
        return intervalSec(getInterval()) >= 86400 ? date : `${date} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
      },
    },
  };
}
function createChart() {
  chart = LC.createChart($('#chart'), baseOptions());
  applyTheme();
  chart.subscribeCrosshairMove(p => { updateLegend(p.logical != null && p.point ? Math.round(p.logical) : null); emit('crosshair', p); });
  chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r && r.from < 30) loadMore(); });
  new ResizeObserver(() => updateLegend(crosshairIdx)).observe($('#chart'));
}

function upDown() {
  const tw = S.settings.colors === 'tw';
  return { up: tw ? '#ff3d6e' : '#00e0a4', down: tw ? '#00e0a4' : '#ff3d6e' };
}

function buildSeries() {
  // remove everything, then recreate main + indicator series
  layer.clear();
  if (mainSeries) try { chart.removeSeries(mainSeries); } catch {}
  markersApi = null;
  while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);

  const { up, down } = upDown();
  const pf = { type: 'price', precision: priceDec, minMove: 1 / 10 ** priceDec };
  const t = S.chartType;
  if (t === 'candle' || t === 'ha') mainSeries = chart.addSeries(LC.CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceFormat: pf });
  else if (t === 'hollow') mainSeries = chart.addSeries(LC.CandlestickSeries, { upColor: 'rgba(0,0,0,0)', downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceFormat: pf });
  else if (t === 'bar') mainSeries = chart.addSeries(LC.BarSeries, { upColor: up, downColor: down, thinBars: false, priceFormat: pf });
  else if (t === 'line') mainSeries = chart.addSeries(LC.LineSeries, { color: '#00e5ff', lineWidth: 2, priceFormat: pf });
  else if (t === 'baseline') mainSeries = chart.addSeries(LC.BaselineSeries, { baseValue: { type: 'price', price: bars.length ? bars[Math.max(0, bars.length - 160)].close : 0 }, topLineColor: up, bottomLineColor: down, topFillColor1: hexA(up, .28), topFillColor2: hexA(up, .04), bottomFillColor1: hexA(down, .04), bottomFillColor2: hexA(down, .28), lineWidth: 2, priceFormat: pf });
  else mainSeries = chart.addSeries(LC.AreaSeries, { lineColor: '#00e5ff', topColor: 'rgba(0,229,255,.32)', bottomColor: 'rgba(0,229,255,0)', lineWidth: 2, priceFormat: pf });

  layer.build(S.indicators, bars);
  const panes = chart.panes();
  panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 3.2 : 1));
  const hasVol = S.indicators.some(x => x.type === 'VOL' && !x.hidden);
  mainSeries.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: hasVol ? 0.22 : 0.08 } });
  setAllData(false);
  emit('build');
}

function makeDisp() {
  const off = tzOffset();
  const base = S.chartType === 'ha' ? I.heikinAshi(bars) : bars;
  const single = S.chartType === 'line' || S.chartType === 'area' || S.chartType === 'baseline';
  disp = base.map(b => single ? { time: b.utc + off, value: b.close } : { time: b.utc + off, open: b.open, high: b.high, low: b.low, close: b.close });
}

function setAllData(keepRange = true, shift = 0) {
  const ts = chart.timeScale();
  const range = keepRange ? ts.getVisibleLogicalRange() : null;
  makeDisp();
  mainSeries.setData(disp);
  layer.setData(bars, disp);
  applyMarkers();
  if (range) ts.setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
  else if (bars.length) ts.setVisibleLogicalRange({ from: Math.max(0, bars.length - 160), to: bars.length + 8 });
  updateLegend(null);
  emit('data');
}

let tickPending = false;
function applyTick() {
  tickPending = false;
  if (!bars.length) return;
  const n = bars.length - 1;
  makeDisp();
  mainSeries.update(disp[n]);
  layer.updateLast(bars, disp);
  if (!crosshairIdx) updateLegend(null);
  emit('tick');
}

// ---------- series markers (backtest trades, script signals) ----------
let markersApi = null, markerList = [];
function applyMarkers() {
  if (!mainSeries) return;
  const off = tzOffset();
  const list = markerList.map(m => ({ ...m, time: m.utc + off })).filter(m => !bars.length || m.utc <= bars[bars.length - 1].utc).sort((a, b) => a.time - b.time);
  if (!markersApi) { if (!list.length) return; markersApi = LC.createSeriesMarkers(mainSeries, list); }
  else markersApi.setMarkers(list);
}
function setMarkers(list) { markerList = list || []; applyMarkers(); }

// ---------- legend ----------
let crosshairIdx = null;
const fmtInd = (def, v) => v == null || Number.isNaN(v) ? '—' : def.fmt === 'vol' ? fmtBig(v) : def.overlay || def.fmt === 'price' ? fmt(v) : def.fmt === 'price+' ? (+v).toFixed(priceDec + 1) : (+v).toFixed(2);
function updateLegend(idx) {
  crosshairIdx = idx;
  const n = bars.length;
  if (!n) { $('#legend').innerHTML = ''; return; }
  const i = idx == null || idx < 0 || idx >= n ? n - 1 : idx;
  const b = bars[i], prev = bars[i - 1];
  const chg = prev ? b.close - prev.close : b.close - b.open;
  const chgPct = prev ? (chg / prev.close) * 100 : 0;
  const c = cls(chg);
  const iv = INTERVALS.find(x => x.k === S.interval);
  let html = `<div class="l-main"><span class="l-sym">${symLabel(S.symbol)}</span><span class="l-tag">${iv.label} · ${esc(srcLabel(S.symbol))}${replayCtl ? ' · <b class="l-replay">回放中</b>' : ''}</span>
    <span><span class="l-k">開</span><span class="${c}">${fmt(b.open)}</span></span>
    <span><span class="l-k">高</span><span class="${c}">${fmt(b.high)}</span></span>
    <span><span class="l-k">低</span><span class="${c}">${fmt(b.low)}</span></span>
    <span><span class="l-k">收</span><span class="${c}">${fmt(b.close)}</span></span>
    <span class="${c}">${chg >= 0 ? '+' : ''}${fmt(chg)} (${pct(chgPct)})</span>
    <span><span class="l-k">量</span>${fmtBig(b.volume)}</span></div><div class="l-ind">`;
  const rows = layer.values(i);
  for (const r of rows) {
    if (r.pane !== 0 || r.def.special === 'vol') continue;
    html += `<span style="color:${r.ind.color}">${esc(I.label(r.ind))} <b>${r.vals.map(v => fmtInd(r.def, v)).join(' / ')}</b></span>`;
  }
  html += '</div>';
  $('#legend').innerHTML = html;
  // sub-pane labels
  const box = $('#paneLegends');
  let out = '', top = 0;
  let sizes;
  try { sizes = chart.panes().map((_, k) => chart.paneSize(k).height); } catch { requestAnimationFrame(() => updateLegend(crosshairIdx)); box.innerHTML = ''; return; }
  for (const r of rows) {
    if (r.pane === 0) continue;
    top = sizes.slice(0, r.pane).reduce((a, h) => a + h + 1, 0);
    const multi = r.vals.length > 1;
    const parts = r.vals.map((v, k) => (multi ? `<span class="l-k">${esc(r.names[k] || '')}</span>` : '') + `<b>${fmtInd(r.def, v)}</b>`).join(' ');
    out += `<div class="pane-legend" style="top:${top + 4}px"><span style="color:${r.ind.color}">${esc(I.label(r.ind))}</span> ${parts}${r.def.error ? ` <span class="down">⚠ ${esc(r.def.error)}</span>` : ''}</div>`;
  }
  box.innerHTML = out;
}

// ---------- loading ----------
async function loadSymbol() {
  loadCtl?.abort();
  const ctl = loadCtl = new AbortController();
  $('#loading').classList.add('on');
  klineStream?.close();
  if (replayCtl) replayStop(false);
  exhausted = false;
  bars = [];
  drawings.setSymbol(S.symbol);
  renderHeader();
  try {
    const rows = await fetchKlines(S.symbol, S.interval, { limit: 1000, signal: ctl.signal });
    if (ctl.signal.aborted) return;
    const intraday = intervalSec(S.interval) < 86400;
    bars = rows.map(r => ({ ...r, intraday }));
    if (bars.length) priceDec = decFor(S.symbol, bars[bars.length - 1].close);
    if (bars.length < 1000) exhausted = true;
    buildSeries();
    updateDemoBadge();
    klineStream = subscribeKlines(S.symbol, S.interval, onKline, st => setStatus(st));
    const tk = await fetchTicker(S.symbol);
    if (tk) { tickers[S.symbol] = { ...tickers[S.symbol], ...tk }; renderHeader(); renderDetail(); }
    emit('loaded');
  } catch (e) {
    if (e.name !== 'AbortError') { toast('載入失敗：' + e.message); bars = []; buildSeries(); }
  } finally {
    if (loadCtl === ctl) $('#loading').classList.remove('on');
  }
  document.title = `${symLabel(S.symbol)} · 鷹眼看盤`;
}

async function loadMore() {
  if (loadingMore || exhausted || !bars.length) return;
  loadingMore = true;
  const sym = S.symbol, iv = S.interval;
  try {
    const rows = await fetchKlines(sym, iv, { endTime: bars[0].utc, limit: 1000 });
    if (sym !== S.symbol || iv !== S.interval) return;
    const older = rows.filter(r => r.utc < bars[0].utc).map(r => ({ ...r, intraday: bars[0].intraday }));
    if (!older.length) { exhausted = true; return; }
    if (rows.length < 1000) exhausted = true;
    bars = older.concat(bars);
    if (replayCtl) replayCtl.full = older.concat(replayCtl.full);
    setAllData(true, older.length);
  } catch {} finally { loadingMore = false; }
}

function onKline(b) {
  if (!b || !bars.length) return;
  const bar = { ...b, intraday: bars[0].intraday };
  const arr = replayCtl ? replayCtl.full : bars; // during replay live bars are kept aside
  const last = arr[arr.length - 1];
  if (bar.utc === last.utc) arr[arr.length - 1] = bar;
  else if (bar.utc > last.utc) arr.push(bar);
  else return;
  if (replayCtl) return;
  if (!tickPending) { tickPending = true; setTimeout(applyTick, 200); }
  priceUpdate(S.symbol, bar.close);
}

// ---------- bar replay core (UI lives in replay.js) ----------
let replayCtl = null; // { full: all bars }
function replayStart(idx) {
  if (!bars.length) return;
  if (!replayCtl) replayCtl = { full: bars };
  bars = replayCtl.full.slice(0, Math.max(2, Math.min(replayCtl.full.length, idx + 1)));
  setAllData(true);
  const ts = chart.timeScale(), r = ts.getVisibleLogicalRange();
  if (r && r.to < bars.length) ts.setVisibleLogicalRange({ from: bars.length - (r.to - r.from) + 10, to: bars.length + 10 });
  emit('replay');
}
function replayStep(k = 1) {
  if (!replayCtl) return false;
  const f = replayCtl.full;
  if (bars.length >= f.length) return false;
  if (k === 1) { bars.push(f[bars.length]); applyTick(); }
  else { bars = f.slice(0, Math.min(f.length, bars.length + k)); setAllData(true); }
  emit('replayStep');
  return bars.length < f.length;
}
function replayBack() { if (!replayCtl || bars.length <= 2) return; bars = bars.slice(0, -1); setAllData(true); emit('replayStep'); }
function replayStop(redraw = true) {
  if (!replayCtl) return;
  bars = replayCtl.full; replayCtl = null;
  if (redraw) { setAllData(true); chart.timeScale().scrollToRealTime(); }
  emit('replay');
}

function setStatus(st) {
  const delay = symbolMeta(S.symbol).delay;
  const map = { live: '● 即時', delayed: `● 延遲約 ${delay} 分`, reconnecting: '○ 重新連線中…', demo: '● 模擬' };
  $('#statusBadge').textContent = map[st] || '';
  if (st === 'delayed') { $('#statusBadge').style.color = css('--muted'); return; }
  $('#statusBadge').style.color = st === 'live' ? css('--down') : css('--muted');
  if (st === 'live' && S.settings.colors === 'tw') $('#statusBadge').style.color = css('--down');
}

// ---------- header / detail ----------
function renderHeader() {
  const t = tickers[S.symbol];
  $('#symName').textContent = symLabel(S.symbol);
  const last = t?.last ?? bars[bars.length - 1]?.close;
  $('#symPrice').textContent = last != null ? fmtS(S.symbol, last) : '—';
  $('#symChg').textContent = t ? pct(t.chgPct) : '';
  $('#symChg').className = 'sym-chg ' + cls(t?.chgPct);
  $('#symPrice').className = 'sym-price ' + cls(t?.chgPct);
}
function srcLabel(sym) {
  const m = symbolMeta(sym);
  if (m.crypto) return 'Binance';
  if (D.isDemo(sym)) return '模擬';
  return m.source === 'Fugle' ? '富果即時' : m.delay ? `Yahoo · 延遲 ${m.delay} 分` : 'Yahoo';
}
function renderDetail() {
  if (!isCrypto(S.symbol)) return renderMarketDetail();
  const t = tickers[S.symbol];
  const [base, quote] = splitSymbol(S.symbol);
  if (!t) { $('#detail').innerHTML = `<div class="d-name">${base} / ${quote}</div>`; return; }
  const pos = t.high > t.low ? ((t.last - t.low) / (t.high - t.low)) * 100 : 50;
  $('#detail').innerHTML = `
    <div class="d-name">${base} / ${quote} · Binance 現貨</div>
    <div class="d-top"><span class="d-px ${cls(t.chgPct)}">${fmtP(t.last)}</span>
      <span class="${cls(t.chgPct)}">${t.chg != null ? (t.chg >= 0 ? '+' : '') + fmtP(t.chg, decimals(t.last)) : ''} (${pct(t.chgPct)})</span></div>
    <div class="range-bar"><i style="left:calc(${pos.toFixed(1)}% - 1px)"></i></div>
    <div class="range-lbl"><span>24h 低 ${fmtP(t.low)}</span><span>24h 高 ${fmtP(t.high)}</span></div>
    <dl>
      <dt>24h 成交量</dt><dd>${fmtBig(t.vol)} ${base}</dd>
      <dt>24h 成交額</dt><dd>${fmtBig(t.qvol)} ${quote}</dd>
      ${t.open != null ? `<dt>24h 開盤</dt><dd>${fmtP(t.open)}</dd>` : ''}
    </dl>`;
}

function renderMarketDetail() {
  const sym = S.symbol, t = tickers[sym], m = symbolMeta(sym);
  const head = `<div class="d-name">${esc(m.label)} · ${m.catName}${m.exchange ? ' · ' + esc(m.exchange) : ''}</div>`;
  if (!t) {
    $('#detail').innerHTML = head + (D.getWorkerUrl() ? '' : `<p class="d-hint">要看即時價格，請到「設定 → 行情中繼」填入網址。</p>`);
    return;
  }
  const hasRange = t.high != null && t.low != null && t.high > t.low;
  const pos = hasRange ? ((t.last - t.low) / (t.high - t.low)) * 100 : 50;
  $('#detail').innerHTML = head + `
    <div class="d-top"><span class="d-px ${cls(t.chgPct)}">${fmtS(sym, t.last)}</span>
      <span class="${cls(t.chgPct)}">${t.chg != null ? (t.chg >= 0 ? '+' : '') + fmtS(sym, t.chg) : ''} (${pct(t.chgPct)})</span></div>
    ${hasRange ? `<div class="range-bar"><i style="left:calc(${pos.toFixed(1)}% - 1px)"></i></div>
    <div class="range-lbl"><span>今日低 ${fmtS(sym, t.low)}</span><span>今日高 ${fmtS(sym, t.high)}</span></div>` : ''}
    <dl>
      ${t.prevClose != null ? `<dt>昨收</dt><dd>${fmtS(sym, t.prevClose)}</dd>` : ''}
      ${t.open != null ? `<dt>今開</dt><dd>${fmtS(sym, t.open)}</dd>` : ''}
      ${t.vol ? `<dt>成交量</dt><dd>${m.cat === 'tw' ? fmtBig(t.vol / 1000) + ' 張' : fmtBig(t.vol)}</dd>` : ''}
      ${t.currency || m.currency ? `<dt>幣別</dt><dd>${esc(t.currency || m.currency)}</dd>` : ''}
      <dt>資料來源</dt><dd>${esc(srcLabel(sym))}</dd>
      ${t.time ? `<dt>更新時間</dt><dd>${new Date(t.time * 1000).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd>` : ''}
    </dl>`;
}
function updateDemoBadge() {
  const r = D.demoReason(S.symbol);
  $('#demoBadge').textContent = r;
  $('#demoBadge').hidden = !r;
}

// ---------- watchlist ----------
function renderWatchlist() {
  const ul = $('#watchlist');
  ul.innerHTML = '';
  for (const sym of S.watchlist) {
    const t = tickers[sym];
    const m = symbolMeta(sym);
    const li = el('li', sym === S.symbol ? 'on' : '');
    li.dataset.sym = sym;
    li.innerHTML = `<span class="w-sym" title="${esc(m.label)}">${esc(m.title)}<small>${m.crypto ? esc(m.sub) : ' ' + esc(m.sub)}</small></span>
      <span class="w-px ${cls(t?.chgPct)}">${t ? fmtS(sym, t.last) : '—'}</span>
      <span class="w-chg ${cls(t?.chgPct)}">${t ? pct(t.chgPct) : ''}</span>
      <button class="w-del" title="移除" aria-label="移除">✕</button>`;
    li.onclick = e => {
      if (e.target.closest('.w-del')) { S.watchlist = S.watchlist.filter(s => s !== sym); save(); renderWatchlist(); restartWatchStream(); return; }
      switchSymbol(sym);
      if (matchMedia('(max-width: 900px)').matches) document.body.classList.remove('app-side-open');
    };
    ul.append(li);
  }
}
function updateWatchRow(sym, prevLast) {
  const li = $(`#watchlist li[data-sym="${CSS.escape(sym)}"]`);
  if (!li) return;
  const t = tickers[sym];
  const px = li.querySelector('.w-px'), ch = li.querySelector('.w-chg');
  px.textContent = fmtS(sym, t.last);
  px.className = 'w-px ' + cls(t.chgPct) + (prevLast != null && t.last !== prevLast ? (t.last > prevLast ? ' flash-up' : ' flash-down') : '');
  ch.textContent = pct(t.chgPct); ch.className = 'w-chg ' + cls(t.chgPct);
}
function restartWatchStream() {
  wlStream?.close();
  const syms = [...new Set([...S.watchlist, S.symbol])];
  wlStream = subscribeTickers(syms, t => {
    const sym = t.symbol;
    const prev = tickers[sym]?.last;
    tickers[sym] = { ...tickers[sym], ...t };
    updateWatchRow(sym, prev);
    if (sym === S.symbol) { renderHeader(); renderDetail(); }
    priceUpdate(sym, t.last);
  });
}
async function primeTickers() {
  const want = [...new Set([...S.watchlist, S.symbol])];
  const [all, mk] = await Promise.all([want.some(isCrypto) ? fetchAllTickers() : [], fetchQuotes(want)]);
  for (const t of [...all, ...mk]) if (want.includes(t.symbol)) tickers[t.symbol] = { ...tickers[t.symbol], ...t };
  renderWatchlist(); renderHeader(); renderDetail();
}

function switchSymbol(sym) {
  if (sym === S.symbol) return;
  S.symbol = sym; save();
  renderWatchlist();
  emit('symbol', sym);
  loadSymbol();
  restartWatchStream();
}

// ---------- alerts (engine + UI in alerts.js) ----------
const priceUpdate = (sym, price) => emit('price', sym, price);

// ---------- symbol search ----------
const MKT_TABS = [['fav', '★ 自選'], ['all', '全部'], ['crypto', '加密貨幣'], ['tw', '台股'], ['us', '美股'], ['idx', '指數'], ['cmd', '原物料'], ['fx', '外匯']];
const CRYPTO_QUOTES = ['USDT', 'FDUSD', 'USDC', 'BTC', 'ETH', 'BNB', '全部'];
let symAll = [], mktTab = 'crypto', quoteTab = 'USDT', kbIdx = 0, symShown = [], remoteSyms = [], remoteQ = '', remoteTimer = null, remoteCtl = null, twAll = [];
function openModal(id) { $(id).hidden = false; }
function closeModals() { document.querySelectorAll('.modal').forEach(m => (m.hidden = true)); }
const bindModal = m => m.addEventListener('pointerdown', e => { if (e.target === m || e.target.closest('[data-close]')) closeModals(); });
document.querySelectorAll('.modal').forEach(bindModal);

// When a feature (e.g. a layout cell) asks for a symbol, the pick goes to it instead of the main chart.
let pickCb = null;
function chooseSymbol(sym) { const cb = pickCb; pickCb = null; if (cb) cb(sym); else switchSymbol(sym); }
async function openSearch(prefill = '', tab, onPick = null) {
  pickCb = onPick;
  if (tab) mktTab = tab;
  openModal('#symModal');
  const inp = $('#symSearch');
  inp.value = prefill;
  setTimeout(() => inp.focus(), 30);
  remoteSyms = []; remoteQ = '';
  renderQuoteTabs();
  $('#symList').innerHTML = '<li class="empty">載入中…</li>';
  symAll = await fetchAllTickers();
  if (D.getWorkerUrl() && !twAll.length) D.loadTwList().then(l => { twAll = l; if (!$('#symModal').hidden) renderSymList(); });
  renderSymList();
}
function renderQuoteTabs() {
  const tabs = $('#quoteTabs');
  tabs.innerHTML = '';
  for (const [k, name] of MKT_TABS) {
    const b = el('button', k === mktTab ? 'on' : '', name);
    b.onclick = () => { mktTab = k; renderQuoteTabs(); renderSymList(); $('#symSearch').focus(); };
    tabs.append(b);
  }
  const sub = $('#quoteSub');
  sub.innerHTML = '';
  sub.hidden = mktTab !== 'crypto';
  if (mktTab === 'crypto') for (const q of CRYPTO_QUOTES) {
    const b = el('button', q === quoteTab ? 'on' : '', q);
    b.onclick = () => { quoteTab = q; renderQuoteTabs(); renderSymList(); };
    sub.append(b);
  }
  $('#symVolHead').textContent = mktTab === 'crypto' ? '24h 成交額' : '成交量';
}
// rows: { symbol, t (ticker or undefined), score }
function marketRows(cat, q, raw) {
  const out = [];
  const match = (code, name) => !q || code.toUpperCase().replace(/[\/\s.-]/g, '').includes(q) || (name && name.includes(raw));
  for (const x of CATALOG) if ((cat === 'all' || x.cat === cat) && match(x.code, x.name)) out.push(toSym(x.code));
  if (q && (cat === 'all' || cat === 'tw')) {
    for (const [code, name, mk] of twAll) {
      if (out.length > 300) break;
      if (code.startsWith(q) || name.includes(raw)) out.push(toSym(`${code}.${mk}`));
    }
    // a bare Taiwan code typed without the worker's list: offer it directly
    if (/^\d{4,6}[A-Z]?$/.test(q) && !twAll.length) out.push(toSym(q + '.TW'));
  }
  if (q && remoteQ === raw) for (const s of remoteSyms) if (cat === 'all' || symbolMeta(s).cat === cat) out.push(s);
  return out;
}
function renderSymList() {
  const raw = $('#symSearch').value.trim();
  const q = raw.toUpperCase().replace(/[\/\s-]/g, '');
  let list = [];
  const cryptoRows = filter => {
    let l = symAll.filter(filter);
    if (q) l = l.filter(t => t.symbol.includes(q)).sort((a, b) => (b.symbol.startsWith(q) - a.symbol.startsWith(q)) || b.qvol - a.qvol);
    else l = l.slice().sort((a, b) => b.qvol - a.qvol);
    return l.map(t => t.symbol);
  };
  if (mktTab === 'fav') list = S.watchlist.filter(s => !q || s.toUpperCase().includes(q) || symbolMeta(s).label.includes(raw));
  else if (mktTab === 'crypto') list = cryptoRows(t => quoteTab === '全部' || splitSymbol(t.symbol)[1] === quoteTab);
  else if (mktTab === 'all') list = q ? [...marketRows('all', q, raw).slice(0, 60), ...cryptoRows(() => true).slice(0, 100)] : [...cryptoRows(t => splitSymbol(t.symbol)[1] === 'USDT').slice(0, 20), ...marketRows('all', '', '')];
  else list = marketRows(mktTab, q, raw);
  list = [...new Set(list)];
  if (q && mktTab !== 'crypto' && mktTab !== 'fav' && D.getWorkerUrl() && remoteQ !== raw) queueRemote(raw);
  const byCrypto = Object.fromEntries(symAll.map(t => [t.symbol, t]));
  symShown = list.slice(0, 200).map(s => ({ symbol: s, t: isCrypto(s) ? byCrypto[s] || tickers[s] : tickers[s] }));
  kbIdx = 0;
  const ul = $('#symList');
  ul.innerHTML = '';
  if (!['crypto', 'fav', 'all'].includes(mktTab) && !D.getWorkerUrl()) {
    const tip = el('li', 'empty tip', '台股、美股、指數、原物料、外匯的報價需要「行情中繼」。<button class="btn">前往設定</button>');
    tip.querySelector('button').onclick = () => { closeModals(); openSettings(); };
    ul.append(tip);
  }
  if (!symShown.length) { ul.append(el('li', 'empty', raw && D.getWorkerUrl() && remoteQ !== raw ? '搜尋中…' : '找不到符合的商品')); return; }
  symShown.forEach((row, i) => {
    const { symbol: s, t } = row;
    const m = symbolMeta(s);
    const on = S.watchlist.includes(s);
    const li = el('li', i === 0 ? 'kb' : '');
    li.dataset.sym = s;
    const tag = mktTab === 'all' || mktTab === 'fav' ? `<em class="s-tag">${m.catName}</em>` : '';
    li.innerHTML = `<span class="s-sym"><b>${esc(m.title)}</b><small>${m.crypto ? esc(m.sub) : ' ' + esc(m.sub)}</small>${tag}</span><span class="s-px">${t ? fmtS(s, t.last) : '—'}</span><span class="s-chg ${cls(t?.chgPct)}">${t ? pct(t.chgPct) : ''}</span><span class="s-vol">${t ? fmtBig(m.crypto ? t.qvol : t.vol) : ''}</span>
      <button class="star ${on ? 'on' : ''}" title="${on ? '移出自選' : '加入自選'}">${on ? '★' : '☆'}</button>`;
    li.onclick = e => {
      if (e.target.closest('.star')) {
        S.watchlist = S.watchlist.includes(s) ? S.watchlist.filter(x => x !== s) : [...S.watchlist, s];
        save();
        if (!tickers[s] && t) tickers[s] = t;
        renderWatchlist(); restartWatchStream();
        const st = e.target.closest('.star'); const now = S.watchlist.includes(s);
        st.className = 'star' + (now ? ' on' : ''); st.textContent = now ? '★' : '☆';
        return;
      }
      pickSymbol(row);
    };
    ul.append(li);
  });
  fillQuotes(symShown.map(r => r.symbol).filter(s => !isCrypto(s) && !tickers[s]).slice(0, 45));
}
function pickSymbol({ symbol, t }) {
  if (t) tickers[symbol] = { ...tickers[symbol], ...t };
  closeModals(); chooseSymbol(symbol);
}
let fillGen = 0;
async function fillQuotes(syms) {
  if (!syms.length || !D.getWorkerUrl()) return;
  const gen = ++fillGen;
  const qs = await fetchQuotes(syms);
  if (gen !== fillGen) return;
  for (const t of qs) {
    tickers[t.symbol] = { ...tickers[t.symbol], ...t };
    const li = $(`#symList li[data-sym="${CSS.escape(t.symbol)}"]`);
    if (!li) continue;
    const row = symShown.find(r => r.symbol === t.symbol); if (row) row.t = tickers[t.symbol];
    const m = symbolMeta(t.symbol);
    li.querySelector('.s-sym b').textContent = m.title;
    li.querySelector('.s-sym small').textContent = ' ' + m.sub;
    li.querySelector('.s-px').textContent = fmtS(t.symbol, t.last);
    const c = li.querySelector('.s-chg'); c.textContent = pct(t.chgPct); c.className = 's-chg ' + cls(t.chgPct);
    li.querySelector('.s-vol').textContent = t.vol ? fmtBig(t.vol) : '';
  }
}
function queueRemote(raw) {
  clearTimeout(remoteTimer);
  remoteTimer = setTimeout(async () => {
    remoteCtl?.abort();
    const ctl = remoteCtl = new AbortController();
    const res = await D.searchMarkets(raw, { signal: ctl.signal });
    if (ctl.signal.aborted || $('#symSearch').value.trim() !== raw) return;
    remoteSyms = res; remoteQ = raw;
    renderSymList();
  }, 350);
}
$('#symSearch').addEventListener('input', renderSymList);
$('#symSearch').addEventListener('keydown', e => {
  const items = [...$('#symList').querySelectorAll('li:not(.empty)')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[kbIdx]?.classList.remove('kb');
    kbIdx = Math.max(0, Math.min(items.length - 1, kbIdx + (e.key === 'ArrowDown' ? 1 : -1)));
    items[kbIdx]?.classList.add('kb'); items[kbIdx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && symShown[kbIdx]) {
    pickSymbol(symShown[kbIdx]);
  }
});
$('#symBtn').onclick = () => openSearch();
$('#addWatch').onclick = () => openSearch('', 'all');

// ---------- indicators UI ----------
let indQuery = '';
function renderIndModal() {
  const act = $('#indActive');
  act.innerHTML = '';
  if (!S.indicators.length) act.append(el('li', 'empty', '尚未加入指標'));
  for (const ind of S.indicators) {
    const def = ind.type === 'SCRIPT' ? null : I.CATALOG[ind.type];
    if (ind.type !== 'SCRIPT' && !def) continue;
    const li = el('li', ind.hidden ? 'off' : '');
    li.append(el('span', 'i-name', esc(I.label(ind).split(' ')[0])));
    for (const p of def?.params || []) {
      const lab = el('label', '', `<small>${p.label}</small> `);
      const inp = el('input'); inp.type = 'number'; inp.min = p.step && p.step < 1 ? p.step : 1; inp.step = p.step || 1; inp.value = ind.p[p.k] ?? p.def;
      inp.onchange = () => { const v = parseFloat(inp.value); if (v > 0) { ind.p[p.k] = v; save(); buildSeries(); } };
      lab.append(inp); li.append(lab);
    }
    if (ind.type === 'SCRIPT') {
      const ed = el('button', 'btn', '編輯腳本'); ed.onclick = () => { closeModals(); emit('editScript', ind.sid); };
      li.append(ed);
    }
    const col = el('input'); col.type = 'color'; col.value = ind.color; col.title = '顏色';
    col.oninput = () => { ind.color = col.value; save(); buildSeries(); };
    li.append(el('span', 'i-sp'), col);
    const eye = el('button', 'icon-btn', ind.hidden ? '◌' : '◉'); eye.title = ind.hidden ? '顯示' : '隱藏';
    eye.onclick = () => { ind.hidden = !ind.hidden; save(); buildSeries(); renderIndModal(); };
    const del = el('button', 'icon-btn danger', '✕'); del.title = '移除';
    del.onclick = () => { S.indicators = S.indicators.filter(x => x !== ind); save(); buildSeries(); renderIndModal(); };
    li.append(eye, del);
    act.append(li);
  }
  const cat = $('#indCatalog');
  cat.innerHTML = '';
  const q = indQuery.trim().toLowerCase();
  const palette = ['#ffc53d', '#00e5ff', '#b388ff', '#ff4fd8', '#00f5b4', '#ffe14d'];
  for (const [g, gname] of Object.entries(I.GROUPS)) {
    const entries = Object.entries(I.CATALOG).filter(([k, d]) => d.g === g && !d.hidden && (!q || (k + d.name).toLowerCase().includes(q)));
    const scripts = g === 'other' ? (S.scripts || []).filter(sc => !q || sc.name.toLowerCase().includes(q)) : [];
    if (!entries.length && !scripts.length && g !== 'other') continue;
    cat.append(el('li', 'i-group', gname === '其他' ? '自訂腳本' : gname));
    for (const [k, def] of entries) {
      const li = el('li', '', `<span>${def.name}</span><small>${def.overlay ? '疊加主圖' : '副圖'}</small>`);
      li.onclick = () => {
        const used = S.indicators.filter(x => x.type === k).length;
        S.indicators.push({ id: 'i' + Date.now(), type: k, p: I.withDefaults(k), color: used ? palette[used % palette.length] : def.colors[0] });
        save(); buildSeries(); renderIndModal();
      };
      cat.append(li);
    }
    for (const sc of scripts) {
      const li = el('li', '', `<span>📜 ${esc(sc.name)}</span><small>${sc.overlay ? '疊加主圖' : '副圖'}</small>`);
      li.onclick = () => { addScriptIndicator(sc); renderIndModal(); };
      cat.append(li);
    }
    if (g === 'other') {
      const li = el('li', 'i-new', '<span>＋ 新增／編輯自訂腳本…</span>');
      li.onclick = () => { closeModals(); emit('editScript', null); };
      cat.append(li);
    }
  }
}
function addScriptIndicator(sc) {
  S.indicators = S.indicators.filter(x => !(x.type === 'SCRIPT' && x.sid === sc.id));
  S.indicators.push({ id: 'i' + Date.now(), type: 'SCRIPT', sid: sc.id, name: sc.name, p: {}, inputs: {}, color: '#38bdf8' });
  save(); buildSeries();
}
$('#indBtn').onclick = () => { indQuery = ''; renderIndModal(); openModal('#indModal'); const f = $('#indFilter'); if (f) { f.value = ''; if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => f.focus(), 30); } };
(() => {
  const f = el('input', 'ind-filter'); f.id = 'indFilter'; f.type = 'search'; f.placeholder = '搜尋指標，例如 RSI、布林、均線'; f.autocomplete = 'off';
  f.oninput = () => { indQuery = f.value; renderIndModal(); };
  $('#indCatalog').before(f);
})();

// ---------- settings ----------
function openSettings() {
  $('#setColor').value = S.settings.colors; $('#setTheme').value = S.settings.theme; $('#setTz').value = S.settings.tz; $('#setMagnet').checked = S.settings.magnet;
  $('#askNotify').textContent = !('Notification' in window) ? '此裝置不支援' : Notification.permission === 'granted' ? '已開啟' : '開啟通知';
  $('#setWorker').value = D.getWorkerUrl();
  showWorkerStatus();
  openModal('#setModal');
}
$('#setBtn').onclick = () => openSettings();
async function showWorkerStatus(url = D.getWorkerUrl()) {
  const st = $('#workerStatus');
  if (!url) { st.textContent = '未設定：台股、美股、指數、原物料、外匯會顯示模擬資料。'; st.className = 'fine'; return; }
  st.textContent = '連線測試中…'; st.className = 'fine';
  try {
    const h = await D.testWorker(url);
    st.textContent = `✓ 已連線（Yahoo 行情${h.providers?.fugle ? '＋富果台股即時' : '；台股延遲約 20 分，可加富果金鑰升級即時'}）`;
    st.className = 'fine ok';
  } catch (e) {
    st.textContent = '✗ 連不上這個網址（' + e.message + '），請確認網址是否正確、Worker 是否已部署。';
    st.className = 'fine bad';
  }
}
$('#saveWorker').onclick = async () => {
  const before = D.getWorkerUrl();
  const u = D.setWorkerUrl($('#setWorker').value);
  $('#setWorker').value = u;
  await showWorkerStatus(u);
  if (u !== before) {
    for (const k of Object.keys(tickers)) if (!isCrypto(k)) delete tickers[k];
    D.loadTwList();
    primeTickers(); restartWatchStream();
    if (!isCrypto(S.symbol)) loadSymbol();
    toast(u ? '已儲存行情中繼網址' : '已清除行情中繼網址');
  }
};
// chart type selector inside settings for small screens
(() => {
  const row = el('label', 'row', '<span>圖表類型</span>');
  const sel = el('select'); sel.id = 'setType';
  for (const t of CHART_TYPES) sel.append(new Option(t.name, t.k));
  row.append(sel);
  $('.set-body').prepend(row);
  sel.onchange = () => setChartType(sel.value);
})();
$('#setColor').onchange = e => { S.settings.colors = e.target.value; save(); applyTheme(); buildSeries(); renderWatchlist(); renderHeader(); renderDetail(); };
$('#setTheme').onchange = e => { S.settings.theme = e.target.value; save(); applyTheme(); };
$('#setTz').onchange = e => { S.settings.tz = e.target.value; save(); setAllData(true); };
$('#setMagnet').onchange = e => { S.settings.magnet = e.target.checked; drawings.magnet = e.target.checked; save(); renderDrawbar(); };
$('#clearDrawings').onclick = () => { drawings.clearAll(); closeModals(); toast('已清除本商品畫線'); };
$('#askNotify').onclick = async () => {
  if (!('Notification' in window)) return;
  const r = await Notification.requestPermission();
  $('#askNotify').textContent = r === 'granted' ? '已開啟' : '未授權';
};

// ---------- timeframe & chart type ----------
function renderTimeframes() {
  const g = $('#tfGroup');
  g.innerHTML = '';
  for (const iv of INTERVALS) {
    const b = el('button', 'tf-btn' + (iv.k === S.interval ? ' on' : ''), iv.label);
    b.onclick = () => { if (S.interval === iv.k) return; S.interval = iv.k; save(); renderTimeframes(); loadSymbol(); };
    g.append(b);
  }
}
function renderTypes() {
  const g = $('#typeGroup');
  g.innerHTML = '';
  for (const t of CHART_TYPES) {
    const b = el('button', t.k === S.chartType ? 'on' : '', `<svg viewBox="0 0 24 24" class="ico"><path d="${t.icon}"/></svg>`);
    b.title = t.name;
    b.onclick = () => setChartType(t.k);
    g.append(b);
  }
  const sel = $('#setType'); if (sel) sel.value = S.chartType;
}
function setChartType(k) { S.chartType = k; save(); renderTypes(); buildSeries(); }

// ---------- drawing toolbar ----------
function renderDrawbar() {
  const bar = $('#drawbar');
  bar.innerHTML = '';
  for (const t of TOOLS) {
    if (t.sep) { bar.append(el('div', 'draw-sep')); continue; }
    const on = t.toggle ? drawings[t.k === 'hide' ? 'hidden' : t.k] : drawings.tool === t.k;
    const b = el('button', 'draw-btn' + (t.toggle ? ' toggle' : '') + (on ? ' on' : ''), `<svg viewBox="0 0 24 24" class="ico"><path d="${t.icon}"/></svg>`);
    b.title = t.name; b.setAttribute('aria-label', t.name);
    b.onclick = () => {
      if (t.k === 'undo') return drawings.undo();
      if (t.k === 'trash') { drawings.clearAll(); return; }
      if (t.k === 'magnet') { drawings.magnet = !drawings.magnet; S.settings.magnet = drawings.magnet; save(); }
      else if (t.k === 'lock') drawings.lock = !drawings.lock;
      else if (t.k === 'hide') { drawings.hidden = !drawings.hidden; if (drawings.hidden) drawings.select(null); }
      else drawings.setTool(drawings.tool === t.k ? 'cursor' : t.k);
      renderDrawbar();
    };
    bar.append(b);
  }
}
function renderSwatches(d) {
  $('#selBar').hidden = !d;
  if (!d) return;
  const sw = $('#swatches');
  sw.innerHTML = '';
  if (d.type === 'measure') { $('#selBar').hidden = true; return; }
  $('#editText').hidden = d.type !== 'text';
  for (const c of COLORS) {
    const b = el('button', 'swatch' + (d.color === c ? ' on' : ''));
    b.style.background = c; b.title = c;
    b.onclick = () => { drawings.setColor(c); drawings.lastColor = c; renderSwatches(d); };
    sw.append(b);
  }
}
$('#delDrawing').onclick = () => drawings.deleteSelected();
$('#editText').onclick = () => {
  const d = drawings.selected;
  if (!d || d.type !== 'text') return;
  askText(d.text).then(t => { if (t) drawings.setText(t); });
};

let textResolve = null;
function askText(def) {
  return new Promise(res => {
    textResolve = res;
    $('#textInput').value = def || '';
    openModal('#textModal');
    setTimeout(() => $('#textInput').focus(), 30);
  });
}
$('#textForm').onsubmit = e => { e.preventDefault(); const v = $('#textInput').value.trim(); closeModals(); textResolve?.(v); textResolve = null; };

// ---------- misc actions ----------
$('#shotBtn').onclick = () => {
  const c = chart.takeScreenshot();
  const ctx = c.getContext('2d');
  ctx.drawImage($('#overlay'), 0, 0, c.width, c.height);
  // stamp
  const dpr = window.devicePixelRatio || 1;
  ctx.font = `${12 * dpr}px "JetBrains Mono", ui-monospace, monospace`; ctx.fillStyle = css('--muted');
  ctx.fillText(`${symLabel(S.symbol)} · ${INTERVALS.find(i => i.k === S.interval).label} · 鷹眼看盤 · ${new Date().toLocaleString('zh-TW')}`, 10 * dpr, c.height - 10 * dpr);
  c.toBlob(async b => {
    const name = `${S.symbol.replace(/[^\w.-]+/g, '_')}_${S.interval}_${Date.now()}.png`;
    // phones (esp. installed iOS apps) can't download files: use the share sheet so it can be saved to Photos
    const file = new File([b], name, { type: 'image/png' });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: symLabel(S.symbol) }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = el('a'); a.href = URL.createObjectURL(b); a.download = name; a.click();
    toast('已儲存截圖');
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
};
$('#sideBtn').onclick = () => {
  if (matchMedia('(max-width: 900px)').matches) document.body.classList.toggle('app-side-open');
  else { S.sideHidden = !S.sideHidden; save(); document.body.classList.toggle('app-noside', S.sideHidden); }
};
$('#sideClose').onclick = () => document.body.classList.remove('app-side-open');
$('.chart-wrap').addEventListener('pointerdown', () => document.body.classList.remove('app-side-open'));

document.addEventListener('keydown', e => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  const modalOpen = [...document.querySelectorAll('.modal')].some(m => !m.hidden);
  if (e.key === 'Escape') { if (modalOpen) closeModals(); else { drawings.setTool('cursor'); drawings.select(null); renderDrawbar(); } return; }
  if (typing || modalOpen) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); drawings.undo(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { drawings.deleteSelected(); return; }
  if (e.altKey && !e.ctrlKey) {
    const map = { t: 'trend', h: 'hline', v: 'vline', r: 'rect', f: 'fib', m: 'measure' };
    const k = map[e.code.replace('Key', '').toLowerCase()];
    if (k) { e.preventDefault(); drawings.setTool(k); renderDrawbar(); }
    return;
  }
  if (!e.ctrlKey && !e.metaKey && /^[a-z0-9]$/i.test(e.key)) { e.preventDefault(); openSearch(e.key.toUpperCase(), 'all'); }
});

// ---------- install (PWA) ----------
let deferredPrompt = null;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#installBtn').hidden = false; });
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('安裝完成！可從桌面或主畫面開啟'); });
if (isIOS && !standalone) $('#installBtn').hidden = false;
$('#installBtn').onclick = async () => {
  if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('#installBtn').hidden = true; }
  else if (isIOS) openModal('#iosModal');
};
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- boot ----------
document.body.classList.toggle('app-noside', !!S.sideHidden);
createChart();
// repaint canvas text once the web fonts (mono numerics) arrive
document.fonts?.ready.then(() => applyTheme()).catch(() => {});
layer = new IndicatorLayer({ chart, upDown, priceDec: () => priceDec, getScript: sid => (S.scripts || []).find(x => x.id === sid) });
drawings = new Drawings({
  chart, getSeries: () => mainSeries, overlay: $('#overlay'), container: $('.chart-wrap'),
  getBars: () => bars, getSec: () => intervalSec(S.interval), fmt: p => fmt(p),
  onSelect: d => renderSwatches(d), askText, onToolChange: () => renderDrawbar(),
});
drawings.magnet = S.settings.magnet;
renderTimeframes(); renderTypes(); renderDrawbar(); renderWatchlist();
// API handed to the feature modules (layout, replay, alerts, screener, backtest, scripts, templates, cloud)
const app = {
  S, save, on, emit, $, el, baseOptions, themeOptions, esc, toast, fmt, fmtP, fmtS, fmtBig, pct, cls, symLabel, decimals, decFor, upDown, css, hexA, tzOffset,
  get chart() { return chart; }, get mainSeries() { return mainSeries; }, get bars() { return bars; }, get priceDec() { return priceDec; },
  get replaying() { return !!replayCtl; }, get replayTotal() { return replayCtl ? replayCtl.full.length : bars.length; },
  get tickers() { return tickers; }, get layer() { return layer; },
  openModal, closeModals, bindModal, openSearch: (prefill = '', onPick = null) => openSearch(prefill, undefined, onPick),
  switchSymbol, loadSymbol, buildSeries, setAllData, setMarkers,
  setInterval: k => { if (S.interval === k) return; S.interval = k; save(); renderTimeframes(); loadSymbol(); },
  setChartType, addScriptIndicator, renderIndModal, notifyPerm: () => 'Notification' in window && Notification.permission === 'default' && Notification.requestPermission(),
  replayStart, replayStep, replayBack, replayStop,
  data: { fetchKlines, fetchAllTickers, fetchTicker, fetchQuotes, subscribeKlines, intervalSec, INTERVALS, splitSymbol, isCrypto, symbolMeta, getWorkerUrl: D.getWorkerUrl, isDemo: D.isDemo, get demoMode() { return D.demoMode; } },
  I,
};
on('watchlistChanged', () => { renderWatchlist(); restartWatchStream(); });
initFeatures(app);
loadSymbol().then(() => { primeTickers(); restartWatchStream(); updateDemoBadge(); });
if (D.getWorkerUrl()) D.loadTwList();
window.addEventListener('online', () => { if (D.isDemo(S.symbol)) toast('網路已恢復，重新整理即可取得即時行情'); });
window.__hawk = { S, get bars() { return bars; }, drawings, get chart() { return chart; }, app };
