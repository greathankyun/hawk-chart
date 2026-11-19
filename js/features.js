// Wires the advanced feature modules into the app and adds their toolbar entries.
import { initTemplates } from './templates.js';
import { initAlerts } from './alerts.js';
import { initScripts } from './scriptui.js';
import { initVolumeProfile } from './vp.js';
import { initReplay } from './replay.js';
import { initLayout } from './layout.js';
import { initScreener } from './screener.js';
import { initBacktest } from './backtest.js';
import { initCloud } from './cloud.js';
import { el } from './ui.js';

const ICON = {
  replay: 'M12 4a8 8 0 1 1-7.7 10h2.1A6 6 0 1 0 8 7.5L10 9.5H4v-6l2.6 2.6A8 8 0 0 1 12 4zm-1.5 4.5 5 3.5-5 3.5z',
  tools: 'M4 5h7v6H4zm9 0h7v6h-7zM4 13h7v6H4zm9 0h7v6h-7z',
};
const MENU = [
  ['replay', '⏯', 'K 線回放', '從過去任一根 K 棒重播行情，練習判斷與模擬下單'],
  ['backtest', '📈', '策略回測', '內建策略、自訂條件或腳本，含手續費、停損停利與資金曲線'],
  ['screener', '🔎', '選股器', '用技術條件掃描加密貨幣、台股、美股等清單'],
  ['scripts', '📜', '自訂腳本', '用 JavaScript 寫自己的指標與策略'],
  ['alerts', '🔔', '條件警示', '多個指標條件組合，任何商品與週期'],
  ['templates', '🗂', '圖表範本與備份', '儲存／套用指標組合與版面，匯出匯入全部設定'],
  ['cloud', '☁', '雲端同步', '跨裝置同步，App 關閉也能推播警示'],
];

export function initFeatures(app) {
  initTemplates(app);
  initAlerts(app);
  initScripts(app);
  initVolumeProfile(app);
  initReplay(app);
  initLayout(app);
  initScreener(app);
  initBacktest(app);
  initCloud(app);

  const ind = document.getElementById('indBtn');
  const rp = el('button', 'tb-btn', `<svg viewBox="0 0 24 24" class="ico"><path d="${ICON.replay}"/></svg><span class="lbl">回放</span>`);
  rp.id = 'replayBtn'; rp.title = 'K 線回放';
  rp.onclick = () => app.replayUI.enter();
  const tools = el('button', 'tb-btn', `<svg viewBox="0 0 24 24" class="ico"><path d="${ICON.tools}"/></svg><span class="lbl">工具</span>`);
  tools.id = 'toolsBtn'; tools.title = '進階工具';
  ind.after(rp, tools);

  const menu = el('div', 'pop-menu tools-menu'); menu.hidden = true;
  for (const [k, icon, name, desc] of MENU) {
    const b = el('button', 'tm-item', `<span class="tm-ico">${icon}</span><span><b>${name}</b><small>${desc}</small></span>`);
    b.dataset.k = k;
    b.onclick = () => { menu.hidden = true; run(k); };
    menu.append(b);
  }
  document.body.append(menu);
  tools.onclick = e => {
    e.stopPropagation();
    if (!menu.hidden) { menu.hidden = true; return; }
    const r = tools.getBoundingClientRect();
    menu.style.top = r.bottom + 6 + 'px';
    menu.style.left = Math.max(8, Math.min(window.innerWidth - 328, r.right - 320)) + 'px';
    menu.hidden = false;
  };
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && !tools.contains(e.target)) menu.hidden = true; });
  function run(k) {
    if (k === 'replay') app.replayUI.enter();
    else if (k === 'backtest') app.backtest.open();
    else if (k === 'screener') app.screener.open();
    else if (k === 'scripts') app.scripts.open();
    else if (k === 'alerts') app.openAlerts();
    else if (k === 'templates') app.templates.open();
    else if (k === 'cloud') { document.getElementById('setBtn').click(); setTimeout(() => document.querySelector('.cloud-sec')?.scrollIntoView({ block: 'start' }), 60); }
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.pop-menu').forEach(m => (m.hidden = true)); });
  app.runTool = run;
}
