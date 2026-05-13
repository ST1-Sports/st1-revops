/**
 * Vercel Serverless Function: POST /api/ai/email
 *
 * Builds a structured AI-written follow-up email from Talk Track session data.
 * Calls the Anthropic API directly (same pattern as /api/claude).
 *
 * Body: { sessionId, contactName, schoolName, schoolClass, numAthletes, numSports,
 *         confirmedPains, answers, questionMap, sponsorshipGuaranteedMin,
 *         sponsorshipUpsideMax, nextStep }
 * Returns: { subject, body }
 */

import { setCors } from '../_lib/cors.js';

const MODEL = 'claude-sonnet-4-20250514';

const SYSTEM = `You are a sales rep for ST1 Sports, a nationwide athletic equipment and custom apparel supplier based in Colorado Springs, CO. ST1 serves K-12 athletic programs as an all-in-one source for equipment (Wilson, DeMarini, All-Star, Diamond, EvoShield, Molten, Gill Athletics and 15+ more brands), custom uniforms, team apparel, and online team stores. Write a warm, direct, professional follow-up email to an athletic director after a discovery call. Reference specific details from the call. Do not be generic. Do not oversell. Sound like a real person who had a real conversation. Sign off as [Rep Name] from ST1 Sports. Return ONLY a JSON object with two fields: { subject: string, body: string }. The body should use plain text with newlines. No HTML, no markdown, no bullet characters.`;

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });

  const {
    contactName,
    schoolName,
    schoolClass,
    numAthletes,
    numSports,
    confirmedPains = [],
    answers        = {},
    questionMap    = {},
    sponsorshipGuaranteedMin,
    sponsorshipUpsideMax,
    nextStep,
  } = req.body || {};

  // Build user message from session data
  const parts = [];

  parts.push(`Contact: ${contactName || 'Athletic Director'}`);
  if (schoolName)  parts.push(`School: ${schoolName}${schoolClass ? ` (${schoolClass})` : ''}`);
  if (numAthletes) parts.push(`Athletes in program: ${numAthletes}`);
  if (numSports)   parts.push(`Sports offered: ${numSports}`);

  if (confirmedPains.length > 0) {
    parts.push(`\nKey challenges identified during the call:\n${confirmedPains.map(p => `- ${p}`).join('\n')}`);
  }

  if (sponsorshipGuaranteedMin != null) {
    parts.push(
      `\nSponsorship offer presented:`,
      `- Guaranteed minimum giveback: $${Number(sponsorshipGuaranteedMin).toLocaleString()}`,
      `- Upside potential: up to $${Number(sponsorshipUpsideMax || 0).toLocaleString()}`,
    );
  }

  const answeredQs = Object.entries(answers)
    .filter(([, v]) => v != null && v !== '' && v !== false)
    .map(([id, v]) => {
      const q = questionMap[id];
      if (!q) return null;
      const display = v === true ? 'Yes' : v === false ? 'No' : String(v);
      return `${q}: ${display}`;
    })
    .filter(Boolean);

  if (answeredQs.length > 0) {
    parts.push(`\nCall notes:\n${answeredQs.join('\n')}`);
  }

  if (nextStep) parts.push(`\nAgreed next step: ${nextStep}`);

  const userMessage = parts.join('\n');

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 600,
        system:     SYSTEM,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      console.error('[ai/email] Anthropic error:', data?.error?.message);
      throw new Error(data?.error?.message || `Anthropic returned ${upstream.status}`);
    }

    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

    let parsed = null;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    } catch {
      parsed = null;
    }

    if (!parsed?.subject || !parsed?.body) {
      return res.status(200).json({
        subject: 'Following up from our call',
        body: `Hi ${contactName || 'there'},\n\nGreat speaking with you today. I wanted to follow up on what we discussed and get you more details on how ST1 Sports can support ${schoolName || 'your program'}.\n\nI'll be in touch shortly.\n\nBest,\nMatt Stone\nST1 Sports`,
      });
    }

    return res.status(200).json({ subject: parsed.subject, body: parsed.body });

  } catch (err) {
    console.error('[ai/email]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
