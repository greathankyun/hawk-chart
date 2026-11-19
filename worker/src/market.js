// 行情中繼：/market/*
// - Yahoo Finance 公開圖表資料（不需金鑰）：台股、美股、各國指數、原物料期貨、外匯、債券殖利率
// - 富果 Fugle（選配，設定 secret FUGLE_API_KEY 後啟用）：台股即時報價與當日分 K，取代 Yahoo 約 20 分鐘的延遲
//
//   GET /market/health
//   GET /market/klines?symbol=2330.TW&interval=1h&limit=1000[&end=unixSec]
//   GET /market/quotes?symbols=2330.TW,AAPL,GC=F
//   GET /market/search?q=台積
//   GET /market/tw-list        上市櫃全部股票代號與中文名稱
import { HttpError, cached, json } from './util.js';

const VERSION = 1;
const YH = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FUGLE = 'https://api.fugle.tw/marketdata/v1.0/stock';
const DAY = 86400;

// app interval -> Yahoo interval, window per request, how far back Yahoo keeps that resolution
export const IV = {
  '1m': { y: '1m', sec: 60, win: 7 * DAY, back: 29 * DAY, fugle: '1' },
  '5m': { y: '5m', sec: 300, win: 30 * DAY, back: 59 * DAY, fugle: '5' },
  '15m': { y: '15m', sec: 900, win: 59 * DAY, back: 59 * DAY, fugle: '15' },
  '30m': { y: '30m', sec: 1800, win: 59 * DAY, back: 59 * DAY, fugle: '30' },
  '1h': { y: '60m', sec: 3600, win: 365 * DAY, back: 729 * DAY, fugle: '60' },
  '4h': { y: '60m', sec: 14400, win: 729 * DAY, back: 729 * DAY, fugle: '60', agg: true },
  '1d': { y: '1d', sec: DAY, period: 'd' },
  '1w': { y: '1wk', sec: 7 * DAY, period: 'w' },
  '1M': { y: '1mo', sec: 30 * DAY, period: 'M' },
};

const isTW = code => /^\d{4,6}[A-Z]?\.(TW|TWO)$/.test(code);
const twCode = code => code.replace(/\.(TW|TWO)$/, '');
const hasFugle = env => !!(env && env.FUGLE_API_KEY);

function delayOf(code, env) {
  if (isTW(code)) return hasFugle(env) ? 0 : 20;
  if (/^\^TW/.test(code)) return 20;
  if (/=F$/.test(code)) return 10;
  return 0;
}

function checkCode(code) {
  if (!code || code.length > 24 || !/^[\w.^=\-]+$/.test(code)) throw new HttpError(400, '商品代號格式不正確');
  return code.toUpperCase();
}

