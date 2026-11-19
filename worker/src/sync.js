// 跨裝置同步：/sync/*
//   GET  /sync/state           → { at, state }（尚無資料時 state 為 null）
//   PUT  /sync/state {at,state} → 儲存（at 較舊時回 409 並附上雲端版本）；?force=1 強制覆蓋
//   DELETE /sync/state         → 刪除雲端資料
import { HttpError, json } from './util.js';
import { userKey, kv } from './auth.js';

const MAX = 4 * 1024 * 1024;

export async function handle(req, env, ctx, url) {
  const id = await userKey(req);
  const store = kv(env);
  const key = 's:' + id;
  if (url.pathname !== '/sync/state') throw new HttpError(404, 'not found');
  if (req.method === 'GET') {
    const v = await store.get(key, 'json');
    return json(v || { at: 0, state: null });
  }
  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > MAX) throw new HttpError(413, '資料太大');
    const body = JSON.parse(text);
    if (!body || typeof body.at !== 'number' || !body.state) throw new HttpError(400, '格式錯誤');
    if (!url.searchParams.has('force')) {
      const cur = await store.get(key, 'json');
      if (cur && cur.at > body.at) return json({ conflict: true, ...cur }, 409);
    }
    await store.put(key, JSON.stringify({ at: body.at, state: body.state }));
    return json({ ok: true, at: body.at });
  }
  if (req.method === 'DELETE') { await store.delete(key); return json({ ok: true }); }
  throw new HttpError(405, 'method not allowed');
}
