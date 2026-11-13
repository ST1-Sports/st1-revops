import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CustomerResolutionError,
  LineMappingError,
  GENERIC_LINE_NAME,
  CONSULTING_SERVICES_ACCOUNT_ID,
  resolveBooksCustomer,
  buildInvoiceLineItems,
  collectQuoteLines,
  classifyInvoiceLine,
  inferChannel,
  extractQuoteNumber,
  createGuardedInvoice,
} from './booksInvoice.js'

const ACCOUNTS = [
  { account_id: 'acct-tf', account_name: 'B2B - T&F' },
  { account_id: 'acct-bb', account_name: 'B2B - Baseball' },
  { account_id: 'acct-ship', account_name: 'Shipping Charge' },
  { account_id: CONSULTING_SERVICES_ACCOUNT_ID, account_name: 'Consulting Services' },
]

const BISMARCK = { contact_id: 'cust-bismarck', contact_name: 'Bismarck Public Schools', contact_type: 'customer', status: 'active' }
const STORE_719 = { contact_id: '7255504000002676002', contact_name: '719 Baseball Team Store', contact_type: 'customer', status: 'active' }

function sevenTrackLines() {
  return [
    { name: 'Gill Hurdle 39"', qty: 6, rate: 180 },
    { name: 'Blazer Starting Block', qty: 4, rate: 95 },
    { name: 'Track Spikes', qty: 12, rate: 42 },
    { name: 'FinishLynx Timing', qty: 1, rate: 850 },
    { name: 'Javelin 600g', qty: 3, rate: 110 },
    { name: 'Discus 1.6kg', qty: 2, rate: 75 },
    { name: 'Freight', qty: 1, rate: 85 },
  ]
}

function mockPrisma() {
  const rows = []
  return {
    rows,
    dealInvoice: {
      async findFirst({ where }) {
        return rows.find(r => {
          if (where.zohoInvoiceId && r.zohoInvoiceId !== where.zohoInvoiceId) return false
          if (where.quoteNumber && r.quoteNumber !== where.quoteNumber) return false
          if (where.crmDealId && r.crmDealId !== where.crmDealId) return false
          if (where.status?.not && r.status === where.status.not) return false
          return true
        }) || null
      },
      async create({ data }) {
        const row = { id: `di_${rows.length + 1}`, ...data }
        rows.push(row)
        return row
      },
      async update({ where, data }) {
        const row = rows.find(r => r.id === where.id)
        Object.assign(row, data)
        return row
      },
    },
  }
}

function mockBooks({ contacts = [], invoices = [], items = [], accounts = ACCOUNTS } = {}) {
  const posts = []
  return {
    posts,
    async booksGet(path) {
      if (path.startsWith('/contacts?')) {
        const url = new URL('https://x.test' + path)
        if (!url.searchParams.get('contact_name') && !url.searchParams.get('email')) {
          throw new Error('empty contact search')
        }
        return { contacts }
      }
      if (path.startsWith('/contacts/')) {
        const id = path.split('/')[2]
        const c = contacts.find(x => x.contact_id === id)
        return c ? { contact: { ...c, payment_terms: c.payment_terms ?? 0, payment_terms_label: c.payment_terms_label || 'Due on Receipt', contact_persons: c.contact_persons || [] } } : null
      }
      if (path.startsWith('/invoices?reference_number=')) {
        const ref = decodeURIComponent(path.split('reference_number=')[1].split('&')[0])
        return { invoices: invoices.filter(i => i.reference_number === ref) }
      }
      if (path.startsWith('/chartofaccounts')) return { chartofaccounts: accounts }
      if (path.startsWith('/items')) return { items }
      return {}
    },
    async booksPost(path, body) {
      posts.push({ path, body })
      return {
        invoice: {
          invoice_id: 'inv-new',
          invoice_number: 'INV-000180',
          total: (body.line_items || []).reduce((s, li) => s + li.rate * li.quantity, 0),
        },
      }
    },
  }
}

describe('resolveBooksCustomer', () => {
  it('returns a stored contact_id without using the list', () => {
    assert.equal(
      resolveBooksCustomer({ storedContactId: 'abc', contactName: 'Nope', contacts: [STORE_719] }),
      'abc'
    )
  })

  it('throws and never returns contacts[0] when there is no exact match', () => {
    assert.throws(
      () => resolveBooksCustomer({ contactName: 'Bismarck Public Schools', contacts: [STORE_719] }),
      (err) => err instanceof CustomerResolutionError && err.matchCount === 0
    )
  })

  it('throws on multiple exact matches', () => {
    const dup = { ...BISMARCK, contact_id: 'cust-bismarck-2' }
    assert.throws(
      () => resolveBooksCustomer({ contactName: 'Bismarck Public Schools', contacts: [BISMARCK, dup] }),
      (err) => err instanceof CustomerResolutionError && err.matchCount === 2
    )
  })

  it('rejects an empty search string', () => {
    assert.throws(
      () => resolveBooksCustomer({ contactName: '  ', contacts: [STORE_719] }),
      CustomerResolutionError
    )
  })

  it('matches exactly, case-insensitive, among active customers only', () => {
    const inactive = { ...BISMARCK, contact_id: 'dead', status: 'inactive' }
    const id = resolveBooksCustomer({
      contactName: 'bismarck public schools',
      contacts: [STORE_719, inactive, BISMARCK],
    })
    assert.equal(id, 'cust-bismarck')
  })
})

