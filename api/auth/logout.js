import { clearSession } from '../_lib.js';

export default function handler(req, res) {
  clearSession(res);
  if (req.method === 'POST') return res.status(200).json({ signedIn: false });
  res.writeHead(302, { Location: '/' });
  res.end();
}
