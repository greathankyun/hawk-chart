// Shared helpers for every route module in this worker.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(data, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store',
    },
  });
}

// Serve GET responses from the edge cache for `ttl` seconds to save upstream quota.
export async function cached(req, ctx, ttl, produce) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(new URL(req.url).toString(), { method: 'GET' });
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const res = json(await produce(), 200, ttl);
  if (cache && ttl > 0) {
    const put = cache.put(key, res.clone());
    if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
  }
  return res;
}
