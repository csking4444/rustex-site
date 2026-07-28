import net from 'node:net';
import dns from 'node:dns/promises';
import protobuf from 'protobufjs';
import WebSocket from 'ws';
import descriptor from './_descriptor.js';

const root = protobuf.Root.fromJSON(descriptor);
const AppRequest = root.lookupType('rustplus.AppRequest');
const AppMessage = root.lookupType('rustplus.AppMessage');

/** Requests that take no arguments. Anything not listed here is refused, so a caller
 *  cannot reach a mutating call like setEntityValue through this path. */
export const READ_ACTIONS = new Set([
  'getInfo', 'getTime', 'getMap', 'getTeamInfo', 'getTeamChat', 'getMapMarkers',
]);

/** Actions that change something in the game. Kept separate from the reads so a write can
 *  never be reached by a caller that only meant to fetch data, and so adding a read later
 *  cannot accidentally grant write access. */
export const WRITE_ACTIONS = new Set(['sendTeamMessage']);

/** Rust+ rejects anything longer, and a very long line is unreadable in the game's chat box. */
export const MAX_MESSAGE_LENGTH = 250;

/**
 * The address is supplied by whoever is calling, and this runs server-side, so without a
 * check it is a server-side request forgery hole: point it at 169.254.169.254 and the
 * function would happily open a socket to the cloud metadata service on the caller's behalf.
 * Only public unicast IPv4/IPv6 is allowed through.
 */
function isPublicAddress(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const p = ip.split('.').map(Number);
    if (p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return false;            // this-network, private, loopback
    if (p[0] === 169 && p[1] === 254) return false;                          // link-local, incl. metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;              // private
    if (p[0] === 192 && p[1] === 168) return false;                          // private
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false;             // carrier-grade NAT
    if (p[0] === 192 && p[1] === 0 && p[2] === 0) return false;              // IETF protocol assignments
    if (p[0] >= 224) return false;                                           // multicast, reserved, broadcast
    return true;
  }
  if (kind === 6) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return false;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return false;  // link-local, ULA
    if (v.startsWith('::ffff:')) return isPublicAddress(v.slice(7));         // IPv4-mapped
    return true;
  }
  return false;
}

/**
 * Escape hatch for local development and tests, where the Rust server is on loopback or a LAN
 * address. Off unless explicitly set, and it must stay off in production: with it on, this
 * endpoint would relay to internal addresses on a caller's behalf. It costs nothing in
 * production anyway, since a hosted function cannot reach someone's LAN regardless.
 */
const allowPrivate = () => process.env.RUSTPLUS_ALLOW_PRIVATE === '1';

/** Resolves a host and returns an address only if every answer is public — a name that
 *  resolves to both a public and a private address must not slip through. */
export async function resolvePublicHost(host) {
  if (net.isIP(host)) return (isPublicAddress(host) || allowPrivate()) ? host : null;
  if (!/^[a-z0-9.-]{1,253}$/i.test(host)) return null;
  let answers;
  try {
    answers = await dns.lookup(host, { all: true });
  } catch {
    return null;
  }
  if (!answers.length) return null;
  if (!allowPrivate() && !answers.every(a => isPublicAddress(a.address))) return null;
  // Connect to the resolved literal, not the name, so a second lookup cannot return a
  // different address than the one that was validated.
  return answers[0].address;
}

export class RustPlusError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

/**
 * One Rust+ request: connect, ask, close.
 *
 * Deliberately not a persistent session. Rust+ supports subscribing to live broadcasts, but
 * that needs a socket held open, which a serverless function cannot do — so this covers the
 * request/response half of the protocol only.
 */
export async function rustPlusRequest({ host, port, playerId, playerToken, action, message, timeoutMs = 8000 }) {
  const isWrite = WRITE_ACTIONS.has(action);
  if (!READ_ACTIONS.has(action) && !isWrite)
    throw new RustPlusError(`Unsupported action '${action}'.`, 400);

  const address = await resolvePublicHost(host);
  if (!address) throw new RustPlusError('That server address is not a reachable public host.', 400);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RustPlusError('Invalid port.', 400);

  const seq = (Date.now() % 2_000_000) + 1;
  // Reads take an empty message; sendTeamMessage carries the text.
  let body = {};
  if (isWrite) {
    const text = String(message ?? '').trim();
    if (!text) throw new RustPlusError('A message is required.', 400);
    if (text.length > MAX_MESSAGE_LENGTH)
      throw new RustPlusError(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`, 400);
    body = { message: text };
  }

  const payload = AppRequest.encode(AppRequest.create({
    seq,
    playerId: String(playerId),
    playerToken: Number(playerToken),
    [action]: body,
  })).finish();

  const ws = new WebSocket(`ws://${address}:${port}`, { handshakeTimeout: timeoutMs });

  return await new Promise((resolve, reject) => {
    const done = (fn, arg) => {
      clearTimeout(timer);
      try { ws.terminate(); } catch {}
      fn(arg);
    };
    const timer = setTimeout(
      () => done(reject, new RustPlusError('The server did not answer in time.', 504)),
      timeoutMs);

    ws.on('open', () => ws.send(payload));

    ws.on('message', data => {
      let message;
      try {
        message = AppMessage.decode(new Uint8Array(data));
      } catch {
        return; // not something we can read; keep waiting for a frame we can
      }
      // Broadcasts arrive on the same socket and carry no seq — ignore anything that is
      // not the reply to the request we just sent.
      const response = message.response;
      if (!response || response.seq !== seq) return;

      if (response.error?.error) {
        return done(reject, new RustPlusError(mapError(response.error.error), 400));
      }
      done(resolve, AppMessage.toObject(message, {
        longs: String, enums: String, bytes: String, defaults: false,
      }).response);
    });

    ws.on('error', err => done(reject,
      new RustPlusError(`Could not reach the server: ${err.message}`, 502)));
    ws.on('close', () => done(reject,
      new RustPlusError('The server closed the connection before replying.', 502)));
  });
}

/** Rust+ error strings are terse; these are the ones a user can actually act on. */
function mapError(code) {
  switch (code) {
    case 'not_found':          return 'This pairing is no longer valid on that server. Servers invalidate pairings when they wipe, so pair again to get a fresh token.';
    case 'invalid_playerid':   return 'The player ID does not match this pairing.';
    case 'invalid_token':      return 'The player token is wrong or has expired. Pair again to get a fresh one.';
    case 'access_denied':      return 'This server refused the request. The pairing may have been revoked.';
    case 'player_not_found':   return 'That player is not on this server.';
    case 'rate_limit':         return 'Too many requests to that server. Wait a moment and retry.';
    default:                   return `The server rejected the request (${code}).`;
  }
}
