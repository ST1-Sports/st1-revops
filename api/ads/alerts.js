import { prisma } from '../_lib/prisma.js';
import { setCors } from '../_lib/cors.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  setCors(res, 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── GET: list rules + recent history ────────────────────────────────────
    if (req.method === 'GET') {
      const { includeHistory = 'true' } = req.query;
      const rules = await prisma.alert_rules.findMany({
        orderBy: { created_at: 'desc' },
      });
      if (includeHistory !== 'true') return res.status(200).json({ rules });

      const history = await prisma.alert_history.findMany({
        orderBy: { fired_at: 'desc' },
        take: 50,
      });
      return res.status(200).json({ rules, history });
    }

    // ── POST: create a rule ──────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { name, platform, campaign_id, metric, operator, threshold, notify_slack } = req.body || {};
      if (!name || !metric || !operator || threshold == null) {
        return res.status(400).json({ error: 'name, metric, operator, and threshold are required' });
      }
      const VALID_METRICS   = ['roas', 'spend', 'ctr', 'cpc', 'impressions', 'clicks'];
      const VALID_OPERATORS = ['lt', 'gt', 'lte', 'gte'];
      if (!VALID_METRICS.includes(metric))   return res.status(400).json({ error: `metric must be one of: ${VALID_METRICS.join(', ')}` });
      if (!VALID_OPERATORS.includes(operator)) return res.status(400).json({ error: `operator must be one of: ${VALID_OPERATORS.join(', ')}` });

      const rule = await prisma.alert_rules.create({
        data: {
          name,
          platform:     platform     || null,
          campaign_id:  campaign_id  || null,
          metric,
          operator,
          threshold:    parseFloat(threshold),
          notify_slack: !!notify_slack,
        },
      });
      return res.status(201).json({ rule });
    }

    // ── PATCH: toggle enabled / update threshold ─────────────────────────────
    if (req.method === 'PATCH') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const { enabled, threshold, name, notify_slack } = req.body || {};
      const data = {};
      if (enabled   !== undefined) data.enabled      = Boolean(enabled);
      if (threshold !== undefined) data.threshold    = parseFloat(threshold);
      if (name      !== undefined) data.name         = name;
      if (notify_slack !== undefined) data.notify_slack = Boolean(notify_slack);
      const rule = await prisma.alert_rules.update({ where: { id }, data });
      return res.status(200).json({ rule });
    }

    // ── DELETE: remove a rule ────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      await prisma.alert_rules.delete({ where: { id } });
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    if (e.code === 'P2021' || e.message?.includes('does not exist')) {
      return res.status(200).json({ rules: [], history: [], note: 'Run migration 003_analytics.sql to enable alerts.' });
    }
    return res.status(500).json({ error: e.message });
  }
}
