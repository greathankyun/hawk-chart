// Condition engine shared by multi-condition alerts, the screener and the
// backtester (and the Cloudflare Worker for server-side alerts). Pure, no DOM.
//
// operand: { k:'price', f:'close'|'open'|'high'|'low'|'volume'|'chg' }
//        | { k:'ind', type:'RSI', p:{n:14}, o:0 }      (o = output index)
//        | { k:'num', v: 30 }
// cond:    { a: operand, op: 'gt'|'lt'|'xup'|'xdn'|'ge'|'le', b: operand }
import * as I from './indicators.js';
import { runScript } from './script.js';

export const OPS = { gt: '大於', lt: '小於', ge: '大於等於', le: '小於等於', xup: '向上穿越', xdn: '向下穿越' };
export const PRICE_FIELDS = { close: '收盤價', open: '開盤價', high: '最高價', low: '最低價', volume: '成交量', chg: '漲跌幅 %' };

export function operandSeries(op, bars, cache = {}) {
  if (!op) return bars.map(() => null);
  if (op.m != null && op.m !== 1) { const base = operandSeries({ ...op, m: null }, bars, cache); return base.map(v => (v == null ? null : v * op.m)); }
  if (op.k === 'num') return bars.map(() => +op.v);
  if (op.k === 'price') {
    if (op.f === 'chg') return bars.map((b, i) => (i ? (b.close / bars[i - 1].close - 1) * 100 : null));
    return bars.map(b => b[op.f || 'close']);
  }
  if (op.k === 'ind') {
    const key = op.type + JSON.stringify(op.p || {});
    if (!cache[key]) cache[key] = I.compute(op.type, bars, op.p);
    return cache[key][op.o || 0] || bars.map(() => null);
  }
  return bars.map(() => null);
}

export function condSeries(c, bars, cache = {}) {
  const A = operandSeries(c.a, bars, cache), B = operandSeries(c.b, bars, cache);
  const ok = (x, y) => x != null && y != null && !Number.isNaN(x) && !Number.isNaN(y);
  return A.map((a, i) => {
    const b = B[i];
    if (!ok(a, b)) return false;
    switch (c.op) {
      case 'gt': return a > b;
      case 'lt': return a < b;
      case 'ge': return a >= b;
      case 'le': return a <= b;
      case 'xup': return i > 0 && ok(A[i - 1], B[i - 1]) && a > b && A[i - 1] <= B[i - 1];
      case 'xdn': return i > 0 && ok(A[i - 1], B[i - 1]) && a < b && A[i - 1] >= B[i - 1];
    }
    return false;
  });
}

// rule: { conds:[...], logic:'and'|'or', script?: {code, inputs} }
export function ruleSeries(rule, bars, cache = {}) {
  const parts = (rule.conds || []).map(c => condSeries(c, bars, cache));
  if (rule.script?.code) {
    const r = runScript(rule.script.code, bars, rule.script.inputs || {});
    if (r.error) throw new Error('腳本錯誤：' + r.error);
    const sig = rule.script.use === 'buy' ? r.buy : rule.script.use === 'sell' ? r.sell : r.alerts[0]?.data;
    parts.push(sig || bars.map(() => false));
  }
  if (!parts.length) return bars.map(() => false);
  const or = rule.logic === 'or';
  return bars.map((_, i) => (or ? parts.some(p => p[i]) : parts.every(p => p[i])));
}

export function describeOperand(op) {
  if (!op) return '?';
  if (op.k === 'num') return String(op.v);
  if (op.k === 'price') return PRICE_FIELDS[op.f] || op.f;
  if (op.k === 'ind') {
    const def = I.CATALOG[op.type];
    const vals = Object.values(I.withDefaults(op.type, op.p));
    const outName = def?.out?.[op.o || 0]?.n;
    const mul = op.m != null && op.m !== 1 ? ` × ${op.m}` : '';
    return `${op.type}${vals.length ? '(' + vals.join(',') + ')' : ''}${def && def.out.length > 1 && outName ? ' ' + outName : ''}${mul}`;
  }
  return '?';
}
export const describeCond = c => `${describeOperand(c.a)} ${OPS[c.op] || c.op} ${describeOperand(c.b)}`;
export function describeRule(rule) {
  const parts = (rule.conds || []).map(describeCond);
  if (rule.script?.code) parts.push(`腳本「${rule.script.name || '自訂'}」`);
  return parts.join(rule.logic === 'or' ? ' 或 ' : ' 且 ') || '（無條件）';
}

// Ready-made rules used by the screener and backtester.
const ind = (type, p, o = 0) => ({ k: 'ind', type, p, o });
const num = v => ({ k: 'num', v });
const px = f => ({ k: 'price', f });
export const PRESETS = {
  rsiOversold: { name: 'RSI 超賣 (<30)', conds: [{ a: ind('RSI', { n: 14 }), op: 'lt', b: num(30) }] },
  rsiOverbought: { name: 'RSI 超買 (>70)', conds: [{ a: ind('RSI', { n: 14 }), op: 'gt', b: num(70) }] },
  maBull: { name: '均線多頭排列 (5>20>60)', conds: [{ a: ind('MA', { n: 5 }), op: 'gt', b: ind('MA', { n: 20 }) }, { a: ind('MA', { n: 20 }), op: 'gt', b: ind('MA', { n: 60 }) }] },
  maBear: { name: '均線空頭排列 (5<20<60)', conds: [{ a: ind('MA', { n: 5 }), op: 'lt', b: ind('MA', { n: 20 }) }, { a: ind('MA', { n: 20 }), op: 'lt', b: ind('MA', { n: 60 }) }] },
  aboveMa20: { name: '站上 20 均線', conds: [{ a: px('close'), op: 'gt', b: ind('MA', { n: 20 }) }] },
  macdGolden: { name: 'MACD 黃金交叉', conds: [{ a: ind('MACD', { f: 12, s: 26, g: 9 }, 1), op: 'xup', b: ind('MACD', { f: 12, s: 26, g: 9 }, 2) }] },
  macdDeath: { name: 'MACD 死亡交叉', conds: [{ a: ind('MACD', { f: 12, s: 26, g: 9 }, 1), op: 'xdn', b: ind('MACD', { f: 12, s: 26, g: 9 }, 2) }] },
  kdGolden: { name: 'KD 低檔黃金交叉', conds: [{ a: ind('KD', { n: 9 }, 0), op: 'xup', b: ind('KD', { n: 9 }, 1) }, { a: ind('KD', { n: 9 }, 0), op: 'lt', b: num(30) }] },
  breakout20: { name: '突破 20 根高點', conds: [{ a: px('close'), op: 'gt', b: ind('DC', { n: 20 }, 0) }] },
  bbSqueezeUp: { name: '突破布林上軌', conds: [{ a: px('close'), op: 'xup', b: ind('BOLL', { n: 20, m: 2 }, 1) }] },
  stUp: { name: '超級趨勢翻多', conds: [{ a: px('close'), op: 'gt', b: ind('ST', { n: 10, m: 3 }, 0) }] },
  volSpike: { name: '爆量（量 > 2 倍均量）', conds: [{ a: px('volume'), op: 'gt', b: { ...ind('VOL', { n: 20 }, 1), m: 2 } }] },
  adxTrend: { name: '強趨勢 (ADX>25)', conds: [{ a: ind('DMI', { n: 14 }, 2), op: 'gt', b: num(25) }] },
};
