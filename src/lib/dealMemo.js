import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { getRateCalc, deriveRates } from './rateCalc'
import pdfMap from './dealMemoPdfMap.json'

// ─── Deal memo generation ─────────────────────────────────────────────────────
// Fills the production's real Word templates (public/deal-memo/*.docx, tagged
// with {placeholders}) from a crew resource + production dates/rate settings.
// Tax Status "Loan Out" → loan-out template (gross-only rates); anything else
// → direct hire (net / holiday / gross split, 89.23% / 10.77% = the ÷1.1207
// holiday factor). Fields the production doesn't track render as [●] for the
// crew member to complete, matching the template's own placeholder style.

// Blank write-in line for anything we can't fill (matches the template's own
// crew-member fill-in blanks).
const PLACEHOLDER = '__________'

// House money style (matches the executed memos): 2dp, trailing .00 stripped,
// no thousands separators — 1300, 1159.99, 232, 23.64.
const r2 = n => Math.round(n * 100) / 100
const money = n => {
  if (n == null || !Number.isFinite(n)) return null
  return String(r2(n).toFixed(2)).replace(/\.00$/, '')
}
const m = n => money(n) ?? PLACEHOLDER

// Start/End dates in the executed style: 19/10/2026
function fmtDateShort(iso) {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  if (isNaN(d)) return null
  const p = x => String(x).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

// Production periods keep the template's long form: 5 October 2026
function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

const dateOr = iso => fmtDate(iso) ?? PLACEHOLDER
const range = (a, b) =>
  fmtDate(a) || fmtDate(b) ? `${dateOr(a)} - ${dateOr(b)}` : PLACEHOLDER

function splitName(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { first: parts[0] ?? '', last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

const num = v => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

export function isLoanOut(resource) {
  return (resource?.taxStatus ?? '').trim().toLowerCase() === 'loan out'
}

export function dealMemoFilename(resource) {
  const safe = String(resource?.name ?? 'crew').replace(/[^\w\s.-]/g, '').trim() || 'crew'
  return `Deal Memo - ${safe}${isLoanOut(resource) ? ' (Loan Out)' : ''}.docx`
}

// Build the full tag→value map for a resource. Exported for tests.
export function buildDealMemoData(resource, production) {
  const calc = getRateCalc(production)
  const r = deriveRates(resource, calc)
  // Display math follows the executed memos: round the gross and the net to
  // display precision first, holiday element = their difference — so every
  // printed row adds up exactly (e.g. 23.64 = 21.09 + 2.55).
  const split = gross => {
    if (gross == null || !Number.isFinite(gross) || !(calc.holidayFactor > 0)) {
      return { g: PLACEHOLDER, n: PLACEHOLDER, h: PLACEHOLDER }
    }
    const g = r2(gross)
    const n = r2(gross / calc.holidayFactor)
    return { g: m(g), n: m(n), h: m(r2(g - n)) }
  }
  const { first, last } = splitName(resource.name)

  const endDate = resource.hireEndDate || production?.shootEndDate || null
  const d = split(r.daily), w = split(r.weekly), h = split(r.hourly)

  return {
    surname:     last || PLACEHOLDER,
    first_name:  first || PLACEHOLDER,
    credit_name: (resource.name ?? '').trim() || PLACEHOLDER,
    unit:        'Main',
    department: resource.department || PLACEHOLDER,
    job_title:  resource.role || PLACEHOLDER,
    mobile:     resource.contactPhone || PLACEHOLDER,
    email:      resource.contactEmail || PLACEHOLDER,
    start_date: fmtDateShort(resource.hireStartDate) ?? PLACEHOLDER,
    // Falls back to the final shoot day (the tracker's estimated end); the memo
    // itself says "unless terminated or extended", and the generated doc is
    // reviewed in Word before sending.
    end_date:   fmtDateShort(endDate) ?? PLACEHOLDER,
    chk_daily:  resource.costType !== 'weekly' ? '☒' : '☐',
    chk_weekly: resource.costType === 'weekly' ? '☒' : '☐',
    schedule_status:
      (resource.taxStatus ?? '').trim().toLowerCase() === 'schedule d' ? 'Schedule D' : 'PAYE',
    prep_period:       range(production?.prepStartDate, production?.prepEndDate),
    production_period: range(production?.shootStartDate, production?.shootEndDate),
    wrap_period:       fmtDate(production?.wrapStartDate)
      ? `${fmtDate(production?.wrapStartDate)} onwards`
      : PLACEHOLDER,

    // Direct hire rate table (net / holiday element / gross). The 6th/7th/OT
    // premium rows are gross-only — their net/holiday cells are literal "n/a"
    // in the template, matching the executed memos.
    d_net: d.n,  d_hol: d.h,  d_gross: d.g,
    w_net: w.n,  w_hol: w.h,  w_gross: w.g,
    h_net: h.n,  h_hol: h.h,  h_gross: h.g,
    s6_gross: m(r.sixth),
    s7_gross: m(r.seventh),
    ot_gross: m(r.ot),

    // Loan out rate table (gross only)
    lo_daily: m(r.daily), lo_weekly: m(r.weekly), lo_hourly: m(r.hourly),
    lo_sixth: m(r.sixth), lo_seventh: m(r.seventh), lo_ot: m(r.ot),

    // Allowances (stored weekly in the tracker). The template keeps its own
    // "per week/day" suffix after the tag, so the value is just the amount —
    // tracker amounts are weekly, so the reviewer strikes "/day".
    car_allowance: m(num(resource.carAllowance)),
    box_rental:    m(num(resource.boxPw)),

    agent: (resource.agent ?? '').trim() || 'N/A',
  }
}

// Fill the right template and return a Blob of the finished .docx.
export async function generateDealMemoBlob(resource, production) {
  const tpl = isLoanOut(resource) ? 'loan-out' : 'direct-hire'
  const res = await fetch(`/deal-memo/${tpl}.docx`)
  if (!res.ok) throw new Error(`Deal memo template "${tpl}.docx" could not be loaded.`)
  const zip = new PizZip(await res.arrayBuffer())
  const doc = new Docxtemplater(zip, { linebreaks: false })
  doc.render(buildDealMemoData(resource, production))
  return doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
  })
}

// ─── PDF generation ───────────────────────────────────────────────────────────
// The two templates are pre-rendered to PDF once (public/deal-memo/*-base.pdf,
// built with LibreOffice from the tagged Word docs) with every field marker's
// coordinates extracted into dealMemoPdfMap.json. Filling = white-out the
// marker, draw the value in place. Legal text is the untouched render; the
// production-period block is baked into the base (regenerate the bases if the
// production's dates ever change in Project Setup).

export async function generateDealMemoPdfBlob(resource, production) {
  const lo = isLoanOut(resource)
  const map = lo ? pdfMap.lo : pdfMap.dh
  const res = await fetch(`/deal-memo/${lo ? 'loan-out' : 'direct-hire'}-base.pdf`)
  if (!res.ok) throw new Error('Deal memo PDF template could not be loaded.')
  const pdf = await PDFDocument.load(await res.arrayBuffer())
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()
  const data = buildDealMemoData(resource, production)
  const H = map.pageHeight

  for (const [tag, f] of Object.entries(map.fields)) {
    const value = data[tag]
    if (value === undefined) continue
    const page = pages[f.page - 1]
    if (!page) continue
    // Cover the marker (and its £ prefix), then draw prefix + value in place
    page.drawRectangle({
      x: f.x1 - 1, y: H - f.y2 - 1.5,
      width: (f.x2 - f.x1) + 3, height: (f.y2 - f.y1) + 3,
      color: rgb(1, 1, 1),
    })
    page.drawText(`${f.prefix ?? ''}${value}`, {
      x: f.x1, y: H - f.y2 + 1.8, size: 8.5, font, color: rgb(0, 0, 0),
    })
  }

  // Engagement checkboxes: draw an X over the chosen ☐ (first = Daily, second = Weekly)
  const chosen = data.chk_weekly === '☒' ? map.checkboxes[1] : map.checkboxes[0]
  if (chosen) {
    const page = pages[chosen.page - 1]
    page.drawText('X', {
      x: chosen.x1 + 1.3, y: H - chosen.y2 + 1.6, size: 7.5, font, color: rgb(0, 0, 0),
    })
  }

  const bytes = await pdf.save()
  return new Blob([bytes], { type: 'application/pdf' })
}

export async function generateDealMemoPdfBase64(resource, production) {
  const blob = await generateDealMemoPdfBlob(resource, production)
  return blobToBase64(blob)
}

export function dealMemoPdfFilename(resource) {
  return dealMemoFilename(resource).replace(/\.docx$/, '.pdf')
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

// Base64 of the filled .docx — for emailing as an attachment.
export async function generateDealMemoBase64(resource, production) {
  return blobToBase64(await generateDealMemoBlob(resource, production))
}

export async function downloadDealMemo(resource, production) {
  const blob = await generateDealMemoBlob(resource, production)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = dealMemoFilename(resource)
  a.click()
  URL.revokeObjectURL(url)
}
