# Rustex — site

Static landing page and product console, plus a small serverless backend that
implements **real Steam sign-in**.

## Deploying

Vercel picks this up with no build step: `index.html` is served at `/`, and
everything under `api/` becomes a Node serverless function.

### Required environment variables

| Variable         | Required | What it does |
|------------------|----------|--------------|
| `SESSION_SECRET` | **yes**  | Signs the session cookie. Use a long random string — `openssl rand -base64 48`. Sign-in returns a 500 without it. |
| `STEAM_API_KEY`  | no       | Steam Web API key from <https://steamcommunity.com/dev/apikey>. Without it sign-in still works and you get a verified SteamID, but no display name or avatar. |
| `PUBLIC_ORIGIN`  | no       | Overrides the origin used for OpenID `realm`/`return_to`. Only needed if the proxy headers are wrong. |

Set them in **Project → Settings → Environment Variables**, then **redeploy** —
existing deployments do not pick up new variables on their own.

### Checking the config

Visit `/api/auth/health` on the deployment. It reports whether each variable is
present (never its value) plus the origin and callback URL it will use:

```json
{ "ok": true, "sessionSecret": "set", "steamApiKey": "set", ... }
```

If `ok` is `false`, sign-in will bounce back to `/?auth_error=not_configured`.

## How sign-in works

1. `GET /api/auth/steam` redirects the browser to Steam's OpenID 2.0 endpoint.
   Steam is the only party that ever sees the password.
2. Steam redirects back to `GET /api/auth/callback`.
3. The callback posts every `openid.*` parameter **back to Steam** with
   `openid.mode=check_authentication`. This step is what makes the login real —
   the redirect on its own is trivially forgeable, so nothing in it is trusted
   until Steam confirms it signed it.
4. On success the verified SteamID64 goes into an HMAC-signed, `HttpOnly`,
   `Secure`, `SameSite=Lax` cookie.
5. The page calls `GET /api/auth/me` on load to restore the session, and
   `POST /api/auth/logout` to clear it.

Because verification is a server-to-server POST, this cannot be done from the
browser: Steam's endpoint sends no CORS headers, and a client-side "check" could
be skipped by the client anyway.

## Local development

`file://` has no `/api`, so sign-in only works when the functions are running:

```bash
npm i -g vercel
vercel dev
```

Opening `index.html` directly still renders the site; it just reports signed-out.

## What is and is not real

- **Real:** Steam identity. The SteamID, name and avatar come from Steam and are
  verified server-side.
- **Not wired:** payments. There is no payment provider connected, so no
  subscription is ever charged and no invoices exist. The dashboard can be opened
  in a clearly-labelled demo mode instead.
- **Illustrative:** the feature mock-ups on the landing page and the sample
  telemetry in the demo dashboard. These are examples of what the product shows,
  not anyone's data.

## Live Rust+ data

`POST /api/rustplus/request` performs one Rust+ request against a game server and returns the
decoded response. Body: `{ host, port, playerId, playerToken, action }`.

`action` is restricted to reads: `getInfo`, `getTime`, `getMap`, `getTeamInfo`, `getTeamChat`,
`getMapMarkers`. Mutating calls such as `setEntityValue` are refused.

### What this can and cannot do

Rust+ is request/response over a WebSocket, so a serverless function can connect, ask, and close
well inside its execution window. That covers live population, team roster and positions, map
markers, and team chat.

It cannot do the half of the protocol that needs a socket held open: `setSubscription` and the
broadcasts it enables, and the FCM listener behind automatic pairing and Smart Alarm push
notifications. Those need a process that stays alive, which static hosting does not provide.

### Credentials

`playerId` and `playerToken` come from a Rust+ pairing and authorise one server, not the Rustex
account. They are supplied by the caller rather than stored here, because this deployment has no
database; the browser keeps them in `localStorage` under `rustex.servers.v1`.

Obtain them by running `rustex-pair --print-only` locally and pairing from the game's pause menu.

### Security

The caller supplies the address this function connects to, so `resolvePublicHost` rejects
loopback, private, link-local (including cloud metadata at 169.254.169.254), carrier-grade NAT
and multicast ranges. Hostnames are resolved first and every answer must be public, then the
connection is made to the resolved literal so a second lookup cannot substitute a different
address. Requests require a signed-in session, so this is not an open relay.

`RUSTPLUS_ALLOW_PRIVATE=1` disables those range checks for local development against a LAN
server. It must stay unset in production.

### Regenerating the protobuf descriptor

`api/rustplus/_descriptor.js` is generated from `rustplus.proto`, which is copied from the server
project (itself taken field-for-field from liamcottle/rustplus.js). To regenerate after a schema
change:

```bash
node --input-type=module -e "
import protobuf from 'protobufjs';
import { writeFileSync } from 'node:fs';
const root = await protobuf.load('rustplus.proto');
writeFileSync('api/rustplus/_descriptor.js', 'export default ' + JSON.stringify(root.toJSON()) + ';\n');
"
```
