// Technical indicator math (pure functions, no DOM — also imported by the
// Cloudflare Worker for server-side alerts). Every bar-based function takes an
// array of bars ({utc, open, high, low, close, volume}) and returns arrays
// aligned to it, with `null` where the indicator is not yet defined.

// ---------- array primitives ----------
const nul = n => new Array(n).fill(null);
const isNum = v => v != null && !Number.isNaN(v);

export function sma(values, n) {
  const out = nul(values.length);
  let sum = 0, cnt = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isNum(v)) { sum += v; cnt++; }
    if (i >= n) { const o = values[i - n]; if (isNum(o)) { sum -= o; cnt--; } }
    if (i >= n - 1 && cnt === n) out[i] = sum / n;
  }
  return out;
}

// EMA seeded with the SMA of the first n defined values (skips leading nulls).
export function ema(values, n, alpha) {
  const out = nul(values.length);
  const k = alpha ?? 2 / (n + 1);
  let prev = null, seed = 0, cnt = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v)) { if (prev != null) out[i] = prev; continue; }
    if (prev == null) {
      seed += v; cnt++;
      if (cnt === n) { prev = seed / n; out[i] = prev; }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}
export const rma = (values, n) => ema(values, n, 1 / n); // Wilder smoothing

export function wma(values, n) {
  const out = nul(values.length);
  const den = (n * (n + 1)) / 2;
  for (let i = n - 1; i < values.length; i++) {
    let s = 0, ok = true;
    for (let j = 0; j < n; j++) { const v = values[i - j]; if (!isNum(v)) { ok = false; break; } s += v * (n - j); }
    if (ok) out[i] = s / den;
  }
  return out;
}
export function hma(values, n) {
  const half = wma(values, Math.max(1, Math.round(n / 2))), full = wma(values, n);
  return wma(half.map((h, i) => (isNum(h) && isNum(full[i]) ? 2 * h - full[i] : null)), Math.max(1, Math.round(Math.sqrt(n))));
}
export function dema(values, n) { const e1 = ema(values, n), e2 = ema(e1, n); return e1.map((v, i) => (isNum(v) && isNum(e2[i]) ? 2 * v - e2[i] : null)); }
export function tema(values, n) { const e1 = ema(values, n), e2 = ema(e1, n), e3 = ema(e2, n); return e1.map((v, i) => (isNum(e3[i]) ? 3 * v - 3 * e2[i] + e3[i] : null)); }
export function vwma(values, vols, n) {
  const pv = sma(values.map((v, i) => v * vols[i]), n), vv = sma(vols, n);
  return pv.map((v, i) => (isNum(v) && vv[i] ? v / vv[i] : null));
}
export function kama(values, n = 10, fast = 2, slow = 30) {
  const out = nul(values.length);
  const fs = 2 / (fast + 1), ss = 2 / (slow + 1);
  let prev = null;
  for (let i = n; i < values.length; i++) {
    const change = Math.abs(values[i] - values[i - n]);
    let vol = 0; for (let j = i - n + 1; j <= i; j++) vol += Math.abs(values[j] - values[j - 1]);
    const er = vol ? change / vol : 0;
    const sc = (er * (fs - ss) + ss) ** 2;
    prev = prev == null ? values[i - 1] : prev;
    prev = prev + sc * (values[i] - prev);
    out[i] = prev;
  }
  return out;
}
export function stdev(values, n, means) {
  means = means || sma(values, n);
  const out = nul(values.length);
  for (let i = n - 1; i < values.length; i++) {
    const m = means[i]; if (!isNum(m)) continue;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (values[j] - m) ** 2;
    out[i] = Math.sqrt(s / n);
  }
  return out;
}
export function highest(values, n) {
  const out = nul(values.length);
  for (let i = n - 1; i < values.length; i++) { let m = -Infinity; for (let j = i - n + 1; j <= i; j++) if (values[j] > m) m = values[j]; out[i] = m; }
  return out;
}
export function lowest(values, n) {
  const out = nul(values.length);
  for (let i = n - 1; i < values.length; i++) { let m = Infinity; for (let j = i - n + 1; j <= i; j++) if (values[j] < m) m = values[j]; out[i] = m; }
  return out;
}
export function change(values, n = 1) { return values.map((v, i) => (i >= n && isNum(v) && isNum(values[i - n]) ? v - values[i - n] : null)); }
export function roc(values, n = 1) { return values.map((v, i) => (i >= n && isNum(v) && values[i - n] ? (v / values[i - n] - 1) * 100 : null)); }
export function sum(values, n) { const s = sma(values, n); return s.map(v => (v == null ? null : v * n)); }
export function linreg(values, n) {
  const out = nul(values.length);
  for (let i = n - 1; i < values.length; i++) {
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let j = 0; j < n; j++) { const y = values[i - n + 1 + j]; sx += j; sy += y; sxy += j * y; sxx += j * j; }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
    out[i] = (sy - slope * sx) / n + slope * (n - 1);
  }
  return out;
}
export function crossover(a, b) {
  const B = typeof b === 'number' ? a.map(() => b) : b;
  return a.map((v, i) => i > 0 && isNum(v) && isNum(B[i]) && isNum(a[i - 1]) && isNum(B[i - 1]) && v > B[i] && a[i - 1] <= B[i - 1]);
}
export function crossunder(a, b) {
  const B = typeof b === 'number' ? a.map(() => b) : b;
  return a.map((v, i) => i > 0 && isNum(v) && isNum(B[i]) && isNum(a[i - 1]) && isNum(B[i - 1]) && v < B[i] && a[i - 1] >= B[i - 1]);
}

