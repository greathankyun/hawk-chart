// Strategy backtester: built-in strategies, condition-builder strategies or
// script strategies (buy()/sell()), with fees, slippage, stop-loss/take-profit,
// long/short, equity curve, drawdown and a trade list.
import * as I from './indicators.js';
import { ruleSeries } from './conditions.js';
import { runScript } from './script.js';
import { ruleEditor } from './condui.js';
import { el, esc, makeModal, select, numInput, download } from './ui.js';

const LC = window.LightweightCharts;

export const STRATEGIES = {
  maCross: { name: '均線交叉', params: [['fast', '快線', 10], ['slow', '慢線', 30], ['ema', 'EMA(1)/SMA(0)', 1]],
    signals: (b, p) => { const c = I.closes(b), f = p.ema ? I.ema(c, p.fast) : I.sma(c, p.fast), s = p.ema ? I.ema(c, p.slow) : I.sma(c, p.slow); return { buy: I.crossover(f, s), sell: I.crossunder(f, s), plots: [[f, '#f5a524'], [s, '#38bdf8']] }; } },
  rsi: { name: 'RSI 超買超賣', params: [['n', '週期', 14], ['lo', '超賣', 30], ['hi', '超買', 70]],
    signals: (b, p) => { const r = I.rsi(b, p.n); return { buy: I.crossover(r, p.lo), sell: I.crossunder(r, p.hi) }; } },
  macd: { name: 'MACD 交叉', params: [['f', '快', 12], ['s', '慢', 26], ['g', '訊號', 9]],
    signals: (b, p) => { const m = I.macd(b, p.f, p.s, p.g); return { buy: I.crossover(m.line, m.signal), sell: I.crossunder(m.line, m.signal) }; } },
  kd: { name: 'KD 交叉', params: [['n', '週期', 9], ['lo', '低檔', 30], ['hi', '高檔', 70]],
    signals: (b, p) => { const r = I.kd(b, p.n), x = I.crossover(r.k, r.d), y = I.crossunder(r.k, r.d); return { buy: x.map((v, i) => v && r.k[i] < p.lo), sell: y.map((v, i) => v && r.k[i] > p.hi) }; } },
  boll: { name: '布林通道均值回歸', params: [['n', '週期', 20], ['m', '倍數', 2]],
    signals: (b, p) => { const r = I.bollinger(b, p.n, p.m), c = I.closes(b); return { buy: I.crossover(c, r.lower), sell: I.crossover(c, r.mid), plots: [[r.upper, '#a78bfa'], [r.mid, '#a78bfa'], [r.lower, '#a78bfa']] }; } },
  st: { name: '超級趨勢', params: [['n', 'ATR 週期', 10], ['m', '倍數', 3]],
    signals: (b, p) => { const r = I.supertrend(b, p.n, p.m); return { buy: r.dir.map((d, i) => i > 0 && d === 1 && r.dir[i - 1] === -1), sell: r.dir.map((d, i) => i > 0 && d === -1 && r.dir[i - 1] === 1), plots: [[r.line, '#10b981']] }; } },
  donchian: { name: '唐奇安突破（海龜）', params: [['n', '進場週期', 20], ['x', '出場週期', 10]],
    signals: (b, p) => { const h = I.highest(b.map(x => x.high), p.n), l = I.lowest(b.map(x => x.low), p.x); return { buy: b.map((x, i) => i > 0 && h[i - 1] != null && x.close > h[i - 1]), sell: b.map((x, i) => i > 0 && l[i - 1] != null && x.close < l[i - 1]) }; } },
  custom: { name: '自訂條件', params: [] },
  script: { name: '自訂腳本（buy / sell）', params: [] },
};

