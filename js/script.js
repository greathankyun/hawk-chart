// Custom indicator / strategy scripts ("鷹眼腳本").
// A script is plain JavaScript run against the loaded bars with a helper API:
//   series data: open high low close volume hl2 hlc3 ohlc4 time  (arrays)
//   ta.*: sma ema wma rma hma rsi macd stdev highest lowest atr crossover crossunder change roc ...
//   input(name, default)            → user-tunable number
//   plot(arr, name?, color?, opts?)  → draw a line (opts.type: 'line'|'hist'|'dots')
//   hline(value, color?)             → horizontal guide line
//   buy(boolArr) / sell(boolArr)     → strategy signals (used by backtest & markers)
//   alert(boolArr, message?)         → alert condition (used by alerts)
//   series(i => …)                   → build an array bar by bar
// The script runs in the user's own browser, on their own data.
import * as I from './indicators.js';

export const EXAMPLES = [
  {
    name: '雙均線交叉策略', overlay: true, code:
`// 快慢均線交叉：上穿做多、下穿出場
const fast = input('快線', 10);
const slow = input('慢線', 30);
const f = ta.ema(close, fast);
const s = ta.ema(close, slow);
plot(f, '快線', '#f5a524');
plot(s, '慢線', '#38bdf8');
buy(ta.crossover(f, s));
sell(ta.crossunder(f, s));
alert(ta.crossover(f, s), '黃金交叉');`,
  },
  {
    name: 'RSI 超買超賣', overlay: false, code:
`const n = input('週期', 14);
const r = ta.rsi(close, n);
plot(r, 'RSI', '#c084fc');
hline(70, '#ef4444');
hline(30, '#10b981');
buy(ta.crossover(r, 30));
sell(ta.crossunder(r, 70));`,
  },
  {
    name: '價量動能柱', overlay: false, code:
`// 自訂：漲跌幅 × 相對量
const n = input('均量週期', 20);
const avgVol = ta.sma(volume, n);
const power = series(i => avgVol[i] ? (close[i] - open[i]) / open[i] * 100 * volume[i] / avgVol[i] : null);
plot(power, '動能', '#2dd4bf', { type: 'hist' });
hline(0);`,
  },
  {
    name: '突破 N 日高點', overlay: true, code:
`const n = input('突破週期', 20);
const hi = ta.highest(high, n);
const lo = ta.lowest(low, Math.round(n / 2));
const prevHi = series(i => i ? hi[i - 1] : null);
const prevLo = series(i => i ? lo[i - 1] : null);
plot(prevHi, '上緣', '#ef4444');
plot(prevLo, '下緣', '#10b981');
buy(series(i => prevHi[i] != null && close[i] > prevHi[i]));
sell(series(i => prevLo[i] != null && close[i] < prevLo[i]));`,
  },
];

function taFor(bars) {
  const arr = x => (Array.isArray(x) ? x : bars.map(() => x));
  return {
    sma: (a, n) => I.sma(arr(a), n), ema: (a, n) => I.ema(arr(a), n), wma: (a, n) => I.wma(arr(a), n), rma: (a, n) => I.rma(arr(a), n),
    hma: (a, n) => I.hma(arr(a), n), dema: (a, n) => I.dema(arr(a), n), tema: (a, n) => I.tema(arr(a), n),
    rsi: (a, n = 14) => I.rsiOf(arr(a), n), macd: (a, f = 12, s = 26, g = 9) => I.macd(arr(a), f, s, g),
    stdev: (a, n) => I.stdev(arr(a), n), highest: (a, n) => I.highest(arr(a), n), lowest: (a, n) => I.lowest(arr(a), n),
    change: (a, n = 1) => I.change(arr(a), n), roc: (a, n = 1) => I.roc(arr(a), n), sum: (a, n) => I.sum(arr(a), n), linreg: (a, n) => I.linreg(arr(a), n),
    crossover: (a, b) => I.crossover(arr(a), Array.isArray(b) ? b : +b), crossunder: (a, b) => I.crossunder(arr(a), Array.isArray(b) ? b : +b),
    atr: (n = 14) => I.atr(bars, n), bb: (n = 20, m = 2) => I.bollinger(bars, n, m), kd: (n = 9) => I.kd(bars, n), stoch: (n = 14) => I.stoch(bars, n),
    cci: (n = 20) => I.cci(bars, n), dmi: (n = 14) => I.dmi(bars, n), obv: () => I.obv(bars), vwap: () => I.vwap(bars), mfi: (n = 14) => I.mfi(bars, n),
    supertrend: (n = 10, m = 3) => I.supertrend(bars, n, m), sar: (s = 0.02, m = 0.2) => I.psar(bars, s, m), willr: (n = 14) => I.willr(bars, n),
  };
}

// Returns { plots:[{name,color,type,data}], hlines:[{v,color}], buy:bool[], sell:bool[], alerts:[{data,msg}], inputs:[{name,def,value}], error }
export function runScript(code, bars, inputValues = {}) {
  const res = { plots: [], hlines: [], buy: null, sell: null, alerts: [], inputs: [], error: null };
  const n = bars.length;
  const pick = k => bars.map(b => b[k]);
  const ctx = {
    open: pick('open'), high: pick('high'), low: pick('low'), close: pick('close'), volume: pick('volume'),
    time: pick('utc'), hl2: bars.map(b => (b.high + b.low) / 2), hlc3: bars.map(b => (b.high + b.low + b.close) / 3), ohlc4: bars.map(b => (b.open + b.high + b.low + b.close) / 4),
    bar_count: n, ta: taFor(bars), Math,
    series: fn => { const out = new Array(n); for (let i = 0; i < n; i++) { const v = fn(i); out[i] = v === undefined || Number.isNaN(v) ? null : v; } return out; },
    input: (name, def) => { const v = inputValues[name] ?? def; res.inputs.push({ name, def, value: v }); return +v; },
    plot: (data, name, color, opts = {}) => {
      if (!Array.isArray(data)) data = bars.map(() => data);
      res.plots.push({ name: name || `線${res.plots.length + 1}`, color: color || null, type: opts.type || 'line', data: data.map(v => (v == null || Number.isNaN(+v) || typeof v === 'boolean' ? null : +v)) });
    },
    hline: (v, color) => res.hlines.push({ v: +v, color: color || '#64748b' }),
    buy: a => { res.buy = (Array.isArray(a) ? a : bars.map(() => !!a)).map(Boolean); },
    sell: a => { res.sell = (Array.isArray(a) ? a : bars.map(() => !!a)).map(Boolean); },
    alert: (a, msg) => res.alerts.push({ data: (Array.isArray(a) ? a : bars.map(() => !!a)).map(Boolean), msg: msg || '腳本條件成立' }),
  };
  try {
    const names = Object.keys(ctx);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, '"use strict";\n' + code);
    fn(...names.map(k => ctx[k]));
  } catch (e) {
    res.error = e.message || String(e);
  }
  return res;
}
