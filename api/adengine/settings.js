import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const rows = await prisma.setting.findMany();
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return res.json({ settings });
  }

  if (req.method === 'POST') {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'key required' });
    const setting = await prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    return res.json({ setting });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
