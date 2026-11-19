// Market data facade.
// - Crypto (ids like BTCUSDT): Binance public REST + WebSocket.
// - Everything else (ids like Y:2330.TW, Y:AAPL, Y:GC=F, Y:USDTWD=X): our Cloudflare Worker (/market/*),
//   which proxies Yahoo Finance (and Fugle for Taiwan realtime when a key is configured). Polled, not streamed.
// - A simulated market (clearly labelled) is used when a source is unreachable or not configured.
import { DEFAULT_WORKER_URL } from './config.js';
import { BY_CODE, catOfCode, catName, shortCode } from './markets.js';

const REST_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com'];
const WS_HOSTS = ['wss://data-stream.binance.vision', 'wss://stream.binance.com:9443'];

export const INTERVALS = [
  { k: '1m', label: '1分', sec: 60 },
  { k: '5m', label: '5分', sec: 300 },
  { k: '15m', label: '15分', sec: 900 },
  { k: '30m', label: '30分', sec: 1800 },
  { k: '1h', label: '1時', sec: 3600 },
  { k: '4h', label: '4時', sec: 14400 },
  { k: '1d', label: '日', sec: 86400 },
  { k: '1w', label: '週', sec: 604800 },
  { k: '1M', label: '月', sec: 2592000 },
];
export const intervalSec = k => (INTERVALS.find(i => i.k === k) || INTERVALS[4]).sec;

export const QUOTES = ['USDT', 'FDUSD', 'USDC', 'BTC', 'ETH', 'BNB', 'TRY', 'EUR', 'JPY', 'BRL'];
export function splitSymbol(sym) {
  for (const q of QUOTES) if (sym.endsWith(q) && sym.length > q.length) return [sym.slice(0, -q.length), q];
  return [sym, ''];
}

