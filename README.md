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

Set them in **Project → Settings → Environment Variables**, then redeploy.

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
