/**
 * /api/sms — 1:1 text messaging with existing/warm contacts via Twilio.
 *
 * GET  ?phone=+1...           → message history for that number
 * POST { to, body }           → sends a text, logs it, returns { ok, sid }
 *
 * On purpose there's no bulk/broadcast action here — this is built for
 * individual sales follow-up, not campaigns. RevOps.jsx gates the UI to
 * contacts who already have a deal, an invoice, or shown reply intent;
 * this endpoint itself doesn't enforce that (it's a UI-level policy), it
 * just sends what it's asked to send.
 */
import { setCors } from './_lib/cors.js';
import { prisma } from './_lib/prisma.js';
import { sendSms, normalizePhone } from './_lib/twilio.js';

const OPT_OUT_FOOTER = "\n\nReply STOP to opt out.";

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const phone = normalizePhone(req.query?.phone || '');
    if (!phone) return res.status(400).json({ error: 'phone required' });
    try {
      const messages = await prisma.smsMessage.findMany({ where: { phone }, orderBy: { createdAt: 'asc' } });
      return res.json({ ok: true, messages });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const { to, body } = req.body || {};
  if (!to)   return res.status(400).json({ error: 'to required' });
  if (!body) return res.status(400).json({ error: 'body required' });
  const phone = normalizePhone(to);
  if (!phone) return res.status(400).json({ error: 'Could not parse a valid phone number from: ' + to });

  const fullBody = /stop to opt out/i.test(body) ? body : body + OPT_OUT_FOOTER;

  try {
    const result = await sendSms({ to: phone, body: fullBody });
    const saved = await prisma.smsMessage.create({
      data: { phone, direction: 'out', body: fullBody, status: result.status || 'sent', twilioSid: result.sid },
    });
    return res.json({ ok: true, sid: result.sid, message: saved });
  } catch (err) {
    console.error('[sms] send failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