// ---------- Yahoo ----------
async function yahooChart(code, params) {
  const qs = new URLSearchParams(params).toString();
  let lastErr;
  for (const host of YH) {
    try {
      const r = await fetch(`${host}/v8/finance/chart/${encodeURIComponent(code)}?${qs}`, {
        headers: { 'user-agent': UA, accept: 'application/json' },
      });
      if (r.status === 404) throw new HttpError(404, '找不到此商品：' + code);
      if (r.status === 400 || r.status === 422) return null; // range outside the data Yahoo keeps
      if (!r.ok) { lastErr = new HttpError(502, 'Yahoo HTTP ' + r.status); continue; }
      const j = await r.json();
      const res = j && j.chart && j.chart.result && j.chart.result[0];
      if (!res) {
        const d = j && j.chart && j.chart.error && j.chart.error.description;
        if (d && /delisted|not found|No data/i.test(d)) throw new HttpError(404, '找不到此商品：' + code);
        return null;
      }
      return res;
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new HttpError(502, 'Yahoo 無法連線');
}

export function parseBars(res) {
  if (!res) return [];
  const t = res.timestamp || [];
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const out = [];
  for (let i = 0; i < t.length; i++) {
    const o = q.open && q.open[i], h = q.high && q.high[i], l = q.low && q.low[i], c = q.close && q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    out.push([t[i], o, h, l, c, (q.volume && q.volume[i]) || 0]);
  }
  return out;
}

// Align every bar to a stable bucket start so that polling the latest bar always lands on the same timestamp.
// Daily/weekly/monthly bars are stamped at 00:00 UTC of the exchange-local date (same convention as Binance).
export function normalize(bars, iv, gmtoffset = 0) {
  const bucket = t => {
    if (iv.period) {
      const local = Math.floor((t + gmtoffset) / DAY) * DAY;
      if (iv.period === 'd') return local;
      const d = new Date(local * 1000);
      if (iv.period === 'w') return local - ((d.getUTCDay() + 6) % 7) * DAY; // Monday
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
    }
    return Math.floor(t / iv.sec) * iv.sec;
  };
  const out = [];
  for (const b of bars) {
    const t = bucket(b[0]);
    const last = out[out.length - 1];
    if (last && last[0] === t) {
      last[2] = Math.max(last[2], b[2]); last[3] = Math.min(last[3], b[3]); last[4] = b[4]; last[5] += b[5];
    } else if (!last || t > last[0]) out.push([t, b[1], b[2], b[3], b[4], b[5]]);
  }
  return out;
}

function metaOf(res, code, env, extra = {}) {
  const m = (res && res.meta) || {};
  return {
    code,
    name: m.shortName || m.longName || null,
    currency: m.currency || null,
    exchange: m.fullExchangeName || m.exchangeName || null,
    type: m.instrumentType || null,
    tz: m.exchangeTimezoneName || null,
    delay: delayOf(code, env),
    source: 'Yahoo',
    ...extra,
  };
}

// ---------- Fugle (optional, Taiwan realtime) ----------
async function fugle(env, path) {
  const r = await fetch(FUGLE + path, { headers: { 'X-API-KEY': env.FUGLE_API_KEY } });
  if (!r.ok) throw new HttpError(502, 'Fugle HTTP ' + r.status);
  return r.json();
}

// Fugle volumes are in 張 (1,000 shares); Yahoo reports shares.
const LOT = 1000;

async function fugleQuote(env, code) {
  const q = await fugle(env, `/intraday/quote/${twCode(code)}`);
  const last = q.lastPrice ?? q.closePrice ?? (q.lastTrade && q.lastTrade.price);
  if (last == null) return null;
  const prev = q.previousClose ?? q.referencePrice;
  return {
    name: q.name || null,
    last,
    prevClose: prev ?? null,
    open: q.openPrice ?? null,
    high: q.highPrice ?? null,
    low: q.lowPrice ?? null,
    vol: q.total && q.total.tradeVolume != null ? q.total.tradeVolume * LOT : null,
    time: q.lastUpdated ? Math.floor(q.lastUpdated / 1e6) : null,
  };
}

async function fugleIntraday(env, code, iv) {
  const j = await fugle(env, `/intraday/candles/${twCode(code)}?timeframe=${iv.fugle}`);
  const rows = (j && j.data) || [];
  return rows
    .map(r => [Math.floor(Date.parse(r.date) / 1000), r.open, r.high, r.low, r.close, (r.volume || 0) * LOT])
    .filter(b => isFinite(b[0]) && b[1] != null)
    .sort((a, b) => a[0] - b[0]);
}

// ---------- routes ----------
async function klines(url, env) {
  const code = checkCode(url.searchParams.get('symbol'));
  const ivKey = url.searchParams.get('interval') || '1h';
  const iv = IV[ivKey];
  if (!iv) throw new HttpError(400, '不支援的週期：' + ivKey);
  const limit = Math.max(1, Math.min(1500, parseInt(url.searchParams.get('limit'), 10) || 500));
  const end = parseInt(url.searchParams.get('end'), 10) || 0;
  const now = Math.floor(Date.now() / 1000);
  const p2 = end || now + 60;
  let p1;
  if (iv.back) {
    const earliest = now - iv.back;
    if (p2 <= earliest + iv.sec) return { symbol: code, interval: ivKey, bars: [], meta: metaOf(null, code, env) };
    p1 = Math.max(earliest, p2 - iv.win);
  } else {
    p1 = Math.max(0, p2 - Math.ceil(limit * iv.sec * 1.6));
  }
  const res = await yahooChart(code, { period1: p1, period2: p2, interval: iv.y, includePrePost: 'false' });
  const gmt = (res && res.meta && res.meta.gmtoffset) || 0;
  let bars = normalize(parseBars(res), iv, gmt);
  if (end) bars = bars.filter(b => b[0] < end);
  let source = 'Yahoo';

  if (!end && isTW(code) && hasFugle(env)) {
    try {
      if (!iv.period) {
        const live = normalize(await fugleIntraday(env, code, iv), iv, gmt);
        if (live.length) {
          bars = bars.filter(b => b[0] < live[0][0]).concat(live);
          source = 'Fugle';
        }
      } else {
        const q = await fugleQuote(env, code);
        if (q && bars.length) {
          const today = normalize([[q.time || now, 0, 0, 0, 0, 0]], iv, gmt)[0][0];
          const last = bars[bars.length - 1];
          const bar = [today, q.open ?? q.last, q.high ?? q.last, q.low ?? q.last, q.last, q.vol ?? 0];
          if (last[0] === today) {
            if (iv.period === 'd') bars[bars.length - 1] = bar;
            else { last[2] = Math.max(last[2], bar[2]); last[3] = Math.min(last[3], bar[3]); last[4] = q.last; }
          } else if (today > last[0]) bars.push(bar);
          source = 'Fugle';
        }
      }
    } catch { /* keep Yahoo data */ }
  }
  bars = bars.slice(-limit);
  return { symbol: code, interval: ivKey, bars, meta: metaOf(res, code, env, { source, delay: source === 'Fugle' ? 0 : delayOf(code, env) }) };
}

async function yahooQuote(code, env) {
  const res = await yahooChart(code, { range: '5d', interval: '1d' });
  if (!res) return null;
  const m = res.meta || {};
  const bars = normalize(parseBars(res), IV['1d'], m.gmtoffset || 0);
  const lastBar = bars[bars.length - 1];
  const last = m.regularMarketPrice ?? (lastBar && lastBar[4]);
  if (last == null) return null;
  let prev = null, isToday = false;
  if (lastBar) {
    const today = normalize([[m.regularMarketTime || lastBar[0], 0, 0, 0, 0, 0]], IV['1d'], m.gmtoffset || 0)[0][0];
    isToday = lastBar[0] === today;
    prev = isToday ? (bars.length > 1 ? bars[bars.length - 2][4] : null) : lastBar[4];
  }
  if (prev == null) prev = m.chartPreviousClose ?? m.previousClose ?? null;
  return {
    ...metaOf(res, code, env),
    last,
    prevClose: prev,
    open: isToday ? lastBar[1] : null,
    high: m.regularMarketDayHigh ?? (lastBar && lastBar[2]) ?? null,
    low: m.regularMarketDayLow ?? (lastBar && lastBar[3]) ?? null,
    vol: m.regularMarketVolume ?? (lastBar && lastBar[5]) ?? null,
    time: m.regularMarketTime || null,
  };
}

async function quote(code, env) {
  let q = null, err = null;
  try { q = await yahooQuote(code, env); } catch (e) { err = e; }
  if (isTW(code) && hasFugle(env)) {
    try {
      const f = await fugleQuote(env, code);
      if (f) q = { ...(q || metaOf(null, code, env)), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v != null)), source: 'Fugle', delay: 0 };
    } catch { /* keep Yahoo */ }
  }
  if (!q) return { code, error: (err && err.message) || '無資料' };
  const chg = q.prevClose != null ? q.last - q.prevClose : null;
  return { ...q, chg, chgPct: chg != null && q.prevClose ? (chg / q.prevClose) * 100 : null };
}

