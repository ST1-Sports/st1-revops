/**
 * Vercel Serverless Function: POST /api/crm/note
 *
 * Creates a Note in Zoho CRM linked to a Contact or Lead.
 *
 * Body: { crmId, crmModule, noteTitle, noteContent }
 *   crmModule must be "Contacts" or "Leads"
 * Returns: { success: true, noteId }
 */

import { getZohoToken } from '../_lib/zoho-token.js';
import { setCors }       from '../_lib/cors.js';

const CRM_BASE     = 'https://www.zohoapis.com/crm/v3';
const VALID_MODULES = ['Contacts', 'Leads'];

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  const { crmId, crmModule, noteTitle, noteContent } = req.body || {};

  if (!crmId)        return res.status(400).json({ error: 'crmId is required' });
  if (!crmModule)    return res.status(400).json({ error: 'crmModule is required' });
  if (!noteContent)  return res.status(400).json({ error: 'noteContent is required' });
  if (!VALID_MODULES.includes(crmModule)) {
    return res.status(400).json({ error: `crmModule must be one of: ${VALID_MODULES.join(', ')}` });
  }

  let token;
  try {
    token = await getZohoToken();
  } catch (err) {
    return res.status(500).json({ error: err.message, setup: '/api/zoho-setup' });
  }

  try {
    const zohoRes = await fetch(`${CRM_BASE}/Notes`, {
      method: 'POST',
      headers: {
        Authorization:  `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: [{
          Note_Title:   noteTitle || 'Talk Track Note',
          Note_Content: noteContent,
          Parent_Id:    { id: crmId },
          se_module:    crmModule,
        }],
      }),
    });

    const data = await zohoRes.json();

    const record = data?.data?.[0];
    if (!zohoRes.ok || record?.status === 'error') {
      const detail = record?.message || data?.message || 'Zoho note creation failed';
      console.error('[crm/note]', detail);
      return res.status(502).json({ error: detail });
    }

    const created = record?.details || {};
    return res.status(200).json({ success: true, noteId: created.id });

  } catch (err) {
    console.error('[crm/note]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
