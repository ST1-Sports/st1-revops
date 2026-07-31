/**
 * POST /api/webhooks/sms — Twilio inbound SMS webhook.
 *
 * Configure this URL as the "A Message Comes In" webhook on the Twilio
 * number in the Twilio console. Twilio POSTs application/x-www-form-urlencoded
 * with From/To/Body/MessageSid — logged here so replies show up in RevOps
 * without any polling.
 */
import { prisma }         from '../_lib/prisma.js';
import { normalizePhone } from '../_lib/twilio.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('POST only');

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
