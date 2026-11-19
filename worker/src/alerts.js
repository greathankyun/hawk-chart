// 伺服器端警示：/alerts/*  ＋ 每分鐘排程檢查（App 關閉也會通知）
//   GET  /alerts            → { alerts, notify }
//   PUT  /alerts {alerts, notify}  → 儲存這個同步代碼的伺服器端警示與通知方式
//   POST /alerts/test {notify}     → 送一則測試通知
// 通知管道：ntfy（免註冊，手機裝 ntfy App 訂閱主題）、Telegram Bot。
// 條件判斷與 App 共用同一套程式（js/conditions.js、js/indicators.js）。
import { HttpError, json } from './util.js';
import { userKey, kv } from './auth.js';
import { ruleSeries, describeRule } from '../../js/conditions.js';
import * as market from './market.js';

const INDEX = 'alert-index';
const SEC = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800, '1M': 2592000 };
const MAX_ALERTS = 30;

export async function handle(req, env, ctx, url) {
  const id = await userKey(req);
  const store = kv(env);
  const key = 'a:' + id;
  const p = url.pathname.replace(/\/$/, '');
  if (p === '/alerts' && req.method === 'GET') return json((await store.get(key, 'json')) || { alerts: [], notify: {} });
  if (p === '/alerts' && req.method === 'PUT') {
    const body = await req.json();
    const alerts = (Array.isArray(body.alerts) ? body.alerts : []).slice(0, MAX_ALERTS).map(clean).filter(Boolean);
    const notify = cleanNotify(body.notify);
    const prev = (await store.get(key, 'json')) || { alerts: [] };
    // keep server-side fired/lastBar state for alerts that didn't change
    for (const a of alerts) { const o = prev.alerts.find(x => x.id === a.id && x.sig === a.sig); if (o) { a.fired = o.fired || a.fired; a.lastBar = o.lastBar; } }
    const idx = (await store.get(INDEX, 'json')) || [];
    const has = idx.includes(id);
    if (alerts.length) {
      await store.put(key, JSON.stringify({ alerts, notify, at: Date.now() }));
      if (!has) await store.put(INDEX, JSON.stringify([...idx, id]));
    } else {
      await store.delete(key);
      if (has) await store.put(INDEX, JSON.stringify(idx.filter(x => x !== id)));
    }
    return json({ ok: true, count: alerts.length });
  }
  if (p === '/alerts/test' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const sent = await send(cleanNotify(body.notify), '鷹眼看盤 測試通知', '收到這則訊息表示伺服器端警示已設定完成 ✅');
    if (!sent) throw new HttpError(400, '請至少設定一種通知方式（ntfy 主題或 Telegram）');
    return json({ ok: true, sent });
  }
  throw new HttpError(404, 'not found');
}

function clean(a) {
  if (!a || typeof a !== 'object' || typeof a.symbol !== 'string') return null;
  const base = { id: String(a.id), symbol: a.symbol.slice(0, 40), label: String(a.label || a.symbol).slice(0, 60), name: String(a.name || '').slice(0, 80), fired: !!a.fired, created: +a.created || Date.now() };
  if (a.kind === 'price') {
    if (!(a.price > 0) || !['above', 'below'].includes(a.dir)) return null;
    return { ...base, kind: 'price', dir: a.dir, price: +a.price, sig: `p${a.dir}${a.price}` };
  }
  if (a.kind === 'rule' && a.rule && Array.isArray(a.rule.conds) && SEC[a.interval]) {
    const rule = { logic: a.rule.logic === 'or' ? 'or' : 'and', conds: a.rule.conds.slice(0, 10) };
    return { ...base, kind: 'rule', interval: a.interval, freq: ['bar', 'close', 'once'].includes(a.freq) ? a.freq : 'bar', rule, sig: JSON.stringify([a.interval, a.freq, rule]) };
  }
  return null;
}
function cleanNotify(n = {}) {
  const out = {};
  if (typeof n.ntfy === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(n.ntfy)) out.ntfy = n.ntfy;
  if (n.tgToken && n.tgChat && /^\d+:[\w-]{20,}$/.test(n.tgToken) && /^-?\d+$/.test(String(n.tgChat))) { out.tgToken = n.tgToken; out.tgChat = String(n.tgChat); }
  return out;
}