async function quotes(url, env) {
  const list = (url.searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length) throw new HttpError(400, '缺少 symbols');
  if (list.length > 15) throw new HttpError(400, '一次最多 15 個商品');
  const codes = list.map(checkCode);
  return { quotes: await Promise.all(codes.map(c => quote(c, env))) };
}

const TYPE_OK = new Set(['EQUITY', 'ETF', 'INDEX', 'FUTURE', 'CURRENCY', 'MUTUALFUND']);
async function search(url) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
  if (!q) return { results: [] };
  let lastErr;
  for (const host of YH) {
    try {
      const r = await fetch(`${host}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0&listsCount=0&enableFuzzyQuery=false`, {
        headers: { 'user-agent': UA, accept: 'application/json' },
      });
      if (!r.ok) { lastErr = new HttpError(502, 'Yahoo HTTP ' + r.status); continue; }
      const j = await r.json();
      const results = ((j && j.quotes) || [])
        .filter(x => x.symbol && TYPE_OK.has(x.quoteType))
        .map(x => ({ code: x.symbol, name: x.shortname || x.longname || x.symbol, type: x.quoteType, exchange: x.exchDisp || x.exchange || '' }));
      return { results };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Full list of Taiwan listed (上市) and OTC (上櫃) securities with Chinese names, from the official open APIs.
async function twList() {
  const get = async u => {
    try {
      const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'application/json' } });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  };
  const [twse, tpex] = await Promise.all([
    get('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'),
    get('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'),
  ]);
  const out = [], seen = new Set();
  const add = (code, name, mkt) => {
    code = String(code || '').trim(); name = String(name || '').trim();
    if (!/^\d{4,6}[A-Z]?$/.test(code) || !name || seen.has(code)) return;
    seen.add(code); out.push([code, name, mkt]);
  };
  for (const r of Array.isArray(twse) ? twse : []) add(r.Code, r.Name, 'TW');
  for (const r of Array.isArray(tpex) ? tpex : []) add(r.SecuritiesCompanyCode ?? r.Code, r.CompanyName ?? r.Name, 'TWO');
  if (!out.length) throw new HttpError(502, '無法取得台股清單');
  return { list: out };
}

export async function handle(req, env, ctx, url) {
  if (req.method !== 'GET') throw new HttpError(405, 'GET only');
  const p = url.pathname.replace(/^\/market\/?/, '');
  switch (p) {
    case 'health': return json({ ok: true, version: VERSION, providers: { yahoo: true, fugle: hasFugle(env) } });
    case 'klines': {
      const hist = url.searchParams.has('end');
      return cached(req, ctx, hist ? 3600 : 8, () => klines(url, env));
    }
    case 'quotes': return cached(req, ctx, 8, () => quotes(url, env));
    case 'search': return cached(req, ctx, 3600, () => search(url));
    case 'tw-list': return cached(req, ctx, 43200, () => twList());
    default: throw new HttpError(404, 'not found');
  }
}
