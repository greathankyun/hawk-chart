// Tests the worker's /sync and /alerts routes and the scheduled alert checker with an
// in-memory KV and mocked upstream APIs. Run: node tests/cloud.mjs
import worker from '../worker/src/index.js';
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL:', m); } };
const store = new Map();
const KV = { async get(k, t) { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); } };
const env = { HAWK: KV };
const sent = [];
let px = 100;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('https://ntfy.sh') || url.includes('api.telegram.org')) { sent.push({ url, body: opts.body }); return new Response('{}', { status: 200 }); }
  if (url.includes('/api/v3/klines')) {
    const iv = new URL(url).searchParams.get('interval'), lim = +new URL(url).searchParams.get('limit');
    const sec = iv === '1m' ? 60 : 3600, now = Math.floor(Date.now() / 1000 / sec) * sec;
    const rows = [];
    for (let i = lim - 1; i >= 0; i--) { const c = i === 0 ? px : 100 - i * 0.01; rows.push([(now - i * sec) * 1000, c, Math.max(c, px), c - 1, c, 10]); }
    return new Response(JSON.stringify(rows), { status: 200 });
  }
  return new Response('nope', { status: 404 });
};
const ctx = { waitUntil: p => p };
const code = 'abcdefghijklmnopqrstuv';
const req = (method, path, body, auth = code) => worker.fetch(new Request('https://w.dev' + path, { method, headers: { authorization: 'Bearer ' + auth, 'content-type': 'application/json', origin: 'https://greathankyun.github.io' }, body: body ? JSON.stringify(body) : undefined }), env, ctx);

// sync
let r = await req('GET', '/sync/state'); let j = await r.json();
ok(r.status === 200 && j.state === null, 'empty sync state');
r = await req('PUT', '/sync/state', { at: 1000, state: { a: 1 } }); ok(r.status === 200, 'put state');
r = await req('PUT', '/sync/state', { at: 500, state: { a: 0 } }); ok(r.status === 409, 'older write conflicts');
r = await req('GET', '/sync/state'); j = await r.json(); ok(j.at === 1000 && j.state.a === 1, 'get state');
r = await req('PUT', '/sync/state?force=1', { at: 500, state: { a: 2 } }); ok(r.status === 200, 'force write');
r = await req('GET', '/sync/state', null, 'bad'); ok(r.status === 401, 'bad code rejected');
ok(r.headers.get('access-control-allow-origin') === 'https://greathankyun.github.io', 'cors header');
ok(![...store.keys()].some(k => k.includes(code)), 'code not stored in plain text');

// alerts
const created = Date.now() - 5000;
r = await req('PUT', '/alerts', { notify: { ntfy: 'hawk-test1' }, alerts: [
  { id: 'p1', kind: 'price', symbol: 'BTCUSDT', label: 'BTC/USDT', dir: 'above', price: 150, created },
  { id: 'r1', kind: 'rule', symbol: 'BTCUSDT', label: 'BTC/USDT', interval: '1h', freq: 'bar', created, name: '收盤 > 0', rule: { logic: 'and', conds: [{ a: { k: 'price', f: 'close' }, op: 'gt', b: { k: 'num', v: 0 } }] } },
  { id: 'bad', kind: 'price', symbol: 'X', dir: 'sideways', price: 1 },
] });
j = await r.json(); ok(j.count === 2, 'alerts stored (invalid dropped)');
await worker.scheduled({}, env, ctx);
ok(sent.length === 1 && sent[0].body.includes('收盤 > 0'), 'rule alert pushed once: ' + sent.length);
await worker.scheduled({}, env, ctx);
ok(sent.length === 1, 'rule alert not repeated on same bar');
px = 160;
await worker.scheduled({}, env, ctx);
ok(sent.length === 2 && sent[1].body.includes('漲破 150'), 'price alert pushed');
await worker.scheduled({}, env, ctx);
ok(sent.length === 2, 'price alert fires once');
r = await req('POST', '/alerts/test', { notify: { ntfy: 'hawk-test1' } }); ok(r.status === 200 && sent.length === 3, 'test notification');
r = await req('POST', '/alerts/test', { notify: {} }); ok(r.status === 400, 'test without channel → 400');
r = await req('PUT', '/alerts', { alerts: [] }); ok((await r.json()).count === 0 && !(await KV.get('alert-index', 'json')).length, 'clearing removes from index');
console.log(`cloud: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