async function send(notify, title, msg) {
  let sent = 0;
  if (notify.ntfy) {
    // JSON publishing keeps the Chinese title intact (HTTP headers can't carry UTF-8)
    const r = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: notify.ntfy, title, message: msg, tags: ['chart_with_upwards_trend'], priority: 4 }) }).catch(() => null);
    if (r?.ok) sent++;
  }
  if (notify.tgToken) {
    const r = await fetch(`https://api.telegram.org/bot${notify.tgToken}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: notify.tgChat, text: `🔔 ${title}\n${msg}` }) }).catch(() => null);
    if (r?.ok) sent++;
  }
  return sent;
}

// ---------- market data for the checker ----------
const isCrypto = s => !s.startsWith('Y:');
async function klines(sym, iv, limit, env, ctx) {
  if (isCrypto(sym)) {
    for (const host of ['https://data-api.binance.vision', 'https://api.binance.com']) {
      try {
        const r = await fetch(`${host}/api/v3/klines?symbol=${sym}&interval=${iv}&limit=${limit}`);
        if (!r.ok) continue;
        return (await r.json()).map(k => ({ utc: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
      } catch {}
    }
    throw new Error('binance unreachable');
  }
  const u = new URL(`https://worker.local/market/klines?symbol=${encodeURIComponent(sym.slice(2))}&interval=${iv}&limit=${limit}`);
  const res = await market.handle(new Request(u), env, ctx, u);
  const j = await res.json();
  return (j.bars || []).map(([t, o, h, l, c, v]) => ({ utc: t, open: o, high: h, low: l, close: c, volume: v || 0 }));
}

// ---------- scheduled checker (cron: every minute) ----------
export async function scheduled(event, env, ctx) {
  if (!env.HAWK) return;
  const idx = (await env.HAWK.get(INDEX, 'json')) || [];
  const cache = new Map();
  const getBars = async (sym, iv, limit) => {
    const k = sym + iv + limit;
    if (!cache.has(k)) cache.set(k, klines(sym, iv, limit, env, ctx).catch(() => null));
    return cache.get(k);
  };
  for (const id of idx) {
    const key = 'a:' + id;
    const doc = await env.HAWK.get(key, 'json');
    if (!doc?.alerts?.length) continue;
    let dirty = false;
    for (const a of doc.alerts) {
      if (a.fired) continue;
      try {
        if (a.kind === 'price') {
          const bars = await getBars(a.symbol, '1m', 3);
          if (!bars?.length) continue;
          const recent = bars.filter(b => b.utc * 1000 + 60000 >= a.created);
          const hit = recent.some(b => (a.dir === 'above' ? b.high >= a.price : b.low <= a.price));
          if (hit) {
            const px = bars[bars.length - 1].close;
            await send(doc.notify || {}, '鷹眼看盤 價格警示', `${a.label} ${a.dir === 'above' ? '漲破' : '跌破'} ${a.price}（現價 ${px}）`);
            a.fired = true; dirty = true;
          }
        } else if (a.kind === 'rule') {
          const sec = SEC[a.interval];
          const bars = await getBars(a.symbol, a.interval, 300);
          if (!bars || bars.length < 3) continue;
          const intraday = sec < 86400;
          bars.forEach(b => (b.intraday = intraday));
          const sig = ruleSeries(a.rule, bars);
          const i = a.freq === 'close' ? bars.length - 2 : bars.length - 1;
          if (sig[i] && a.lastBar !== bars[i].utc && bars[i].utc * 1000 + sec * 1000 > a.created) {
            a.lastBar = bars[i].utc; dirty = true;
            if (a.freq === 'once') a.fired = true;
            await send(doc.notify || {}, '鷹眼看盤 條件警示', `${a.label} ${a.interval}：${a.name || describeRule(a.rule)}（價 ${bars[bars.length - 1].close}）`);
          }
        }
      } catch (e) { console.log('alert check failed', a.id, e?.message); }
    }
    if (dirty) await env.HAWK.put(key, JSON.stringify(doc));
  }
}
