/**
 * Shared Twilio helpers — SMS only, built for 1:1 follow-up texting with
 * existing/warm contacts (see api/sms.js and api/webhooks/sms.js), not mass
 * campaigns. Uses a toll-free number (TWILIO_PHONE_NUMBER), which goes
 * through Twilio's toll-free verification instead of 10DLC brand/campaign
 * registration.
 *
 * Required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 */

export function twilioAuthHeader() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not configured in Vercel env vars");
  return { sid, authHeader: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") };
}

/** Normalize a US phone number to E.164 (+1XXXXXXXXXX). Returns "" if unusable. */
export function normalizePhone(raw) {
  const digits = (raw || "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "";
}

export async function sendSms({ to, body }) {
  const { sid, authHeader } = twilioAuthHeader();
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error("TWILIO_PHONE_NUMBER not configured in Vercel env vars");

  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || `Twilio ${r.status}`);
  return data; // { sid, status, ... }
}