// Pure engine. sig: {buy:bool[], sell:bool[]}; o: options
export function runBacktest(bars, sig, o) {
  const n = bars.length;
  const fee = (o.fee || 0) / 100, slip = (o.slip || 0) / 100, size = Math.min(1, (o.size ?? 100) / 100);
  let cash = o.capital || 10000, pos = null; // {side:1|-1, qty, entry, entryI, cost}
  const trades = [], equity = new Array(n).fill(null);
  let peak = cash, maxDD = 0;
  const allowLong = o.dir !== 'short', allowShort = o.dir !== 'long';
  const enter = (side, i, price) => {
    const px = price * (1 + side * slip);
    const eq = cash; const notional = eq * size;
    const qty = notional / px;
    const f = notional * fee;
    cash -= f;
    pos = { side, qty, entry: px, entryI: i, fees: f };
  };
  const exit = (i, price, reason) => {
    const px = price * (1 - pos.side * slip);
    const gross = pos.side * (px - pos.entry) * pos.qty;
    const f = px * pos.qty * fee;
    cash += gross - f;
    const pnl = gross - f - pos.fees;
    trades.push({ side: pos.side, entryI: pos.entryI, exitI: i, entry: pos.entry, exit: px, pnl, ret: (pnl / (pos.entry * pos.qty)) * 100, bars: i - pos.entryI, reason });
    pos = null;
  };
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    // signals from bar i-1 execute at bar i open
    if (i > 0) {
      const buy = sig.buy?.[i - 1], sell = sig.sell?.[i - 1];
      if (pos && ((pos.side === 1 && sell) || (pos.side === -1 && buy))) exit(i, b.open, '訊號');
      if (!pos) {
        if (buy && allowLong) enter(1, i, b.open);
        else if (sell && allowShort) enter(-1, i, b.open);
      }
    }
    // stop-loss / take-profit intrabar (stop first when both hit)
    if (pos && i >= pos.entryI) {
      const sl = o.sl ? pos.entry * (1 - pos.side * o.sl / 100) : null, tp = o.tp ? pos.entry * (1 + pos.side * o.tp / 100) : null;
      const hitSL = sl != null && (pos.side === 1 ? b.low <= sl : b.high >= sl);
      const hitTP = tp != null && (pos.side === 1 ? b.high >= tp : b.low <= tp);
      if (hitSL) exit(i, pos.side === 1 ? Math.min(sl, b.open) : Math.max(sl, b.open), '停損');
      else if (hitTP) exit(i, pos.side === 1 ? Math.max(tp, b.open) : Math.min(tp, b.open), '停利');
    }
    const eq = cash + (pos ? pos.side * (b.close - pos.entry) * pos.qty : 0);
    equity[i] = eq;
    peak = Math.max(peak, eq);
    maxDD = Math.max(maxDD, (peak - eq) / peak);
  }
  if (pos && o.closeAtEnd !== false) { exit(n - 1, bars[n - 1].close, '期末平倉'); equity[n - 1] = cash; }
  const start = o.capital || 10000, end = equity[n - 1] ?? start;
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const gp = wins.reduce((a, t) => a + t.pnl, 0), gl = -losses.reduce((a, t) => a + t.pnl, 0);
  const rets = equity.map((e, i) => (i && equity[i - 1] ? e / equity[i - 1] - 1 : 0));
  const mean = rets.reduce((a, b) => a + b, 0) / (n || 1);
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (n || 1));
  const perYear = o.barsPerYear || 365;
  let streak = 0, maxStreak = 0;
  for (const t of trades) { streak = t.pnl <= 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak); }
  const inMarket = trades.reduce((a, t) => a + t.bars, 0);
  return {
    trades, equity,
    stats: {
      net: end - start, netPct: (end / start - 1) * 100, end, trades: trades.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      pf: gl ? gp / gl : gp ? Infinity : 0, avg: trades.length ? trades.reduce((a, t) => a + t.ret, 0) / trades.length : 0,
      avgWin: wins.length ? wins.reduce((a, t) => a + t.ret, 0) / wins.length : 0, avgLoss: losses.length ? losses.reduce((a, t) => a + t.ret, 0) / losses.length : 0,
      maxDD: maxDD * 100, sharpe: sd ? (mean / sd) * Math.sqrt(perYear) : 0, maxLossStreak: maxStreak,
      avgBars: trades.length ? inMarket / trades.length : 0, exposure: n ? (inMarket / n) * 100 : 0,
      bh: bars.length ? (bars[n - 1].close / bars[0].open - 1) * 100 : 0,
    },
  };
}

