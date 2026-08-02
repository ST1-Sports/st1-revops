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
 * signup forms, or "Subscribed to List" for plain list signups. Klaviyo's
 * /metrics/ endpoint is cursor-paginated with no page-size override, so
 * this follows links.next until it finds a match or runs out of pages. */
export async function findMetricId(nameCandidates) {
  const all = []
  let path = '/metrics/'
  for (let page = 0; path && page < 20; page++) {
    const data = await klaviyoFetch(path)
    all.push(...(data?.data || []))
    const next = data?.links?.next || null
    path = next ? next.replace(/^https:\/\/a\.klaviyo\.com\/api/, '') : null
  }
  for (const name of nameCandidates) {
    const match = all.find(m => (m.attributes?.name || '').toLowerCase() === name.toLowerCase())
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

/** Individual signup events for a metric, newest first, with the profile's
 * name/email/phone sideloaded — for a "who signed up and when" table, not
 * just a count. Capped at `limit` (most recent) rather than paginating
 * through everything, since this is for display, not aggregation. */
export async function listMetricEvents(metricId, sinceISO, untilISO, limit = 50) {
  const filter = `and(equals(metric_id,"${metricId}"),greater-or-equal(datetime,${sinceISO}),less-than(datetime,${untilISO}))`
  const qs = new URLSearchParams({ filter, include: 'profile', sort: '-datetime', 'page[size]': String(Math.min(limit, 200)) })
  const data = await klaviyoFetch(`/events/?${qs.toString()}`)
  const profilesById = new Map((data?.included || []).filter(i => i.type === 'profile').map(p => [p.id, p]))
  return (data?.data || []).slice(0, limit).map(ev => {
    const profile = profilesById.get(ev.relationships?.profile?.data?.id)?.attributes || {}
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || profile.phone_number || 'Unknown'
    return {
      name,
      date:  ev.attributes?.datetime || null,
      email: profile.email || null,
      phone: profile.phone_number || null,
    }
  })
}
