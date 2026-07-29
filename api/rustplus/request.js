import { readSession } from '../_lib.js';
import { rustPlusRequest, RustPlusError, READ_ACTIONS, WRITE_ACTIONS, ENTITY_ACTIONS,
         MAX_MESSAGE_LENGTH } from './_client.js';

/**
 * Live Rust+ data, fetched on demand.
 *
 * Signed-in callers only. Without that this would be an open relay: anyone could point it at
 * an arbitrary host and port and have our servers make the connection for them.
 *
 * The player token is supplied by the caller rather than stored here — this deployment has no
 * database, and a token is scoped to one server pairing rather than to the Rustex account, so
 * it lives in the browser and travels with the request.
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let session = null;
  try { session = readSession(req); } catch { /* treated as signed out */ }
  if (!session) return res.status(401).json({ error: 'not_signed_in', message: 'Sign in to load live data.' });

  const { host, port, playerId, playerToken, action, message, entityId, value } = req.body ?? {};

  if (!host || typeof host !== 'string')
    return res.status(400).json({ error: 'bad_request', message: 'A server address is required.' });
  if (!READ_ACTIONS.has(action) && !WRITE_ACTIONS.has(action))
    return res.status(400).json({ error: 'bad_request', message: `Unknown action '${action}'.` });
  // Writes post into the player's team chat, so the text is checked before we open a socket.
  // Entity calls name one paired device. Validate the id here too, so a bad one is refused
  // before a socket is opened rather than after.
  if (ENTITY_ACTIONS.has(action)) {
    const id = Number(entityId);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ error: 'bad_request', message: 'A device id is required.' });
  }
  if (action === 'setEntityValue' && typeof value !== 'boolean')
    return res.status(400).json({ error: 'bad_request', message: 'A device value must be true or false.' });

  if (action === 'sendTeamMessage') {
    const text = String(message ?? '').trim();
    if (!text)
      return res.status(400).json({ error: 'bad_request', message: 'A message is required.' });
    if (text.length > MAX_MESSAGE_LENGTH)
      return res.status(400).json({ error: 'bad_request',
        message: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.` });
  }
  // Steam ids exceed the safe integer range, so the id stays a string all the way through.
  if (!/^\d{1,20}$/.test(String(playerId ?? '')))
    return res.status(400).json({ error: 'bad_request', message: 'A valid player ID is required.' });
  if (!Number.isInteger(Number(playerToken)))
    return res.status(400).json({ error: 'bad_request', message: 'A valid player token is required.' });

  try {
    const response = await rustPlusRequest({
      host,
      port: Number(port),
      playerId: String(playerId),
      playerToken: Number(playerToken),
      action,
      message,
      entityId,
      value,
    });
    return res.status(200).json({ ok: true, action, response });
  } catch (err) {
    if (err instanceof RustPlusError) {
      return res.status(err.status).json({ error: 'rustplus_error', message: err.message });
    }
    console.error('[rustplus/request]', err);
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong reaching that server.' });
  }
}
