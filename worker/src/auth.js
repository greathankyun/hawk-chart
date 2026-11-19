// Sync-code auth: the client sends "Authorization: Bearer <sync code>".
// We only ever store a SHA-256 hash of the code, so the KV data can't be tied back to it.
import { HttpError } from './util.js';

export async function userKey(req) {
  const h = req.headers.get('authorization') || '';
  const code = h.replace(/^Bearer\s+/i, '').trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) throw new HttpError(401, '同步代碼格式不正確');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hawk:' + code));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
export function kv(env) {
  if (!env.HAWK) throw new HttpError(503, '雲端儲存（KV）尚未設定，請重新執行 Deploy Worker');
  return env.HAWK;
}
