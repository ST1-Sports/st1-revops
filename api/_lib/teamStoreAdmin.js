/**
 * Raw calls against the ST1 admin app's team-store endpoints. Every call
 * goes through the session returned by st1AdminAuth.js's createSession(),
 * which re-authenticates and retries once on a 403 (this API's signal for
 * an aged-out token on these specific endpoints).
 */

const API_BASE = process.env.ST1_ADMIN_API_BASE || 'https://api.st1sports.com';
const PER_PAGE = 100; // GET /admin/team_store_order 500s if called unpaginated — this is mandatory, not a tuning knob

/** Every order summary across all pages — a page shorter than PER_PAGE means it was the last one. */
export async function fetchAllOrderSummaries(session) {
  const orders = [];
  let page = 1;
  while (true) {
    const res = await session.request(`/admin/team_store_order?page=${page}&perPage=${PER_PAGE}`);
    if (!res.ok) throw new Error(`GET /admin/team_store_order?page=${page} failed (${res.status})`);
    const batch = await res.json();
    if (!Array.isArray(batch)) {
      throw new Error('GET /admin/team_store_order did not return a bare array as expected — check the response shape');
    }
    orders.push(...batch);
    if (batch.length < PER_PAGE) break;
    page++;
  }
  return orders;
}

/** One order, with items[] — the list endpoint above doesn't include line items. */
export async function fetchOrderDetail(session, orderId) {
  const res = await session.request(`/admin/team_store_order/${orderId}`);
  if (!res.ok) throw new Error(`GET /admin/team_store_order/${orderId} failed (${res.status})`);
  return res.json();
}

/**
 * DTF small/medium/large, embroidery, screen print costs. Identical for all
 * 8 suppliers despite the endpoint taking a supplierId — the exact response
 * shape (field names for each decoration type) is UNVERIFIED; decorationCostFor()
 * in teamStoreSync.js is where to correct it once a real response is seen.
 */
export async function fetchDecorationCosts(session) {
  const res = await session.request('/admin/decoration_cost');
  if (!res.ok) throw new Error(`GET /admin/decoration_cost failed (${res.status})`);
  return res.json();
}

export { API_BASE };
