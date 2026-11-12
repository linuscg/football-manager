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

// Columns are found by HEADER TEXT, not fixed position — real trackers grow
// extra columns ("Forwarded to payroll?", "RTW Check", …) and drop others, so
// the parser scans the first rows for the header row (must contain Name, Role
// and Weekly Rate) and maps each field to wherever its header sits. A field
// whose header is absent simply never produces values (and the diff never
// blanks existing data on empty values).
const HEADER_MATCHERS = [
  ['name',            h => h === 'name'],
  ['role',            h => h === 'role'],
  ['email',           h => h === 'email'],
  ['phone',           h => h === 'number' || h === 'phone'],
  ['agent',           h => h === 'agent'],
  ['weeklyRate',      h => h === 'weekly rate'],
  ['sixthOverride',   h => h === '6th day rate'],
  ['seventhOverride', h => h === '7th day rate'],
  ['otOverride',      h => h === 'ot rate'],
  ['boxPw',           h => h.startsWith('box')],
  ['carAllowance',    h => h === 'car' || h === 'car allowance'],
  ['taxStatus',       h => h === 'tax status' || h === 'tax'],
  ['startDate',       h => h === 'start date' || h === 'start'],
  ['endDate',         h => h === 'end date' || h === 'end'],
  ['dealMemoEmailed', h => h === 'email deal memo'],
  ['dealMemoDrafted', h => h === 'deal memo drafted'],
  ['dealMemoSent',    h => (h.includes('docusign') && h.includes('sent')) || h === 'deal memo sent'],
  ['dealMemoExecuted', h => h.includes('executed')],
  ['payrollForwarded', h => h.includes('forwarded to payroll')],
  ['teamEngine',      h => h === 'team engine'],
  ['shootCrew',       h => h === 'shoot crew'],
  ['rtwCheck',        h => h === 'rtw check' || h === 'rtw'],
]

// Scan the first 10 rows for the header; returns { headerRow, col } or null.
function findHeader(cell, lastRow, lastCol) {
  for (let r = 0; r <= Math.min(lastRow, 9); r++) {
    const labels = []
    for (let c = 0; c <= lastCol; c++) {
      labels[c] = strVal(cell(r, c)).trim().toLowerCase().replace(/\?+$/, '').trim()
    }
    if (!labels.includes('name') || !labels.includes('role') || !labels.includes('weekly rate')) continue
    const col = {}
    for (const [key, match] of HEADER_MATCHERS) {
      const idx = labels.findIndex(h => h && match(h))
      if (idx >= 0) col[key] = idx
    }
    return { headerRow: r, col }
  }
  return null
}

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

