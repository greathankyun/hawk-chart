// Multi-market tests: runs the real Worker code in Node against simulated Yahoo / Fugle / TWSE responses,
// then drives the app in Chromium with the worker URL configured.   node tests/markets.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL:', m); } };

// ---------------- simulated upstreams ----------------
const calls = [];
const PX = { '2330.TW': 1000, 'AAPL': 230, 'GC=F': 2650, 'USDTWD=X': 32.5, '^TWII': 23000, '6488.TWO': 400 };
const gmtOf = c => (/\.TWO?$|\^TW/.test(c) ? 28800 : /=X$/.test(c) ? 0 : -18000);
function yahooChart(code, q) {
  if (code === 'NOPE') return [404, { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }];
  const ivSec = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '60m': 3600, '1d': 86400, '1wk': 604800, '1mo': 2592000 }[q.get('interval')];
  const now = Math.floor(Date.now() / 1000);
  let p1 = +q.get('period1'), p2 = +q.get('period2');
  if (q.get('range')) { p2 = now; p1 = now - 5 * 86400; }
  const ts = [], o = [], h = [], l = [], c = [], v = [];
  let px = PX[code] || 100;
  // daily bars stamped at the session open like Yahoo; the live (last) bar carries the current time
  const step = ivSec;
  let t = Math.ceil(p1 / step) * step + (ivSec >= 86400 ? 3600 : 0);
  for (; t < Math.min(p2, now); t += step) {
    const d = new Date((t + gmtOf(code)) * 1000).getUTCDay();
    if (!/=X$/.test(code) && (d === 0 || d === 6)) continue;
    ts.push(t); o.push(px); h.push(px * 1.01); l.push(px * 0.99); px *= 1.001; c.push(px); v.push(1000);
    if (ts.length % 97 === 0) { o[o.length - 1] = null; } // Yahoo has null rows
  }
  if (ivSec >= 86400 && ts.length) ts[ts.length - 1] = Math.min(now, ts[ts.length - 1] + 3000); // live bar timestamp drift
  return [200, { chart: { result: [{ meta: { currency: code.endsWith('.TW') ? 'TWD' : 'USD', symbol: code, shortName: code + ' Inc', regularMarketPrice: px, regularMarketTime: ts[ts.length - 1] || now, regularMarketDayHigh: px * 1.02, regularMarketDayLow: px * 0.98, regularMarketVolume: 12345000, gmtoffset: gmtOf(code), exchangeTimezoneName: 'Asia/Taipei', fullExchangeName: 'Taiwan' }, timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }], error: null } }];
}
const resp = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  calls.push(u.host + u.pathname);
  if (u.host.endsWith('finance.yahoo.com')) {
    if (u.pathname.startsWith('/v8/finance/chart/')) { const [s, b] = yahooChart(decodeURIComponent(u.pathname.split('/').pop()), u.searchParams); return resp(s, b); }
    if (u.pathname === '/v1/finance/search') return resp(200, { quotes: [
      { symbol: '7203.T', shortname: 'TOYOTA MOTOR CORP', quoteType: 'EQUITY', exchDisp: 'Tokyo' },
      { symbol: 'TM', shortname: 'Toyota Motor Corporation', quoteType: 'EQUITY', exchDisp: 'NYSE' },
      { symbol: 'XTOY-USD', shortname: 'Toy coin', quoteType: 'CRYPTOCURRENCY' },
    ] });
  }
  if (u.host === 'api.fugle.tw') {
    if (init.headers?.['X-API-KEY'] !== 'k123') return resp(401, { message: 'Unauthorized' });
    if (u.pathname.includes('/intraday/quote/')) return resp(200, { symbol: '2330', name: '台積電', previousClose: 990, openPrice: 995, highPrice: 1012, lowPrice: 993, lastPrice: 1010, total: { tradeVolume: 23000 }, lastUpdated: Date.now() * 1000 });
    if (u.pathname.includes('/intraday/candles/')) {
      const tf = +u.searchParams.get('timeframe'), now = Math.floor(Date.now() / 1000), start = Math.floor(now / 3600) * 3600 - 3 * 3600;
      const data = []; for (let t = start; t <= now; t += tf * 60) data.push({ date: new Date(t * 1000).toISOString(), open: 1001, high: 1011, low: 999, close: 1010, volume: 5 });
      return resp(200, { symbol: '2330', timeframe: String(tf), data });
    }
  }
  if (u.host === 'openapi.twse.com.tw') return resp(200, [{ Code: '2330', Name: '台積電' }, { Code: '2317', Name: '鴻海' }, { Code: '1101', Name: '台泥' }]);
  if (u.host === 'www.tpex.org.tw') return resp(200, [{ SecuritiesCompanyCode: '6488', CompanyName: '環球晶' }, { SecuritiesCompanyCode: '8069', CompanyName: '元太' }]);
  return resp(404, { error: 'unmocked ' + u.host });
};

