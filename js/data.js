// Market data: Binance public REST + WebSocket, with a simulated fallback
// so the app still works (clearly labelled) when the exchange is unreachable.

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
  let p = DEMO_BASE[symbol] || 10 + (seedOf(symbol) % 500);
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
