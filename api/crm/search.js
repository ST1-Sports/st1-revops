/**
 * Vercel Serverless Function: GET /api/crm/search
 *
 * Searches Zoho CRM Contacts and Leads by name or school/company.
 * Two searches per module (Full_Name + school field) are merged and deduped.
 *
 * Query param: q (string, min 2 chars)
 * Returns: array of up to 10 unified contact objects
 */

import { getZohoToken } from '../_lib/zoho-token.js';
import { setCors }       from '../_lib/cors.js';

const CRM_BASE = 'https://www.zohoapis.com/crm/v3';

async function zohoSearch(token, module, field, value) {
  const criteria = encodeURIComponent(`(${field}:contains:${value})`);
  const res = await fetch(`${CRM_BASE}/${module}/search?criteria=${criteria}&per_page=5`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  if (res.status === 204) return [];
  const data = await res.json();
  return data?.data || [];
}

function mapContact(r) {
  return {
    id:        r.id,
    firstName: r.First_Name  || '',
    lastName:  r.Last_Name   || '',
    fullName:  r.Full_Name   || `${r.First_Name || ''} ${r.Last_Name || ''}`.trim(),
    school:    r.Account_Name || '',
    email:     r.Email       || '',
    phone:     r.Phone       || '',
    module:    'Contact',
  };
}

function mapLead(r) {
  return {
    id:        r.id,
    firstName: r.First_Name || '',
    lastName:  r.Last_Name  || '',
    fullName:  r.Full_Name  || `${r.First_Name || ''} ${r.Last_Name || ''}`.trim(),
    school:    r.Company    || '',
    email:     r.Email      || '',
    phone:     r.Phone      || '',
    module:    'Lead',
  };
}

export default async function handler(req, res) {
  setCors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'GET only' });

  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.status(200).json([]);

  let token;
  try {
    token = await getZohoToken();
  } catch (err) {
    return res.status(500).json({ error: err.message, setup: '/api/zoho-setup' });
  }

  try {
    const [cByName, cBySchool, lByName, lByCompany] = await Promise.all([
      zohoSearch(token, 'Contacts', 'Full_Name',    q),
      zohoSearch(token, 'Contacts', 'Account_Name', q),
      zohoSearch(token, 'Leads',    'Full_Name',    q),
      zohoSearch(token, 'Leads',    'Company',      q),
    ]);

    const seen = new Map();
    for (const r of [...cByName, ...cBySchool]) {
      if (!seen.has(r.id)) seen.set(r.id, mapContact(r));
    }
    for (const r of [...lByName, ...lByCompany]) {
      if (!seen.has(r.id)) seen.set(r.id, mapLead(r));
    }

    return res.status(200).json([...seen.values()].slice(0, 10));

  } catch (err) {
    console.error('[crm/search]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