const W = (await import(path.join(root, 'worker/src/index.js'))).default;
const env = {};
const call = async (p, origin = 'https://greathankyun.github.io') => {
  const r = await W.fetch(new Request('https://w.test' + p, { headers: origin ? { origin } : {} }), env, { waitUntil() {} });
  return { status: r.status, h: r.headers, j: await r.json().catch(() => null) };
};

// ---------------- worker unit tests ----------------
{
  let r = await call('/market/health');
  ok(r.status === 200 && r.j.providers.yahoo && !r.j.providers.fugle, 'health');
  ok(r.h.get('access-control-allow-origin') === 'https://greathankyun.github.io', 'cors header');
  r = await call('/market/health', 'https://evil.example');
  ok(r.status === 403, 'foreign origin blocked');
  ok((await call('/market/health', 'http://localhost:5173')).status === 200, 'localhost allowed');

  for (const iv of ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']) {
    r = await call(`/market/klines?symbol=2330.TW&interval=${iv}&limit=300`);
    const b = r.j.bars;
    const sorted = b.every((x, i) => !i || x[0] > b[i - 1][0]);
    ok(r.status === 200 && b.length > 0 && b.length <= 300 && sorted, `klines ${iv} n=${b.length} sorted=${sorted}`);
    if (iv === '4h') ok(b.every(x => x[0] % 14400 === 0), '4h aligned');
    if (iv === '1d') ok(b.every(x => (x[0] + 0) % 86400 === 0), 'daily at 00:00 UTC of local date');
    if (iv === '1w') ok(b.every(x => new Date(x[0] * 1000).getUTCDay() === 1), 'weekly on Monday');
    if (iv === '1M') ok(b.every(x => new Date(x[0] * 1000).getUTCDate() === 1), 'monthly on 1st');
  }
  r = await call('/market/klines?symbol=2330.TW&interval=1h&limit=100');
  const first = r.j.bars[0][0];
  ok(r.j.meta.delay === 20 && r.j.meta.source === 'Yahoo', 'TW delayed 20 without fugle');
  r = await call(`/market/klines?symbol=2330.TW&interval=1h&limit=100&end=${first}`);
  ok(r.j.bars.length > 0 && r.j.bars.every(b => b[0] < first), 'pagination end');
  r = await call(`/market/klines?symbol=2330.TW&interval=1m&limit=100&end=${Math.floor(Date.now() / 1000) - 40 * 86400}`);
  ok(r.status === 200 && r.j.bars.length === 0, '1m beyond 30 days -> empty');
  r = await call('/market/klines?symbol=NOPE&interval=1d');
  ok(r.status === 404, 'unknown symbol 404');
  r = await call('/market/klines?symbol=bad%20sym!&interval=1d');
  ok(r.status === 400, 'bad symbol 400');
  r = await call('/market/klines?symbol=AAPL&interval=7m');
  ok(r.status === 400, 'bad interval 400');

  r = await call('/market/quotes?symbols=2330.TW,AAPL,GC=F,USDTWD=X,NOPE');
  const qs = r.j.quotes;
  ok(qs.length === 5 && qs[0].last > 0 && qs[0].prevClose > 0 && qs[0].chgPct != null, 'quotes basic');
  ok(qs.find(q => q.code === 'NOPE').error, 'quote error entry');
  ok(qs.find(q => q.code === 'GC=F').delay === 10, 'futures delay');
  ok((await call('/market/quotes?symbols=' + Array(16).fill('AAPL').join(','))).status === 400, 'quote batch cap');

  r = await call('/market/search?q=toyota');
  ok(r.j.results.length === 2 && r.j.results[0].code === '7203.T', 'search filters crypto');
  r = await call('/market/tw-list');
  ok(r.j.list.length === 5 && r.j.list.find(x => x[0] === '6488')[2] === 'TWO', 'tw-list merges TWSE + TPEx');

  // Fugle on
  env.FUGLE_API_KEY = 'k123';
  r = await call('/market/health');
  ok(r.j.providers.fugle, 'fugle enabled');
  r = await call('/market/quotes?symbols=2330.TW,AAPL');
  ok(r.j.quotes[0].source === 'Fugle' && r.j.quotes[0].last === 1010 && r.j.quotes[0].prevClose === 990 && r.j.quotes[0].vol === 23000000 && r.j.quotes[0].name === '台積電', 'fugle quote');
  ok(r.j.quotes[1].source === 'Yahoo', 'US stays Yahoo');
  r = await call('/market/klines?symbol=2330.TW&interval=5m&limit=500');
  const last = r.j.bars[r.j.bars.length - 1];
  ok(r.j.meta.source === 'Fugle' && r.j.meta.delay === 0 && last[4] === 1010, 'fugle intraday merged');
  ok(r.j.bars.every((x, i) => !i || x[0] > r.j.bars[i - 1][0]), 'merged bars sorted');
  r = await call('/market/klines?symbol=2330.TW&interval=1d&limit=50');
  ok(r.j.bars[r.j.bars.length - 1][4] === 1010, 'fugle patches daily bar');
  env.FUGLE_API_KEY = 'wrong';
  r = await call('/market/klines?symbol=2330.TW&interval=5m&limit=50');
  ok(r.status === 200 && r.j.meta.source === 'Yahoo', 'bad fugle key falls back to Yahoo');
  delete env.FUGLE_API_KEY;
}

