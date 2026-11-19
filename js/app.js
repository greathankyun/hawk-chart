import * as I from './indicators.js';
import { INTERVALS, intervalSec, fetchKlines, fetchAllTickers, fetchTicker, Stream, splitSymbol, QUOTES } from './data.js';
import * as D from './data.js';
import { Drawings, TOOLS, COLORS } from './drawings.js';

const LC = window.LightweightCharts;
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// ---------- persisted state ----------
const DEFAULTS = {
  symbol: 'BTCUSDT', interval: '1h', chartType: 'candle',
  indicators: I.DEFAULT_INDICATORS,
  watchlist: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'ETHBTC'],
  alerts: [],
  settings: { colors: 'tw', theme: 'dark', tz: 'local', magnet: false },
  sideHidden: false,
};
let S;
try { S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('hawk.state') || '{}') }; } catch { S = { ...DEFAULTS }; }
S.settings = { ...DEFAULTS.settings, ...S.settings };
const save = () => { try { localStorage.setItem('hawk.state', JSON.stringify(S)); } catch {} };

// ---------- runtime ----------
let chart, mainSeries, indSeries = [], indCache = {}, alertLines = [];
let bars = [], disp = [];
let klineStream, wlStream, loadCtl, loadingMore = false, exhausted = false;
const tickers = {}; // symbol -> {last, chgPct, high, low, vol, qvol}
let drawings;

const CHART_TYPES = [
  { k: 'candle', name: 'K 線', icon: 'M8 3h2v3h2v11h-2v4H8v-4H6V6h2zm7 4h2v3h2v7h-2v3h-2v-3h-2v-7h2z' },
  { k: 'ha', name: '平均 K', icon: 'M6 6h5v12H6zm7 3h5v9h-5zM8 3h1v3H8zm0 15h1v3H8zm7-12h1v3h-1zm0 12h1v3h-1z' },
  { k: 'bar', name: '美國線', icon: 'M8 3h2v18H8zM5 8h3v2H5zm5 6h3v2h-3zm6-9h2v14h-2zm-3 3h3v2h-3zm5 6h3v2h-3z' },
  { k: 'line', name: '折線', icon: 'M3 17l5-6 4 3 8-9 1.4 1.4-9.2 10.3-4-3-4.6 5.5z' },
  { k: 'area', name: '面積', icon: 'M3 17l5-6 4 3 8-9v16H3z' },
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
const symLabel = s => { const [b, q] = splitSymbol(s); return q ? `${b}/${q}` : s; };
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function toast(msg, ms = 3500) { const t = el('div', 'toast', msg); $('#toasts').append(t); setTimeout(() => t.remove(), ms); }
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

// ---------- theme ----------
function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme;
  document.documentElement.dataset.colors = S.settings.colors;
  document.querySelector('meta[name="theme-color"]').content = css('--panel');
  if (!chart) return;
  const dark = S.settings.theme === 'dark';
  chart.applyOptions({
    layout: { background: { color: css('--bg') }, textColor: css('--muted'), panes: { separatorColor: css('--border'), separatorHoverColor: hexA('#f5a524', .3) } },
    grid: { vertLines: { color: dark ? 'rgba(30,43,66,.55)' : 'rgba(221,227,236,.8)' }, horzLines: { color: dark ? 'rgba(30,43,66,.55)' : 'rgba(221,227,236,.8)' } },
    rightPriceScale: { borderColor: css('--border') },
    timeScale: { borderColor: css('--border') },
    crosshair: { vertLine: { color: dark ? '#4b5b78' : '#9aa6bb', labelBackgroundColor: dark ? '#26354f' : '#55627a' }, horzLine: { color: dark ? '#4b5b78' : '#9aa6bb', labelBackgroundColor: dark ? '#26354f' : '#55627a' } },
  });
}

