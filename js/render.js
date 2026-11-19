// Generic indicator → Lightweight Charts series renderer, shared by the main
// chart and the extra charts of a multi-chart layout.
import * as I from './indicators.js';
import { runScript } from './script.js';

const LC = window.LightweightCharts;
export function hexA(hex, a) {
  if (!hex || hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

export class IndicatorLayer {
  // o: { chart, upDown: () => ({up, down}), priceDec: () => number, getScript: sid => script }
  constructor(o) { Object.assign(this, o); this.items = []; this.cache = {}; }

  clear() {
    for (const it of this.items) for (const s of it.series) try { this.chart.removeSeries(s); } catch {}
    this.items = []; this.cache = {};
  }

  // Resolve a script indicator into a pseudo catalog definition by running it once.
  scriptDef(ind, bars) {
    const sc = this.getScript?.(ind.sid);
    if (!sc) return null;
    const r = runScript(sc.code, bars, ind.inputs || {});
    return {
      name: sc.name, overlay: !!sc.overlay, fmt: sc.overlay ? 'price' : 'num', script: sc, error: r.error,
      levels: r.hlines.map(h => h.v), levelColors: r.hlines.map(h => h.color),
      out: r.plots.map(p => ({ n: p.name, c: p.color || undefined, kind: p.type === 'hist' ? 'hist' : p.type === 'dots' ? 'dots' : 'line' })),
      calc: b => runScript(sc.code, b, ind.inputs || {}).plots.map(p => p.data),
    };
  }

  defOf(ind, bars) { return ind.type === 'SCRIPT' ? this.scriptDef(ind, bars) : I.CATALOG[ind.type]; }

  colorOf(ind, o) {
    const { up, down } = this.upDown();
    if (o.c === 'up') return up;
    if (o.c === 'down') return down;
    if (o.c) return o.c;
    return o.a ? hexA(ind.color, o.a) : ind.color;
  }

  // Build series for all indicators. Returns the number of panes used (incl. main).
  build(indicators, bars, firstPane = 1) {
    this.clear();
    const chart = this.chart;
    const pd = this.priceDec();
    const pricePf = { type: 'price', precision: pd, minMove: 1 / 10 ** pd };
    let pane = firstPane;
    for (const ind of indicators) {
      if (ind.hidden) continue;
      const def = this.defOf(ind, bars);
      if (!def || def.special === 'vp') { if (def) this.items.push({ ind, def, series: [], pane: 0 }); continue; }
      const pi = def.overlay ? 0 : pane++;
      const pf = def.overlay || def.fmt === 'price' ? pricePf
        : def.fmt === 'price+' ? { type: 'price', precision: pd + 1, minMove: 1 / 10 ** (pd + 1) }
        : def.fmt === 'vol' ? { type: 'volume' } : { type: 'price', precision: 2, minMove: 0.01 };
      const series = [];
      if (def.special === 'vol') {
        const v = chart.addSeries(LC.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 0);
        const m = chart.addSeries(LC.LineSeries, { priceScaleId: 'vol', color: this.colorOf(ind, def.out[1]), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        series.push(v, m);
      } else {
        def.out.forEach(o => {
          const color = this.colorOf(ind, o);
          const common = { priceLineVisible: false, lastValueVisible: !def.overlay, priceFormat: pf };
          let s;
          if (o.kind === 'hist') s = chart.addSeries(LC.HistogramSeries, { ...common, color, lastValueVisible: false }, pi);
          else if (o.kind === 'dots') s = chart.addSeries(LC.LineSeries, { ...common, color, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.6, crosshairMarkerVisible: false, lastValueVisible: false }, pi);
          else s = chart.addSeries(LC.LineSeries, { ...common, color, lineWidth: o.w || 1.5, lineStyle: o.style || 0, crosshairMarkerVisible: false }, pi);
          series.push(s);
        });
        if (series[0]) (def.levels || []).forEach((lv, k) => series[0].createPriceLine({ price: lv, color: def.levelColors?.[k] ? hexA(def.levelColors[k], .6) : 'rgba(125,140,168,.5)', lineStyle: 2, lineWidth: 1, axisLabelVisible: false }));
      }
      this.items.push({ ind, def, series, pane: pi });
    }
    return pane;
  }

  compute(bars) {
    this.cache = {};
    for (const it of this.items) {
      if (!it.series.length) continue;
      try { this.cache[it.ind.id] = it.def.calc(bars, I.withDefaults(it.ind.type, it.ind.p)); } catch { this.cache[it.ind.id] = []; }
    }
  }

  point(it, k, i, bars, disp) {
    const time = disp[i].time;
    const v = this.cache[it.ind.id]?.[k]?.[i];
    if (v == null || Number.isNaN(v)) return { time };
    const { up, down } = this.upDown();
    if (it.def.special === 'vol' && k === 0) return { time, value: v, color: hexA(bars[i].close >= bars[i].open ? up : down, .45) };
    const o = it.def.out[k];
    if (o?.kind === 'hist') {
      if (o.macd || it.def.script) {
        const prev = this.cache[it.ind.id][k][i - 1];
        const c = v >= 0 ? (prev != null && v < prev ? hexA(up, .45) : up) : (prev != null && v > prev ? hexA(down, .45) : down);
        return { time, value: v, color: o.c && !o.macd ? undefined : c };
      }
    }
    return { time, value: v };
  }

  setData(bars, disp) {
    this.compute(bars);
    for (const it of this.items) it.series.forEach((s, k) => s.setData(bars.map((_, i) => this.point(it, k, i, bars, disp))));
  }

  updateLast(bars, disp) {
    this.compute(bars);
    const n = bars.length - 1;
    for (const it of this.items) it.series.forEach((s, k) => { try { s.update(this.point(it, k, n, bars, disp)); } catch {} });
  }

  // Legend rows for bar index i.
  values(i) {
    return this.items.filter(it => it.series.length).map(it => ({
      ind: it.ind, def: it.def, pane: it.pane,
      names: it.def.out.map(o => o.n), vals: (this.cache[it.ind.id] || []).map(a => a[i]),
    }));
  }
}
