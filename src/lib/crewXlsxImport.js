// ─── Crew tracker Excel import ────────────────────────────────────────────────
//
// Parses the production's crew-tracker Excel template (uploaded through the
// Crew Tracker "Import CSV" button) into plain person objects, and diffs them
// against the existing crew resources so the user can approve changes.
//
// Template layout (1-based columns), header on ROW 3, data from ROW 4:
//   A  Email Deal Memo            → dealMemoEmailed (free text / TRUE / FALSE)
//   B  Deal Memo drafted          → dealMemoDrafted
//   C  Deal Memo - Docusign sent? → dealMemoSent
//   D  Name   E  Role   F  (ignored)   G  Email   H  Number   I  Agent
//   K  Weekly Rate (number)       → costAmount + costType 'weekly'
//   L–S derived nets/daily/hourly → ignored
//   T  6th Day Rate  U  7th Day Rate  V  OT Rate
//        — only hard-typed number constants count as overrides; cells holding
//          a FORMULA (cell.f present) are calculated values, not overrides.
//   W  Box (pw)   X  Car   Y  Tax Status
//   Z  Start Date   AA  End Date  (real dates or dd/mm/yy[yy] strings)
//   AB+ the sheet's own gantt     → ignored
//
// Department sections: a row with only column D set (and E empty) is a
// department header; the rows beneath belong to it until the next header.

// 0-based column indices
const COL = {
  dealMemoEmailed: 0,   // A
  dealMemoDrafted: 1,   // B
  dealMemoSent:    2,   // C
  name:            3,   // D
  role:            4,   // E
  email:           6,   // G
  phone:           7,   // H
  agent:           8,   // I
  weeklyRate:      10,  // K
  sixthOverride:   19,  // T
  seventhOverride: 20,  // U
  otOverride:      21,  // V
  boxPw:           22,  // W
  carAllowance:    23,  // X
  taxStatus:       24,  // Y
  startDate:       25,  // Z
  endDate:         26,  // AA
}

const HEADER_ROW = 2   // row 3 (0-based)
const DATA_START = 3   // row 4 (0-based)

function toISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// String value: booleans → 'TRUE'/'FALSE', empty → ''
function strVal(cell) {
  if (!cell || cell.v === undefined || cell.v === null) return ''
  const v = cell.v
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return toISODate(v)
  return String(v).trim()
}