// ---------- chart ----------
function createChart() {
  chart = LC.createChart($('#chart'), {
    autoSize: true,
    layout: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", sans-serif', fontSize: 11, attributionLogo: false },
    crosshair: { mode: LC.CrosshairMode.Normal },
    timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 7, minBarSpacing: 0.5 },
    rightPriceScale: { scaleMargins: { top: 0.12, bottom: 0.08 } },
    localization: {
      locale: 'zh-TW',
      timeFormatter: t => {
        const d = new Date(t * 1000);
        const p = n => String(n).padStart(2, '0');
        const date = `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}`;
        return intervalSec(S.interval) >= 86400 ? date : `${date} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
      },
    },
  });
  applyTheme();
  chart.subscribeCrosshairMove(p => updateLegend(p.logical != null && p.point ? Math.round(p.logical) : null));
  chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r && r.from < 30) loadMore(); });
  new ResizeObserver(() => updateLegend(crosshairIdx)).observe($('#chart'));
}

function upDown() {
  const tw = S.settings.colors === 'tw';
  return { up: tw ? '#ef4444' : '#10b981', down: tw ? '#10b981' : '#ef4444' };
}

function buildSeries() {
  // remove everything, then recreate main + indicator series
  for (const s of [mainSeries, ...indSeries.flatMap(x => x.series)]) if (s) try { chart.removeSeries(s); } catch {}
  indSeries = []; alertLines = [];
  while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);

  const { up, down } = upDown();
  const pf = { type: 'price', precision: priceDec, minMove: 1 / 10 ** priceDec };
  const t = S.chartType;
  if (t === 'candle' || t === 'ha') mainSeries = chart.addSeries(LC.CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceFormat: pf });
  else if (t === 'bar') mainSeries = chart.addSeries(LC.BarSeries, { upColor: up, downColor: down, thinBars: false, priceFormat: pf });
  else if (t === 'line') mainSeries = chart.addSeries(LC.LineSeries, { color: '#38bdf8', lineWidth: 2, priceFormat: pf });
  else mainSeries = chart.addSeries(LC.AreaSeries, { lineColor: '#38bdf8', topColor: 'rgba(56,189,248,.35)', bottomColor: 'rgba(56,189,248,0)', lineWidth: 2, priceFormat: pf });

  let pane = 1;
  for (const ind of S.indicators) {
    const def = I.CATALOG[ind.type];
    if (!def) continue;
    const pi = def.overlay ? 0 : pane++;
    const line = (color, extra = {}) => chart.addSeries(LC.LineSeries, { color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: !def.overlay || ind.type !== 'VOL', crosshairMarkerVisible: false, priceFormat: def.overlay ? pf : { type: 'price', precision: 2, minMove: 0.01 }, ...extra }, pi);
    let series = [];
    switch (ind.type) {
      case 'MA': case 'EMA': case 'VWAP': series = [line(ind.color)]; break;
      case 'BOLL': series = [line(ind.color), line(hexA(ind.color, .8), { lineStyle: 2 }), line(hexA(ind.color, .8), { lineStyle: 2 })]; break;
      case 'VOL': {
        const v = chart.addSeries(LC.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 0);
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        series = [v]; break;
      }
      case 'RSI': {
        const s = line(ind.color);
        s.createPriceLine({ price: 70, color: hexA('#ef4444', .5), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
        s.createPriceLine({ price: 30, color: hexA('#10b981', .5), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
        series = [s]; break;
      }
      case 'KD': {
        const k = line(ind.color), d = line('#38bdf8');
        k.createPriceLine({ price: 80, color: hexA('#ef4444', .5), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
        k.createPriceLine({ price: 20, color: hexA('#10b981', .5), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
        series = [k, d]; break;
      }
      case 'MACD': {
        const h = chart.addSeries(LC.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'price', precision: priceDec + 1, minMove: 1 / 10 ** (priceDec + 1) } }, pi);
        const m = line(ind.color, { priceFormat: { type: 'price', precision: priceDec + 1, minMove: 1 / 10 ** (priceDec + 1) } });
        const s = line('#f5a524', { priceFormat: { type: 'price', precision: priceDec + 1, minMove: 1 / 10 ** (priceDec + 1) } });
        series = [h, m, s]; break;
      }
      case 'ATR': series = [line(ind.color, { priceFormat: pf })]; break;
    }
    indSeries.push({ ind, series, pane: pi });
  }
  const panes = chart.panes();
  panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 3.2 : 1));
  const hasVol = S.indicators.some(x => x.type === 'VOL');
  mainSeries.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: hasVol ? 0.22 : 0.08 } });
  setAllData(false);
  drawAlertLines();
}

function computeIndicators() {
  indCache = {};
  for (const { ind } of indSeries) {
    const p = ind.p || {};
    switch (ind.type) {
      case 'MA': indCache[ind.id] = [I.sma(bars.map(b => b.close), p.n)]; break;
      case 'EMA': indCache[ind.id] = [I.ema(bars.map(b => b.close), p.n)]; break;
      case 'VWAP': indCache[ind.id] = [I.vwap(bars)]; break;
      case 'BOLL': { const r = I.bollinger(bars, p.n, p.m); indCache[ind.id] = [r.mid, r.upper, r.lower]; break; }
      case 'VOL': indCache[ind.id] = [bars.map(b => b.volume)]; break;
      case 'RSI': indCache[ind.id] = [I.rsi(bars, p.n)]; break;
      case 'KD': { const r = I.kd(bars, p.n); indCache[ind.id] = [r.k, r.d]; break; }
      case 'MACD': { const r = I.macd(bars, p.f, p.s, p.g); indCache[ind.id] = [r.hist, r.line, r.signal]; break; }
      case 'ATR': indCache[ind.id] = [I.atr(bars, p.n)]; break;
    }
  }
}

function pointFor(ind, k, i, v) {
  const time = disp[i].time;
  if (v == null) return { time };
  const { up, down } = upDown();
  if (ind.type === 'VOL') return { time, value: v, color: hexA(bars[i].close >= bars[i].open ? up : down, .45) };
  if (ind.type === 'MACD' && k === 0) {
    const prev = indCache[ind.id][0][i - 1];
    const c = v >= 0 ? (prev != null && v < prev ? hexA(up, .45) : up) : (prev != null && v > prev ? hexA(down, .45) : down);
    return { time, value: v, color: c };
  }
  return { time, value: v };
}

function makeDisp() {
  const off = tzOffset();
  const base = S.chartType === 'ha' ? I.heikinAshi(bars) : bars;
  disp = base.map(b => (S.chartType === 'line' || S.chartType === 'area') ? { time: b.utc + off, value: b.close } : { time: b.utc + off, open: b.open, high: b.high, low: b.low, close: b.close });
}

function setAllData(keepRange = true, shift = 0) {
  const ts = chart.timeScale();
  const range = keepRange ? ts.getVisibleLogicalRange() : null;
  makeDisp();
  mainSeries.setData(disp);
  computeIndicators();
  for (const { ind, series } of indSeries) {
    const arrs = indCache[ind.id] || [];
    series.forEach((s, k) => s.setData((arrs[k] || []).map((v, i) => pointFor(ind, k, i, v))));
  }
  if (range) ts.setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
  else if (bars.length) ts.setVisibleLogicalRange({ from: Math.max(0, bars.length - 160), to: bars.length + 8 });
  updateLegend(null);
}

let tickPending = false;
function applyTick() {
  tickPending = false;
  if (!bars.length) return;
  const n = bars.length - 1;
  makeDisp();
  mainSeries.update(disp[n]);
  computeIndicators();
  for (const { ind, series } of indSeries) {
    const arrs = indCache[ind.id] || [];
    series.forEach((s, k) => { try { s.update(pointFor(ind, k, n, arrs[k]?.[n])); } catch {} });
  }
  if (!crosshairIdx) updateLegend(null);
}

// ---------- legend ----------
let crosshairIdx = null;
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
  let html = `<div class="l-main"><span class="l-sym">${symLabel(S.symbol)}</span><span class="l-tag">${iv.label} · Binance</span>
    <span><span class="l-k">開</span><span class="${c}">${fmt(b.open)}</span></span>
    <span><span class="l-k">高</span><span class="${c}">${fmt(b.high)}</span></span>
    <span><span class="l-k">低</span><span class="${c}">${fmt(b.low)}</span></span>
    <span><span class="l-k">收</span><span class="${c}">${fmt(b.close)}</span></span>
    <span class="${c}">${chg >= 0 ? '+' : ''}${fmt(chg)} (${pct(chgPct)})</span>
    <span><span class="l-k">量</span>${fmtBig(b.volume)}</span></div><div class="l-ind">`;
  for (const { ind } of indSeries) {
    const def = I.CATALOG[ind.type];
    if (!def.overlay || ind.type === 'VOL') continue;
    const vals = (indCache[ind.id] || []).map(a => a[i]);
    html += `<span style="color:${ind.color}">${I.label(ind)} <b>${vals.map(v => fmt(v)).join(' / ')}</b></span>`;
  }
  html += '</div>';
  $('#legend').innerHTML = html;
  // sub-pane labels
  const box = $('#paneLegends');
  let out = '', top = 0;
  let sizes;
  try { sizes = chart.panes().map((_, k) => chart.paneSize(k).height); } catch { requestAnimationFrame(() => updateLegend(crosshairIdx)); box.innerHTML = ''; return; }
  for (const { ind, pane } of indSeries) {
    if (pane === 0) continue;
    top = sizes.slice(0, pane).reduce((a, h) => a + h + 1, 0);
    const vals = (indCache[ind.id] || []).map(a => a[i]);
    const names = { MACD: ['柱', 'DIF', 'DEA'], KD: ['K', 'D'] }[ind.type];
    const parts = vals.map((v, k) => (names ? `<span class="l-k">${names[k]}</span>` : '') + `<b>${v == null ? '—' : (+v).toFixed(ind.type === 'MACD' || ind.type === 'ATR' ? priceDec + 1 : 2)}</b>`).join(' ');
    out += `<div class="pane-legend" style="top:${top + 4}px"><span style="color:${ind.color}">${I.label(ind)}</span> ${parts}</div>`;
  }
  box.innerHTML = out;
}

// ---------- loading ----------
async function loadSymbol() {
  loadCtl?.abort();
  const ctl = loadCtl = new AbortController();
  $('#loading').classList.add('on');
  klineStream?.close();
  exhausted = false;
  bars = [];
  drawings.setSymbol(S.symbol);
  renderHeader();
  try {
    const rows = await fetchKlines(S.symbol, S.interval, { limit: 1000, signal: ctl.signal });
    if (ctl.signal.aborted) return;
    const intraday = intervalSec(S.interval) < 86400;
    bars = rows.map(r => ({ ...r, intraday }));
    if (bars.length) priceDec = decimals(bars[bars.length - 1].close);
    if (bars.length < 1000) exhausted = true;
    buildSeries();
    $('#demoBadge').hidden = !D.demoMode;
    klineStream = new Stream([`${S.symbol.toLowerCase()}@kline_${S.interval}`], onKline, st => setStatus(st));
    const tk = await fetchTicker(S.symbol);
    if (tk) { tickers[S.symbol] = { ...tickers[S.symbol], ...tk }; renderHeader(); renderDetail(); }
  } catch (e) {
    if (e.name !== 'AbortError') toast('載入失敗：' + e.message);
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
    setAllData(true, older.length);
  } catch {} finally { loadingMore = false; }
}

function onKline(stream, data) {
  const k = data.k;
  if (!k || !bars.length) return;
  const bar = { utc: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, quoteVolume: +k.q, intraday: bars[0].intraday };
  const last = bars[bars.length - 1];
  if (bar.utc === last.utc) bars[bars.length - 1] = bar;
  else if (bar.utc > last.utc) bars.push(bar);
  else return;
  if (!tickPending) { tickPending = true; setTimeout(applyTick, 200); }
  priceUpdate(S.symbol, bar.close);
}

function setStatus(st) {
  const map = { live: '● 即時', reconnecting: '○ 重新連線中…', demo: '● 模擬' };
  $('#statusBadge').textContent = map[st] || '';
  $('#statusBadge').style.color = st === 'live' ? css('--down') : css('--muted');
  if (st === 'live' && S.settings.colors === 'tw') $('#statusBadge').style.color = '#10b981';
}

// ---------- header / detail ----------
function renderHeader() {
  const t = tickers[S.symbol];
  $('#symName').textContent = symLabel(S.symbol);
  const last = t?.last ?? bars[bars.length - 1]?.close;
  $('#symPrice').textContent = last != null ? fmtP(last, decimals(last)) : '—';
  $('#symChg').textContent = t ? pct(t.chgPct) : '';
  $('#symChg').className = 'sym-chg ' + cls(t?.chgPct);
  $('#symPrice').className = 'sym-price ' + cls(t?.chgPct);
}
function renderDetail() {
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

// ---------- watchlist ----------
function renderWatchlist() {
  const ul = $('#watchlist');
  ul.innerHTML = '';
  for (const sym of S.watchlist) {
    const t = tickers[sym];
    const [b, q] = splitSymbol(sym);
    const li = el('li', sym === S.symbol ? 'on' : '');
    li.dataset.sym = sym;
    li.innerHTML = `<span class="w-sym">${b}<small>/${q}</small></span>
      <span class="w-px ${cls(t?.chgPct)}">${t ? fmtP(t.last) : '—'}</span>
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
  const li = $(`#watchlist li[data-sym="${sym}"]`);
  if (!li) return;
  const t = tickers[sym];
  const px = li.querySelector('.w-px'), ch = li.querySelector('.w-chg');
  px.textContent = fmtP(t.last);
  px.className = 'w-px ' + cls(t.chgPct) + (prevLast != null && t.last !== prevLast ? (t.last > prevLast ? ' flash-up' : ' flash-down') : '');
  ch.textContent = pct(t.chgPct); ch.className = 'w-chg ' + cls(t.chgPct);
}
function restartWatchStream() {
  wlStream?.close();
  const syms = [...new Set([...S.watchlist, S.symbol])];
  wlStream = new Stream(syms.map(s => s.toLowerCase() + '@miniTicker'), (st, d) => {
    const sym = d.s;
    const prev = tickers[sym]?.last;
    const last = +d.c, open = +d.o;
    tickers[sym] = { ...tickers[sym], symbol: sym, last, open, chg: last - open, chgPct: open ? (last / open - 1) * 100 : 0, high: +d.h, low: +d.l, vol: +d.v, qvol: +d.q };
    updateWatchRow(sym, prev);
    if (sym === S.symbol) { renderHeader(); renderDetail(); }
    priceUpdate(sym, last);
  });
}
async function primeTickers() {
  const all = await fetchAllTickers();
  for (const t of all) if (S.watchlist.includes(t.symbol) || t.symbol === S.symbol) tickers[t.symbol] = { ...tickers[t.symbol], ...t };
  renderWatchlist(); renderHeader(); renderDetail();
}

function switchSymbol(sym) {
  if (sym === S.symbol) return;
  S.symbol = sym; save();
  renderWatchlist();
  renderAlerts();
  loadSymbol();
  restartWatchStream();
}

// ---------- alerts ----------
const lastSeen = {};
function priceUpdate(sym, price) {
  const prev = lastSeen[sym];
  lastSeen[sym] = price;
  if (prev == null) return;
  let changed = false;
  for (const a of S.alerts) {
    if (a.fired || a.symbol !== sym) continue;
    if ((a.dir === 'above' && prev < a.price && price >= a.price) || (a.dir === 'below' && prev > a.price && price <= a.price)) {
      a.fired = true; changed = true;
      const msg = `${symLabel(sym)} ${a.dir === 'above' ? '漲破' : '跌破'} ${fmtP(a.price)}（現價 ${fmtP(price)}）`;
      toast('🔔 ' + msg, 8000);
      notify('鷹眼看盤 價格警示', msg);
    }
  }
  if (changed) { save(); renderAlerts(); drawAlertLines(); }
}
async function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
    else new Notification(title, { body });
  } catch {}
}
function renderAlerts() {
  const ul = $('#alerts');
  ul.innerHTML = '';
  const list = S.alerts.filter(a => a.symbol === S.symbol);
  if (!list.length) { ul.append(el('li', 'empty', `${symLabel(S.symbol)} 尚無警示`)); return; }
  for (const a of list) {
    const li = el('li', a.fired ? 'fired' : '');
    li.innerHTML = `<span class="a-txt">${a.dir === 'above' ? '漲破' : '跌破'} <b>${fmtP(a.price)}</b></span><button class="icon-btn danger" title="刪除">✕</button>`;
    li.querySelector('button').onclick = () => { S.alerts = S.alerts.filter(x => x !== a); save(); renderAlerts(); drawAlertLines(); };
    ul.append(li);
  }
}
function drawAlertLines() {
  if (!mainSeries) return;
  for (const l of alertLines) try { mainSeries.removePriceLine(l); } catch {}
  alertLines = S.alerts.filter(a => a.symbol === S.symbol && !a.fired).map(a =>
    mainSeries.createPriceLine({ price: a.price, color: '#f5a524', lineStyle: 1, lineWidth: 1, axisLabelVisible: true, title: '🔔' }));
}
$('#alertForm').onsubmit = e => {
  e.preventDefault();
  const price = parseFloat($('#alertPrice').value);
  if (!(price > 0)) return;
  S.alerts.push({ id: Date.now(), symbol: S.symbol, dir: $('#alertDir').value, price, fired: false });
  save(); renderAlerts(); drawAlertLines();
  $('#alertPrice').value = '';
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  toast(`已新增警示：${symLabel(S.symbol)} ${$('#alertDir').value === 'above' ? '漲破' : '跌破'} ${fmtP(price)}`);
};
$('#alertPrice').addEventListener('focus', () => {
  const last = bars[bars.length - 1]?.close;
  if (!$('#alertPrice').value && last) $('#alertPrice').placeholder = fmtP(last).replace(/,/g, '');
});

// ---------- symbol search ----------
let symAll = [], quoteTab = 'USDT', kbIdx = 0, symShown = [];
function openModal(id) { $(id).hidden = false; }
function closeModals() { document.querySelectorAll('.modal').forEach(m => (m.hidden = true)); }
document.querySelectorAll('.modal').forEach(m => m.addEventListener('pointerdown', e => { if (e.target === m || e.target.closest('[data-close]')) closeModals(); }));

async function openSearch(prefill = '') {
  openModal('#symModal');
  const inp = $('#symSearch');
  inp.value = prefill;
  setTimeout(() => inp.focus(), 30);
  $('#symList').innerHTML = '<li class="empty">載入中…</li>';
  symAll = await fetchAllTickers();
  renderQuoteTabs();
  renderSymList();
}
function renderQuoteTabs() {
  const tabs = $('#quoteTabs');
  tabs.innerHTML = '';
  for (const q of ['★ 自選', 'USDT', 'FDUSD', 'USDC', 'BTC', 'ETH', 'BNB', '全部']) {
    const b = el('button', q === quoteTab ? 'on' : '', q);
    b.onclick = () => { quoteTab = q; renderQuoteTabs(); renderSymList(); };
    tabs.append(b);
  }
}
function renderSymList() {
  const q = $('#symSearch').value.trim().toUpperCase().replace(/[\/\s-]/g, '');
  let list = symAll;
  if (quoteTab === '★ 自選') list = list.filter(t => S.watchlist.includes(t.symbol));
  else if (quoteTab !== '全部') list = list.filter(t => splitSymbol(t.symbol)[1] === quoteTab);
  if (q) {
    list = list.filter(t => t.symbol.includes(q));
    list = list.slice().sort((a, b) => (b.symbol.startsWith(q) - a.symbol.startsWith(q)) || b.qvol - a.qvol);
  } else list = list.slice().sort((a, b) => b.qvol - a.qvol);
  symShown = list.slice(0, 200);
  kbIdx = 0;
  const ul = $('#symList');
  ul.innerHTML = '';
  if (!symShown.length) { ul.append(el('li', 'empty', '找不到符合的商品')); return; }
  symShown.forEach((t, i) => {
    const [b, qq] = splitSymbol(t.symbol);
    const on = S.watchlist.includes(t.symbol);
    const li = el('li', i === 0 ? 'kb' : '');
    li.innerHTML = `<span class="s-sym"><b>${b}</b><small>/${qq}</small></span><span>${fmtP(t.last)}</span><span class="${cls(t.chgPct)}">${pct(t.chgPct)}</span><span>${fmtBig(t.qvol)}</span>
      <button class="star ${on ? 'on' : ''}" title="${on ? '移出自選' : '加入自選'}">${on ? '★' : '☆'}</button>`;
    li.onclick = e => {
      if (e.target.closest('.star')) {
        const s = t.symbol;
        S.watchlist = S.watchlist.includes(s) ? S.watchlist.filter(x => x !== s) : [...S.watchlist, s];
        save();
        if (!tickers[s]) tickers[s] = t;
        renderWatchlist(); restartWatchStream();
        const st = e.target.closest('.star'); const now = S.watchlist.includes(s);
        st.className = 'star' + (now ? ' on' : ''); st.textContent = now ? '★' : '☆';
        return;
      }
      tickers[t.symbol] = { ...tickers[t.symbol], ...t };
      closeModals(); switchSymbol(t.symbol);
    };
    ul.append(li);
  });
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
    const t = symShown[kbIdx]; tickers[t.symbol] = { ...tickers[t.symbol], ...t }; closeModals(); switchSymbol(t.symbol);
  }
});
$('#symBtn').onclick = () => openSearch();
$('#addWatch').onclick = () => { quoteTab = 'USDT'; openSearch(); };

