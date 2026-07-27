import { origin, isConfigured, compedAccountCount } from '../_lib.js';

/**
 * Config check. Reports only whether each variable is PRESENT — never its value,
 * and never which accounts are comped — so it is safe to hit from a browser while
 * diagnosing a failed sign-in.
 */
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ok = isConfigured();
  const compCount = compedAccountCount();
  res.status(ok ? 200 : 503).json({
    ok,
    sessionSecret: ok ? 'set' : 'MISSING — sign-in cannot issue a session',
    steamApiKey: process.env.STEAM_API_KEY ? 'set' : 'not set (optional: adds name + avatar)',
    compedAccounts: compCount > 0 ? `${compCount} account(s) parsed` : 'none configured',
    origin: origin(req),
    returnTo: `${origin(req)}/api/auth/callback`,
    node: process.version,
  });
}