describe('buildInvoiceLineItems', () => {
  it('maps a 7-line quote onto T&F and Shipping Charge accounts', () => {
    const lines = buildInvoiceLineItems(sevenTrackLines(), { accounts: ACCOUNTS, channel: 'B2B' })
    assert.equal(lines.length, 7)
    assert.deepEqual(lines.slice(0, 6).map(l => l.account_id), Array(6).fill('acct-tf'))
    assert.equal(lines[6].account_id, 'acct-ship')
    assert.equal(lines[6].name, 'Freight')
    assert.ok(!lines.some(l => l.account_id === CONSULTING_SERVICES_ACCOUNT_ID))
    assert.ok(!lines.some(l => l.name === GENERIC_LINE_NAME))
  })

  it('fails loudly instead of posting a lump-sum generic line', () => {
    assert.equal(collectQuoteLines({}).length, 0)
    assert.throws(() => buildInvoiceLineItems([]), LineMappingError)
    assert.throws(
      () => buildInvoiceLineItems([{ name: GENERIC_LINE_NAME, qty: 1, rate: 2329.4 }]),
      LineMappingError
    )
  })
})

describe('helpers', () => {
  it('extracts ST1 quote numbers and classifies shipping vs T&F', () => {
    assert.equal(extractQuoteNumber('Bismarck — ST1-2026-11-02'), 'ST1-2026-11-02')
    assert.equal(classifyInvoiceLine('Freight prepaid').kind, 'shipping')
    assert.equal(classifyInvoiceLine('Gill Hurdle').category, 't&f')
    assert.equal(inferChannel('719 Baseball Team Store'), 'Team Store')
    assert.equal(inferChannel('Bismarck Public Schools'), 'B2B')
  })
})

describe('createGuardedInvoice', () => {
  it('throws on no customer match and does not POST /invoices', async () => {
    const books = mockBooks({ contacts: [STORE_719] })
    await assert.rejects(
      () => createGuardedInvoice({
        dryRun: false,
        customerName: 'Bismarck Public Schools',
        quoteNumber: 'ST1-2026-11-02',
        lineItems: sevenTrackLines(),
      }, { ...books, prisma: mockPrisma() }),
      CustomerResolutionError
    )
    assert.equal(books.posts.length, 0)
  })

  it('throws on multiple matches and does not POST /invoices', async () => {
    const books = mockBooks({
      contacts: [BISMARCK, { ...BISMARCK, contact_id: 'cust-bismarck-2' }],
    })
    await assert.rejects(
      () => createGuardedInvoice({
        dryRun: false,
        customerName: 'Bismarck Public Schools',
        quoteNumber: 'ST1-2026-11-02',
        lineItems: sevenTrackLines(),
      }, { ...books, prisma: mockPrisma() }),
      (err) => err instanceof CustomerResolutionError && err.matchCount === 2
    )
    assert.equal(books.posts.length, 0)
  })

  it('returns the existing Zoho invoice when reference_number already exists', async () => {
    const books = mockBooks({
      contacts: [BISMARCK],
      invoices: [{
        invoice_id: 'inv-178',
        invoice_number: 'INV-000178',
        reference_number: 'ST1-2026-11-02',
        status: 'draft',
        total: 2329.4,
        customer_id: 'cust-bismarck',
      }],
    })
    const result = await createGuardedInvoice({
      dryRun: false,
      customerName: 'Bismarck Public Schools',
      quoteNumber: 'ST1-2026-11-02',
      lineItems: sevenTrackLines(),
    }, { ...books, prisma: mockPrisma() })
    assert.equal(result.alreadyExists, true)
    assert.equal(result.zohoInvoiceId, 'inv-178')
    assert.equal(books.posts.length, 0)
  })

  it('posts seven mapped lines on B2B T&F / Shipping Charge and never contacts[0]', async () => {
    const books = mockBooks({ contacts: [BISMARCK] })
    const result = await createGuardedInvoice({
      dryRun: false,
      customerName: 'Bismarck Public Schools',
      quoteNumber: 'ST1-2026-11-02',
      lineItems: sevenTrackLines(),
      notes: 'Quote ST1-2026-11-02',
      terms: 'Net per customer terms.',
    }, { ...books, prisma: mockPrisma() })
    assert.equal(result.ok, true)
    assert.equal(books.posts.length, 1)
    const body = books.posts[0].body
    assert.equal(body.customer_id, 'cust-bismarck')
    assert.notEqual(body.customer_id, STORE_719.contact_id)
    assert.equal(body.reference_number, 'ST1-2026-11-02')
    assert.equal(body.line_items.length, 7)
    assert.equal(body.line_items[0].account_id, 'acct-tf')
    assert.equal(body.line_items[6].account_id, 'acct-ship')
    assert.equal(body.payment_terms, 0)
    assert.ok(body.notes)
    assert.ok(body.terms)
  })
})