// ---------------- app e2e with the worker ----------------
const T = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.html': 'text/html' };
const app = http.createServer((q, r) => { let f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'text/html' }); r.end(d); }); }).listen(8131);
const wsrv = http.createServer(async (q, r) => {
  const res = await W.fetch(new Request('http://localhost:8132' + q.url, { headers: { origin: q.headers.origin || '' } }), env, { waitUntil() {} });
  r.writeHead(res.status, Object.fromEntries(res.headers)); r.end(Buffer.from(await res.arrayBuffer()));
}).listen(8132);

const b = await chromium.launch();
async function boot(ctx, workerUrl) {
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  await p.route(/binance/, r => r.abort());
  if (workerUrl) await p.addInitScript(u => { if (!sessionStorage.getItem('x')) { localStorage.setItem('hawk.workerUrl', u); sessionStorage.setItem('x', 1); } }, workerUrl);
  await p.goto('http://localhost:8131/');
  await p.waitForFunction(() => window.__hawk && window.__hawk.bars.length > 0);
  await p.waitForTimeout(400);
  return p;
}
const shots = process.env.SHOTS;
{
  // without worker: market symbols show demo + guidance
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 } });
  const p = await boot(ctx);
  const wl = await p.evaluate(() => window.__hawk.S.watchlist);
  ok(wl.includes('Y:2330.TW') && wl.includes('Y:GC=F'), 'watchlist seeded with markets');
  await p.click('#watchlist li[data-sym="Y:2330.TW"]'); await p.waitForTimeout(600);
  ok(/2330 台積電/.test(await p.textContent('#symName')), 'TW name in header');
  ok(/尚未設定行情中繼/.test(await p.textContent('#demoBadge')) && await p.isVisible('#demoBadge'), 'demo badge explains worker');
  await p.click('#symBtn'); await p.click('#quoteTabs button:text-is("台股")'); await p.waitForTimeout(200);
  ok(await p.isVisible('#symList .tip'), 'setup tip in market tab');
  await p.click('#symList .tip button'); await p.waitForTimeout(200);
  ok(await p.isVisible('#setModal') && await p.isVisible('#setWorker'), 'tip opens settings');
  // configure via settings
  await p.fill('#setWorker', 'http://localhost:8132/');
  await p.click('#saveWorker'); await p.waitForTimeout(1500);
  ok(/已連線/.test(await p.textContent('#workerStatus')), 'settings test ok: ' + await p.textContent('#workerStatus'));
  ok((await p.evaluate(() => localStorage.getItem('hawk.workerUrl'))) === 'http://localhost:8132', 'stored without trailing slash');
  ok(p.errs.length === 0, 'no page errors (no worker): ' + p.errs.join(' | '));
  await ctx.close();
}
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 } });
  const p = await boot(ctx, 'http://localhost:8132');
  await p.click('#watchlist li[data-sym="Y:2330.TW"]');
  await p.waitForFunction(() => window.__hawk.S.symbol === 'Y:2330.TW' && window.__hawk.bars.length > 0);
  await p.waitForTimeout(1200);
  ok(await p.isHidden('#demoBadge'), 'real data: no demo badge');
  ok(/Yahoo · 延遲 20 分/.test(await p.textContent('#legend')), 'legend source');
  ok(/延遲約 20 分/.test(await p.textContent('#statusBadge')), 'status delayed');
  ok(/昨收/.test(await p.textContent('#detail')) && /張/.test(await p.textContent('#detail')), 'TW detail panel');
  const wlPx = await p.textContent('#watchlist li[data-sym="Y:GC=F"] .w-px');
  ok(/\d/.test(wlPx), 'watchlist commodity price ' + wlPx);
  const fx = await p.textContent('#watchlist li[data-sym="Y:USDTWD=X"] .w-px');
  ok(/^\d+\.\d{3,4}$/.test(fx), 'fx precision ' + fx);
  for (const lbl of ['1分', '5分', '15分', '30分', '1時', '4時', '日', '週', '月']) {
    await p.click(`.tf-btn:text-is("${lbl}")`); await p.waitForTimeout(500);
    ok((await p.evaluate(() => window.__hawk.bars.length)) > 0, 'TW tf ' + lbl);
  }
  await p.click('.tf-btn:text-is("5分")'); await p.waitForTimeout(500);
  // scroll back loads history
  const n0 = await p.evaluate(() => window.__hawk.bars.length);
  await p.evaluate(() => window.__hawk.chart.timeScale().setVisibleLogicalRange({ from: 0, to: 100 }));
  await p.waitForTimeout(1500);
  ok((await p.evaluate(() => window.__hawk.bars.length)) > n0, 'load more history');
  // search tabs
  await p.click('#symBtn');
  for (const [tab, re] of [['台股', /台積電/], ['美股', /AAPL/], ['指數', /台灣加權指數/], ['原物料', /黃金/], ['外匯', /美元\/台幣/]]) {
    await p.click(`#quoteTabs button:text-is("${tab}")`); await p.waitForTimeout(800);
    ok(re.test(await p.textContent('#symList')), 'tab ' + tab);
  }
  await p.click('#quoteTabs button:text-is("原物料")'); await p.waitForTimeout(1200);
  ok(/\d/.test(await p.textContent('#symList li[data-sym="Y:GC=F"] .s-px')), 'tab quotes filled');
  if (shots) await p.screenshot({ path: shots + '/search-cmd.png' });
  // full TW list by Chinese name (OTC)
  await p.click('#quoteTabs button:text-is("台股")');
  await p.fill('#symSearch', '元太'); await p.waitForTimeout(900);
  ok(/8069/.test(await p.textContent('#symList')), 'TW list search by name (OTC) ' + (await p.textContent('#symList')).slice(0, 80));
  await p.press('#symSearch', 'Enter'); await p.waitForTimeout(800);
  ok((await p.evaluate(() => window.__hawk.S.symbol)) === 'Y:8069.TWO', 'pick OTC stock');
  // remote search
  await p.click('#symBtn'); await p.click('#quoteTabs button:text-is("全部")');
  await p.fill('#symSearch', 'toyota'); await p.waitForTimeout(1200);
  ok(/7203/.test(await p.textContent('#symList')), 'remote search results');
  await p.click('#symList li[data-sym="Y:7203.T"] .star');
  ok((await p.evaluate(() => window.__hawk.S.watchlist.includes('Y:7203.T'))), 'star remote result');
  await p.keyboard.press('Escape');
  // gold chart + alert
  await p.click('#watchlist li[data-sym="Y:GC=F"]'); await p.waitForTimeout(1200);
  ok(/黃金/.test(await p.textContent('#symName')), 'gold header');
  await p.fill('#alertPrice', '1'); await p.selectOption('#alertDir', 'below'); await p.click('#alertForm button');
  ok((await p.evaluate(() => window.__hawk.S.alerts.some(a => a.symbol === 'Y:GC=F'))), 'alert on commodity');
  // drawings work on market symbols
  await p.click('button[title="水平線"]');
  const bx = await p.locator('#chart').boundingBox();
  await p.mouse.click(bx.x + bx.width * .5, bx.y + bx.height * .5);
  ok((await p.evaluate(() => window.__hawk.drawings.items.length)) === 1, 'draw on commodity');
  // live poll updates last bar (10s)
  const t0 = await p.evaluate(() => window.__hawk.bars.length);
  await p.waitForTimeout(11000);
  ok((await p.evaluate(() => window.__hawk.bars.length)) >= t0, 'poll keeps series');
  if (shots) await p.screenshot({ path: shots + '/desktop-gold.png' });
  // screenshot button filename sanitize
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#shotBtn')]);
  ok(!/[:^=]/.test(dl.suggestedFilename()), 'screenshot name ' + dl.suggestedFilename());
  ok(p.errs.length === 0, 'no page errors: ' + p.errs.join(' | '));
  await ctx.close();
}
{
  // mobile
  const ctx = await b.newContext({ ...devices['iPhone 14'] });
  const p = await boot(ctx, 'http://localhost:8132');
  await p.tap('#sideBtn'); await p.waitForTimeout(300);
  await p.tap('#watchlist li[data-sym="Y:^TWII"]'); await p.waitForTimeout(1500);
  ok(/台灣加權指數/.test(await p.textContent('#symName')), 'mobile index');
  if (shots) await p.screenshot({ path: shots + '/mobile-twii.png' });
  await p.tap('#symBtn'); await p.tap('#quoteTabs button:text-is("台股")'); await p.waitForTimeout(1200);
  if (shots) await p.screenshot({ path: shots + '/mobile-search.png' });
  ok(p.errs.length === 0, 'mobile no errors: ' + p.errs.join(' | '));
  await ctx.close();
}
await b.close(); app.close(); wsrv.close();
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