export function initBacktest(app) {
  const { S, save } = app;
  S.bt = { strat: 'maCross', p: {}, dir: 'long', capital: 10000, size: 100, fee: 0.1, slip: 0.05, sl: 0, tp: 0, hist: 1000,
    entry: { logic: 'and', conds: [{ a: { k: 'ind', type: 'RSI', p: { n: 14 }, o: 0 }, op: 'xup', b: { k: 'num', v: 30 } }] },
    exit: { logic: 'or', conds: [{ a: { k: 'ind', type: 'RSI', p: { n: 14 }, o: 0 }, op: 'xdn', b: { k: 'num', v: 70 } }] }, ...S.bt };
  const cfg = S.bt;
  let eqChart = null;

  async function getBars(target) {
    let bars = app.bars.slice();
    if (app.replaying) return bars;
    const iv = S.interval, sym = S.symbol;
    let guard = 0;
    while (bars.length < target && guard++ < 10) {
      const rows = await app.data.fetchKlines(sym, iv, { endTime: bars[0].utc, limit: 1000 });
      const older = rows.filter(r => r.utc < bars[0].utc).map(r => ({ ...r, intraday: bars[0].intraday }));
      if (!older.length) break;
      bars = older.concat(bars);
    }
    return bars.slice(-target);
  }

  function open() {
    const M = makeModal(app, 'btModal', '策略回測', 'xwide');
    const b = M.body; b.className = 'mbody bt-body'; b.innerHTML = '';
    const form = el('div', 'bt-form');
    const res = el('div', 'bt-res', '<div class="muted">設定好策略後按「開始回測」。回測使用目前主圖的商品與週期。</div>');
    b.append(form, res);
    const row = (label, ctrl) => { const r = el('label', 'row', `<span>${label}</span>`); r.append(ctrl); form.append(r); return r; };
    form.append(el('div', 'bt-sym', `<b>${esc(app.symLabel(S.symbol))}</b> · ${app.data.INTERVALS.find(i => i.k === S.interval).label}${app.replaying ? '（回放中：只用到目前回放位置）' : ''}`));
    row('策略', select(Object.entries(STRATEGIES).map(([k, v]) => [k, v.name]), cfg.strat, v => { cfg.strat = v; save(); open(); }));
    const st = STRATEGIES[cfg.strat];
    cfg.p[cfg.strat] ||= Object.fromEntries(st.params.map(p => [p[0], p[2]]));
    const sp = cfg.p[cfg.strat];
    for (const [k, label] of st.params) row(label, numInput(sp[k], v => { sp[k] = v; save(); }, { width: '80px' }));
    if (cfg.strat === 'custom') {
      form.append(el('h4', '', '進場條件（做多）'), ruleEditor(cfg.entry, save), el('h4', '', '出場條件（或反手做空）'), ruleEditor(cfg.exit, save));
    }
    if (cfg.strat === 'script') {
      const scs = (S.scripts || []).filter(s => /\b(buy|sell)\s*\(/.test(s.code));
      if (!scs.length) form.append(el('div', 'muted', '還沒有包含 buy()/sell() 的腳本。到「自訂腳本」新增，或套用範例「雙均線交叉策略」。'));
      else { if (!scs.some(s => s.id === cfg.sid)) cfg.sid = scs[0].id; row('腳本', select(scs.map(s => [s.id, s.name]), cfg.sid, v => { cfg.sid = v; save(); })); }
    }
    form.append(el('h4', '', '交易設定'));
    row('方向', select([['long', '只做多'], ['both', '多空雙向'], ['short', '只做空']], cfg.dir, v => { cfg.dir = v; save(); }));
    row('初始資金', numInput(cfg.capital, v => { cfg.capital = v > 0 ? v : 10000; save(); }, { width: '100px' }));
    row('每筆部位（資金 %）', numInput(cfg.size, v => { cfg.size = v > 0 ? v : 100; save(); }, { width: '80px' }));
    row('手續費（單邊 %）', numInput(cfg.fee, v => { cfg.fee = v >= 0 ? v : 0; save(); }, { width: '80px' }));
    row('滑價（%）', numInput(cfg.slip, v => { cfg.slip = v >= 0 ? v : 0; save(); }, { width: '80px' }));
    row('停損（%，0＝不設）', numInput(cfg.sl, v => { cfg.sl = v >= 0 ? v : 0; save(); }, { width: '80px' }));
    row('停利（%，0＝不設）', numInput(cfg.tp, v => { cfg.tp = v >= 0 ? v : 0; save(); }, { width: '80px' }));
    row('回測 K 棒數', select([['500', '500'], ['1000', '1,000'], ['2000', '2,000'], ['5000', '5,000'], ['10000', '10,000']], String(cfg.hist), v => { cfg.hist = +v; save(); }));
    const go = el('button', 'btn primary wide', '開始回測');
    form.append(go);
    go.onclick = async () => {
      go.disabled = true; go.textContent = '計算中…';
      try { await run(res); } catch (e) { res.innerHTML = `<div class="down">回測失敗：${esc(e.message)}</div>`; }
      go.disabled = false; go.textContent = '開始回測';
    };
    M.open();
  }

  async function run(res) {
    const bars = await getBars(cfg.hist);
    if (bars.length < 50) throw new Error('K 棒太少');
    let sig;
    if (cfg.strat === 'custom') sig = { buy: ruleSeries(cfg.entry, bars), sell: ruleSeries(cfg.exit, bars) };
    else if (cfg.strat === 'script') {
      const sc = (S.scripts || []).find(s => s.id === cfg.sid);
      if (!sc) throw new Error('請先選擇腳本');
      const r = runScript(sc.code, bars);
      if (r.error) throw new Error('腳本錯誤：' + r.error);
      sig = { buy: r.buy || [], sell: r.sell || [] };
    } else sig = STRATEGIES[cfg.strat].signals(bars, cfg.p[cfg.strat]);
    const sec = app.data.intervalSec(S.interval);
    const r = runBacktest(bars, sig, { ...cfg, barsPerYear: (365 * 86400) / sec });
    show(res, bars, r);
  }

  function show(res, bars, r) {
    const s = r.stats;
    const money = v => (v >= 0 ? '+' : '') + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : '∞');
    const span = `${new Date(bars[0].utc * 1000).toLocaleDateString('zh-TW')} – ${new Date(bars[bars.length - 1].utc * 1000).toLocaleDateString('zh-TW')}`;
    res.innerHTML = `
      <div class="bt-head">${bars.length} 根 K 棒 · ${span}</div>
      <div class="stat-grid">
        <div><small>淨利</small><b class="${app.cls(s.net)}">${money(s.net)}</b><i class="${app.cls(s.netPct)}">${app.pct(s.netPct)}</i></div>
        <div><small>買進持有</small><b class="${app.cls(s.bh)}">${app.pct(s.bh)}</b></div>
        <div><small>最大回撤</small><b class="down-neutral">-${s.maxDD.toFixed(2)}%</b></div>
        <div><small>交易次數</small><b>${s.trades}</b></div>
        <div><small>勝率</small><b>${s.winRate.toFixed(1)}%</b></div>
        <div><small>獲利因子</small><b>${f2(s.pf)}</b></div>
        <div><small>平均每筆</small><b class="${app.cls(s.avg)}">${app.pct(s.avg)}</b></div>
        <div><small>平均獲利／虧損</small><b><span class="up-neutral">${app.pct(s.avgWin)}</span> / <span>${app.pct(s.avgLoss)}</span></b></div>
        <div><small>夏普值</small><b>${f2(s.sharpe)}</b></div>
        <div><small>最長連虧</small><b>${s.maxLossStreak} 筆</b></div>
        <div><small>平均持有</small><b>${s.avgBars.toFixed(1)} 根</b></div>
        <div><small>持倉時間</small><b>${s.exposure.toFixed(1)}%</b></div>
      </div>
      <div class="eq-wrap"><div class="eq-title">資金曲線 <span class="muted">（橘：策略／灰：買進持有）</span></div><div class="eq-chart" id="eqChart"></div></div>
      <div class="bt-actions"><button class="btn" data-a="mk">在主圖標示交易</button><button class="btn" data-a="clr">清除標示</button><button class="btn" data-a="csv">匯出交易明細 CSV</button></div>
      <div class="trade-table"><table><thead><tr><th>#</th><th>方向</th><th>進場時間</th><th>進場價</th><th>出場時間</th><th>出場價</th><th>報酬</th><th>根數</th><th>原因</th></tr></thead><tbody>
      ${r.trades.slice().reverse().map((t, k) => `<tr><td>${r.trades.length - k}</td><td>${t.side === 1 ? '多' : '空'}</td><td>${tstr(bars[t.entryI].utc)}</td><td>${app.fmtS(S.symbol, t.entry)}</td><td>${tstr(bars[t.exitI].utc)}</td><td>${app.fmtS(S.symbol, t.exit)}</td><td class="${app.cls(t.ret)}">${app.pct(t.ret)}</td><td>${t.bars}</td><td>${t.reason}</td></tr>`).join('')}
      </tbody></table>${r.trades.length ? '' : '<div class="muted" style="padding:10px">這段期間沒有任何交易</div>'}</div>`;
    // equity chart
    try { eqChart?.remove(); } catch {}
    const box = res.querySelector('#eqChart');
    eqChart = LC.createChart(box, app.baseOptions());
    eqChart.applyOptions(app.themeOptions());
    eqChart.applyOptions({ handleScroll: false, handleScale: false });
    const off = app.tzOffset();
    const line = eqChart.addSeries(LC.AreaSeries, { lineColor: '#f5a524', topColor: 'rgba(245,165,36,.3)', bottomColor: 'rgba(245,165,36,0)', lineWidth: 2, priceLineVisible: false });
    const bh = eqChart.addSeries(LC.LineSeries, { color: '#64748b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const cap = cfg.capital;
    line.setData(r.equity.map((v, i) => ({ time: bars[i].utc + off, value: v })));
    bh.setData(bars.map(b => ({ time: b.utc + off, value: (cap * b.close) / bars[0].open })));
    eqChart.timeScale().fitContent();
    const markers = () => {
      const { up, down } = app.upDown();
      const mk = [];
      for (const t of r.trades) {
        mk.push({ utc: bars[t.entryI].utc, position: t.side === 1 ? 'belowBar' : 'aboveBar', shape: t.side === 1 ? 'arrowUp' : 'arrowDown', color: t.side === 1 ? up : down, text: t.side === 1 ? '多' : '空' });
        mk.push({ utc: bars[t.exitI].utc, position: t.side === 1 ? 'aboveBar' : 'belowBar', shape: 'circle', color: '#f5a524', text: `${t.ret >= 0 ? '+' : ''}${t.ret.toFixed(1)}%` });
      }
      return mk;
    };
    res.querySelector('[data-a=mk]').onclick = () => { app.setMarkers(markers()); app.closeModals(); app.toast(`已在主圖標示 ${r.trades.length} 筆交易`); };
    res.querySelector('[data-a=clr]').onclick = () => app.setMarkers([]);
    res.querySelector('[data-a=csv]').onclick = () => download(`backtest_${S.symbol}_${S.interval}.csv`, '﻿方向,進場時間,進場價,出場時間,出場價,報酬%,根數,原因\n' + r.trades.map(t => [t.side === 1 ? '多' : '空', tstr(bars[t.entryI].utc), t.entry, tstr(bars[t.exitI].utc), t.exit, t.ret.toFixed(3), t.bars, t.reason].join(',')).join('\n'), 'text/csv');
    app.setMarkers(markers());
  }
  const tstr = utc => { const d = new Date((utc + app.tzOffset()) * 1000); const p = n => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
  app.backtest = { open };
}
