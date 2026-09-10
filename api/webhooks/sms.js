/**
 * POST /api/webhooks/sms — Twilio inbound SMS webhook.
 *
 * Configure this URL as the "A Message Comes In" webhook on the Twilio
 * number in the Twilio console. Twilio POSTs application/x-www-form-urlencoded
 * with From/To/Body/MessageSid — logged here so replies show up in RevOps
 * without any polling.
 *
 * Optional shared secret: set TWILIO_WEBHOOK_SECRET and add
 * ?secret=<same value> to the webhook URL configured in Twilio — same
 * conditional-shared-secret convention as the other webhook handlers in
 * this directory (zoho.js, instantly.js). Twilio doesn't let a query
 * param collide with its own POST fields, so this is checked separately
 * from the form body.
 */
import { prisma }         from '../_lib/prisma.js';
import { normalizePhone } from '../_lib/twilio.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('POST only');

  const secret = process.env.TWILIO_WEBHOOK_SECRET;
  if (secret && req.query?.secret !== secret) {
    return res.status(401).send('Invalid webhook secret');
  }

  try {
    const from = normalizePhone(req.body?.From || '');
    const body = req.body?.Body || '';
    const sid  = req.body?.MessageSid || null;
    if (from) {
      await prisma.smsMessage.create({ data: { phone: from, direction: 'in', body, status: 'received', twilioSid: sid } });
    }
  } catch (err) {
    console.error('[webhooks/sms]', err.message);
  }

  // Empty TwiML = no auto-reply sent back to the sender.
  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send('<Response></Response>');
}
