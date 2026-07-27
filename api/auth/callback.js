import { origin, setSession } from '../_lib.js';
import { STEAM_OPENID } from './steam.js';

const CLAIMED = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

function fail(res, base, code) {
  res.writeHead(302, { Location: `${base}/?auth_error=${encodeURIComponent(code)}` });
  res.end();
}

export default async function handler(req, res) {
  const base = origin(req);
  const q = req.query || {};

  if (q['openid.mode'] !== 'id_res') return fail(res, base, 'cancelled');

  // Never trust the identity Steam's redirect hands us — bounce every parameter
  // straight back to Steam with mode=check_authentication and let Steam say whether
  // it really signed this. Without this step anyone could forge a claimed_id.
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (k.startsWith('openid.')) body.append(k, Array.isArray(v) ? v[0] : v);
  }
  body.set('openid.mode', 'check_authentication');

  let verified = false;
  try {
    const r = await fetch(STEAM_OPENID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    verified = /is_valid\s*:\s*true/i.test(await r.text());
  } catch {
    return fail(res, base, 'steam_unreachable');
  }
  if (!verified) return fail(res, base, 'invalid_signature');

  const claimed = String(q['openid.claimed_id'] || '');
  const match = CLAIMED.exec(claimed);
  if (!match) return fail(res, base, 'bad_identity');
  const steamId = match[1];

  // Name and avatar are a bonus: they need a Web API key. Without one the sign-in
  // still succeeds, we just show the SteamID until a key is configured.
  let profile = null;
  if (process.env.STEAM_API_KEY) {
    try {
      const url = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/'
        + `?key=${process.env.STEAM_API_KEY}&steamids=${steamId}`;
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json();
        const p = j?.response?.players?.[0];
        if (p) {
          profile = {
            name: p.personaname || null,
            avatar: p.avatarfull || p.avatarmedium || null,
            profileUrl: p.profileurl || null,
            created: p.timecreated ? new Date(p.timecreated * 1000).toISOString() : null,
          };
        }
      }
    } catch { /* profile is optional — a verified SteamID is the thing that matters */ }
  }

  setSession(res, { steamId, ...profile });

  const next = typeof q.next === 'string' ? q.next.replace(/[^a-z]/gi, '') : '';
  res.writeHead(302, { Location: `${base}/${next ? `#${next}` : '#settings'}` });
  res.end();
}
