import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { getRateCalc, deriveRates } from './rateCalc'

// ─── Deal memo generation ─────────────────────────────────────────────────────
// Fills the production's real Word templates (public/deal-memo/*.docx, tagged
// with {placeholders}) from a crew resource + production dates/rate settings.
// Tax Status "Loan Out" → loan-out template (gross-only rates); anything else
// → direct hire (net / holiday / gross split, 89.23% / 10.77% = the ÷1.1207
// holiday factor). Fields the production doesn't track render as [●] for the
// crew member to complete, matching the template's own placeholder style.

const PLACEHOLDER = '[●]'

const money = n =>
  n == null || !Number.isFinite(n)
    ? null
    : n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const m = n => money(n) ?? PLACEHOLDER

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
  const net = g => (g == null || !(calc.holidayFactor > 0) ? null : g / calc.holidayFactor)
  const hol = g => (g == null || net(g) == null ? null : g - net(g))
  const { first, last } = splitName(resource.name)

  const endDate = resource.hireEndDate || production?.shootEndDate || null

  return {
    surname:    last || PLACEHOLDER,
    first_name: first || PLACEHOLDER,
    department: resource.department || PLACEHOLDER,
    job_title:  resource.role || PLACEHOLDER,
    mobile:     resource.contactPhone || PLACEHOLDER,
    email:      resource.contactEmail || PLACEHOLDER,
    start_date: dateOr(resource.hireStartDate),
    // Falls back to the final shoot day (the tracker's estimated end); the memo
    // itself says "unless terminated or extended", and the generated doc is
    // reviewed in Word before sending.
    end_date:   dateOr(endDate),
    chk_daily:  resource.costType !== 'weekly' ? '☒' : '☐',
    chk_weekly: resource.costType === 'weekly' ? '☒' : '☐',
    schedule_status:
      (resource.taxStatus ?? '').trim().toLowerCase() === 'schedule d' ? 'Schedule D' : 'PAYE',
    prep_period:       range(production?.prepStartDate, production?.prepEndDate),
    production_period: range(production?.shootStartDate, production?.shootEndDate),
    wrap_period:       fmtDate(production?.wrapStartDate)
      ? `${fmtDate(production?.wrapStartDate)} onwards`
      : PLACEHOLDER,

    // Direct hire rate table (net / holiday element / gross)
    d_net: m(r.dailyNet),   d_hol: m(r.dailyHol),   d_gross: m(r.daily),
    w_net: m(r.weeklyNet),  w_hol: m(r.weeklyHol),  w_gross: m(r.weekly),
    h_net: m(r.hourlyNet),  h_hol: m(r.hourlyHol),  h_gross: m(r.hourly),
    s6_net: m(net(r.sixth)),   s6_hol: m(hol(r.sixth)),   s6_gross: m(r.sixth),
    s7_net: m(net(r.seventh)), s7_hol: m(hol(r.seventh)), s7_gross: m(r.seventh),
    ot_net: m(net(r.ot)),      ot_hol: m(hol(r.ot)),      ot_gross: m(r.ot),

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

export async function downloadDealMemo(resource, production) {
  const blob = await generateDealMemoBlob(resource, production)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = dealMemoFilename(resource)
  a.click()
  URL.revokeObjectURL(url)
}
