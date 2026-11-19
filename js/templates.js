// Chart templates (indicator sets + chart type + layout) and full backup/restore.
import { el, esc, makeModal, uid, download, pickFile } from './ui.js';

export function initTemplates(app) {
  const { S, save } = app;
  S.templates ||= [];
  const BUILTIN = [
    { id: 'b1', name: '台股經典（MA5/20/60＋量＋KD＋MACD）', builtin: true, chartType: 'candle', indicators: [
      { type: 'MA', p: { n: 5 }, color: '#facc15' }, { type: 'MA', p: { n: 20 }, color: '#f472b6' }, { type: 'MA', p: { n: 60 }, color: '#38bdf8' },
      { type: 'VOL', p: { n: 20 }, color: '#64748b' }, { type: 'KD', p: { n: 9 }, color: '#f5a524' }, { type: 'MACD', p: { f: 12, s: 26, g: 9 }, color: '#38bdf8' }] },
    { id: 'b2', name: '趨勢交易（EMA20/50/200＋超級趨勢＋ADX）', builtin: true, chartType: 'candle', indicators: [
      { type: 'EMA', p: { n: 20 }, color: '#f5a524' }, { type: 'EMA', p: { n: 50 }, color: '#38bdf8' }, { type: 'EMA', p: { n: 200 }, color: '#a78bfa' },
      { type: 'ST', p: { n: 10, m: 3 }, color: '#10b981' }, { type: 'DMI', p: { n: 14 }, color: '#f5a524' }] },
    { id: 'b3', name: '波段（布林＋RSI＋成交量分佈）', builtin: true, chartType: 'candle', indicators: [
      { type: 'BOLL', p: { n: 20, m: 2 }, color: '#a78bfa' }, { type: 'VOL', p: { n: 20 }, color: '#64748b' }, { type: 'VP', p: { rows: 30, va: 70 }, color: '#f5a524' }, { type: 'RSI', p: { n: 14 }, color: '#c084fc' }] },
    { id: 'b4', name: '一目均衡表', builtin: true, chartType: 'candle', indicators: [{ type: 'ICHI', p: { t: 9, k: 26, s: 52 }, color: '#38bdf8' }, { type: 'VOL', p: { n: 20 }, color: '#64748b' }] },
    { id: 'b5', name: '乾淨 K 線（無指標）', builtin: true, chartType: 'candle', indicators: [] },
  ];

  function applyTpl(t) {
    S.indicators = t.indicators.map((x, i) => ({ ...JSON.parse(JSON.stringify(x)), id: 'i' + Date.now() + i }));
    if (t.chartType) app.setChartType(t.chartType); else app.buildSeries();
    if (t.layout && app.layout) { S.layout.mode = t.layout.mode; S.layout.cells = JSON.parse(JSON.stringify(t.layout.cells || [])); app.layout.apply(); }
    if (t.interval) app.setInterval(t.interval);
    save();
    app.toast('已套用範本：' + esc(t.name));
  }

  function open() {
    const M = makeModal(app, 'tplModal', '圖表範本', '');
    const b = M.body; b.className = 'mbody form-body'; b.innerHTML = '';
    const nameRow = el('div', 'inline');
    const name = el('input'); name.placeholder = '範本名稱，例如：我的當沖版面';
    const incLayout = el('label', 'mini', '<input type="checkbox" checked> 含版面');
    const incIv = el('label', 'mini', '<input type="checkbox"> 含週期');
    const saveBtn = el('button', 'btn primary', '儲存目前設定');
    saveBtn.onclick = () => {
      const n = name.value.trim() || `範本 ${S.templates.length + 1}`;
      S.templates.push({
        id: uid(), name: n, chartType: S.chartType, indicators: JSON.parse(JSON.stringify(S.indicators)),
        layout: incLayout.querySelector('input').checked ? JSON.parse(JSON.stringify({ mode: S.layout.mode, cells: S.layout.cells })) : null,
        interval: incIv.querySelector('input').checked ? S.interval : null,
      });
      save(); app.emit('dataChanged'); open(); app.toast('已儲存範本：' + esc(n));
    };
    nameRow.append(name, saveBtn);
    b.append(el('h4', '', '把目前圖表存成範本'), nameRow);
    const opts = el('div', 'inline'); opts.append(incLayout, incIv); b.append(opts);
    const list = (title, arr) => {
      b.append(el('h4', '', title));
      const ul = el('ul', 'tpl-list');
      if (!arr.length) ul.append(el('li', 'empty', '尚無範本'));
      for (const t of arr) {
        const li = el('li', '', `<span class="t-name">${esc(t.name)}<small>${t.indicators.length} 個指標${t.layout ? ' · 版面' : ''}${t.interval ? ' · ' + t.interval : ''}</small></span>`);
        const ap = el('button', 'btn', '套用'); ap.onclick = () => { applyTpl(t); app.closeModals(); };
        li.append(ap);
        if (!t.builtin) {
          const del = el('button', 'icon-btn danger', '✕'); del.title = '刪除';
          del.onclick = () => { S.templates = S.templates.filter(x => x !== t); save(); app.emit('dataChanged'); open(); };
          li.append(del);
        }
        ul.append(li);
      }
      b.append(ul);
    };
    list('我的範本', S.templates);
    list('內建範本', BUILTIN);
    b.append(el('h4', '', '備份與還原（全部設定、自選、警示、腳本、畫線）'));
    const row = el('div', 'inline');
    const ex = el('button', 'btn', '匯出備份檔');
    ex.onclick = () => download(`hawk-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportAll(), null, 1));
    const im = el('button', 'btn', '匯入備份檔');
    im.onclick = async () => {
      const txt = await pickFile(); if (!txt) return;
      try { importAll(JSON.parse(txt)); app.toast('已匯入，重新載入中…'); setTimeout(() => location.reload(), 600); } catch (e) { app.toast('匯入失敗：' + esc(e.message)); }
    };
    row.append(ex, im); b.append(row);
    M.open();
  }

  function exportAll() {
    const out = { app: 'hawk-chart', v: 1, at: Date.now(), state: JSON.parse(JSON.stringify(S)), drawings: {} };
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('hawk.drawings.')) out.drawings[k.slice(14)] = JSON.parse(localStorage.getItem(k) || '[]'); }
    delete out.state.cloud;
    return out;
  }
  function importAll(data, { keepCloud = true } = {}) {
    if (data.app !== 'hawk-chart' || !data.state) throw new Error('不是鷹眼看盤的備份檔');
    const cloud = S.cloud;
    const next = { ...data.state };
    if (keepCloud) next.cloud = cloud;
    localStorage.setItem('hawk.state', JSON.stringify(next));
    for (const [sym, items] of Object.entries(data.drawings || {})) localStorage.setItem('hawk.drawings.' + sym, JSON.stringify(items));
  }
  app.templates = { open, exportAll, importAll, applyTpl };
}