const src = (bars, k) => bars.map(b => (k === 'hl2' ? (b.high + b.low) / 2 : k === 'hlc3' ? (b.high + b.low + b.close) / 3 : k === 'ohlc4' ? (b.open + b.high + b.low + b.close) / 4 : b[k || 'close']));
export const closes = bars => bars.map(b => b.close);
const trueRange = bars => bars.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))));

// ---------- bar-based indicators ----------
export function bollinger(bars, n = 20, mult = 2) {
  const c = closes(bars);
  const mid = sma(c, n);
  const sd = stdev(c, n, mid);
  return {
    mid,
    upper: mid.map((m, i) => (m == null ? null : m + mult * sd[i])),
    lower: mid.map((m, i) => (m == null ? null : m - mult * sd[i])),
  };
}
export function rsiOf(values, n = 14) {
  const out = nul(values.length);
  let gain = 0, loss = 0, cnt = 0, start = values.findIndex(isNum);
  if (start < 0) return out;
  for (let i = start + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    cnt++;
    if (cnt <= n) {
      gain += g; loss += l;
      if (cnt === n) { gain /= n; loss /= n; out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss); }
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}
export const rsi = (bars, n = 14) => rsiOf(closes(bars), n);

export function macd(bars, fast = 12, slow = 26, signal = 9) {
  const c = Array.isArray(bars) && typeof bars[0] === 'number' ? bars : closes(bars);
  const f = ema(c, fast), s = ema(c, slow);
  const line = c.map((_, i) => (f[i] == null || s[i] == null ? null : f[i] - s[i]));
  const sig = ema(line, signal);
  const hist = line.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i]));
  return { line, signal: sig, hist };
}

