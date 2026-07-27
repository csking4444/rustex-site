import crypto from 'node:crypto';

export const COOKIE = 'rx_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** null rather than a throw: callers turn this into a readable error, not a 500. */
function secret() {
  return process.env.SESSION_SECRET || null;
}

export const isConfigured = () => !!process.env.SESSION_SECRET;

/**
 * Sessions are a signed payload, not an encrypted one — nothing secret lives in
 * there, we only need to know the browser did not edit it. HMAC + timing-safe
 * compare is enough for that, and it keeps the whole thing dependency free.
 */
export function sign(payload) {
  const key = secret();
  if (!key) return null;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verify(token) {
  const key = secret();
  if (!key) return null;
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', key).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

/** Returns false when the signing key is missing, so callers can say why. */
export function setSession(res, payload) {
  const token = sign({ ...payload, exp: Date.now() + MAX_AGE * 1000 });
  if (!token) return false;
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${MAX_AGE}`);
  return true;
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`);
}

export function readSession(req) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`));
  return hit ? verify(hit.slice(COOKIE.length + 1)) : null;
}

/** Absolute origin of this deployment, honouring Vercel's proxy headers. */
export function origin(req) {
  if (process.env.PUBLIC_ORIGIN) return process.env.PUBLIC_ORIGIN.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