// ---------- indicators UI ----------
function renderIndModal() {
  const act = $('#indActive');
  act.innerHTML = '';
  if (!S.indicators.length) act.append(el('li', 'empty', '尚未加入指標'));
  for (const ind of S.indicators) {
    const def = I.CATALOG[ind.type];
    const li = el('li');
    li.append(el('span', 'i-name', ind.type));
    for (const p of def.params) {
      const lab = el('label', '', `<small>${p.label}</small> `);
      const inp = el('input'); inp.type = 'number'; inp.min = 1; inp.step = p.k === 'm' ? 0.1 : 1; inp.value = ind.p[p.k];
      inp.onchange = () => { const v = parseFloat(inp.value); if (v > 0) { ind.p[p.k] = v; save(); buildSeries(); } };
      lab.append(inp); li.append(lab);
    }
    const col = el('input'); col.type = 'color'; col.value = ind.color; col.title = '顏色';
    col.oninput = () => { ind.color = col.value; save(); buildSeries(); };
    li.append(el('span', 'i-sp'), col);
    const del = el('button', 'icon-btn danger', '✕'); del.title = '移除';
    del.onclick = () => { S.indicators = S.indicators.filter(x => x !== ind); save(); buildSeries(); renderIndModal(); };
    li.append(del);
    act.append(li);
  }
  const cat = $('#indCatalog');
  cat.innerHTML = '';
  for (const [k, def] of Object.entries(I.CATALOG)) {
    const li = el('li', '', `<span>${def.name}</span><small>${def.overlay ? '疊加主圖' : '副圖'}</small>`);
    li.onclick = () => {
      const p = Object.fromEntries(def.params.map(x => [x.k, x.def]));
      const used = S.indicators.filter(x => x.type === k).length;
      const palette = ['#f5a524', '#38bdf8', '#a78bfa', '#f472b6', '#2dd4bf', '#facc15'];
      S.indicators.push({ id: 'i' + Date.now(), type: k, p, color: used ? palette[used % palette.length] : def.colors[0] });
      save(); buildSeries(); renderIndModal();
    };
    cat.append(li);
  }
}
$('#indBtn').onclick = () => { renderIndModal(); openModal('#indModal'); };