// Taiwan-style KD (stochastic) with smoothing 1/3: K = 2/3·K' + 1/3·RSV
export function kd(bars, n = 9, kS = 3, dS = 3) {
  const K = nul(bars.length), D = nul(bars.length);
  let k = 50, d = 50;
  const hh = highest(bars.map(b => b.high), n), ll = lowest(bars.map(b => b.low), n);
  for (let i = n - 1; i < bars.length; i++) {
    const rsv = hh[i] === ll[i] ? 50 : ((bars[i].close - ll[i]) / (hh[i] - ll[i])) * 100;
    k = ((kS - 1) * k + rsv) / kS;
    d = ((dS - 1) * d + k) / dS;
    K[i] = k; D[i] = d;
  }
  return { k: K, d: D };
}
// Classic full stochastic (%K smoothed by SMA, %D = SMA of %K)
export function stoch(bars, n = 14, kS = 3, dS = 3) {
  const hh = highest(bars.map(b => b.high), n), ll = lowest(bars.map(b => b.low), n);
  const raw = bars.map((b, i) => (hh[i] == null ? null : hh[i] === ll[i] ? 50 : ((b.close - ll[i]) / (hh[i] - ll[i])) * 100));
  const k = sma(raw, kS);
  return { k, d: sma(k, dS) };
}
export function stochRsi(bars, rn = 14, sn = 14, kS = 3, dS = 3) {
  const r = rsi(bars, rn);
  const hh = highest(r.map(v => v ?? NaN), sn), ll = lowest(r.map(v => v ?? NaN), sn);
  const raw = r.map((v, i) => (!isNum(v) || !isNum(hh[i]) || !isNum(ll[i]) ? null : hh[i] === ll[i] ? 50 : ((v - ll[i]) / (hh[i] - ll[i])) * 100));
  const k = sma(raw, kS);
  return { k, d: sma(k, dS) };
}
export function atr(bars, n = 14) { return rma(trueRange(bars), n); }
export function vwap(bars) {
  // Resets each UTC day for intraday bars; cumulative on daily+.
  const out = nul(bars.length);
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
export function cci(bars, n = 20) {
  const tp = src(bars, 'hlc3'), m = sma(tp, n);
  return tp.map((v, i) => {
    if (m[i] == null) return null;
    let md = 0; for (let j = i - n + 1; j <= i; j++) md += Math.abs(tp[j] - m[i]);
    md /= n; return md ? (v - m[i]) / (0.015 * md) : 0;
  });
}
export function willr(bars, n = 14) {
  const hh = highest(bars.map(b => b.high), n), ll = lowest(bars.map(b => b.low), n);
  return bars.map((b, i) => (hh[i] == null ? null : hh[i] === ll[i] ? -50 : ((hh[i] - b.close) / (hh[i] - ll[i])) * -100));
}
export function dmi(bars, n = 14, adxN = 14) {
  const up = nul(bars.length).map((_, i) => (i ? bars[i].high - bars[i - 1].high : 0));
  const dn = nul(bars.length).map((_, i) => (i ? bars[i - 1].low - bars[i].low : 0));
  const pdm = up.map((u, i) => (u > dn[i] && u > 0 ? u : 0)), mdm = dn.map((d, i) => (d > up[i] && d > 0 ? d : 0));
  const tr = rma(trueRange(bars), n), sp = rma(pdm, n), sm = rma(mdm, n);
  const pdi = tr.map((t, i) => (t ? (100 * sp[i]) / t : null)), mdi = tr.map((t, i) => (t ? (100 * sm[i]) / t : null));
  const dx = pdi.map((p, i) => (isNum(p) && isNum(mdi[i]) && p + mdi[i] ? (100 * Math.abs(p - mdi[i])) / (p + mdi[i]) : null));
  return { pdi, mdi, adx: rma(dx, adxN) };
}
export function aroon(bars, n = 25) {
  const U = nul(bars.length), Dn = nul(bars.length);
  for (let i = n; i < bars.length; i++) {
    let hi = i, lo = i;
    for (let j = i - n; j <= i; j++) { if (bars[j].high >= bars[hi].high) hi = j; if (bars[j].low <= bars[lo].low) lo = j; }
    U[i] = (100 * (n - (i - hi))) / n; Dn[i] = (100 * (n - (i - lo))) / n;
  }
  return { up: U, down: Dn };
}
export function obv(bars) { let v = 0; return bars.map((b, i) => (v += i === 0 ? 0 : b.close > bars[i - 1].close ? b.volume : b.close < bars[i - 1].close ? -b.volume : 0)); }
export function adl(bars) { let v = 0; return bars.map(b => (v += b.high === b.low ? 0 : (((b.close - b.low) - (b.high - b.close)) / (b.high - b.low)) * b.volume)); }
export function cmf(bars, n = 20) {
  const mfv = bars.map(b => (b.high === b.low ? 0 : (((b.close - b.low) - (b.high - b.close)) / (b.high - b.low)) * b.volume));
  const a = sum(mfv, n), v = sum(bars.map(b => b.volume), n);
  return a.map((x, i) => (isNum(x) && v[i] ? x / v[i] : null));
}
export function mfi(bars, n = 14) {
  const tp = src(bars, 'hlc3');
  const out = nul(bars.length);
  for (let i = n; i < bars.length; i++) {
    let pos = 0, neg = 0;
    for (let j = i - n + 1; j <= i; j++) { const f = tp[j] * bars[j].volume; if (tp[j] > tp[j - 1]) pos += f; else if (tp[j] < tp[j - 1]) neg += f; }
    out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  return out;
}
export function psar(bars, step = 0.02, max = 0.2) {
  const out = nul(bars.length);
  if (bars.length < 2) return out;
  let long = bars[1].close >= bars[0].close, af = step, ep = long ? bars[0].high : bars[0].low, sar = long ? bars[0].low : bars[0].high;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    sar = sar + af * (ep - sar);
    if (long) {
      sar = Math.min(sar, bars[i - 1].low, i > 1 ? bars[i - 2].low : bars[i - 1].low);
      if (b.low < sar) { long = false; sar = ep; ep = b.low; af = step; }
      else if (b.high > ep) { ep = b.high; af = Math.min(max, af + step); }
    } else {
      sar = Math.max(sar, bars[i - 1].high, i > 1 ? bars[i - 2].high : bars[i - 1].high);
      if (b.high > sar) { long = true; sar = ep; ep = b.high; af = step; }
      else if (b.low < ep) { ep = b.low; af = Math.min(max, af + step); }
    }
    out[i] = sar;
  }
  return out;
}
export function supertrend(bars, n = 10, mult = 3) {
  const a = atr(bars, n);
  const line = nul(bars.length), dir = nul(bars.length);
  let fu = null, fl = null, d = 1;
  for (let i = 0; i < bars.length; i++) {
    if (a[i] == null) continue;
    const hl2 = (bars[i].high + bars[i].low) / 2;
    const bu = hl2 + mult * a[i], bl = hl2 - mult * a[i];
    const pc = i ? bars[i - 1].close : bars[i].close;
    fu = fu == null || bu < fu || pc > fu ? bu : fu;
    fl = fl == null || bl > fl || pc < fl ? bl : fl;
    if (d === 1 && bars[i].close < fl) d = -1;
    else if (d === -1 && bars[i].close > fu) d = 1;
    line[i] = d === 1 ? fl : fu; dir[i] = d;
  }
  return { up: line.map((v, i) => (dir[i] === 1 ? v : null)), down: line.map((v, i) => (dir[i] === -1 ? v : null)), line, dir };
}
export function ichimoku(bars, t = 9, k = 26, s = 52) {
  const mid = n => { const h = highest(bars.map(b => b.high), n), l = lowest(bars.map(b => b.low), n); return h.map((v, i) => (v == null ? null : (v + l[i]) / 2)); };
  const tenkan = mid(t), kijun = mid(k), sb = mid(s);
  const shift = (arr, by) => arr.map((_, i) => (i - by >= 0 ? arr[i - by] : null));
  const sa = tenkan.map((v, i) => (v == null || kijun[i] == null ? null : (v + kijun[i]) / 2));
  return { tenkan, kijun, spanA: shift(sa, k - 1), spanB: shift(sb, k - 1), chikou: bars.map((_, i) => (bars[i + k - 1] ? bars[i + k - 1].close : null)) };
}
export function keltner(bars, n = 20, mult = 2, atrN = 10) {
  const m = ema(closes(bars), n), a = atr(bars, atrN);
  return { mid: m, upper: m.map((v, i) => (isNum(v) && isNum(a[i]) ? v + mult * a[i] : null)), lower: m.map((v, i) => (isNum(v) && isNum(a[i]) ? v - mult * a[i] : null)) };
}
export function donchian(bars, n = 20) {
  const u = highest(bars.map(b => b.high), n), l = lowest(bars.map(b => b.low), n);
  return { upper: u, lower: l, mid: u.map((v, i) => (v == null ? null : (v + l[i]) / 2)) };
}
export function awesome(bars) { const m = src(bars, 'hl2'); const f = sma(m, 5), s = sma(m, 34); return f.map((v, i) => (isNum(v) && isNum(s[i]) ? v - s[i] : null)); }
export function ultimate(bars, a = 7, b = 14, c = 28) {
  const bp = bars.map((x, i) => x.close - Math.min(x.low, i ? bars[i - 1].close : x.low));
  const tr = trueRange(bars);
  const avg = n => { const s1 = sum(bp, n), s2 = sum(tr, n); return s1.map((v, i) => (isNum(v) && s2[i] ? v / s2[i] : null)); };
  const A = avg(a), B = avg(b), C = avg(c);
  return A.map((v, i) => (isNum(C[i]) ? (100 * (4 * v + 2 * B[i] + C[i])) / 7 : null));
}
export function trix(bars, n = 15) { const e = ema(ema(ema(closes(bars), n), n), n); return roc(e, 1); }
export function cmo(bars, n = 9) {
  const c = closes(bars), out = nul(c.length);
  for (let i = n; i < c.length; i++) { let u = 0, d = 0; for (let j = i - n + 1; j <= i; j++) { const x = c[j] - c[j - 1]; if (x > 0) u += x; else d -= x; } out[i] = u + d ? (100 * (u - d)) / (u + d) : 0; }
  return out;
}
export function tsi(bars, r = 25, s = 13) {
  const m = change(closes(bars)), a = m.map(v => (v == null ? null : Math.abs(v)));
  const n1 = ema(ema(m, r), s), d1 = ema(ema(a, r), s);
  return n1.map((v, i) => (isNum(v) && d1[i] ? (100 * v) / d1[i] : null));
}
export function fisher(bars, n = 9) {
  const hl = src(bars, 'hl2'), hh = highest(hl, n), ll = lowest(hl, n);
  const out = nul(bars.length); let v = 0, f = 0;
  for (let i = n - 1; i < bars.length; i++) {
    v = 0.66 * ((hl[i] - ll[i]) / ((hh[i] - ll[i]) || 1) - 0.5) + 0.67 * v;
    v = Math.max(-0.999, Math.min(0.999, v));
    f = 0.5 * Math.log((1 + v) / (1 - v)) + 0.5 * f; out[i] = f;
  }
  return out;
}
export function vortex(bars, n = 14) {
  const vp = bars.map((b, i) => (i ? Math.abs(b.high - bars[i - 1].low) : 0)), vm = bars.map((b, i) => (i ? Math.abs(b.low - bars[i - 1].high) : 0));
  const tr = sum(trueRange(bars), n), P = sum(vp, n), M = sum(vm, n);
  return { plus: P.map((v, i) => (tr[i] ? v / tr[i] : null)), minus: M.map((v, i) => (tr[i] ? v / tr[i] : null)) };
}
export function histVol(bars, n = 20, annual = 365) {
  const lr = bars.map((b, i) => (i ? Math.log(b.close / bars[i - 1].close) : null));
  const sd = stdev(lr.map(v => v ?? 0), n);
  return sd.map((v, i) => (v == null || i < n ? null : v * Math.sqrt(annual) * 100));
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
// Floor pivots from the previous day (intraday) / previous bar (daily+)
export function pivots(bars) {
  const P = nul(bars.length), R1 = nul(bars.length), S1 = nul(bars.length), R2 = nul(bars.length), S2 = nul(bars.length);
  let cur = null, prev = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const key = b.intraday ? Math.floor(b.utc / 86400) : i;
    if (!cur || cur.key !== key) { prev = cur; cur = { key, h: b.high, l: b.low, c: b.close }; }
    else { cur.h = Math.max(cur.h, b.high); cur.l = Math.min(cur.l, b.low); cur.c = b.close; }
    if (prev) {
      const p = (prev.h + prev.l + prev.c) / 3;
      P[i] = p; R1[i] = 2 * p - prev.l; S1[i] = 2 * p - prev.h; R2[i] = p + (prev.h - prev.l); S2[i] = p - (prev.h - prev.l);
    }
  }
  return { P, R1, S1, R2, S2 };
}

// ---------- catalog ----------
// outputs: { n: legend name, kind: 'line'|'hist'|'dots'|'area', c: color (or 'main' = user color), style: 0..4, w: width }
// levels: horizontal guide lines for oscillators; fmt: 'price' (same decimals as price) | 'num' | 'vol'
const P = (k, label, def, step) => ({ k, label, def, step });
const C = bars => closes(bars);
export const GROUPS = { trend: '趨勢／均線', band: '通道／帶狀', osc: '擺盪', vol: '成交量', volat: '波動', other: '其他' };

export const CATALOG = {
  MA:   { name: '移動平均 MA', g: 'trend', overlay: true, params: [P('n', '週期', 20)], colors: ['#f5a524'], out: [{ n: 'MA' }], calc: (b, p) => [sma(C(b), p.n)] },
  EMA:  { name: '指數移動平均 EMA', g: 'trend', overlay: true, params: [P('n', '週期', 50)], colors: ['#38bdf8'], out: [{ n: 'EMA' }], calc: (b, p) => [ema(C(b), p.n)] },
  WMA:  { name: '加權移動平均 WMA', g: 'trend', overlay: true, params: [P('n', '週期', 20)], colors: ['#facc15'], out: [{ n: 'WMA' }], calc: (b, p) => [wma(C(b), p.n)] },
  HMA:  { name: '赫爾均線 HMA', g: 'trend', overlay: true, params: [P('n', '週期', 21)], colors: ['#2dd4bf'], out: [{ n: 'HMA' }], calc: (b, p) => [hma(C(b), p.n)] },
  DEMA: { name: '雙指數均線 DEMA', g: 'trend', overlay: true, params: [P('n', '週期', 20)], colors: ['#fb923c'], out: [{ n: 'DEMA' }], calc: (b, p) => [dema(C(b), p.n)] },
  TEMA: { name: '三指數均線 TEMA', g: 'trend', overlay: true, params: [P('n', '週期', 20)], colors: ['#e879f9'], out: [{ n: 'TEMA' }], calc: (b, p) => [tema(C(b), p.n)] },
  SMMA: { name: '平滑均線 SMMA', g: 'trend', overlay: true, params: [P('n', '週期', 14)], colors: ['#a3e635'], out: [{ n: 'SMMA' }], calc: (b, p) => [rma(C(b), p.n)] },
  VWMA: { name: '量加權均線 VWMA', g: 'trend', overlay: true, params: [P('n', '週期', 20)], colors: ['#f472b6'], out: [{ n: 'VWMA' }], calc: (b, p) => [vwma(C(b), b.map(x => x.volume), p.n)] },
  KAMA: { name: '考夫曼自適應均線 KAMA', g: 'trend', overlay: true, params: [P('n', '週期', 10)], colors: ['#c084fc'], out: [{ n: 'KAMA' }], calc: (b, p) => [kama(C(b), p.n)] },
  LSMA: { name: '線性迴歸線 LSMA', g: 'trend', overlay: true, params: [P('n', '週期', 25)], colors: ['#60a5fa'], out: [{ n: 'LSMA' }], calc: (b, p) => [linreg(C(b), p.n)] },
  MARIBBON: { name: '均線帶（5/10/20/60/120）', g: 'trend', overlay: true, params: [], colors: ['#f5a524'], out: [{ n: '5', c: '#facc15' }, { n: '10', c: '#fb923c' }, { n: '20', c: '#f472b6' }, { n: '60', c: '#38bdf8' }, { n: '120', c: '#a78bfa' }], calc: b => [5, 10, 20, 60, 120].map(n => sma(C(b), n)) },
  SAR:  { name: '拋物線 SAR', g: 'trend', overlay: true, params: [P('s', '加速', 0.02, 0.01), P('m', '上限', 0.2, 0.01)], colors: ['#f5a524'], out: [{ n: 'SAR', kind: 'dots' }], calc: (b, p) => [psar(b, p.s, p.m)] },
  ST:   { name: '超級趨勢 Supertrend', g: 'trend', overlay: true, params: [P('n', 'ATR 週期', 10), P('m', '倍數', 3, 0.1)], colors: ['#10b981'], out: [{ n: '多', c: 'up' }, { n: '空', c: 'down' }], calc: (b, p) => { const r = supertrend(b, p.n, p.m); return [r.up, r.down]; } },
  ICHI: { name: '一目均衡表', g: 'trend', overlay: true, params: [P('t', '轉換', 9), P('k', '基準', 26), P('s', '先行', 52)], colors: ['#38bdf8'], out: [{ n: '轉換', c: '#38bdf8' }, { n: '基準', c: '#ef4444' }, { n: '先行A', c: 'rgba(16,185,129,.8)' }, { n: '先行B', c: 'rgba(239,68,68,.8)' }, { n: '遲行', c: '#a3e635', style: 2 }], calc: (b, p) => { const r = ichimoku(b, p.t, p.k, p.s); return [r.tenkan, r.kijun, r.spanA, r.spanB, r.chikou]; } },
  PIVOT: { name: '樞紐點 Pivot', g: 'trend', overlay: true, params: [], colors: ['#94a3b8'], out: [{ n: 'P', c: '#94a3b8', style: 2 }, { n: 'R1', c: '#ef4444', style: 2 }, { n: 'S1', c: '#10b981', style: 2 }, { n: 'R2', c: 'rgba(239,68,68,.6)', style: 2 }, { n: 'S2', c: 'rgba(16,185,129,.6)', style: 2 }], calc: b => { const r = pivots(b); return [r.P, r.R1, r.S1, r.R2, r.S2]; } },
  BOLL: { name: '布林通道 BOLL', g: 'band', overlay: true, params: [P('n', '週期', 20), P('m', '倍數', 2, 0.1)], colors: ['#a78bfa'], out: [{ n: '中' }, { n: '上', a: .8, style: 2 }, { n: '下', a: .8, style: 2 }], calc: (b, p) => { const r = bollinger(b, p.n, p.m); return [r.mid, r.upper, r.lower]; } },
  KC:   { name: '肯特納通道 Keltner', g: 'band', overlay: true, params: [P('n', '週期', 20), P('m', '倍數', 2, 0.1)], colors: ['#2dd4bf'], out: [{ n: '中' }, { n: '上', a: .8, style: 2 }, { n: '下', a: .8, style: 2 }], calc: (b, p) => { const r = keltner(b, p.n, p.m); return [r.mid, r.upper, r.lower]; } },
  DC:   { name: '唐奇安通道 Donchian', g: 'band', overlay: true, params: [P('n', '週期', 20)], colors: ['#60a5fa'], out: [{ n: '上' }, { n: '中', a: .6, style: 2 }, { n: '下' }], calc: (b, p) => { const r = donchian(b, p.n); return [r.upper, r.mid, r.lower]; } },
  ENV:  { name: '包絡線 Envelope', g: 'band', overlay: true, params: [P('n', '週期', 20), P('pct', '%', 2.5, 0.1)], colors: ['#fb923c'], out: [{ n: '中', a: .6, style: 2 }, { n: '上' }, { n: '下' }], calc: (b, p) => { const m = sma(C(b), p.n); return [m, m.map(v => (v == null ? null : v * (1 + p.pct / 100))), m.map(v => (v == null ? null : v * (1 - p.pct / 100)))]; } },
  VWAP: { name: '成交量加權均價 VWAP', g: 'vol', overlay: true, params: [], colors: ['#f472b6'], out: [{ n: 'VWAP' }], calc: b => [vwap(b)] },
  VOL:  { name: '成交量 VOL', g: 'vol', overlay: true, special: 'vol', params: [P('n', '均量', 20)], colors: ['#64748b'], out: [{ n: '量', kind: 'hist' }, { n: '均量', c: '#f5a524', w: 1 }], calc: (b, p) => { const v = b.map(x => x.volume); return [v, sma(v, p.n || 20)]; } },
  VP:   { name: '成交量分佈（可視範圍）', g: 'vol', overlay: true, special: 'vp', params: [P('rows', '列數', 30), P('va', '價值區 %', 70)], colors: ['#38bdf8'], out: [], calc: () => [] },
  OBV:  { name: '能量潮 OBV', g: 'vol', fmt: 'vol', params: [], colors: ['#38bdf8'], out: [{ n: 'OBV' }], calc: b => [obv(b)] },
  ADL:  { name: '累積派發線 A/D', g: 'vol', fmt: 'vol', params: [], colors: ['#2dd4bf'], out: [{ n: 'A/D' }], calc: b => [adl(b)] },
  CMF:  { name: '蔡金資金流 CMF', g: 'vol', params: [P('n', '週期', 20)], colors: ['#10b981'], levels: [0], out: [{ n: 'CMF', kind: 'hist' }], calc: (b, p) => [cmf(b, p.n)] },
  MFI:  { name: '資金流量 MFI', g: 'vol', params: [P('n', '週期', 14)], colors: ['#f472b6'], levels: [80, 20], out: [{ n: 'MFI' }], calc: (b, p) => [mfi(b, p.n)] },
  RSI:  { name: '相對強弱 RSI', g: 'osc', params: [P('n', '週期', 14)], colors: ['#c084fc'], levels: [70, 30], out: [{ n: 'RSI' }], calc: (b, p) => [rsi(b, p.n)] },
  SRSI: { name: '隨機 RSI', g: 'osc', params: [P('r', 'RSI', 14), P('s', '隨機', 14)], colors: ['#38bdf8'], levels: [80, 20], out: [{ n: 'K' }, { n: 'D', c: '#f5a524' }], calc: (b, p) => { const r = stochRsi(b, p.r, p.s); return [r.k, r.d]; } },
  MACD: { name: 'MACD', g: 'osc', fmt: 'price+', params: [P('f', '快', 12), P('s', '慢', 26), P('g', '訊號', 9)], colors: ['#38bdf8'], out: [{ n: '柱', kind: 'hist', macd: true }, { n: 'DIF' }, { n: 'DEA', c: '#f5a524' }], calc: (b, p) => { const r = macd(b, p.f, p.s, p.g); return [r.hist, r.line, r.signal]; } },
  KD:   { name: '隨機指標 KD（台股）', g: 'osc', params: [P('n', '週期', 9)], colors: ['#f5a524'], levels: [80, 20], out: [{ n: 'K' }, { n: 'D', c: '#38bdf8' }], calc: (b, p) => { const r = kd(b, p.n); return [r.k, r.d]; } },
  STOCH: { name: '隨機指標 Stochastic', g: 'osc', params: [P('n', '週期', 14), P('k', '%K 平滑', 3), P('d', '%D', 3)], colors: ['#38bdf8'], levels: [80, 20], out: [{ n: '%K' }, { n: '%D', c: '#f5a524' }], calc: (b, p) => { const r = stoch(b, p.n, p.k, p.d); return [r.k, r.d]; } },
  CCI:  { name: '順勢指標 CCI', g: 'osc', params: [P('n', '週期', 20)], colors: ['#2dd4bf'], levels: [100, -100], out: [{ n: 'CCI' }], calc: (b, p) => [cci(b, p.n)] },
  WR:   { name: '威廉指標 %R', g: 'osc', params: [P('n', '週期', 14)], colors: ['#a78bfa'], levels: [-20, -80], out: [{ n: '%R' }], calc: (b, p) => [willr(b, p.n)] },
  DMI:  { name: '趨向指標 DMI / ADX', g: 'osc', params: [P('n', '週期', 14)], colors: ['#f5a524'], levels: [25], out: [{ n: '+DI', c: 'up' }, { n: '-DI', c: 'down' }, { n: 'ADX' }], calc: (b, p) => { const r = dmi(b, p.n); return [r.pdi, r.mdi, r.adx]; } },
  AROON: { name: '阿隆指標 Aroon', g: 'osc', params: [P('n', '週期', 25)], colors: ['#f5a524'], out: [{ n: '上', c: 'up' }, { n: '下', c: 'down' }], calc: (b, p) => { const r = aroon(b, p.n); return [r.up, r.down]; } },
  MOM:  { name: '動量 MOM', g: 'osc', fmt: 'price', params: [P('n', '週期', 10)], colors: ['#38bdf8'], levels: [0], out: [{ n: 'MOM' }], calc: (b, p) => [change(C(b), p.n)] },
  ROC:  { name: '變動率 ROC', g: 'osc', params: [P('n', '週期', 12)], colors: ['#fb923c'], levels: [0], out: [{ n: 'ROC' }], calc: (b, p) => [roc(C(b), p.n)] },
  BIAS: { name: '乖離率 BIAS', g: 'osc', params: [P('n', '週期', 20)], colors: ['#facc15'], levels: [0], out: [{ n: 'BIAS' }], calc: (b, p) => { const c = C(b), m = sma(c, p.n); return [m.map((v, i) => (v ? (c[i] / v - 1) * 100 : null))]; } },
  PSY:  { name: '心理線 PSY', g: 'osc', params: [P('n', '週期', 12)], colors: ['#e879f9'], levels: [75, 25], out: [{ n: 'PSY' }], calc: (b, p) => [sma(b.map((x, i) => (i && x.close > b[i - 1].close ? 100 : 0)), p.n)] },
  AO:   { name: '動量震盪 AO', g: 'osc', fmt: 'price', params: [], colors: ['#10b981'], out: [{ n: 'AO', kind: 'hist', macd: true }], calc: b => [awesome(b)] },
  UO:   { name: '終極震盪 UO', g: 'osc', params: [P('a', '短', 7), P('b', '中', 14), P('c', '長', 28)], colors: ['#f472b6'], levels: [70, 30], out: [{ n: 'UO' }], calc: (b, p) => [ultimate(b, p.a, p.b, p.c)] },
  TRIX: { name: '三重指數 TRIX', g: 'osc', params: [P('n', '週期', 15)], colors: ['#60a5fa'], levels: [0], out: [{ n: 'TRIX' }, { n: '訊號', c: '#f5a524' }], calc: (b, p) => { const t = trix(b, p.n); return [t, sma(t, 9)]; } },
  CMO:  { name: '錢德動量 CMO', g: 'osc', params: [P('n', '週期', 9)], colors: ['#a3e635'], levels: [50, -50], out: [{ n: 'CMO' }], calc: (b, p) => [cmo(b, p.n)] },
  TSI:  { name: '真實強度 TSI', g: 'osc', params: [P('r', '長', 25), P('s', '短', 13)], colors: ['#38bdf8'], levels: [0], out: [{ n: 'TSI' }, { n: '訊號', c: '#f5a524' }], calc: (b, p) => { const t = tsi(b, p.r, p.s); return [t, ema(t, 7)]; } },
  FISH: { name: '費雪轉換 Fisher', g: 'osc', params: [P('n', '週期', 9)], colors: ['#2dd4bf'], levels: [0], out: [{ n: 'Fisher' }, { n: '前值', c: '#f5a524' }], calc: (b, p) => { const f = fisher(b, p.n); return [f, f.map((_, i) => (i ? f[i - 1] : null))]; } },
  VI:   { name: '渦旋指標 Vortex', g: 'osc', params: [P('n', '週期', 14)], colors: ['#10b981'], out: [{ n: 'VI+', c: 'up' }, { n: 'VI-', c: 'down' }], calc: (b, p) => { const r = vortex(b, p.n); return [r.plus, r.minus]; } },
  ATR:  { name: '真實波幅 ATR', g: 'volat', fmt: 'price', params: [P('n', '週期', 14)], colors: ['#2dd4bf'], out: [{ n: 'ATR' }], calc: (b, p) => [atr(b, p.n)] },
  STD:  { name: '標準差 StdDev', g: 'volat', fmt: 'price', params: [P('n', '週期', 20)], colors: ['#94a3b8'], out: [{ n: 'SD' }], calc: (b, p) => [stdev(C(b), p.n)] },
  BBW:  { name: '布林帶寬 BBW', g: 'volat', params: [P('n', '週期', 20), P('m', '倍數', 2, 0.1)], colors: ['#a78bfa'], out: [{ n: 'BBW %' }], calc: (b, p) => { const r = bollinger(b, p.n, p.m); return [r.mid.map((m, i) => (m ? ((r.upper[i] - r.lower[i]) / m) * 100 : null))]; } },
  PB:   { name: '布林 %B', g: 'volat', params: [P('n', '週期', 20), P('m', '倍數', 2, 0.1)], colors: ['#c084fc'], levels: [100, 0], out: [{ n: '%B' }], calc: (b, p) => { const r = bollinger(b, p.n, p.m); return [b.map((x, i) => (r.upper[i] != null && r.upper[i] !== r.lower[i] ? ((x.close - r.lower[i]) / (r.upper[i] - r.lower[i])) * 100 : null))]; } },
  HV:   { name: '歷史波動率 HV', g: 'volat', params: [P('n', '週期', 20)], colors: ['#fb923c'], out: [{ n: 'HV %' }], calc: (b, p) => [histVol(b, p.n)] },
  SCRIPT: { name: '自訂腳本', g: 'other', hidden: true, params: [], colors: ['#38bdf8'], out: [], calc: () => [] },
};

export const DEFAULT_INDICATORS = [
  { id: 'i1', type: 'MA', p: { n: 20 }, color: '#f5a524' },
  { id: 'i2', type: 'MA', p: { n: 60 }, color: '#38bdf8' },
  { id: 'i3', type: 'VOL', p: { n: 20 }, color: '#64748b' },
  { id: 'i4', type: 'MACD', p: { f: 12, s: 26, g: 9 }, color: '#38bdf8' },
];

export function label(ind) {
  if (ind.type === 'SCRIPT') return ind.name || '腳本';
  const vals = Object.values(ind.p || {});
  return ind.type + (vals.length ? ' ' + vals.join(',') : '');
}

// Default params for an indicator type, merged with given ones.
export function withDefaults(type, p = {}) {
  const def = CATALOG[type];
  return { ...Object.fromEntries((def?.params || []).map(x => [x.k, x.def])), ...p };
}

// Compute an indicator's output arrays for a bar array.
export function compute(type, bars, p) {
  const def = CATALOG[type];
  if (!def || !bars.length) return [];
  try { return def.calc(bars, withDefaults(type, p)); } catch { return []; }
}
