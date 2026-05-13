/**
 * Vercel Serverless Function: POST /api/crm/lead
 *
 * Creates a new Lead in Zoho CRM from a Talk Track session.
 *
 * Body: { firstName, lastName, school, email, phone, role }
 * Returns: { id, fullName, school, module: "Lead" }
 */

import { getZohoToken } from '../_lib/zoho-token.js';
import { setCors }       from '../_lib/cors.js';

const CRM_BASE = 'https://www.zohoapis.com/crm/v3';

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  const { firstName, lastName, school, email, phone, role } = req.body || {};
  if (!firstName && !lastName) {
    return res.status(400).json({ error: 'At least one of firstName or lastName is required' });
  }

  let token;
  try {
    token = await getZohoToken();
  } catch (err) {
    return res.status(500).json({ error: err.message, setup: '/api/zoho-setup' });
  }

  try {
    const zohoRes = await fetch(`${CRM_BASE}/Leads`, {
      method: 'POST',
      headers: {
        Authorization:  `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: [{
          First_Name:  firstName   || '',
          Last_Name:   lastName    || '',
          Company:     school      || '',
          Email:       email       || '',
          Phone:       phone       || '',
          Designation: role        || '',
          Lead_Source: 'ST1 Talk Track',
          Lead_Status: 'Working',
        }],
      }),
    });

    const data = await zohoRes.json();

    const record = data?.data?.[0];
    if (!zohoRes.ok || record?.status === 'error') {
      const detail = record?.message || data?.message || 'Zoho lead creation failed';
      console.error('[crm/lead]', detail);
      return res.status(502).json({ error: detail });
    }

    const created = record?.details || {};
    return res.status(200).json({
      id:       created.id,
      fullName: `${firstName || ''} ${lastName || ''}`.trim(),
      school:   school || '',
      module:   'Lead',
    });

  } catch (err) {
    console.error('[crm/lead]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
