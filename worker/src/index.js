// 鷹眼看盤 Worker: one entry point, route modules mounted by path prefix.
//   /market/*  行情中繼（台股、美股、指數、原物料、外匯）— market.js
//   /sync/*    跨裝置同步（KV）— sync.js
//   /alerts/*  伺服器端警示＋每分鐘排程檢查 — alerts.js
// Other features add a line to ROUTES (and, if needed, a scheduled() handler below).
import * as market from './market.js';
import * as sync from './sync.js';
import * as alerts from './alerts.js';
import { json } from './util.js';

const ROUTES = [
  ['/market/', market.handle],
  ['/sync/', sync.handle],
  ['/alerts', alerts.handle],
];

// Pages allowed to call this worker from a browser. Override with the ALLOWED_ORIGINS var (comma separated).
const DEFAULT_ORIGINS = ['https://greathankyun.github.io'];
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function originOk(origin, env) {
  if (!origin) return true; // direct visits / curl
  const list = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : DEFAULT_ORIGINS;
  return list.includes(origin) || LOCAL.test(origin);
}

function withCors(res, origin) {
  const r = new Response(res.body, res);
  if (origin) {
    r.headers.set('access-control-allow-origin', origin);
    r.headers.set('vary', 'origin');
    r.headers.set('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
    r.headers.set('access-control-allow-headers', 'content-type, authorization');
    r.headers.set('access-control-max-age', '86400');
  }
  return r;
}

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('origin');
    if (!originOk(origin, env)) return new Response('forbidden origin', { status: 403 });
    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), origin);
    const url = new URL(req.url);
    let res;
    try {
      const route = ROUTES.find(([p]) => url.pathname.startsWith(p));
      if (route) res = await route[1](req, env, ctx, url);
      else if (url.pathname === '/') res = json({ name: '鷹眼看盤 worker', ok: true, routes: ROUTES.map(r => r[0]) });
      else res = json({ error: 'not found' }, 404);
    } catch (e) {
      res = json({ error: e?.message || String(e) }, e?.status || 502);
    }
    return withCors(res, origin);
  },
  async scheduled(event, env, ctx) {
    await alerts.scheduled(event, env, ctx);
  },
};
