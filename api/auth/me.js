import { readSession } from '../_lib.js';

/** Who is this browser? The cookie is the only source of identity. */
export default function handler(req, res) {
  const s = readSession(req);
  res.setHeader('Cache-Control', 'no-store');
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
  });
}
