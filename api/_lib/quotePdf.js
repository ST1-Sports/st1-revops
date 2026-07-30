/**
 * Server-side quote PDF generation — entirely within RevOps, no Zoho involved.
 *
 * Renders a customer-facing quote document (sell prices only — dealer cost
 * and margin never appear here, those live only as custom fields on the
 * Zoho CRM Quote record). Built with pdf-lib since it's pure JS with no
 * native deps, so it runs cleanly in a Vercel serverless function.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const ORANGE = rgb(0xF3 / 255, 0x73 / 255, 0x21 / 255)
const BLACK  = rgb(0.06, 0.06, 0.06)
const MUTED  = rgb(0.48, 0.47, 0.45)
const BORDER = rgb(0.89, 0.88, 0.86)

const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * @param {object} q
 * @param {string} q.quoteNumber
 * @param {string} q.date - ISO date string
 * @param {string} [q.validUntil] - ISO date string
 * @param {string} q.customerName
 * @param {string} [q.contactPerson]
 * @param {Array<{name:string, description?:string, quantity:number, rate:number}>} q.lineItems
 * @param {string} [q.notes]
 * @returns {Promise<Uint8Array>}
 */
export async function generateQuotePdf(q) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792]) // Letter
  const font     = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const marginX = 50
  let y = 742

  const text = (str, x, yPos, { size = 10, f = font, color = BLACK } = {}) => {
    page.drawText(String(str ?? ''), { x, y: yPos, size, font: f, color })
  }
  const line = (yPos, color = BORDER) => {
    page.drawLine({ start: { x: marginX, y: yPos }, end: { x: 562, y: yPos }, thickness: 1, color })
  }

  // ── Header ──────────────────────────────────────────────────────────────
  text('ST1 SPORTS', marginX, y, { size: 20, f: fontBold, color: ORANGE })
  text('QUOTE', 470, y, { size: 20, f: fontBold, color: BLACK })
  y -= 16
  text('Athletic Equipment & Team Gear', marginX, y, { size: 9, color: MUTED })
  text(`# ${q.quoteNumber || '—'}`, 470, y, { size: 10, color: MUTED })
  y -= 12
  text('st1sports.com · matt@st1sports.com · 719-256-0275', marginX, y, { size: 9, color: MUTED })
  y -= 12
  text(`Date: ${q.date || new Date().toISOString().slice(0, 10)}`, 470, y, { size: 9, color: MUTED })
  if (q.validUntil) { y -= 12; text(`Valid until: ${q.validUntil}`, 470, y, { size: 9, color: MUTED }) }

  y -= 20
  line(y, ORANGE)
  y -= 26

  // ── Bill To ─────────────────────────────────────────────────────────────
  text('PREPARED FOR', marginX, y, { size: 8, f: fontBold, color: MUTED })
  y -= 16
  text(q.customerName || 'Customer', marginX, y, { size: 13, f: fontBold, color: BLACK })
  if (q.contactPerson) { y -= 15; text(q.contactPerson, marginX, y, { size: 10, color: MUTED }) }

  y -= 30

  // ── Line items table ────────────────────────────────────────────────────
  const colName = marginX, colQty = 400, colRate = 460, colTotal = 520
  text('ITEM', colName, y, { size: 8, f: fontBold, color: MUTED })
  text('QTY', colQty, y, { size: 8, f: fontBold, color: MUTED })
  text('RATE', colRate, y, { size: 8, f: fontBold, color: MUTED })
  text('TOTAL', colTotal, y, { size: 8, f: fontBold, color: MUTED })
  y -= 8
  line(y)
  y -= 18

  let subtotal = 0
  for (const li of (q.lineItems || [])) {
    if (y < 120) { y = 742; pdf.addPage([612, 792]) } // simple overflow guard; rare for a quote
    const qty = Number(li.quantity) || 0
    const rate = Number(li.rate) || 0
    const lineTotal = qty * rate
    subtotal += lineTotal

    text(li.name || 'Item', colName, y, { size: 10, f: fontBold })
    text(String(qty), colQty, y, { size: 10 })
    text(money(rate), colRate, y, { size: 10 })
    text(money(lineTotal), colTotal, y, { size: 10, f: fontBold })
    y -= 14
    if (li.description) {
      text(li.description.slice(0, 90), colName, y, { size: 9, color: MUTED })
      y -= 14
    }
    y -= 6
  }

  y -= 6
  line(y)
  y -= 22

  // ── Totals ──────────────────────────────────────────────────────────────
  text('TOTAL', 460, y, { size: 11, f: fontBold })
  text(money(subtotal), colTotal, y, { size: 11, f: fontBold, color: ORANGE })

  // ── Notes / terms ───────────────────────────────────────────────────────
  if (q.notes) {
    y -= 40
    text('NOTES', marginX, y, { size: 8, f: fontBold, color: MUTED })
    y -= 14
    const words = String(q.notes).split(/\s+/)
    let lineBuf = ''
    for (const w of words) {
      if ((lineBuf + ' ' + w).trim().length > 95) {
        text(lineBuf.trim(), marginX, y, { size: 9 })
        y -= 13
        lineBuf = w
      } else {
        lineBuf += ' ' + w
      }
    }
    if (lineBuf.trim()) { text(lineBuf.trim(), marginX, y, { size: 9 }) }
  }

  return pdf.save()
}