// Number value: numbers pass through; numeric-looking strings (strip £/$/commas)
// parse; anything else → null.
function numVal(cell) {
  if (!cell || cell.v === undefined || cell.v === null) return null
  const v = cell.v
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const cleaned = v.replace(/[£$€,\s]/g, '')
    if (!cleaned) return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// Rate override: only a hard-typed NUMBER constant counts. A cell with a
// formula (`.f` present) is a calculated value → NOT an override.
function overrideVal(cell) {
  if (!cell) return null
  if (cell.f) return null
  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return cell.v
  return null
}

// Date value → 'YYYY-MM-DD'. Handles real Date cells (cellDates: true),
// ISO strings, and dd/mm/yy[yy] strings. Unparseable → ''.
function dateVal(cell) {
  if (!cell || cell.v === undefined || cell.v === null) return ''
  const v = cell.v
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : toISODate(v)
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return ''
    // Already ISO
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m) return s
    // dd/mm/yy or dd/mm/yyyy (also - or . separators)
    m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
    if (m) {
      const day = Number(m[1]), month = Number(m[2])
      let year = Number(m[3])
      if (m[3].length <= 2) year += 2000
      if (month < 1 || month > 12 || day < 1 || day > 31) return ''
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  return ''
}

export class CrewTemplateError extends Error {
  constructor(message) {
    super(message)
    this.code = 'TEMPLATE_MISMATCH'
  }
}

// Parse the uploaded .xlsx File into person objects. Throws CrewTemplateError
// when the first sheet doesn't look like the crew tracker template.
export async function parseCrewXlsx(file) {
  const XLSX = await import('xlsx-js-style')
  const buf  = await file.arrayBuffer()
  const wb   = XLSX.read(buf, { cellDates: true })
  const ws   = wb.Sheets[wb.SheetNames[0]]
  if (!ws || !ws['!ref']) throw new CrewTemplateError('Empty workbook')

  const cell = (r, c) => ws[XLSX.utils.encode_cell({ r, c })]

  // Template detection: header row 3 must have D='Name', E='Role', K='Weekly Rate'
  const headOk = (c, expected) =>
    strVal(cell(HEADER_ROW, c)).trim().toLowerCase() === expected
  if (!headOk(COL.name, 'name') || !headOk(COL.role, 'role') || !headOk(COL.weeklyRate, 'weekly rate')) {
    throw new CrewTemplateError('Header row does not match the crew tracker template')
  }

  const range = XLSX.utils.decode_range(ws['!ref'])
  const people = []
  let department = ''

  for (let r = DATA_START; r <= range.e.r; r++) {
    const name = strVal(cell(r, COL.name))
    if (!name) continue                       // no D value → skip
    const role = strVal(cell(r, COL.role))
    if (!role) {                              // D set, E empty → department header
      department = name
      continue
    }
    people.push({
      name,
      role,
      department,
      email:           strVal(cell(r, COL.email)),
      phone:           strVal(cell(r, COL.phone)),
      agent:           strVal(cell(r, COL.agent)),
      weeklyRate:      numVal(cell(r, COL.weeklyRate)),
      sixthOverride:   overrideVal(cell(r, COL.sixthOverride)),
      seventhOverride: overrideVal(cell(r, COL.seventhOverride)),
      otOverride:      overrideVal(cell(r, COL.otOverride)),
      boxPw:           numVal(cell(r, COL.boxPw)),
      carAllowance:    numVal(cell(r, COL.carAllowance)),
      taxStatus:       strVal(cell(r, COL.taxStatus)),
      startDate:       dateVal(cell(r, COL.startDate)),
      endDate:         dateVal(cell(r, COL.endDate)),
      dealMemoEmailed: strVal(cell(r, COL.dealMemoEmailed)),
      dealMemoDrafted: strVal(cell(r, COL.dealMemoDrafted)),
      dealMemoSent:    strVal(cell(r, COL.dealMemoSent)),
    })
  }

  return people
}

// ─── Diff against existing crew resources ─────────────────────────────────────

// person field → resource field (+ label + numeric compare)
const DIFF_FIELDS = [
  { key: 'role',            res: 'role',            label: 'Role' },
  { key: 'department',      res: 'department',      label: 'Department' },
  { key: 'email',           res: 'contactEmail',    label: 'Email' },
  { key: 'phone',           res: 'contactPhone',    label: 'Phone' },
  { key: 'agent',           res: 'agent',           label: 'Agent' },
  { key: 'sixthOverride',   res: 'sixthDayRate',    label: '6th Day Rate',  numeric: true },
  { key: 'seventhOverride', res: 'seventhDayRate',  label: '7th Day Rate',  numeric: true },
  { key: 'otOverride',      res: 'otRate',          label: 'OT Rate',       numeric: true },
  { key: 'boxPw',           res: 'boxPw',           label: 'Box (pw)',      numeric: true },
  { key: 'carAllowance',    res: 'carAllowance',    label: 'Car Allowance', numeric: true },
  { key: 'taxStatus',       res: 'taxStatus',       label: 'Tax Status' },
  { key: 'startDate',       res: 'hireStartDate',   label: 'Start Date' },
  { key: 'endDate',         res: 'hireEndDate',     label: 'End Date' },
  { key: 'dealMemoEmailed', res: 'dealMemoEmailed', label: 'Deal Memo Emailed' },
  { key: 'dealMemoDrafted', res: 'dealMemoDrafted', label: 'Deal Memo Drafted' },
  { key: 'dealMemoSent',    res: 'dealMemoSent',    label: 'Deal Memo Sent' },
]

const normName = s => String(s ?? '').trim().toLowerCase()

// Diff parsed people against existing crew resources (ALL classes).
// Returns { newPeople, changed, unchangedCount }.
//   newPeople: person objects not matching any existing resource by name
//   changed:   [{ resource, person, changes: [{ field, label, from, to }] }]
export function buildCrewImportDiff(people, crewResources) {
  const byName = new Map()
  for (const r of crewResources) {
    const key = normName(r.name)
    if (key && !byName.has(key)) byName.set(key, r)
  }

  const newPeople = []
  const changed = []
  let unchangedCount = 0

  for (const person of people) {
    const match = byName.get(normName(person.name))
    if (!match) { newPeople.push(person); continue }

    const changes = []

    // Weekly rate ↔ costAmount (+ costType → 'weekly')
    if (person.weeklyRate != null) {
      const existingNum = match.costAmount === '' || match.costAmount == null
        ? null : Number(match.costAmount)
      if (existingNum === null || !Number.isFinite(existingNum) || existingNum !== person.weeklyRate) {
        changes.push({
          field: 'costAmount', label: 'Weekly Rate',
          from: match.costAmount === '' || match.costAmount == null ? '' : String(match.costAmount),
          to:   String(person.weeklyRate),
        })
        if ((match.costType ?? '') !== 'weekly') {
          changes.push({ field: 'costType', label: 'Cost Type', from: match.costType ?? '', to: 'weekly' })
        }
      }
    }

    for (const { key, res, label, numeric } of DIFF_FIELDS) {
      const sheetVal = person[key]
      if (numeric) {
        if (sheetVal == null) continue                       // empty → never blank existing
        const existing = match[res] === '' || match[res] == null ? null : Number(match[res])
        if (existing === null || !Number.isFinite(existing) || existing !== sheetVal) {
          changes.push({
            field: res, label,
            from: existing === null || !Number.isFinite(existing) ? '' : String(existing),
            to: sheetVal,
          })
        }
      } else {
        const sv = String(sheetVal ?? '').trim()
        if (!sv) continue                                    // empty → never blank existing
        const ev = String(match[res] ?? '').trim()
        if (sv !== ev) changes.push({ field: res, label, from: ev, to: sv })
      }
    }

    if (changes.length) changed.push({ resource: match, person, changes })
    else unchangedCount++
  }

  return { newPeople, changed, unchangedCount }
}