let restHost = null;
async function rest(path, { signal } = {}) {
  const hosts = restHost ? [restHost, ...REST_HOSTS.filter(h => h !== restHost)] : REST_HOSTS;
  let lastErr;
  for (const h of hosts) {
    try {
      const r = await fetch(h + path, { signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      restHost = h;
      return await r.json();
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error('network');
}

export let demoMode = false;

function mapKline(k) {
  return { utc: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], quoteVolume: +k[7] };
}

export async function fetchKlines(symbol, interval, { endTime, limit = 1000, signal } = {}) {
  if (!isCrypto(symbol)) return marketKlines(symbol, interval, { endTime, limit, signal });
  if (demoMode) return demoKlines(symbol, interval, endTime, limit);
  try {
    let q = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (endTime) q += `&endTime=${endTime * 1000 - 1}`;
    const rows = await rest(q, { signal });
    return rows.map(mapKline);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    demoMode = true;
    return demoKlines(symbol, interval, endTime, limit);
  }
}

let tickerCache = null, tickerAt = 0;
export async function fetchAllTickers() {
  if (tickerCache && Date.now() - tickerAt < 30000) return tickerCache;
  if (demoMode) return (tickerCache = demoTickers());
  try {
    const rows = await rest('/api/v3/ticker/24hr?type=FULL');
    tickerCache = rows
      .filter(r => +r.count > 0 && +r.lastPrice > 0)
      .map(r => ({
        symbol: r.symbol, last: +r.lastPrice, chgPct: +r.priceChangePercent, chg: +r.priceChange,
        high: +r.highPrice, low: +r.lowPrice, open: +r.openPrice, vol: +r.volume, qvol: +r.quoteVolume,
      }));
    tickerAt = Date.now();
    return tickerCache;
  } catch {
    demoMode = true;
    return (tickerCache = demoTickers());
  }
}

export async function fetchTicker(symbol) {
  if (!isCrypto(symbol)) return (await fetchQuotes([symbol]))[0] || null;
  if (demoMode) return demoTickers().find(t => t.symbol === symbol) || demoTickers()[0];
  try {
    const r = await rest(`/api/v3/ticker/24hr?symbol=${symbol}`);
    return { symbol, last: +r.lastPrice, chgPct: +r.priceChangePercent, chg: +r.priceChange, high: +r.highPrice, low: +r.lowPrice, open: +r.openPrice, vol: +r.volume, qvol: +r.quoteVolume };
  } catch { return null; }
}

// ---------- WebSocket with auto-reconnect ----------
export class Stream {
  constructor(streams, onMsg, onState) {
    this.streams = streams; this.onMsg = onMsg; this.onState = onState || (() => {});
    this.hostIdx = 0; this.closed = false; this.retry = 0; this.demoTimer = null;
    this.open();
  }
  open() {
    if (this.closed || !this.streams.length) return;
    if (demoMode) return this.startDemo();
    const url = `${WS_HOSTS[this.hostIdx % WS_HOSTS.length]}/stream?streams=${this.streams.join('/')}`;
    let ws;
    try { ws = new WebSocket(url); } catch { return this.fail(); }
    this.ws = ws;
    const t = setTimeout(() => { if (ws.readyState !== 1) ws.close(); }, 8000);
    ws.onopen = () => { clearTimeout(t); this.retry = 0; this.onState('live'); };
    ws.onmessage = e => { try { const m = JSON.parse(e.data); this.onMsg(m.stream, m.data); } catch {} };
    ws.onclose = () => { clearTimeout(t); if (!this.closed) this.fail(); };
    ws.onerror = () => {};
  }
  fail() {
    this.onState('reconnecting');
    this.hostIdx++; this.retry++;
    const wait = Math.min(15000, 500 * 2 ** this.retry);
    setTimeout(() => this.open(), wait);
  }
  startDemo() {
    this.onState('demo');
    this.demoTimer = setInterval(() => demoTick(this.streams, this.onMsg), 1000);
  }
  close() {
    this.closed = true;
    clearInterval(this.demoTimer);
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch {} }
  }
}

// ---------- simulated market (fallback only) ----------
const DEMO_BASE = { BTCUSDT: 92000, ETHUSDT: 3200, BNBUSDT: 900, SOLUSDT: 180, XRPUSDT: 2.2, DOGEUSDT: 0.2, ADAUSDT: 0.75, AVAXUSDT: 30, LINKUSDT: 18, TRXUSDT: 0.3, DOTUSDT: 4.5, LTCUSDT: 95, ETHBTC: 0.035, SOLBTC: 0.002 };
function seedOf(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function rng(seed) { return () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x6d2b79f5 >>> 0) / 4294967296); }
const demoState = {};
function demoSeries(symbol, interval) {
  const key = symbol + interval;
  if (demoState[key]) return demoState[key];
  const sec = intervalSec(interval);
  const r = rng(seedOf(key));
  const n = 3000;
  const now = Math.floor(Date.now() / 1000 / sec) * sec;
  let p = DEMO_BASE[symbol] || BY_CODE[symbol.slice(2)]?.px || 10 + (seedOf(symbol) % 500);
  const vol = 0.004 * Math.sqrt(sec / 3600);
  const bars = [];
  for (let i = n - 1; i >= 0; i--) {
    const open = p;
    const drift = Math.sin(i / 180) * vol * 0.15;
    const close = open * (1 + drift + (r() - 0.5) * 2 * vol);
    const high = Math.max(open, close) * (1 + r() * vol * 0.8);
    const low = Math.min(open, close) * (1 - r() * vol * 0.8);
    bars.push({ utc: now - i * sec, open, high, low, close, volume: 50 + r() * 500, quoteVolume: 0 });
    p = close;
  }
  return (demoState[key] = { bars, sec });
}
function demoKlines(symbol, interval, endTime, limit) {
  const { bars } = demoSeries(symbol, interval);
  const end = endTime ? bars.findIndex(b => b.utc >= endTime) : bars.length;
  const e = end < 0 ? bars.length : end;
  return bars.slice(Math.max(0, e - limit), e).map(b => ({ ...b }));
}
function demoTickers() {
  return Object.keys(DEMO_BASE).map(s => {
    const { bars } = demoSeries(s, '1h');
    const last = bars[bars.length - 1].close, open = bars[bars.length - 25].close;
    const slice = bars.slice(-24);
    return { symbol: s, last, open, chg: last - open, chgPct: (last / open - 1) * 100, high: Math.max(...slice.map(b => b.high)), low: Math.min(...slice.map(b => b.low)), vol: 1e4, qvol: 1e4 * last };
  });
}
function demoTick(streams, onMsg) {
  for (const st of streams) {
    const [sym, kind] = st.split('@');
    const S = sym.toUpperCase();
    if (kind.startsWith('kline_')) {
      const iv = kind.slice(6);
      const ds = demoSeries(S, iv);
      let last = ds.bars[ds.bars.length - 1];
      const now = Math.floor(Date.now() / 1000);
      if (now >= last.utc + ds.sec) {
        last = { utc: last.utc + ds.sec, open: last.close, high: last.close, low: last.close, close: last.close, volume: 0, quoteVolume: 0 };
        ds.bars.push(last);
      }
      const c = last.close * (1 + (Math.random() - 0.5) * 0.0012);
      last.close = c; last.high = Math.max(last.high, c); last.low = Math.min(last.low, c); last.volume += Math.random() * 5;
      onMsg(st, { k: { t: last.utc * 1000, o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume, q: 0, x: false } });
    } else if (kind === 'miniTicker') {
      const ds = demoSeries(S, '1h');
      const last = ds.bars[ds.bars.length - 1];
      const open = ds.bars[ds.bars.length - 25].close;
      last.close *= 1 + (Math.random() - 0.5) * 0.001;
      onMsg(st, { s: S, c: last.close, o: open, h: last.high, l: last.low, v: 0, q: 0 });
    }
  }
}

// =====================================================================
// Multi-market layer
// =====================================================================
export const isCrypto = sym => !String(sym).startsWith('Y:');
export const codeOf = sym => (isCrypto(sym) ? sym : sym.slice(2));
export const toSym = code => 'Y:' + code;

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export function getWorkerUrl() {
  let u = '';
  try { u = localStorage.getItem('hawk.workerUrl') || ''; } catch {}
  return (u || DEFAULT_WORKER_URL || '').trim().replace(/\/+$/, '');
}
export function setWorkerUrl(u) {
  u = (u || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//.test(u)) u = 'https://' + u;
  try { u ? localStorage.setItem('hawk.workerUrl', u) : localStorage.removeItem('hawk.workerUrl'); } catch {}
  marketDemo.clear();
  return u;
}

async function worker(path, { signal, timeout = 15000 } = {}) {
  const base = getWorkerUrl();
  if (!base) { const e = new Error('尚未設定行情中繼'); e.code = 'noworker'; throw e; }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const r = await fetch(base + path, { signal: ctl.signal, cache: 'no-store' });
    let j = null;
    try { j = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(j?.error || 'HTTP ' + r.status); e.status = r.status; throw e; }
    return j;
  } catch (e) {
    if (signal?.aborted) { const a = new Error('aborted'); a.name = 'AbortError'; throw a; }
    if (e.name === 'AbortError') { const x = new Error('行情中繼逾時'); x.status = 504; throw x; }
    throw e;
  } finally { clearTimeout(t); signal?.removeEventListener('abort', onAbort); }
}

export async function testWorker(url) {
  const base = (url || getWorkerUrl()).replace(/\/+$/, '');
  const r = await fetch(base + '/market/health', { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// ---------- names / metadata ----------
const metaStore = lsGet('hawk.meta', {}); // sym -> { name, cur, exch, delay, source }
let twNames = null; // code -> [name, 'TW'|'TWO']
function loadTwNames() {
  if (twNames) return twNames;
  const c = lsGet('hawk.twlist', null);
  twNames = {};
  if (c?.list) for (const [code, name, m] of c.list) twNames[code] = [name, m];
  return twNames;
}
export function noteMeta(sym, m) {
  if (!m) return;
  const cur = metaStore[sym] || {};
  const next = { ...cur };
  for (const k of ['name', 'currency', 'exchange', 'delay', 'source']) if (m[k] != null) next[k] = m[k];
  if (JSON.stringify(next) !== JSON.stringify(cur)) { metaStore[sym] = next; lsSet('hawk.meta', metaStore); }
}

// Everything the UI needs to show a symbol: title (bold), sub (small), label (one line), category.
export function symbolMeta(sym) {
  if (isCrypto(sym)) {
    const [b, q] = splitSymbol(sym);
    return { sym, crypto: true, code: sym, cat: 'crypto', catName: catName('crypto'), title: b, sub: q ? '/' + q : '', label: q ? `${b}/${q}` : sym, name: q ? `${b}/${q}` : sym, source: 'Binance', delay: 0 };
  }
  const code = codeOf(sym);
  const cat = catOfCode(code);
  const st = metaStore[sym] || {};
  const short = shortCode(code);
  let name = BY_CODE[code]?.name;
  if (!name && cat === 'tw') name = loadTwNames()[short]?.[0];
  if (!name) name = st.name || short;
  const codeFirst = cat === 'us' || cat === 'intl';
  const title = codeFirst ? short : name;
  const sub = codeFirst ? (name !== short ? name : '') : (name !== short ? short : '');
  const label = cat === 'tw' ? `${short} ${name}` : codeFirst ? (sub ? `${short} ${name}` : short) : name;
  return { sym, crypto: false, code, short, cat, catName: catName(cat), name, title, sub, label, currency: st.currency, exchange: st.exchange, source: st.source || 'Yahoo', delay: st.delay ?? (cat === 'tw' || code.startsWith('^TW') ? 20 : cat === 'cmd' ? 10 : 0) };
}

// ---------- klines ----------
const marketDemo = new Set();
export const isDemo = sym => (isCrypto(sym) ? demoMode : !getWorkerUrl() || marketDemo.has(sym));
export function demoReason(sym) {
  if (isCrypto(sym)) return demoMode ? '模擬資料（目前無法連線交易所）' : '';
  if (!getWorkerUrl()) return '模擬資料：尚未設定行情中繼（到「設定 → 行情中繼」填入網址）';
  if (marketDemo.has(sym)) return '模擬資料（行情中繼暫時無法連線）';
  return '';
}

async function marketKlines(sym, interval, { endTime, limit = 1000, signal } = {}) {
  if (isDemo(sym)) return demoKlines(sym, interval, endTime, limit);
  try {
    let q = `/market/klines?symbol=${encodeURIComponent(codeOf(sym))}&interval=${interval}&limit=${limit}`;
    if (endTime) q += `&end=${endTime}`;
    const j = await worker(q, { signal });
    noteMeta(sym, j.meta);
    return (j.bars || []).map(([t, o, h, l, c, v]) => ({ utc: t, open: o, high: h, low: l, close: c, volume: v || 0, quoteVolume: (v || 0) * c }));
  } catch (e) {
    if (e.name === 'AbortError' || e.status === 404 || e.status === 400 || endTime) throw e;
    marketDemo.add(sym);
    return demoKlines(sym, interval, endTime, limit);
  }
}

// ---------- quotes ----------
function quoteToTicker(sym, q) {
  return {
    symbol: sym, last: q.last, chg: q.chg, chgPct: q.chgPct, high: q.high, low: q.low, open: q.open, prevClose: q.prevClose,
    vol: q.vol, qvol: q.vol != null && q.last != null ? q.vol * q.last : null, time: q.time, currency: q.currency,
    exchange: q.exchange, source: q.source, delay: q.delay,
  };
}
function demoQuote(sym) {
  const { bars } = demoSeries(sym, '1h');
  const last = bars[bars.length - 1].close, prev = bars[bars.length - 25].close;
  const slice = bars.slice(-24);
  return { symbol: sym, last, prevClose: prev, open: slice[0].open, chg: last - prev, chgPct: (last / prev - 1) * 100, high: Math.max(...slice.map(b => b.high)), low: Math.min(...slice.map(b => b.low)), vol: null, qvol: null, demo: true };
}

// Quotes for non-crypto symbols. Returns [] if the worker is not configured (no fake prices in lists).
export async function fetchQuotes(syms, { demo = false } = {}) {
  syms = [...new Set(syms.filter(s => !isCrypto(s)))];
  if (!syms.length) return [];
  if (!getWorkerUrl()) return demo ? syms.map(demoQuote) : [];
  const out = [];
  const chunks = [];
  for (let i = 0; i < syms.length; i += 15) chunks.push(syms.slice(i, i + 15));
  await Promise.all(chunks.map(async ch => {
    try {
      const j = await worker('/market/quotes?symbols=' + ch.map(s => encodeURIComponent(codeOf(s))).join(','));
      for (const q of j.quotes || []) {
        if (q.error || q.last == null) continue;
        const sym = toSym(q.code);
        noteMeta(sym, q);
        out.push(quoteToTicker(sym, q));
      }
    } catch {}
  }));
  return out;
}

// ---------- search ----------
export async function searchMarkets(q, { signal } = {}) {
  if (!getWorkerUrl() || !q) return [];
  try {
    const j = await worker('/market/search?q=' + encodeURIComponent(q), { signal });
    return (j.results || []).map(r => {
      const sym = toSym(r.code);
      if (!metaStore[sym]?.name) noteMeta(sym, { name: r.name, exchange: r.exchange });
      return sym;
    });
  } catch { return []; }
}

// Full Taiwan listed + OTC list with Chinese names (cached a day).
export async function loadTwList() {
  const c = lsGet('hawk.twlist', null);
  if (c?.list?.length && Date.now() - c.at < 86400000) { loadTwNames(); return c.list; }
  if (!getWorkerUrl()) return c?.list || [];
  try {
    const j = await worker('/market/tw-list', { timeout: 20000 });
    if (j.list?.length) { lsSet('hawk.twlist', { at: Date.now(), list: j.list }); twNames = null; loadTwNames(); return j.list; }
  } catch {}
  return c?.list || [];
}

// ---------- live updates (all markets) ----------
const POLL_KLINE = 10000, POLL_QUOTE = 15000;
const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

// onBar({utc, open, high, low, close, volume, quoteVolume}); onState('live'|'delayed'|'reconnecting'|'demo')
export function subscribeKlines(sym, interval, onBar, onState = () => {}) {
  if (isCrypto(sym)) {
    const st = new Stream([`${sym.toLowerCase()}@kline_${interval}`], (_, d) => {
      const k = d.k; if (!k) return;
      onBar({ utc: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, quoteVolume: +k.q });
    }, onState);
    return { close: () => st.close() };
  }
  let closed = false, timer = null, fails = 0;
  const tick = async () => {
    if (closed) return;
    if (isDemo(sym)) {
      onState('demo');
      const ds = demoSeries(sym, interval);
      let last = ds.bars[ds.bars.length - 1];
      const now = Math.floor(Date.now() / 1000);
      if (now >= last.utc + ds.sec) { last = { utc: last.utc + ds.sec, open: last.close, high: last.close, low: last.close, close: last.close, volume: 0, quoteVolume: 0 }; ds.bars.push(last); }
      const c = last.close * (1 + (Math.random() - 0.5) * 0.0012);
      last.close = c; last.high = Math.max(last.high, c); last.low = Math.min(last.low, c); last.volume += Math.random() * 5;
      onBar({ ...last });
      timer = setTimeout(tick, 1000);
      return;
    }
    if (visible()) {
      try {
        const rows = await marketKlines(sym, interval, { limit: 3 });
        if (closed) return;
        fails = 0;
        for (const b of rows) onBar(b);
        onState(symbolMeta(sym).delay ? 'delayed' : 'live');
      } catch { fails++; onState('reconnecting'); }
    }
    timer = setTimeout(tick, Math.min(60000, POLL_KLINE * (1 + fails)));
  };
  timer = setTimeout(tick, isDemo(sym) ? 1000 : POLL_KLINE);
  if (!isDemo(sym)) onState(symbolMeta(sym).delay ? 'delayed' : 'live');
  return { close: () => { closed = true; clearTimeout(timer); } };
}

// onTicker(ticker) for every symbol, crypto via WebSocket, others polled.
export function subscribeTickers(syms, onTicker) {
  const crypto = syms.filter(isCrypto), other = syms.filter(s => !isCrypto(s));
  const st = crypto.length ? new Stream(crypto.map(s => s.toLowerCase() + '@miniTicker'), (_, d) => {
    const last = +d.c, open = +d.o;
    onTicker({ symbol: d.s, last, open, chg: last - open, chgPct: open ? (last / open - 1) * 100 : 0, high: +d.h, low: +d.l, vol: +d.v, qvol: +d.q });
  }) : null;
  let closed = false, timer = null;
  const poll = async () => {
    if (closed) return;
    if (visible() && getWorkerUrl()) {
      const qs = await fetchQuotes(other);
      if (closed) return;
      for (const t of qs) onTicker(t);
    }
    timer = setTimeout(poll, POLL_QUOTE);
  };
  if (other.length) poll();
  return { close: () => { closed = true; clearTimeout(timer); st?.close(); } };
}
