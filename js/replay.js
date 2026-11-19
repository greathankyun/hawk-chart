// Bar replay: pick a starting bar, then play history forward bar by bar
// (with speed control) and practise with simulated trades.
import { el, esc } from './ui.js';

export function initReplay(app) {
  const wrap = document.querySelector('.chart-wrap');
  const bar = el('div', 'replay-bar'); bar.hidden = true;
  const hint = el('div', 'replay-hint', '點一下圖表上的 K 棒，從那裡開始回放'); hint.hidden = true;
  wrap.append(bar, hint);
  let timer = null, picking = false, speed = 1;
  let pos = null, trades = [], realized = 0;

  const lastClose = () => app.bars[app.bars.length - 1]?.close;
  const pnlPct = p => (p ? ((lastClose() - p.entry) / p.entry) * 100 * (p.side === 'long' ? 1 : -1) : 0);

  function render() {
    const n = app.bars.length, total = app.replayTotal;
    const playing = !!timer;
    bar.innerHTML = `
      <button class="rp-btn" data-a="pick" title="重新選擇起點">⌖</button>
      <button class="rp-btn" data-a="back" title="後退一根">⏮</button>
      <button class="rp-btn main" data-a="play" title="${playing ? '暫停' : '播放'}">${playing ? '⏸' : '▶'}</button>
      <button class="rp-btn" data-a="step" title="前進一根">⏭</button>
      <select data-a="speed" title="速度">${[0.5, 1, 2, 3, 5, 10].map(s => `<option value="${s}" ${s === speed ? 'selected' : ''}>${s}x</option>`).join('')}</select>
      <span class="rp-prog">${n} / ${total}</span>
      <span class="rp-sep"></span>
      <button class="rp-btn buy" data-a="long">買進</button>
      <button class="rp-btn sell" data-a="short">賣出</button>
      <button class="rp-btn" data-a="flat" ${pos ? '' : 'disabled'}>平倉</button>
      <span class="rp-pnl">${pos ? `${pos.side === 'long' ? '多' : '空'} @ ${app.fmt(pos.entry)} <b class="${app.cls(pnlPct(pos))}">${app.pct(pnlPct(pos))}</b> · ` : ''}已實現 <b class="${app.cls(realized)}">${app.pct(realized)}</b> · ${trades.length} 筆</span>
      <span class="rp-sep"></span>
      <button class="rp-btn exit" data-a="exit" title="結束回放，回到即時">結束回放</button>`;
    bar.querySelector('[data-a=speed]').onchange = e => { speed = +e.target.value; if (timer) { stopTimer(); play(); } };
  }
  const stopTimer = () => { clearInterval(timer); timer = null; };
  function play() {
    stopTimer();
    timer = setInterval(() => { if (!app.replayStep()) { stopTimer(); render(); app.toast('已播放到最新 K 棒'); } }, 1000 / speed);
    render();
  }
  function mark(side, text) {
    const b = app.bars[app.bars.length - 1];
    const { up, down } = app.upDown();
    markers.push({ utc: b.utc, position: side === 'long' ? 'belowBar' : 'aboveBar', shape: side === 'long' ? 'arrowUp' : 'arrowDown', color: side === 'long' ? up : down, text });
    app.setMarkers(markers);
  }
  let markers = [];
  function trade(side) {
    if (pos && pos.side === side) return;
    if (pos) close();
    pos = { side, entry: lastClose() };
    mark(side, side === 'long' ? '買' : '賣');
    render();
  }
  function close() {
    if (!pos) return;
    const r = pnlPct(pos);
    realized += r; trades.push({ ...pos, exit: lastClose(), r });
    mark(pos.side === 'long' ? 'short' : 'long', `平 ${r >= 0 ? '+' : ''}${r.toFixed(2)}%`);
    pos = null; render();
  }
  bar.onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || a === 'speed') return;
    if (a === 'play') timer ? (stopTimer(), render()) : play();
    else if (a === 'step') { stopTimer(); app.replayStep(); }
    else if (a === 'back') { stopTimer(); app.replayBack(); }
    else if (a === 'pick') { stopTimer(); startPick(); }
    else if (a === 'long' || a === 'short') trade(a);
    else if (a === 'flat') close();
    else if (a === 'exit') exit();
  };
  function startPick() {
    picking = true; hint.hidden = false; wrap.classList.add('picking');
  }
  app.chart.subscribeClick(p => {
    if (!picking || p.logical == null) return;
    picking = false; hint.hidden = true; wrap.classList.remove('picking');
    const idx = Math.max(10, Math.round(p.logical));
    if (!app.replaying) { trades = []; realized = 0; pos = null; markers = []; }
    app.replayStart(idx);
    bar.hidden = false; render();
  });
  function enter() {
    if (!app.bars.length) return;
    if (app.replaying) { bar.hidden = false; render(); return; }
    startPick();
    bar.hidden = true;
    app.toast('回放模式：點一下圖表上的 K 棒作為起點（按 Esc 取消）');
  }
  function exit() {
    stopTimer(); picking = false; hint.hidden = true; wrap.classList.remove('picking');
    bar.hidden = true;
    if (trades.length) app.toast(`回放結束：${trades.length} 筆模擬交易，累計 ${app.pct(realized)}`, 6000);
    markers = []; app.setMarkers([]);
    app.replayStop();
  }
  app.on('replayStep', () => { if (!bar.hidden) render(); });
  app.on('replay', () => { if (!app.replaying) { stopTimer(); bar.hidden = true; } });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && picking) { picking = false; hint.hidden = true; wrap.classList.remove('picking'); }
    if (!app.replaying || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    if (e.key === 'ArrowRight' && e.shiftKey) { e.preventDefault(); app.replayStep(); }
    if (e.key === 'ArrowLeft' && e.shiftKey) { e.preventDefault(); app.replayBack(); }
  });
  app.replayUI = { enter, exit };
  void esc;
}
