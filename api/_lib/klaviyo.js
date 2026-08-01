/**
 * Shared Klaviyo API v3 helper.
 *
 * Required env var: KLAVIYO_API_KEY (a private API key — Klaviyo account →
 * Settings → API Keys → Create Private API Key, needs Metrics + Lists read scope)
 */

const API_BASE = 'https://a.klaviyo.com/api'
const REVISION = '2024-10-15'

export function klaviyoConfigured() {
  return Boolean(process.env.KLAVIYO_API_KEY)
}

async function klaviyoFetch(path, opts = {}) {
  const key = process.env.KLAVIYO_API_KEY
  if (!key) throw new Error('KLAVIYO_API_KEY not configured')
  const r = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Klaviyo-API-Key ${key}`,
      revision: REVISION,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error(data?.errors?.[0]?.detail || `Klaviyo ${r.status}`)
  return data
}

/** Find a metric by name (first match wins, in the order given) — e.g. the
 * form-submission metric is called "Filled Out Form" for native Klaviyo
 * signup forms, or "Subscribed to List" for plain list signups. */
export async function findMetricId(nameCandidates) {
  const data = await klaviyoFetch('/metrics/?page[size]=100')
  const metrics = data?.data || []
  for (const name of nameCandidates) {
    const match = metrics.find(m => (m.attributes?.name || '').toLowerCase() === name.toLowerCase())
    if (match) return { id: match.id, name: match.attributes.name }
  }
  return null
}

/** Total event count for a metric between two ISO datetimes. */
export async function metricCount(metricId, sinceISO, untilISO) {
  const body = {
    data: {
      type: 'metric-aggregate',
      attributes: {
        metric_id: metricId,
        measurements: ['count'],
        interval: 'day',
        page_size: 500,
        filter: [`greater-or-equal(datetime,${sinceISO})`, `less-than(datetime,${untilISO})`],
      },
    },
  }
  const data = await klaviyoFetch('/metric-aggregates/', { method: 'POST', body: JSON.stringify(body) })
  const buckets = data?.data?.attributes?.data || []
  let total = 0
  for (const b of buckets) {
    const counts = b.measurements?.count || []
    total += counts.reduce((s, n) => s + (Number(n) || 0), 0)
  }
  return total
}
