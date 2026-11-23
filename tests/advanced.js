// Advanced features smoke/e2e test (demo data, no network). Run: node tests/advanced.js
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const T = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.html': 'text/html' };
const srv = http.createServer((q, r) => { let f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'text/html' }); r.end(d); }); }).listen(8132);
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL:', m); } };
const shots = process.env.SHOTS;

async function boot(ctx) {
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('dialog', d => { p.errs.push('DIALOG ' + d.message()); d.dismiss(); });
  await p.route(/binance|workers\.dev|ntfy|telegram/, r => r.abort());
  await p.goto('http://localhost:8132/');
  await p.waitForFunction(() => window.__hawk && window.__hawk.bars.length > 0);
  await p.waitForTimeout(400);
  return p;
}
const ev = (p, f, a) => p.evaluate(f, a);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p = await boot(ctx);

  // --- every indicator renders without errors
  const types = await ev(p, () => Object.entries(window.__hawk.app.I.CATALOG).filter(([, d]) => !d.hidden).map(([k]) => k));
  ok(types.length >= 50, 'catalog has 50+ indicators: ' + types.length);
  for (const t of types) {
    await ev(p, t => { const a = window.__hawk.app; a.S.indicators = [{ id: 'x', type: t, p: a.I.withDefaults(t), color: '#38bdf8' }]; a.buildSeries(); }, t);
    const vals = await ev(p, () => { const a = window.__hawk.app; const r = a.layer.values(a.bars.length - 1); return r.map(x => x.vals.filter(v => v != null && !Number.isNaN(v)).length); });
    const def = await ev(p, t => window.__hawk.app.I.CATALOG[t].out.length, t);
    ok(def === 0 || vals.some(n => n > 0), `indicator ${t} produces values`);
  }
  ok(p.errs.length === 0, 'no errors after all indicators: ' + p.errs.join('|'));
  // restore defaults via UI catalog
  await ev(p, () => { const a = window.__hawk.app; a.S.indicators = [{ id: 'i1', type: 'MA', p: { n: 20 }, color: '#f5a524' }, { id: 'i3', type: 'VOL', p: { n: 20 }, color: '#64748b' }, { id: 'i4', type: 'MACD', p: { f: 12, s: 26, g: 9 }, color: '#38bdf8' }]; a.buildSeries(); });
  await p.click('#indBtn');
  await p.fill('#indFilter', '布林');
  ok(await p.locator('#indCatalog li:not(.i-group)').count() >= 2, 'indicator search filters');
  await p.click('#indCatalog li:has-text("布林通道 BOLL")');
  ok(await ev(p, () => window.__hawk.S.indicators.some(x => x.type === 'BOLL')), 'add BOLL via modal');
  await p.click('#indActive li:has-text("BOLL") button[title="隱藏"]');
  ok(await ev(p, () => window.__hawk.S.indicators.find(x => x.type === 'BOLL').hidden === true), 'hide indicator');
  await p.keyboard.press('Escape');

  // --- chart types incl. new ones
  for (const t of ['hollow', 'baseline', 'candle']) { await ev(p, t => window.__hawk.app.setChartType(t), t); await p.waitForTimeout(100); }
  ok(p.errs.length === 0, 'chart types ok');

  // --- multi chart layout
  await p.click('#layoutBtn');
  await p.click('.lay-btn:has-text("四宮格")');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(800);
  ok(await p.locator('.mini-cell').count() === 3, '4-grid shows 3 mini charts');
  const miniBars = await ev(p, () => window.__hawk.app.layout.minis.map(m => m.bars.length));
  ok(miniBars.every(n => n > 50), 'minis loaded bars ' + miniBars);
  const ivs = await ev(p, () => window.__hawk.app.layout.minis.map(m => m.cfg.interval));
  ok(new Set(ivs).size === 3, 'minis default to different timeframes ' + ivs);
  // crosshair sync
  const cb = await p.locator('#chart').boundingBox();
  await p.mouse.move(cb.x + cb.width * .6, cb.y + cb.height * .3);
  await p.waitForTimeout(200);
  ok(p.errs.length === 0, 'crosshair sync no errors ' + p.errs.join('|'));
  if (shots) await p.screenshot({ path: shots + '/layout4.png' });
  // symbol sync
  await ev(p, () => window.__hawk.app.switchSymbol('ETHUSDT'));
  await p.waitForTimeout(800);
  ok((await ev(p, () => window.__hawk.app.layout.minis.map(m => m.cfg.symbol))).every(s => s === 'ETHUSDT'), 'symbol sync to minis');
  // mini change interval
  await p.selectOption('.mini-cell >> nth=0 >> .mini-head select >> nth=0', '1w');
  await p.waitForTimeout(500);
  ok(await ev(p, () => window.__hawk.app.layout.minis[0].cfg.interval === '1w'), 'mini interval change');
  // swap
  await p.click('.mini-cell >> nth=0 >> button[title="與主圖交換"]');
  await p.waitForTimeout(800);
  ok(await ev(p, () => window.__hawk.S.interval === '1w'), 'swap moves mini timeframe to main');
  await ev(p, () => { window.__hawk.app.setInterval('1h'); });
  await p.waitForTimeout(500);
  await p.keyboard.press('Escape');
  await p.click('#layoutBtn'); await p.click('.lay-btn:has-text("單圖")'); await p.keyboard.press('Escape');
  ok(await p.locator('.mini-cell').count() === 0, 'back to single');

  // --- replay
  await p.click('#replayBtn');
  ok(await p.isVisible('.replay-hint'), 'replay pick hint');
  await p.mouse.click(cb.x + cb.width * .4, cb.y + cb.height * .4);
  await p.waitForTimeout(300);
  ok(await ev(p, () => window.__hawk.app.replaying), 'replay started');
  const n0 = await ev(p, () => window.__hawk.bars.length);
  ok(n0 < await ev(p, () => window.__hawk.app.replayTotal), 'bars truncated');
  await p.click('.rp-btn[data-a=step]'); await p.click('.rp-btn[data-a=step]');
  ok(await ev(p, () => window.__hawk.bars.length) === n0 + 2, 'step forward');
  await p.click('.rp-btn[data-a=back]');
  ok(await ev(p, () => window.__hawk.bars.length) === n0 + 1, 'step back');
  await p.click('.rp-btn[data-a=long]');
  for (let i = 0; i < 5; i++) await p.click('.rp-btn[data-a=step]');
  await p.click('.rp-btn[data-a=flat]');
  ok((await p.textContent('.rp-pnl')).includes('1 筆'), 'paper trade recorded');
  await p.selectOption('.replay-bar select', '10');
  await p.click('.rp-btn[data-a=play]'); await p.waitForTimeout(700); await p.click('.rp-btn[data-a=play]');
  ok(await ev(p, () => window.__hawk.bars.length) > n0 + 6, 'play advances');
  if (shots) await p.screenshot({ path: shots + '/replay.png' });
  await p.click('.rp-btn[data-a=exit]');
  ok(!(await ev(p, () => window.__hawk.app.replaying)) && await ev(p, () => window.__hawk.bars.length) >= 1000, 'replay exit restores bars');

  // --- scripts
  await p.click('#toolsBtn'); await p.click('.tm-item[data-k=scripts]');
  await p.click('.sc-list li:has-text("雙均線交叉策略")');
  await p.click('#scriptModal .btn.primary');
  await p.waitForTimeout(300);
  ok(await ev(p, () => window.__hawk.S.scripts.length === 1 && window.__hawk.S.indicators.some(x => x.type === 'SCRIPT')), 'script saved + added');
  ok((await p.textContent('.sc-out')).includes('執行成功'), 'script ran');
  await p.fill('textarea.code', 'plot(nope)');
  await p.click('#scriptModal .btn:has-text("試算")');
  ok((await p.textContent('.sc-out')).includes('錯誤'), 'script error shown');
  await p.keyboard.press('Escape');
  // script indicator in subpane
  await ev(p, () => { const a = window.__hawk.app; a.S.scripts.push({ id: 's2', name: 'RSI測試', overlay: false, code: "plot(ta.rsi(close,14),'R','#c084fc'); hline(70); hline(30);" }); a.addScriptIndicator(a.S.scripts[1]); });
  // pane sizes are only known after the next frame; the legend retries on rAF, so wait for it
  await p.waitForFunction(() => document.querySelector('#paneLegends').textContent.includes('RSI測試'), null, { timeout: 2000 }).catch(() => {});
  ok((await p.textContent('#paneLegends')).includes('RSI測試'), 'script pane legend');

  // --- alerts
  await p.click('#toolsBtn'); await p.click('.tm-item[data-k=alerts]');
  ok(await p.isVisible('#alertModal'), 'alert editor opens');
  await p.click('#alertModal .rule-ed > .btn');
  ok(await p.locator('#alertModal .cond-row').count() === 2, 'add condition row');
  await p.click('#alertModal .btn:has-text("用目前圖表測試")');
  ok((await p.textContent('#alertModal .muted.small')).includes('根 K 棒'), 'alert test runs');
  await p.click('#alertModal .btn.primary');
  ok(await ev(p, () => window.__hawk.S.alerts.some(a => a.kind === 'rule')), 'rule alert created');
  ok(await p.locator('#alerts li:has-text("條件警示")').count() >= 1, 'rule alert listed');
  // a rule that is always true fires
  await ev(p, () => { const a = window.__hawk.app; a.S.alerts.push({ id: 'z', kind: 'rule', symbol: a.S.symbol, interval: a.S.interval, freq: 'bar', name: '永遠成立', rule: { logic: 'and', conds: [{ a: { k: 'price', f: 'close' }, op: 'gt', b: { k: 'num', v: 0 } }] } }); a.emit('tick'); });
  await p.waitForTimeout(1200);
  ok(await ev(p, () => window.__hawk.S.alertLog.some(x => x.msg.includes('永遠成立'))), 'rule alert fires');
  // quick price alert still works
  await p.fill('#alertPrice', '1');
  await p.click('#alertForm button');
  ok(await ev(p, () => window.__hawk.S.alerts.some(a => a.kind === 'price' && a.price === 1)), 'price alert');

  // --- backtest every strategy
  await p.click('#toolsBtn'); await p.click('.tm-item[data-k=backtest]');
  const strats = await p.$$eval('#btModal .bt-form select >> nth=0', s => [...s[0]?.options || []].map(o => o.value)).catch(() => []);
  const list = await ev(p, () => [...document.querySelector('#btModal .bt-form select').options].map(o => o.value));
  for (const s of list) {
    await p.selectOption('#btModal .bt-form select >> nth=0', s);
    if (s === 'script') await p.waitForTimeout(50);
    await p.click('#btModal .btn.primary.wide');
    await p.waitForFunction(() => !document.querySelector('#btModal .btn.primary.wide').disabled, null, { timeout: 15000 });
    const txt = await p.textContent('#btModal .bt-res');
    ok(txt.includes('淨利') && txt.includes('最大回撤'), `backtest ${s}: ${txt.slice(0, 80)}`);
  }
  if (shots) await p.screenshot({ path: shots + '/backtest.png' });
  await p.click('#btModal [data-a=mk]');
  ok(await ev(p, () => !!document.querySelector('#btModal').hidden), 'markers + close');

  // --- screener
  await p.click('#toolsBtn'); await p.click('.tm-item[data-k=screener]');
  await p.click('#scrModal .chip.on'); // clear default preset
  await p.click('#scrModal .chip:has-text("站上 20 均線")');
  await p.click('#scrModal .btn.primary');
  await p.waitForFunction(() => document.querySelector('#scrModal .scr-sum')?.textContent.includes('完成'), null, { timeout: 30000 });
  const sum = await p.textContent('#scrModal .scr-sum');
  ok(/\d+ 檔中有/.test(sum), 'screener result ' + sum);
  await p.click('#scrModal .mini-row select >> nth=0').catch(() => {});
  await p.selectOption('#scrModal .mini-row select >> nth=0', 'tw');
  await p.click('#scrModal .btn.primary');
  await p.waitForFunction(() => document.querySelector('#scrModal .scr-sum')?.textContent.includes('完成'), null, { timeout: 60000 });
  ok(/\d+ 檔/.test(await p.textContent('#scrModal .scr-sum')), 'screener tw market (demo)');
  if (shots) await p.screenshot({ path: shots + '/screener.png' });
  await p.keyboard.press('Escape');

  // --- templates
  await p.click('#toolsBtn'); await p.click('.tm-item[data-k=templates]');
  await p.click('#tplModal li:has-text("一目均衡表") .btn');
  ok(await ev(p, () => window.__hawk.S.indicators.some(x => x.type === 'ICHI')), 'apply builtin template');
  await p.click('#toolsBtn'); await p.click('.tm-item[data-k=templates]');
  await p.fill('#tplModal input', '我的範本');
  await p.click('#tplModal .btn.primary');
  ok(await ev(p, () => window.__hawk.S.templates.some(t => t.name === '我的範本')), 'save template');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#tplModal .btn:has-text("匯出備份檔")')]);
  const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(backup.app === 'hawk-chart' && backup.state.templates.length, 'backup export');
  await p.keyboard.press('Escape');

  // --- volume profile
  await ev(p, () => { const a = window.__hawk.app; a.S.indicators.push({ id: 'vp', type: 'VP', p: { rows: 30, va: 70 }, color: '#f5a524' }); a.buildSeries(); });
  await p.waitForTimeout(200);
  const vpPixels = await ev(p, () => { const c = document.querySelector('.vp-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 40) if (d[i]) n++; return n; });
  ok(vpPixels > 100, 'volume profile draws ' + vpPixels);
  if (shots) await p.screenshot({ path: shots + '/vp.png' });

  // --- cloud settings (no worker): hint shown
  await p.click('#setBtn');
  ok((await p.textContent('.cloud-sec')).includes('行情中繼'), 'cloud needs worker hint');
  await ev(p, () => localStorage.setItem('hawk.workerUrl', 'https://hawk-chart.example.workers.dev'));
  await ev(p, () => window.__hawk.app.cloud.render());
  ok(await p.locator('.cloud-sec .code-inp').count() >= 3, 'cloud form renders with worker url');
  await p.click('.cloud-sec .btn:has-text("產生") >> nth=0');
  ok(await ev(p, () => window.__hawk.S.cloud.code.length >= 20), 'sync code generated');
  await ev(p, () => localStorage.removeItem('hawk.workerUrl'));
  await p.keyboard.press('Escape');

  ok(p.errs.length === 0, 'no page errors (desktop): ' + p.errs.join(' | '));
  await ctx.close();

  // ---------- mobile ----------
  const mctx = await b.newContext({ ...devices['iPhone 13'] });
  const m = await boot(mctx);
  await m.click('#toolsBtn');
  ok(await m.isVisible('.tools-menu'), 'mobile tools menu');
  await m.click('.tm-item[data-k=backtest]');
  await m.click('#btModal .btn.primary.wide');
  await m.waitForFunction(() => document.querySelector('#btModal .bt-res').textContent.includes('淨利'), null, { timeout: 15000 });
  ok(true, 'mobile backtest');
  if (shots) await m.screenshot({ path: shots + '/m-backtest.png' });
  await m.keyboard.press('Escape').catch(() => {});
  await m.evaluate(() => window.__hawk.app.closeModals());
  await m.click('#layoutBtn'); await m.click('.lay-btn:has-text("上下兩圖")');
  await m.waitForTimeout(600);
  ok(await m.locator('.mini-cell').count() === 1, 'mobile 2v layout');
  await m.evaluate(() => document.querySelector('.layout-menu').hidden = true);
  if (shots) await m.screenshot({ path: shots + '/m-layout.png' });
  await m.click('#replayBtn');
  const mb = await m.locator('#chart').boundingBox();
  await m.mouse.click(mb.x + mb.width * .5, mb.y + mb.height * .3);
  await m.waitForTimeout(300);
  ok(await m.isVisible('.replay-bar'), 'mobile replay bar');
  if (shots) await m.screenshot({ path: shots + '/m-replay.png' });
  ok(m.errs.length === 0, 'no page errors (mobile): ' + m.errs.join(' | '));

  await b.close(); srv.close();
  console.log(`advanced: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
