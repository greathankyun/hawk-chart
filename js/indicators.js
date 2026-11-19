// Technical indicator math. Every function takes an array of bars
// ({time, open, high, low, close, volume}) and returns arrays aligned to it,
// with `null` where the indicator is not yet defined.

export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null, seed = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) {
      seed += v;
      if (i === n - 1 || (i >= n - 1 && prev == null)) {
        prev = seed / n;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function emaOfSparse(values, n) {
  // EMA over an array that starts with nulls (e.g. MACD line).
  const start = values.findIndex(v => v != null);
  if (start < 0) return values.map(() => null);
  const tail = ema(values.slice(start), n);
  return values.slice(0, start).map(() => null).concat(tail);
}

export function stdev(values, n, means) {
  const out = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    const m = means[i];
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (values[j] - m) ** 2;
    out[i] = Math.sqrt(s / n);
  }
  return out;
}

export function bollinger(bars, n = 20, mult = 2) {
  const c = bars.map(b => b.close);
  const mid = sma(c, n);
  const sd = stdev(c, n, mid);
  return {
    mid,
    upper: mid.map((m, i) => (m == null ? null : m + mult * sd[i])),
    lower: mid.map((m, i) => (m == null ? null : m - mult * sd[i])),
  };
}

export function rsi(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    if (i <= n) {
      gain += g; loss += l;
      if (i === n) { gain /= n; loss /= n; out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss); }
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

export function macd(bars, fast = 12, slow = 26, signal = 9) {
  const c = bars.map(b => b.close);
  const f = ema(c, fast), s = ema(c, slow);
  const line = c.map((_, i) => (f[i] == null || s[i] == null ? null : f[i] - s[i]));
  const sig = emaOfSparse(line, signal);
  const hist = line.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i]));
  return { line, signal: sig, hist };
}

// Taiwan-style KD (stochastic) with smoothing 1/3: K = 2/3·K' + 1/3·RSV
export function kd(bars, n = 9, kS = 3, dS = 3) {
  const K = new Array(bars.length).fill(null), D = new Array(bars.length).fill(null);
  let k = 50, d = 50;
  for (let i = 0; i < bars.length; i++) {
    if (i < n - 1) continue;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) { hi = Math.max(hi, bars[j].high); lo = Math.min(lo, bars[j].low); }
    const rsv = hi === lo ? 50 : ((bars[i].close - lo) / (hi - lo)) * 100;
    k = ((kS - 1) * k + rsv) / kS;
    d = ((dS - 1) * d + k) / dS;
    K[i] = k; D[i] = d;
  }
  return { k: K, d: D };
}

export function atr(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  let prev = null;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    const tr = Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close));
    if (i < n) { prev = (prev || 0) + tr; if (i === n - 1) { prev /= n; out[i] = prev; } }
    else { prev = (prev * (n - 1) + tr) / n; out[i] = prev; }
  }
  return out;
}

export function vwap(bars) {
  // Rolling VWAP that resets each UTC day (for intraday) — on daily+ it is cumulative.
  const out = new Array(bars.length).fill(null);
  let pv = 0, vol = 0, day = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const d = Math.floor(b.utc / 86400);
    if (d !== day && b.intraday) { pv = 0; vol = 0; day = d; }
    const tp = (b.high + b.low + b.close) / 3;
    pv += tp * b.volume; vol += b.volume;
    out[i] = vol ? pv / vol : tp;
  }
  return out;
}

export function heikinAshi(bars) {
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({ ...b, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close) });
  }
  return out;
}

// ---------- catalog ----------
// Each entry: how to compute, what series to draw, and where (overlay vs own pane).
export const CATALOG = {
  MA:   { name: '移動平均 MA', overlay: true, params: [{ k: 'n', label: '週期', def: 20 }], colors: ['#f5a524'] },
  EMA:  { name: '指數移動平均 EMA', overlay: true, params: [{ k: 'n', label: '週期', def: 50 }], colors: ['#38bdf8'] },
  BOLL: { name: '布林通道 BOLL', overlay: true, params: [{ k: 'n', label: '週期', def: 20 }, { k: 'm', label: '倍數', def: 2 }], colors: ['#a78bfa'] },
  VWAP: { name: '成交量加權均價 VWAP', overlay: true, params: [], colors: ['#f472b6'] },
  VOL:  { name: '成交量 VOL', overlay: true, params: [], colors: ['#64748b'] },
  RSI:  { name: '相對強弱 RSI', overlay: false, params: [{ k: 'n', label: '週期', def: 14 }], colors: ['#c084fc'] },
  MACD: { name: 'MACD', overlay: false, params: [{ k: 'f', label: '快', def: 12 }, { k: 's', label: '慢', def: 26 }, { k: 'g', label: '訊號', def: 9 }], colors: ['#38bdf8'] },
  KD:   { name: '隨機指標 KD', overlay: false, params: [{ k: 'n', label: '週期', def: 9 }], colors: ['#f5a524'] },
  ATR:  { name: '真實波幅 ATR', overlay: false, params: [{ k: 'n', label: '週期', def: 14 }], colors: ['#2dd4bf'] },
};

export const DEFAULT_INDICATORS = [
  { id: 'i1', type: 'MA', p: { n: 20 }, color: '#f5a524' },
  { id: 'i2', type: 'MA', p: { n: 60 }, color: '#38bdf8' },
  { id: 'i3', type: 'VOL', p: {}, color: '#64748b' },
  { id: 'i4', type: 'MACD', p: { f: 12, s: 26, g: 9 }, color: '#38bdf8' },
];

export function label(ind) {
  const vals = Object.values(ind.p || {});
  return ind.type + (vals.length ? ' ' + vals.join(',') : '');
}
