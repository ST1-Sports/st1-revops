import { zohoCrmCreateRecord, zohoRecordId } from './zohoCrm.js'

export const LOCAL_TO_ZOHO_STAGE = {
  Quoted: 'Proposal/Price Quote',
  'Follow-Up 1': 'Id. Decision Makers',
  'Follow-Up 2': 'Perception Analysis',
  Negotiating: 'Negotiation/Review',
  'PO Received': 'Negotiation/Review',
  'Closed Won': 'Closed Won',
  'Closed Lost': 'Closed Lost',
  'On Hold': 'Qualification',
}

export function zohoDealStage(local) {
  if (!local) return 'Proposal/Price Quote'
  return LOCAL_TO_ZOHO_STAGE[local] || local
}

export function isScopeError(rec) {
  const text = `${rec?.message || ''} ${rec?.code || ''} ${JSON.stringify(rec?.raw || rec || {})}`.toLowerCase()
  return /oauth|scope mismatch|invalid oauth|invalid auto scope|no_permission/.test(text)
}

export async function createZohoDeal({ dealName, amount, stage, closingDate, description, accountId, contactId }, headers) {
  const base = {
    Deal_Name: dealName,
    Amount: Number(amount) || 0,
    ...(closingDate ? { Closing_Date: closingDate } : {}),
    ...(description ? { Description: description } : {}),
    ...(accountId ? { Account_Name: { id: accountId } } : {}),
    ...(contactId ? { Contact_Name: { id: contactId } } : {}),
  }
  const stages = [...new Set([stage || 'Quoted', zohoDealStage(stage), 'Proposal/Price Quote'])]
  let last = null
  for (const Stage of stages) {
    last = await zohoCrmCreateRecord('Deals', { ...base, Stage }, headers)
    if (last?.status !== 'error' && zohoRecordId(last)) return { rec: last, id: zohoRecordId(last) }
  }
  return { rec: last, id: null }
}
