import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  setCors(res, 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── GET: list saved UTM links ────────────────────────────────────────────
    if (req.method === 'GET') {
      const { limit = 50, campaign, source } = req.query;
      const where = {
        ...(campaign ? { utm_campaign: { contains: campaign, mode: 'insensitive' } } : {}),
        ...(source   ? { utm_source:   { contains: source,   mode: 'insensitive' } } : {}),
      };
      const links = await prisma.utm_links.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take:    parseInt(limit),
      });
      return res.status(200).json({ links, count: links.length });
    }

    // ── POST: create UTM link ────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { label, destination, utm_source, utm_medium, utm_campaign, utm_content, utm_term, created_by } = req.body || {};
      if (!destination || !utm_source || !utm_medium || !utm_campaign) {
        return res.status(400).json({ error: 'destination, utm_source, utm_medium, and utm_campaign are required' });
      }

      const params = [
        ['utm_source', utm_source],
        ['utm_medium', utm_medium],
        ['utm_campaign', utm_campaign],
        ...(utm_content ? [['utm_content', utm_content]] : []),
        ...(utm_term    ? [['utm_term',    utm_term]]    : []),
      ];
      const full_url = `${destination.trim().replace(/\/$/, '')}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;

      const link = await prisma.utm_links.create({
        data: {
          label:        label || `${utm_source}/${utm_medium}/${utm_campaign}`,
          destination:  destination.trim(),
          utm_source,
          utm_medium,
          utm_campaign,
          utm_content:  utm_content || null,
          utm_term:     utm_term    || null,
          full_url,
          created_by:   created_by || null,
        },
      });
      return res.status(201).json({ link });
    }

    // ── DELETE: remove a UTM link ────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      await prisma.utm_links.delete({ where: { id } });
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    if (e.code === 'P2021' || e.message?.includes('does not exist')) {
      return res.status(200).json({ links: [], count: 0, note: 'Run migration 003_analytics.sql to enable UTM link storage.' });
    }
    return res.status(500).json({ error: e.message });
  }
}
