import { origin } from '../_lib.js';

export const STEAM_OPENID = 'https://steamcommunity.com/openid/login';

/**
 * Kicks off Steam's OpenID 2.0 flow. Steam is the only party that ever sees the
 * password; we get back a claimed_id that api/auth/callback then verifies with
 * Steam directly before trusting a single byte of it.
 */
export default function handler(req, res) {
  const base = origin(req);

  // Where Steam should drop the user afterwards. `next` lets the UI resume the
  // view it was on, but only ever as a same-site fragment.
  const next = typeof req.query.next === 'string' ? req.query.next.replace(/[^a-z]/gi, '') : '';
  const returnTo = `${base}/api/auth/callback${next ? `?next=${next}` : ''}`;

  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': base,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });

  res.writeHead(302, { Location: `${STEAM_OPENID}?${params}` });
  res.end();
}
