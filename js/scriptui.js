// Script editor for custom indicators / strategies.
import { runScript, EXAMPLES } from './script.js';
import { el, esc, makeModal, uid } from './ui.js';

const HELP = `<b>資料（陣列）</b> open high low close volume hl2 hlc3 ohlc4 time bar_count<br>
<b>函式</b> ta.sma(x,n) ta.ema ta.wma ta.rma ta.hma ta.dema ta.tema ta.rsi(x,n) ta.macd(x,12,26,9) ta.stdev ta.highest ta.lowest ta.change ta.roc ta.sum ta.linreg ta.crossover(a,b) ta.crossunder(a,b) ta.atr(n) ta.bb(n,m) ta.kd(n) ta.stoch(n) ta.cci ta.dmi ta.obv() ta.vwap() ta.mfi ta.supertrend(n,m) ta.sar() ta.willr<br>
<b>輸出</b> plot(陣列, 名稱, 顏色, {type:'line'|'hist'|'dots'}) · hline(數值, 顏色) · buy(布林陣列) · sell(布林陣列) · alert(布林陣列, 訊息)<br>
<b>工具</b> input(名稱, 預設值) 可調參數 · series(i => …) 逐根計算 · Math`;

export function initScripts(app) {
  const { S, save } = app;
  S.scripts ||= [];
  let cur = null, flash = '';

  function open(sid) {
    const M = makeModal(app, 'scriptModal', '自訂腳本', 'xwide');
    const b = M.body; b.className = 'mbody script-body'; b.innerHTML = '';
    cur = S.scripts.find(x => x.id === sid) || cur && S.scripts.find(x => x.id === cur.id) || S.scripts[0] || null;
    if (!cur) cur = { id: uid(), name: EXAMPLES[0].name, code: EXAMPLES[0].code, overlay: EXAMPLES[0].overlay, unsaved: true };

    const side = el('div', 'sc-side');
    side.append(el('h4', '', '我的腳本'));
    const ul = el('ul', 'sc-list');
    for (const s of S.scripts) {
      const li = el('li', s.id === cur.id ? 'on' : '', esc(s.name));
      li.onclick = () => { cur = s; open(s.id); };
      ul.append(li);
    }
    if (!S.scripts.length) ul.append(el('li', 'empty', '尚無'));
    const nb = el('button', 'btn', '＋ 新腳本');
    nb.onclick = () => { cur = { id: uid(), name: '新腳本', code: "const n = input('週期', 20);\nplot(ta.sma(close, n), '均線', '#f5a524');\n", overlay: true, unsaved: true }; open(); };
    side.append(ul, nb, el('h4', '', '範例'));
    const ex = el('ul', 'sc-list');
    for (const e of EXAMPLES) {
      const li = el('li', '', esc(e.name));
      li.onclick = () => { cur = { id: uid(), name: e.name, code: e.code, overlay: e.overlay, unsaved: true }; open(); };
      ex.append(li);
    }
    side.append(ex);

    const main = el('div', 'sc-main');
    const top = el('div', 'inline');
    const name = el('input'); name.value = cur.name; name.placeholder = '腳本名稱';
    const ov = el('label', 'mini', `<input type="checkbox" ${cur.overlay ? 'checked' : ''}> 疊加在主圖`);
    top.append(name, ov);
    const ta = el('textarea', 'code'); ta.value = cur.code; ta.spellcheck = false; ta.autocapitalize = 'off';
    ta.addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); apply(); }
      e.stopPropagation();
    });
    const out = el('div', 'sc-out');
    const help = el('details', 'sc-help', `<summary>語法說明</summary><div>${HELP}</div>`);
    const act = el('div', 'actions');
    const test = el('button', 'btn', '試算');
    const applyB = el('button', 'btn primary', '儲存並加到圖表');
    const del = el('button', 'btn danger', '刪除');
    act.append(test, del, el('span', 'sp'), applyB);
    main.append(top, ta, out, act, help);
    b.append(side, main);

    // edits stay in a draft until saved
    const draft = () => ({ name: name.value.trim() || '未命名腳本', code: ta.value, overlay: ov.querySelector('input').checked });
    function check() {
      const d = draft();
      const r = runScript(d.code, app.bars);
      if (r.error) { out.innerHTML = `<span class="down">錯誤：${esc(r.error)}</span>`; return null; }
      const buys = r.buy ? r.buy.filter(Boolean).length : 0, sells = r.sell ? r.sell.filter(Boolean).length : 0;
      out.innerHTML = `✓ 執行成功（${app.bars.length} 根 K 棒）：${r.plots.length} 條線${r.hlines.length ? `、${r.hlines.length} 條水平線` : ''}${r.buy || r.sell ? `、買進訊號 ${buys} 次、賣出訊號 ${sells} 次` : ''}${r.alerts.length ? `、${r.alerts.length} 個警示條件` : ''}${r.inputs.length ? `<br>參數：${r.inputs.map(i => `${esc(i.name)}=${i.value}`).join('、')}（可在「指標」視窗調整）` : ''}`;
      return r;
    }
    function apply() {
      const r = check(); if (!r) return;
      Object.assign(cur, draft());
      flash = out.innerHTML;
      const isNew = !S.scripts.some(x => x.id === cur.id);
      delete cur.unsaved;
      if (isNew) S.scripts.push(cur);
      save(); app.emit('dataChanged');
      const exists = S.indicators.find(x => x.type === 'SCRIPT' && x.sid === cur.id);
      if (exists) { exists.name = cur.name; save(); app.buildSeries(); } else app.addScriptIndicator(cur);
      // show strategy signals as markers
      const { up, down } = app.upDown();
      const mk = [];
      r.buy?.forEach((v, i) => v && mk.push({ utc: app.bars[i].utc, position: 'belowBar', shape: 'arrowUp', color: up, text: '買' }));
      r.sell?.forEach((v, i) => v && mk.push({ utc: app.bars[i].utc, position: 'aboveBar', shape: 'arrowDown', color: down, text: '賣' }));
      app.setMarkers(mk);
      app.toast(`已儲存「${esc(cur.name)}」並加到圖表`);
      open(cur.id);
    }
    test.onclick = check;
    applyB.onclick = apply;
    del.onclick = () => {
      S.scripts = S.scripts.filter(x => x.id !== cur.id);
      S.indicators = S.indicators.filter(x => !(x.type === 'SCRIPT' && x.sid === cur.id));
      save(); app.buildSeries(); app.emit('dataChanged'); cur = null; open();
    };
    // inputs editor for the script indicator on the chart
    const ind = S.indicators.find(x => x.type === 'SCRIPT' && x.sid === cur.id);
    if (ind) {
      const r = runScript(cur.code, app.bars, ind.inputs || {});
      if (r.inputs.length) {
        const box = el('div', 'inline sc-inputs');
        box.append(el('small', '', '圖表上的參數：'));
        for (const inp of r.inputs) {
          const lab = el('label', 'mini', `<small>${esc(inp.name)}</small>`);
          const i = el('input'); i.type = 'number'; i.step = 'any'; i.value = inp.value; i.style.width = '64px';
          i.onchange = () => { ind.inputs = { ...ind.inputs, [inp.name]: parseFloat(i.value) }; save(); app.buildSeries(); };
          lab.append(i); box.append(lab);
        }
        main.insertBefore(box, out);
      }
    }
    if (flash) { out.innerHTML = flash; flash = ''; }
    M.open();
  }
  app.on('editScript', sid => open(sid));
  app.scripts = { open };
}
