// Visual editor for condition rules ({conds, logic}) used by alerts, screener and backtest.
import * as I from './indicators.js';
import { OPS, PRICE_FIELDS } from './conditions.js';
import { el, select, numInput } from './ui.js';

const IND_TYPES = Object.entries(I.CATALOG).filter(([, d]) => !d.special && !d.hidden || d.special === 'vol').map(([k, d]) => [k, d.name]);

function operandEditor(op, onChange) {
  const box = el('span', 'operand');
  const draw = () => {
    box.innerHTML = '';
    box.append(select([['price', '價格'], ['ind', '指標'], ['num', '數值']], op.k, k => {
      for (const key of Object.keys(op)) delete op[key];
      Object.assign(op, k === 'price' ? { k, f: 'close' } : k === 'num' ? { k, v: 0 } : { k, type: 'MA', p: I.withDefaults('MA'), o: 0 });
      draw(); onChange();
    }));
    if (op.k === 'price') box.append(select(Object.entries(PRICE_FIELDS), op.f, v => { op.f = v; onChange(); }));
    else if (op.k === 'num') box.append(numInput(op.v, v => { op.v = Number.isFinite(v) ? v : 0; onChange(); }, { width: '84px' }));
    else {
      box.append(select(IND_TYPES, op.type, v => { op.type = v; op.p = I.withDefaults(v); op.o = 0; draw(); onChange(); }));
      const def = I.CATALOG[op.type];
      for (const p of def.params) {
        const lab = el('label', 'mini', `<small>${p.label}</small>`);
        lab.append(numInput(op.p?.[p.k] ?? p.def, v => { if (v > 0) { op.p = { ...op.p, [p.k]: v }; onChange(); } }, { step: p.step || 1, width: '54px' }));
        box.append(lab);
      }
      if (def.out.length > 1) box.append(select(def.out.map((o, i) => [String(i), o.n]), String(op.o || 0), v => { op.o = +v; onChange(); }));
      const lab = el('label', 'mini', '<small>×</small>');
      lab.append(numInput(op.m ?? 1, v => { op.m = Number.isFinite(v) && v !== 1 ? v : undefined; onChange(); }, { width: '46px' }));
      box.append(lab);
    }
  };
  draw();
  return box;
}

// rule: {conds:[], logic:'and'|'or'}; mutates in place, calls onChange after edits.
export function ruleEditor(rule, onChange = () => {}) {
  rule.conds ||= []; rule.logic ||= 'and';
  const wrap = el('div', 'rule-ed');
  const draw = () => {
    wrap.innerHTML = '';
    const top = el('div', 'rule-top');
    top.append(el('span', '', '符合'), select([['and', '全部條件（且）'], ['or', '任一條件（或）']], rule.logic, v => { rule.logic = v; onChange(); }));
    wrap.append(top);
    rule.conds.forEach((c, i) => {
      const row = el('div', 'cond-row');
      row.append(operandEditor(c.a, onChange));
      row.append(select(Object.entries(OPS), c.op, v => { c.op = v; onChange(); }));
      row.append(operandEditor(c.b, onChange));
      const del = el('button', 'icon-btn danger', '✕'); del.title = '刪除條件';
      del.onclick = () => { rule.conds.splice(i, 1); draw(); onChange(); };
      row.append(del);
      wrap.append(row);
    });
    const add = el('button', 'btn', '＋ 新增條件');
    add.onclick = () => { rule.conds.push({ a: { k: 'price', f: 'close' }, op: 'xup', b: { k: 'ind', type: 'MA', p: { n: 20 }, o: 0 } }); draw(); onChange(); };
    wrap.append(add);
  };
  draw();
  wrap.redraw = draw;
  return wrap;
}
