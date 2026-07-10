import { prisma } from './_lib/prisma.js';
import { setCors } from './_lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

export default async function handler(req, res) {
  setCors(res, 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const repKey = ((req.method === 'GET' ? req.query.repKey : req.body?.repKey) || '')
    .toString().toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (!repKey) return res.status(400).json({ error: 'repKey required' });

  const dbKey = `gmail_token_${repKey}`;

  if (req.method === 'GET') {
    try {
      const row = await prisma.setting.findUnique({ where: { key: dbKey } });
      return res.json({ connected: !!(row?.value?.refreshToken), email: row?.value?.email || null });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === 'POST') {
    const { refreshToken, email } = req.body || {};
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
    try {
      await prisma.setting.upsert({
        where: { key: dbKey },
        update: { value: { refreshToken, email: email || null, connectedAt: new Date().toISOString() } },
        create: { key: dbKey, value: { refreshToken, email: email || null, connectedAt: new Date().toISOString() } },
      });
      return res.json({ ok: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === 'DELETE') {
    try {
      await prisma.setting.deleteMany({ where: { key: dbKey } });
      return res.json({ ok: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
