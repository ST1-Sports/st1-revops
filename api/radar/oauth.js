/**
 * Follow-Up Radar no longer has its own Gmail connect: Sign in with Google (api/auth/google.js)
 * connects the rep's Gmail once for Radar, outreach and the inbox. Old links land there.
 */
const CONNECT_URL = '/api/auth/google?consent=1';

export default async function handler(req, res) {
  if (req.method === 'POST') return res.json({ url: CONNECT_URL });
  res.setHeader('Location', CONNECT_URL);
  return res.status(302).end();
}