// ---------- settings ----------
$('#setBtn').onclick = () => {
  $('#setColor').value = S.settings.colors; $('#setTheme').value = S.settings.theme; $('#setTz').value = S.settings.tz; $('#setMagnet').checked = S.settings.magnet;
  $('#askNotify').textContent = !('Notification' in window) ? '此裝置不支援' : Notification.permission === 'granted' ? '已開啟' : '開啟通知';
  openModal('#setModal');
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
      else if (t.k === 'hide') drawings.hidden = !drawings.hidden;
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
  for (const c of COLORS) {
    const b = el('button', 'swatch' + (d.color === c ? ' on' : ''));
    b.style.background = c; b.title = c;
    b.onclick = () => { drawings.setColor(c); drawings.lastColor = c; renderSwatches(d); };
    sw.append(b);
  }
}
$('#delDrawing').onclick = () => drawings.deleteSelected();

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
  ctx.font = `${12 * dpr}px sans-serif`; ctx.fillStyle = css('--muted');
  ctx.fillText(`${symLabel(S.symbol)} · ${INTERVALS.find(i => i.k === S.interval).label} · 鷹眼看盤 · ${new Date().toLocaleString('zh-TW')}`, 10 * dpr, c.height - 10 * dpr);
  c.toBlob(b => {
    const a = el('a'); a.href = URL.createObjectURL(b); a.download = `${S.symbol}_${S.interval}_${Date.now()}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  toast('已儲存截圖');
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
  if (!e.ctrlKey && !e.metaKey && /^[a-z0-9]$/i.test(e.key)) { e.preventDefault(); openSearch(e.key.toUpperCase()); }
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
drawings = new Drawings({
  chart, getSeries: () => mainSeries, overlay: $('#overlay'), container: $('.chart-wrap'),
  getBars: () => bars, getSec: () => intervalSec(S.interval), fmt: p => fmt(p),
  onSelect: d => renderSwatches(d), askText, onToolChange: () => renderDrawbar(),
});
drawings.magnet = S.settings.magnet;
renderTimeframes(); renderTypes(); renderDrawbar(); renderWatchlist(); renderAlerts();
loadSymbol().then(() => { primeTickers(); restartWatchStream(); $('#demoBadge').hidden = !D.demoMode; });
window.addEventListener('online', () => { if (D.demoMode) toast('網路已恢復，重新整理即可取得即時行情'); });
window.__hawk = { S, get bars() { return bars; }, drawings, get chart() { return chart; } };
