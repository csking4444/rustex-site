import { readSession, compedPlan } from '../_lib.js';

/** Who is this browser, and what plan do they have? Both come from the server —
 * the client never gets to assert its own entitlement. */
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let s = null;
  try { s = readSession(req); } catch (err) { console.error('[auth/me]', err); }
  if (!s) return res.status(401).json({ signedIn: false });
  res.status(200).json({
    signedIn: true,
    user: {
      steamId: s.steamId,
      name: s.name || null,
      avatar: s.avatar || null,
      profileUrl: s.profileUrl || null,
      created: s.created || null,
    },
    plan: compedPlan(s.steamId),
  });
}