// A calendar-valid Y/M/D → 'YYYY-MM-DD', else '' (so "31/02/26" never reaches
// the DB, where the invalid date string would abort the whole import insert).
function ymdOrEmpty(year, month, day) {
  const d = new Date(year, month - 1, day)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Date value → 'YYYY-MM-DD'. Handles real Date cells (cellDates: true), Excel
// serial-date numbers (cells not formatted as dates arrive as plain numbers),
// ISO strings, and dd/mm/yy[yy] strings. Unparseable/invalid → ''.
function dateVal(cell) {
  if (!cell || cell.v === undefined || cell.v === null) return ''
  const v = cell.v
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : toISODate(v)
  if (typeof v === 'number') {
    // Excel serial date (days since 1899-12-30); plausible range ≈ 1990–2100
    if (v > 32000 && v < 75000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    }
    return ''
  }
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return ''
    // Already ISO — still validate the calendar date
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m) return ymdOrEmpty(Number(m[1]), Number(m[2]), Number(m[3]))
    // dd/mm/yy or dd/mm/yyyy (also - or . separators)
    m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
    if (m) {
      const day = Number(m[1]), month = Number(m[2])
      let year = Number(m[3])
      if (m[3].length <= 2) year += 2000
      return ymdOrEmpty(year, month, day)
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

// Shared grid walk: `cell(r, c)` returns { v, f? } or undefined. Checks the
// template header then extracts person objects (department-header rows set
// the department for the rows beneath).
function parseGrid(cell, lastRow, lastCol) {
  const head = findHeader(cell, lastRow, lastCol)
  if (!head) {
    throw new CrewTemplateError('Header row does not match the crew tracker template (need Name, Role and Weekly Rate columns)')
  }
  const { headerRow, col } = head
  const at = (r, key) => (col[key] === undefined ? undefined : cell(r, col[key]))

  const people = []
  let department = ''

  for (let r = headerRow + 1; r <= lastRow; r++) {
    const name = strVal(at(r, 'name'))
    if (!name) continue                       // no Name value → skip
    const role = strVal(at(r, 'role'))
    if (!role) {                              // Name set, Role empty → department header
      department = name
      continue
    }
    people.push({
      name,
      role,
      department,
      email:           strVal(at(r, 'email')),
      phone:           strVal(at(r, 'phone')),
      agent:           strVal(at(r, 'agent')),
      weeklyRate:      numVal(at(r, 'weeklyRate')),
      sixthOverride:   overrideVal(at(r, 'sixthOverride')),
      seventhOverride: overrideVal(at(r, 'seventhOverride')),
      otOverride:      overrideVal(at(r, 'otOverride')),
      boxPw:           numVal(at(r, 'boxPw')),
      carAllowance:    numVal(at(r, 'carAllowance')),
      taxStatus:       strVal(at(r, 'taxStatus')),
      startDate:       dateVal(at(r, 'startDate')),
      endDate:         dateVal(at(r, 'endDate')),
      dealMemoEmailed: strVal(at(r, 'dealMemoEmailed')),
      dealMemoDrafted: strVal(at(r, 'dealMemoDrafted')),
      dealMemoSent:    strVal(at(r, 'dealMemoSent')),
      dealMemoExecuted: strVal(at(r, 'dealMemoExecuted')),
      payrollForwarded: strVal(at(r, 'payrollForwarded')),
      teamEngine:      strVal(at(r, 'teamEngine')),
      shootCrew:       strVal(at(r, 'shootCrew')),
      rtwCheck:        strVal(at(r, 'rtwCheck')),
    })
  }

  return people
}

// Parse the uploaded .xlsx File into person objects. Throws CrewTemplateError
// when the first sheet doesn't look like the crew tracker template.
export async function parseCrewXlsx(file) {
  // Official SheetJS 0.20.x (cdn.sheetjs.com) — the npm 'xlsx-js-style' fork
  // tracks an old 0.18.x core with unpatched parse CVEs, so untrusted uploads
  // are read with the patched build; styled EXPORTS still use xlsx-js-style.
  const XLSX = await import('xlsx')
  const buf  = await file.arrayBuffer()
  const wb   = XLSX.read(buf, { cellDates: true })
  const ws   = wb.Sheets[wb.SheetNames[0]]
  if (!ws || !ws['!ref']) throw new CrewTemplateError('Empty workbook')

  const cell  = (r, c) => ws[XLSX.utils.encode_cell({ r, c })]
  const range = XLSX.utils.decode_range(ws['!ref'])
  return parseGrid(cell, range.e.r, range.e.c)
}

// Parse a Google Sheets grid of the same template. `values` is the
// UNFORMATTED_VALUE render (dates arrive as serial numbers, which dateVal
// handles), `formulas` the FORMULA render — a cell whose formula render starts
// with '=' is a calculated value, so the override columns ignore it, exactly
// like formula cells in the Excel file.
export function parseCrewSheetGrid(values, formulas) {
  const cell = (r, c) => {
    const v = values?.[r]?.[c]
    if (v === undefined || v === null || v === '') return undefined
    const f = formulas?.[r]?.[c]
    return { v, f: typeof f === 'string' && f.startsWith('=') ? f : undefined }
  }
  const lastCol = Math.max(0, ...(values ?? []).map(r => (r?.length ?? 0))) - 1
  return parseGrid(cell, (values?.length ?? 0) - 1, lastCol)
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
  { key: 'dealMemoExecuted', res: 'dealMemoExecuted', label: 'Deal Memo Executed' },
  { key: 'payrollForwarded', res: 'payrollForwarded', label: 'Forwarded to Payroll' },
  { key: 'teamEngine',      res: 'teamEngine',      label: 'Team Engine' },
  { key: 'shootCrew',       res: 'shootCrew',       label: 'Shoot Crew' },
  { key: 'rtwCheck',        res: 'rtwCheck',        label: 'RTW Check' },
]

const normName = s => String(s ?? '').trim().toLowerCase()

// Diff parsed people against existing crew resources (ALL classes).
// Returns { newPeople, changed, unchangedCount, ambiguous }.
//   newPeople: person objects not matching any existing resource by name
//   changed:   [{ resource, person, changes: [{ field, label, from, to }] }]
//   ambiguous: names that can't be matched safely (the name appears on more
//              than one existing crew row, or more than once in the sheet) —
//              skipped rather than silently writing onto the wrong person.
export function buildCrewImportDiff(people, crewResources) {
  const byName = new Map()
  const nameCounts = new Map()
  for (const r of crewResources) {
    const key = normName(r.name)
    if (!key) continue
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
    if (!byName.has(key)) byName.set(key, r)
  }
  const sheetCounts = new Map()
  for (const p of people) {
    const key = normName(p.name)
    if (key) sheetCounts.set(key, (sheetCounts.get(key) ?? 0) + 1)
  }

  const newPeople = []
  const changed = []
  const ambiguous = []
  const matchedIds = []   // every safely-matched existing resource (changed or not)
  let unchangedCount = 0

  for (const person of people) {
    const key = normName(person.name)
    if ((nameCounts.get(key) ?? 0) > 1 || (sheetCounts.get(key) ?? 0) > 1) {
      if (!ambiguous.includes(person.name)) ambiguous.push(person.name)
      continue
    }
    const match = byName.get(key)
    if (!match) { newPeople.push(person); continue }
    matchedIds.push(match.id)

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

  return { newPeople, changed, unchangedCount, ambiguous, matchedIds }
}
