import { useState, useEffect, useRef, useMemo, useCallback, Fragment, memo } from 'react'
import { useCrewStore } from '../store/useCrewStore'
import { useCrewPeopleStore } from '../store/useCrewPeopleStore'
import { getRateCalc, deriveRates } from '../lib/rateCalc'
import { parseCrewXlsx, buildCrewImportDiff } from '../lib/crewXlsxImport'
import { syncFulltimeBookings } from '../lib/fulltimeBookingSync'
import { supabase } from '../lib/supabase'
import CrewXlsxImportModal from './CrewXlsxImportModal'

// Department display priority: Producers/Executives → Directors → Production → A-Z.
function deptPriority(name) {
  const d = (name || '').toLowerCase().trim()
  if (/^(producers?|executives?)$/.test(d)) return 0
  if (/^directors?$/.test(d))               return 1
  if (d === 'production')                   return 2
  return 3
}

// ─── Phase definitions ────────────────────────────────────────────────────────

const PHASES = [
  { id: 'prep',  label: 'Pre-Prod', color: '#7c3aed', startKey: 'prepStartDate',  endKey: 'prepEndDate'  },
  { id: 'shoot', label: 'Shoot',    color: '#2563eb', startKey: 'shootStartDate', endKey: 'shootEndDate' },
  { id: 'wrap',  label: 'Wrap',     color: '#16a34a', startKey: 'wrapStartDate',  endKey: 'wrapEndDate'  },
]

// Paint modes: the currently-selected brush
const PAINT_MODES = [
  { value: 'booked',      label: 'Confirmed', icon: '✓', key: 'C',   color: '#16a34a', bg: '#dcfce7' },
  { value: 'hold',        label: 'On Hold',   icon: 'H', key: 'H',   color: '#d97706', bg: '#fef3c7' },
  { value: 'unavailable', label: 'Unavail.',  icon: '✕', key: 'V',   color: '#dc2626', bg: '#fee2e2' },
  { value: 'cancelled',    label: 'Cancelled',    icon: '✗', key: 'X',   color: '#374151', bg: '#f3f4f6' },
  { value: 'to_reconfirm', label: 'To Reconfirm', icon: '↻', key: 'R',   color: '#b45309', bg: '#fef3c7' },
  { value: null,           label: 'Clear',        icon: '○', key: 'Esc', color: '#9ca3af', bg: '#ffffff' },
]

// ─── Date helpers ─────────────────────────────────────────────────────────────

function eachDay(startStr, endStr) {
  if (!startStr || !endStr) return []
  const result = []
  const cur = new Date(startStr + 'T00:00:00')
  const end = new Date(endStr   + 'T00:00:00')
  while (cur <= end) {
    result.push([
      cur.getFullYear(),
      String(cur.getMonth() + 1).padStart(2, '0'),
      String(cur.getDate()).padStart(2, '0'),
    ].join('-'))
    cur.setDate(cur.getDate() + 1)
  }
  return result
}

function todayStr() {
  const t = new Date()
  return [t.getFullYear(), String(t.getMonth()+1).padStart(2,'0'), String(t.getDate()).padStart(2,'0')].join('-')
}

function formatColHeader(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return {
    date:      d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    wday:      d.toLocaleDateString('en-GB', { weekday: 'short' }),
    isWeekend: d.getDay() === 0 || d.getDay() === 6,
  }
}

// ─── Column spec builder ──────────────────────────────────────────────────────

function buildColSpecs(production, expandedPhases, dateMap, today, subUnitsByDate = {}) {
  const specs = []
  for (const phase of PHASES) {
    const start = production[phase.startKey]
    const end   = production[phase.endKey]
    if (!start || !end) continue

    if (expandedPhases[phase.id]) {
      for (const date of eachDay(start, end)) {
        const { isWeekend } = formatColHeader(date)
        const subDays   = subUnitsByDate[date] ?? []
        const hasMainDay = !!dateMap[date]

        // Only emit a main-unit column if there IS a main unit for this date,
        // OR if there are no sub-units (so an empty day column still appears).
        if (hasMainDay || subDays.length === 0) {
          specs.push({
            type: 'day', date,
            phaseId: phase.id, phaseColor: phase.color,
            isToday: date === today, isWeekend,
            shootDay: dateMap[date] ?? null,
            dayId: null, subUnitCategory: null,
          })
        }
        // Insert a column for each sub-unit (prep / splinter / other) on this date
        for (const subDay of subDays) {
          specs.push({
            type: 'day', date,
            phaseId: phase.id, phaseColor: phase.color,
            isToday: date === today, isWeekend,
            shootDay: subDay,
            dayId: subDay.id, subUnitCategory: subDay.dayCategory,
          })
        }
      }
    } else {
      specs.push({
        type: 'summary',
        phaseId: phase.id, label: phase.label, color: phase.color,
        dayCount: eachDay(start, end).length,
      })
    }
  }
  return specs
}

// ─── Build phase-banner spans ─────────────────────────────────────────────────
// Groups consecutive colSpecs by phaseId → [{phaseId, label, color, count}]

function buildPhaseSpans(colSpecs) {
  const spans = []
  for (const spec of colSpecs) {
    const last = spans[spans.length - 1]
    if (last && last.phaseId === spec.phaseId) {
      last.count++
    } else {
      const phase = PHASES.find(p => p.id === spec.phaseId)
      spans.push({ phaseId: spec.phaseId, label: phase.label, color: phase.color, count: 1 })
    }
  }
  return spans
}

// ─── Crew details panel — frozen spreadsheet-style columns ────────────────────

// Grouped header (top row) — spans must add up to DETAIL_COLS.length
const DETAIL_GROUPS = [
  { label: 'Deal Memo', span: 3 },
  { label: 'Contact',   span: 3 },
  { label: 'Weekly',    span: 3 },
  { label: 'Daily',     span: 3 },
  { label: 'Hourly',    span: 3 },
  { label: 'Day Rates', span: 3 },
  { label: 'Extras',    span: 3 },
  { label: 'Dates',     span: 2 },
  { label: 'Other',     span: 2 },
]

// Individual column labels (bottom header row) + widths
const DETAIL_COLS = [
  { label: 'Emailed',  w: 56 },
  { label: 'Drafted',  w: 56 },
  { label: 'Sent',     w: 56 },
  { label: 'Email',    w: 110 },
  { label: 'Phone',    w: 96 },
  { label: 'Agent',    w: 90 },
  { label: 'Rate',     w: 68 },
  { label: 'Net',      w: 68 },
  { label: 'Hol',      w: 68 },
  { label: 'Rate',     w: 68 },
  { label: 'Net',      w: 68 },
  { label: 'Hol',      w: 68 },
  { label: 'Rate',     w: 68 },
  { label: 'Net',      w: 68 },
  { label: 'Hol',      w: 68 },
  { label: '6th Day',  w: 68 },
  { label: '7th Day',  w: 68 },
  { label: 'OT',       w: 68 },
  { label: 'Box (pw)', w: 62 },
  { label: 'Car',      w: 62 },
  { label: 'Tax',      w: 94 },
  { label: 'Start',    w: 108 },
  { label: 'End',      w: 108 },
  { label: 'Vendor',   w: 100 },
  { label: 'Notes',    w: 170 },
]
const DETAIL_COL_COUNT = DETAIL_COLS.length

const OVERRIDE_TOOLTIP = 'Calculated — type to override / clear to revert'

function fmtMoney(v) {
  return v == null || !Number.isFinite(v) ? '' : v.toFixed(2)
}

// Free-text detail cell — local state, commit on blur
function DetailTextCell({ value, onCommit, width, placeholder = '', type = 'text', title }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => setV(value ?? ''), [value])
  return (
    <td className="crewd-td" style={{ width, minWidth: width }}>
      <input
        className="crewd-input"
        type={type}
        value={v}
        placeholder={placeholder}
        title={title}
        onChange={e => setV(e.target.value)}
        onBlur={() => { if (v !== (value ?? '')) onCommit(v) }}
      />
    </td>
  )
}

// Plain numeric cell (Box pw / Car) — '' commits '' (store writes NULL)
function DetailNumCell({ value, onCommit, width, title }) {
  const valStr = value == null || value === '' ? '' : String(value)
  const [v, setV] = useState(valStr)
  useEffect(() => setV(valStr), [valStr])
  function blur() {
    const t = String(v).trim()
    if (t === valStr) return
    if (t === '') { onCommit(''); return }
    const n = parseFloat(t)
    if (!Number.isFinite(n)) { setV(valStr); return }
    onCommit(n)
  }
  return (
    <td className="crewd-td" style={{ width, minWidth: width }}>
      <input
        className="crewd-input crewd-num"
        type="number" min="0" step="0.01"
        value={v}
        title={title}
        onChange={e => setV(e.target.value)}
        onBlur={blur}
      />
    </td>
  )
}

// Read-only derived money cell
function DerivedCell({ value, width, title }) {
  return (
    <td className="crewd-td crewd-derived" style={{ width, minWidth: width }} title={title}>
      {fmtMoney(value)}
    </td>
  )
}

// Editable weekly/daily rate cell. The cell matching the row's costType shows
// the stored number; the other shows the derived figure as a muted placeholder.
// Typing in either commits costAmount AND flips costType to this cell's basis.
function RateCell({ isSource, stored, derived, onCommitRate, width, title }) {
  const sourceVal = isSource ? String(stored ?? '') : ''
  const [v, setV] = useState(sourceVal)
  useEffect(() => setV(sourceVal), [sourceVal])
  function blur() {
    const t = String(v).trim()
    if (t === sourceVal) return
    if (t === '') {
      if (isSource) onCommitRate('')    // clear the stored rate
      return
    }
    const n = parseFloat(t)
    if (!Number.isFinite(n)) { setV(sourceVal); return }
    onCommitRate(t)
  }
  return (
    <td className="crewd-td" style={{ width, minWidth: width }}>
      <input
        className={`crewd-input crewd-num${!isSource ? ' is-derived' : ''}`}
        type="number" min="0" step="0.01"
        value={v}
        placeholder={fmtMoney(derived)}
        title={title}
        onChange={e => setV(e.target.value)}
        onBlur={blur}
      />
    </td>
  )
}

// 6th / 7th / OT cell — shows the per-row override when set (normal weight),
// else the derived figure (muted italic placeholder). Typing commits the
// override column; clearing commits null (back to the formula).
function OverrideCell({ override, derived, onCommit, width }) {
  const ovStr = override == null || override === '' ? '' : String(override)
  const [v, setV] = useState(ovStr)
  useEffect(() => setV(ovStr), [ovStr])
  function blur() {
    const t = String(v).trim()
    if (t === ovStr) return
    if (t === '') { onCommit(null); return }
    const n = parseFloat(t)
    if (!Number.isFinite(n)) { setV(ovStr); return }
    onCommit(n)
  }
  return (
    <td className="crewd-td" style={{ width, minWidth: width }}>
      <input
        className={`crewd-input crewd-num${v === '' ? ' is-derived' : ''}`}
        type="number" min="0" step="0.01"
        value={v}
        placeholder={fmtMoney(derived)}
        title={OVERRIDE_TOOLTIP}
        onChange={e => setV(e.target.value)}
        onBlur={blur}
      />
    </td>
  )
}

// The full run of detail <td>s for one crew row
// End date with an estimated fallback: when no real end date is set, show the
// production's final shoot day as an amber "est." value. Click to set a real
// date; clearing a real date reverts to the estimate.
function EndDateCell({ resource, estEndDate, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const hasReal = !!resource.hireEndDate

  function fmtEst(iso) {
    try {
      return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
    } catch { return iso }
  }

  if (!hasReal && estEndDate && !editing) {
    return (
      <td className="crewd-td" style={{ width: 108, minWidth: 108 }}>
        <button
          className="crewd-est"
          onClick={() => setEditing(true)}
          title={`Estimated end — final shoot day (${estEndDate}). Click to set a real end date.`}
        >
          est. {fmtEst(estEndDate)}
        </button>
      </td>
    )
  }

  return (
    <td className="crewd-td" style={{ width: 108, minWidth: 108 }}>
      <input
        className="crewd-input crewd-date"
        type="date"
        value={resource.hireEndDate ?? ''}
        min={resource.hireStartDate || undefined}
        autoFocus={editing && !hasReal}
        onChange={e => onUpdate(resource.id, 'hireEndDate', e.target.value)}
        onBlur={() => setEditing(false)}
        title={hasReal ? 'End date — clear to revert to the estimated end (final shoot day)' : undefined}
      />
    </td>
  )
}

function CrewDetailCells({ resource, rates, onUpdate, onCommitEmail, onCommitPhone, estEndDate = '' }) {
  const u = field => value => onUpdate(resource.id, field, value)
  return (
    <Fragment>
      {/* Deal memo */}
      <DetailTextCell value={resource.dealMemoEmailed} onCommit={u('dealMemoEmailed')} width={56} title="Deal memo emailed (e.g. TRUE / NA / BUY OUT)" />
      <DetailTextCell value={resource.dealMemoDrafted} onCommit={u('dealMemoDrafted')} width={56} title="Deal memo drafted" />
      <DetailTextCell value={resource.dealMemoSent}    onCommit={u('dealMemoSent')}    width={56} title="Deal memo sent" />
      {/* Contact */}
      <DetailTextCell value={resource.contactEmail} onCommit={onCommitEmail} width={110} type="email" placeholder="email" />
      <DetailTextCell value={resource.contactPhone} onCommit={onCommitPhone} width={96} type="tel" placeholder="phone" />
      <DetailTextCell value={resource.agent} onCommit={u('agent')} width={90} placeholder="agent" />
      {/* Weekly */}
      <RateCell
        isSource={rates.source === 'weekly'}
        stored={resource.costAmount}
        derived={rates.weekly}
        onCommitRate={val => {
          onUpdate(resource.id, 'costAmount', val)
          if (val !== '' && resource.costType !== 'weekly') onUpdate(resource.id, 'costType', 'weekly')
        }}
        width={68}
        title="Weekly rate — editing sets this row's rate basis to weekly"
      />
      <DerivedCell value={rates.weeklyNet} width={68} title="Weekly net (gross ÷ holiday factor)" />
      <DerivedCell value={rates.weeklyHol} width={68} title="Weekly holiday element" />
      {/* Daily */}
      <RateCell
        isSource={rates.source === 'daily'}
        stored={resource.costAmount}
        derived={rates.daily}
        onCommitRate={val => {
          onUpdate(resource.id, 'costAmount', val)
          if (val !== '' && resource.costType !== 'daily') onUpdate(resource.id, 'costType', 'daily')
        }}
        width={68}
        title="Daily rate — editing sets this row's rate basis to daily"
      />
      <DerivedCell value={rates.dailyNet} width={68} title="Daily net (gross ÷ holiday factor)" />
      <DerivedCell value={rates.dailyHol} width={68} title="Daily holiday element" />
      {/* Hourly */}
      <DerivedCell value={rates.hourly}    width={68} title="Hourly rate (daily ÷ hours per day)" />
      <DerivedCell value={rates.hourlyNet} width={68} title="Hourly net" />
      <DerivedCell value={rates.hourlyHol} width={68} title="Hourly holiday element" />
      {/* Day rates (overridable) */}
      <OverrideCell override={resource.sixthDayRate}   derived={rates.sixth}   onCommit={u('sixthDayRate')}   width={68} />
      <OverrideCell override={resource.seventhDayRate} derived={rates.seventh} onCommit={u('seventhDayRate')} width={68} />
      <OverrideCell override={resource.otRate}         derived={rates.ot}      onCommit={u('otRate')}         width={68} />
      {/* Extras */}
      <DetailNumCell value={resource.boxPw}        onCommit={u('boxPw')}        width={62} title="Box rental per week" />
      <DetailNumCell value={resource.carAllowance} onCommit={u('carAllowance')} width={62} title="Car allowance" />
      <td className="crewd-td" style={{ width: 94, minWidth: 94 }}>
        <select
          className="crewd-select"
          value={resource.taxStatus ?? ''}
          onChange={e => onUpdate(resource.id, 'taxStatus', e.target.value)}
          title="Tax status"
        >
          <option value=""></option>
          <option value="PAYE">PAYE</option>
          <option value="Schedule D">Schedule D</option>
          <option value="Loan Out">Loan Out</option>
        </select>
      </td>
      {/* Dates — go through updateResource so the fulltime booking auto-sync runs */}
      <td className="crewd-td" style={{ width: 108, minWidth: 108 }}>
        <input
          className="crewd-input crewd-date"
          type="date"
          value={resource.hireStartDate ?? ''}
          onChange={e => onUpdate(resource.id, 'hireStartDate', e.target.value)}
        />
      </td>
      <EndDateCell resource={resource} estEndDate={estEndDate} onUpdate={onUpdate} />
      {/* Other */}
      <DetailTextCell value={resource.vendor} onCommit={u('vendor')} width={100} placeholder="vendor" title="Vendor / company supplying this crew member" />
      <DetailTextCell value={resource.notes}  onCommit={u('notes')}  width={170} placeholder="notes" title="Notes" />
    </Fragment>
  )
}

// Global rate-calc settings strip (one input)
function RateSettingInput({ label, value, onCommit }) {
  const valStr = String(value)
  const [v, setV] = useState(valStr)
  useEffect(() => setV(valStr), [valStr])
  function blur() {
    const n = parseFloat(String(v).trim())
    if (!Number.isFinite(n) || n <= 0) { setV(valStr); return }   // guard: keep previous
    if (n === value) { setV(valStr); return }
    onCommit(n)
  }
  return (
    <label className="crewd-set-field">
      <span className="crewd-set-label">{label}</span>
      <input
        className="crewd-input crewd-num"
        type="number" min="0" step="any"
        value={v}
        onChange={e => setV(e.target.value)}
        onBlur={blur}
      />
    </label>
  )
}

const RATE_SETTINGS = [
  { key: 'holidayFactor',  label: 'Holiday factor' },
  { key: 'daysPerWeek',    label: 'Days/week' },
  { key: 'hoursPerDay',    label: 'Hours/day' },
  { key: 'sixthDayMult',   label: '6th day ×' },
  { key: 'seventhDayMult', label: '7th day ×' },
  { key: 'otMult',         label: 'OT ×' },
]

// ─── ResourceRow — isolated so local text state never loses focus ─────────────

// Derive unique sorted values for a given field from a resource list
function uniq(arr) { return [...new Set(arr.filter(Boolean))].sort() }

// Shared empty booking map — stable identity for rows with no bookings
const EMPTY_ROW_BOOKINGS = {}

const ResourceRow = memo(function ResourceRow({
  resource, activeTab, colSpecs, rowBookings = EMPTY_ROW_BOOKINGS,
  shootDateSet,
  onCellMouseDown, onCellMouseEnter,
  onUpdate, onDelete, onMoveUp, onMoveDown, onPhaseToggle,
  typeResources,
  // People database
  people, onCreatePerson, onUpdatePerson,
  // Crew details panel
  showDetails = false, rateCalcSettings = null, estEndDate = '',
  onRowContextMenu = null,
}) {
  // Build suggestions from all other resources (for role/dept/etc.)
  const others = typeResources.filter(r => r.id !== resource.id)
  const roleSuggestions   = uniq(others.map(r => r.role))
  const deptSuggestions   = uniq(others.map(r => r.department))
  const catSuggestions    = uniq(others.map(r => r.category))
  const vendorSuggestions = uniq(others.map(r => r.vendor))

  const [expanded,       setExpanded]       = useState(false)
  const [lName,          setLName]          = useState(resource.name)
  const [lPersonId,      setLPersonId]      = useState(resource.personId)
  const [lRole,          setLRole]          = useState(resource.role)
  const [lCat,           setLCat]           = useState(resource.category)
  const [lDept,          setLDept]          = useState(resource.department)
  const [lCostAmount,    setLCostAmount]    = useState(resource.costAmount)
  const [lContactEmail,  setLContactEmail]  = useState(resource.contactEmail)
  const [lContactPhone,  setLContactPhone]  = useState(resource.contactPhone)
  const [lVendor,        setLVendor]        = useState(resource.vendor)
  const [lPoNumber,      setLPoNumber]      = useState(resource.poNumber)
  const [lNotes,         setLNotes]         = useState(resource.notes)
  const [lHireStart,     setLHireStart]     = useState(resource.hireStartDate)
  const [lHireEnd,       setLHireEnd]       = useState(resource.hireEndDate)

  // People-search dropdown
  const [showPeopleDrop, setShowPeopleDrop] = useState(false)

  useEffect(() => setLName(resource.name),                   [resource.name])
  useEffect(() => setLPersonId(resource.personId),           [resource.personId])
  useEffect(() => setLRole(resource.role),                   [resource.role])
  useEffect(() => setLCat(resource.category),                [resource.category])
  useEffect(() => setLDept(resource.department),             [resource.department])
  useEffect(() => setLCostAmount(resource.costAmount),       [resource.costAmount])
  useEffect(() => setLContactEmail(resource.contactEmail),   [resource.contactEmail])
  useEffect(() => setLContactPhone(resource.contactPhone),   [resource.contactPhone])
  useEffect(() => setLVendor(resource.vendor),               [resource.vendor])
  useEffect(() => setLPoNumber(resource.poNumber),           [resource.poNumber])
  useEffect(() => setLNotes(resource.notes),                 [resource.notes])
  useEffect(() => setLHireStart(resource.hireStartDate),     [resource.hireStartDate])
  useEffect(() => setLHireEnd(resource.hireEndDate),         [resource.hireEndDate])

  function commit(field, local, original) {
    if (local !== original) onUpdate(resource.id, field, local)
  }

  // Filtered people for the dropdown (only shown when activeTab === 'crew')
  const filteredPeople = lName.trim().length > 0
    ? people.filter(p => p.name.toLowerCase().includes(lName.toLowerCase()))
    : people

  // Link a person from the dropdown
  function selectPerson(person) {
    setLName(person.name)
    setLPersonId(person.id)
    setShowPeopleDrop(false)
    onUpdate(resource.id, 'name',     person.name)
    onUpdate(resource.id, 'personId', person.id)
    // Auto-fill blank contact fields
    if (!lContactEmail && person.email) {
      setLContactEmail(person.email)
      onUpdate(resource.id, 'contactEmail', person.email)
    }
    if (!lContactPhone && person.phone) {
      setLContactPhone(person.phone)
      onUpdate(resource.id, 'contactPhone', person.phone)
    }
  }

  // On blur: commit name, then either link an exact match or auto-create in DB
  async function handleNameBlur() {
    setShowPeopleDrop(false)
    const trimmed = lName.trim()
    commit('name', trimmed, resource.name)
    if (!trimmed) return

    // Only run people-linking for crew rows
    if (activeTab !== 'crew') return

    // If this row is already linked to a person, update that person's name
    // (rather than creating an orphan duplicate record)
    if (lPersonId) {
      const linked = people.find(p => p.id === lPersonId)
      if (linked && linked.name.toLowerCase() !== trimmed.toLowerCase()) {
        // Check if another person already has this exact name
        const conflict = people.find(p => p.id !== lPersonId && p.name.toLowerCase() === trimmed.toLowerCase())
        if (conflict) {
          // Re-link to the existing person with this name
          setLPersonId(conflict.id)
          onUpdate(resource.id, 'personId', conflict.id)
          if (!lContactEmail && conflict.email) { setLContactEmail(conflict.email); onUpdate(resource.id, 'contactEmail', conflict.email) }
          if (!lContactPhone && conflict.phone) { setLContactPhone(conflict.phone); onUpdate(resource.id, 'contactPhone', conflict.phone) }
        } else {
          // Update the linked person's name in the crew database
          onUpdatePerson(lPersonId, 'name', trimmed)
        }
      }
      return
    }

    // Not yet linked — look for an exact match in the database
    const exact = people.find(p => p.name.toLowerCase() === trimmed.toLowerCase())
    if (exact) {
      if (lPersonId !== exact.id) {
        setLPersonId(exact.id)
        onUpdate(resource.id, 'personId', exact.id)
        // Auto-fill blank contact fields from the linked person
        if (!lContactEmail && exact.email) {
          setLContactEmail(exact.email)
          onUpdate(resource.id, 'contactEmail', exact.email)
        }
        if (!lContactPhone && exact.phone) {
          setLContactPhone(exact.phone)
          onUpdate(resource.id, 'contactPhone', exact.phone)
        }
      }
      return
    }

    // No match — create a new person record and link it
    const newId = await onCreatePerson({
      name:  trimmed,
      email: lContactEmail,
      phone: lContactPhone,
    })
    if (newId) {
      setLPersonId(newId)
      onUpdate(resource.id, 'personId', newId)
    }
  }

  // Detail-panel email/phone commits — also sync the linked person record
  function commitEmailValue(v) {
    onUpdate(resource.id, 'contactEmail', v)
    if (lPersonId) onUpdatePerson(lPersonId, 'email', v)
  }

  function commitPhoneValue(v) {
    onUpdate(resource.id, 'contactPhone', v)
    if (lPersonId) onUpdatePerson(lPersonId, 'phone', v)
  }

  const detailRates = showDetails && rateCalcSettings
    ? deriveRates(resource, rateCalcSettings)
    : null
  const totalColSpan = colSpecs.length + 1 + (showDetails ? DETAIL_COL_COUNT : 0)

  return (
    <Fragment>
      <tr className="gantt-resource-row">
        {/* ── Sticky name cell ─────────────────────────────────────────────────── */}
        <td
          className="pm-g-name"
          onContextMenu={e => {
            if (activeTab === 'crew' && onRowContextMenu) {
              e.preventDefault()
              onRowContextMenu(resource.id, resource.crewClass ?? 'additional', resource.name, e.clientX, e.clientY)
            }
          }}
        >
          <div className="gantt-name-cell">
            {activeTab === 'equipment' && (
              <button
                className={`gantt-row-expand${expanded ? ' open' : ''}`}
                onClick={() => setExpanded(e => !e)}
                title={expanded ? 'Hide details' : 'Show cost / hire details'}
              >
                {expanded ? '▾' : '▸'}
              </button>
            )}
            <div className="gantt-name-fields">
              <div className="gantt-name-input-wrap">
                <input
                  className="gantt-input gantt-input-name"
                  value={lName}
                  placeholder={activeTab === 'crew' ? 'Name' : 'Item name'}
                  onChange={e => { setLName(e.target.value); if (activeTab === 'crew') setShowPeopleDrop(true) }}
                  onFocus={() => { if (activeTab === 'crew') setShowPeopleDrop(true) }}
                  onBlur={handleNameBlur}
                />
                {lPersonId && (
                  <span className="gantt-person-linked" title="Linked to crew database">●</span>
                )}
                {activeTab === 'crew' && showPeopleDrop && filteredPeople.length > 0 && (
                  <div className="people-dropdown">
                    {filteredPeople.slice(0, 8).map(person => (
                      <div
                        key={person.id}
                        className="people-dropdown-item"
                        onMouseDown={e => { e.preventDefault(); selectPerson(person) }}
                      >
                        <span className="people-dropdown-name">{person.name}</span>
                        {(person.email || person.phone) && (
                          <span className="people-dropdown-meta">
                            {person.email || person.phone}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {activeTab === 'crew' ? (
                <>
                  <input
                    className="gantt-input gantt-input-role"
                    value={lRole}
                    placeholder="Role"
                    list={`role-${resource.id}`}
                    onChange={e => setLRole(e.target.value)}
                    onBlur={() => commit('role', lRole, resource.role)}
                  />
                  <datalist id={`role-${resource.id}`}>
                    {roleSuggestions.map(s => <option key={s} value={s} />)}
                  </datalist>
                </>
              ) : (
                <>
                  <input
                    className="gantt-input gantt-input-role"
                    value={lCat}
                    placeholder="Category"
                    list={`cat-${resource.id}`}
                    onChange={e => setLCat(e.target.value)}
                    onBlur={() => commit('category', lCat, resource.category)}
                  />
                  <datalist id={`cat-${resource.id}`}>
                    {catSuggestions.map(s => <option key={s} value={s} />)}
                  </datalist>
                </>
              )}
              {activeTab === 'crew' && (
                <>
                  <input
                    className="gantt-input gantt-input-dept"
                    value={lDept}
                    placeholder="Department"
                    list={`dept-${resource.id}`}
                    onChange={e => setLDept(e.target.value)}
                    onBlur={() => commit('department', lDept, resource.department)}
                  />
                  <datalist id={`dept-${resource.id}`}>
                    {deptSuggestions.map(s => <option key={s} value={s} />)}
                  </datalist>
                </>
              )}
            </div>
            <div className="gantt-name-actions">
              <button className="pm-icon-btn" onClick={() => onMoveUp(resource.id)}   title="Move up">↑</button>
              <button className="pm-icon-btn" onClick={() => onMoveDown(resource.id)} title="Move down">↓</button>
              <button className="pm-icon-btn danger" title="Delete"
                onClick={() => {
                  if (window.confirm(`Delete "${resource.name}"? This cannot be undone.`))
                    onDelete(resource.id)
                }}>✕</button>
            </div>
          </div>
        </td>

        {/* ── Crew detail columns (spreadsheet panel) ──────────────────────────── */}
        {showDetails && detailRates && (
          <CrewDetailCells
            resource={resource}
            rates={detailRates}
            onUpdate={onUpdate}
            onCommitEmail={commitEmailValue}
            onCommitPhone={commitPhoneValue}
            estEndDate={estEndDate}
          />
        )}

        {/* ── Day / summary cells ──────────────────────────────────────────────── */}
        {colSpecs.map((spec, specIndex) => {
          if (spec.type === 'summary') {
            return (
              <td key={`sum-${spec.phaseId}`}
                  className="gantt-phase-sum-cell"
                  style={{ '--phase-color': spec.color }}
                  onClick={() => onPhaseToggle(spec.phaseId)}
                  title={`${spec.label} — click to expand`}
              />
            )
          }

          const booking    = rowBookings[spec.dayId ?? spec.date]
          const status     = booking?.status ?? null
          const isShootDay = shootDateSet.has(spec.date)

          const isSubUnit = !!spec.subUnitCategory
          const statusCls = status === 'unavailable' ? 'pm-g-cell--unavail'
                          : status ? `pm-g-cell--${status}` : ''
          const cls = [
            'pm-g-cell',
            statusCls,
            spec.subUnitCategory === 'prep'      ? 'cell-prep'      : '',
            spec.subUnitCategory === 'splinter'  ? 'cell-splinter'  : '',
            spec.subUnitCategory === 'rehearsal' ? 'cell-rehearsal' : '',
            spec.subUnitCategory === 'other'     ? 'cell-other'     : '',
            spec.shootDay?.isNonShootDay && !isSubUnit ? 'cell-nonshoot' : '',
            spec.isWeekend ? 'cell-weekend'  : '',
            spec.isToday   ? 'cell-today'    : '',
            !isShootDay && !isSubUnit ? 'cell-no-shoot' : '',
          ].filter(Boolean).join(' ')

          const unitLabel = spec.subUnitCategory === 'prep'      ? 'Prep'
                          : spec.subUnitCategory === 'splinter'  ? 'Splinter'
                          : spec.subUnitCategory === 'rehearsal' ? 'Rehearsal'
                          : spec.subUnitCategory === 'other'     ? 'Other'
                          : null

          return (
            <td
              key={spec.dayId ?? spec.date}
              className={cls}
              onMouseDown={e => { e.preventDefault(); onCellMouseDown(resource.id, spec.date, spec.dayId, specIndex) }}
              onMouseEnter={() => onCellMouseEnter(resource.id, spec.date, spec.dayId, specIndex)}
              title={
                unitLabel
                  ? (status ? `${unitLabel}: ${status}` : `${unitLabel} unit — click to assign`)
                  : status
                    ? `${status.charAt(0).toUpperCase() + status.slice(1)}${isShootDay ? ' — drag to paint more' : ''}`
                    : isShootDay
                      ? 'Click or drag to paint'
                      : 'Click to mark (not a shoot day — drag skips this)'
              }
            >
              {status && <span className="gantt-cell-icon">
                {PAINT_MODES.find(m => m.value === status)?.icon ?? ''}
              </span>}
            </td>
          )
        })}
      </tr>

      {/* ── Details row — equipment only; crew fields live in the detail columns ── */}
      {activeTab === 'equipment' && expanded && (
        <tr className="gantt-details-row">
          <td colSpan={totalColSpan}>
            <div className="gantt-details-panel">

              {/* Cost — equipment only; crew rates live in the detail columns */}
              {activeTab === 'equipment' && (
                <div className="details-group">
                  <label className="details-label">Cost</label>
                  <input
                    className="details-input details-input-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={lCostAmount}
                    placeholder="0.00"
                    onChange={e => setLCostAmount(e.target.value)}
                    onBlur={() => commit('costAmount', lCostAmount, resource.costAmount)}
                  />
                  <span className="details-sep">per</span>
                  <select
                    className="details-select"
                    value={resource.costType}
                    onChange={e => onUpdate(resource.id, 'costType', e.target.value)}
                  >
                    <option value="daily">Day</option>
                    <option value="halfday">Half Day</option>
                    <option value="weekly">Week</option>
                  </select>
                  {resource.costType === 'weekly' && (
                    <select
                      className="details-select"
                      value={resource.weekType}
                      onChange={e => onUpdate(resource.id, 'weekType', e.target.value)}
                    >
                      <option value="5day">5-day week</option>
                      <option value="3day">3-day week</option>
                    </select>
                  )}
                </div>
              )}

              {/* Equipment: supplier + PO# */}
              {activeTab === 'equipment' && (
                <>
                  <div className="details-group">
                    <label className="details-label">Supplier</label>
                    <input
                      className="details-input"
                      type="text"
                      value={lVendor}
                      placeholder="Supplier name"
                      list={`vendor-${resource.id}`}
                      onChange={e => setLVendor(e.target.value)}
                      onBlur={() => commit('vendor', lVendor, resource.vendor)}
                    />
                    <datalist id={`vendor-${resource.id}`}>
                      {vendorSuggestions.map(s => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                  <div className="details-group">
                    <label className="details-label">PO #</label>
                    <input
                      className="details-input details-input-po"
                      type="text"
                      value={lPoNumber}
                      placeholder="PO number"
                      onChange={e => setLPoNumber(e.target.value)}
                      onBlur={() => commit('poNumber', lPoNumber, resource.poNumber)}
                    />
                  </div>
                </>
              )}

              {/* Hire period — equipment only; crew dates live in the detail columns */}
              {activeTab === 'equipment' && (
                <>
                  <div className="details-group">
                    <label className="details-label">Hire from</label>
                    <input
                      className="details-input details-input-date"
                      type="date"
                      value={lHireStart}
                      onChange={e => { setLHireStart(e.target.value); onUpdate(resource.id, 'hireStartDate', e.target.value) }}
                    />
                  </div>
                  <div className="details-group">
                    <label className="details-label">Hire to</label>
                    <input
                      className="details-input details-input-date"
                      type="date"
                      value={lHireEnd}
                      min={lHireStart || undefined}
                      onChange={e => { setLHireEnd(e.target.value); onUpdate(resource.id, 'hireEndDate', e.target.value) }}
                    />
                  </div>
                </>
              )}

              {/* Notes — all resources */}
              <div className="details-group">
                <label className="details-label">Notes</label>
                <textarea
                  className="details-input details-textarea"
                  value={lNotes}
                  placeholder="Notes…"
                  rows={2}
                  onChange={e => setLNotes(e.target.value)}
                  onBlur={() => commit('notes', lNotes, resource.notes)}
                />
              </div>

            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
})

// ─── Main component ───────────────────────────────────────────────────────────

export default function CrewGantt({ production, shootDays, mode = 'both', onUpdateProduction }) {
  const canViewCrewDetails = true  // TODO: wire to the permissions system

  const [activeTab, setActiveTab] = useState(() =>
    localStorage.getItem('fm_gantt_tab') ?? 'crew'
  )
  const [detailsOpen, setDetailsOpen] = useState(() =>
    localStorage.getItem('fm_gantt_details_open') === '1'
  )
  const [crewClassTab, setCrewClassTab] = useState(() => {
    const saved = localStorage.getItem('fm_gantt_crew_class')
    return saved === 'fulltime' || saved === 'additional' ? saved : 'fulltime'
  })

  // Effective type + class filter — the single place (mode, activeTab, crewClassTab)
  // is resolved. Everything below filters/renders off these two values.
  //   mode='equipment' → equipment only, no sub-tabs
  //   mode='crew'      → crew only, Full-Time | Additional sub-tabs (crewClassTab)
  //   mode='both'      → legacy Crew | Equipment sub-tabs (activeTab)
  const effTab = mode === 'equipment' ? 'equipment'
               : mode === 'crew'      ? 'crew'
               : activeTab
  const classFilter = mode === 'crew' ? crewClassTab : null

  // Crew details panel — only in crew mode, and only for permitted users
  const showDetails = mode === 'crew' && canViewCrewDetails && detailsOpen
  const rateCalcSettings = useMemo(() => getRateCalc(production), [production])
  const extraCols = showDetails ? DETAIL_COL_COUNT : 0

  function toggleDetails() {
    setDetailsOpen(open => {
      const next = !open
      localStorage.setItem('fm_gantt_details_open', next ? '1' : '0')
      return next
    })
  }
  const [expandedPhases, setExpandedPhases] = useState(() => {
    try {
      const saved = localStorage.getItem('fm_gantt_phases')
      return saved ? JSON.parse(saved) : { prep: true, shoot: true, wrap: true }
    } catch { return { prep: true, shoot: true, wrap: true } }
  })
  const [paintMode,      setPaintMode]      = useState('booked')   // the selected brush
  const [isDragging,     setIsDragging]     = useState(false)
  const [hidePastDays,   setHidePastDays]   = useState(false)

  const isDraggingRef   = useRef(false)
  const dragActionRef   = useRef(paintMode)   // the status being applied for the current drag
  const paintedInDrag   = useRef(new Set())   // keys painted this drag session
  const lastPaintedRef  = useRef(null)        // { resourceId, specIndex } of the last MAIN-unit cell painted this drag
  const scrollRef       = useRef(null)        // gantt-scroll container
  const scrollInterval  = useRef(null)
  const dirtyResources  = useRef(new Set())   // resource IDs whose bookings changed via painting
  const paintModeRef    = useRef(paintMode)   // mirror of paintMode for []-stable callbacks
  const [rowMenu, setRowMenu] = useState(null) // { resourceId, crewClass, name, x, y }
  // eslint-disable-next-line react-hooks/refs -- latest-value ref, read only in event handlers
  paintModeRef.current  = paintMode
  const prevRowMapsRef  = useRef({})          // per-resource booking-map identity cache
  const latestRef       = useRef({})          // latest store fns + derived data for []-stable callbacks

  const {
    loading, error,
    resources, bookings,
    addResource, deleteResource, updateResource,
    importResources,
    setBooking,
    moveResourceUp, moveResourceDown,
  } = useCrewStore()

  const {
    people,
    findOrCreatePerson,
    updatePerson: updateCrewPerson,
  } = useCrewPeopleStore()

  const importFileRef = useRef(null)
  const [importMsg, setImportMsg] = useState(null)  // null | { count, type }
  const [xlsxDiff, setXlsxDiff]   = useState(null)  // null | { newPeople, changed, unchangedCount }

  const today = todayStr()

  // ── Derived data ───────────────────────────────────────────────────────────

  const hasPhases = PHASES.some(p => production[p.startKey] && production[p.endKey])

  // date → main shootDay map (for column labels — main unit only)
  // date → [subUnit, ...] map — prep, splinter, rehearsal AND other units get their own columns
  const { dateMap, subUnitsByDate, shootDateSet } = useMemo(() => {
    const dateMap = {}
    const subUnitsByDate = {}
    for (const sd of shootDays) {
      if (!sd.date) continue
      if (sd.dayCategory === 'main') dateMap[sd.date] = sd
      if (sd.dayCategory === 'prep' || sd.dayCategory === 'splinter' || sd.dayCategory === 'rehearsal' || sd.dayCategory === 'other') {
        if (!subUnitsByDate[sd.date]) subUnitsByDate[sd.date] = []
        subUnitsByDate[sd.date].push(sd)
      }
    }
    // Set of shoot-day dates that are NOT non-shoot (drag-paint skips others)
    const shootDateSet = new Set(
      shootDays.filter(sd => !sd.isNonShootDay).map(sd => sd.date)
    )
    return { dateMap, subUnitsByDate, shootDateSet }
  }, [shootDays])

  const colSpecs = useMemo(() => {
    let specs = hasPhases
      ? buildColSpecs(production, expandedPhases, dateMap, today, subUnitsByDate)
      : []
    if (hidePastDays) {
      specs = specs.filter(spec => spec.type === 'summary' || spec.date >= today)
    }
    return specs
  }, [hasPhases, production, expandedPhases, dateMap, today, subUnitsByDate, hidePastDays])

  // Per-resource booking lookup maps, keyed WITHIN each row by `dayId ?? date`
  // (the global map used `${resourceId}:${dayId ?? date}`). A row's map keeps
  // its identity when that resource's bookings didn't change — optimistic store
  // updates preserve object identity for untouched bookings, so an optimistic
  // paint only produces a new sub-map for the painted resource and memoized
  // rows elsewhere skip re-rendering.
  const bookingsByResource = useMemo(() => {
    /* eslint-disable react-hooks/refs -- identity cache: the ref only memoises
       the previous result so unchanged rows keep the same object identity */
    const grouped = {}
    for (const b of bookings) (grouped[b.resourceId] ??= []).push(b)
    const out = {}
    const prev = prevRowMapsRef.current
    for (const rid in grouped) {
      const list = grouped[rid]
      const old = prev[rid]
      if (old && old.__list.length === list.length && old.__list.every((x, i) => x === list[i])) {
        out[rid] = old            // unchanged → keep identity
      } else {
        const m = { __list: list }
        for (const b of list) m[b.dayId ?? b.date] = b
        out[rid] = m
      }
    }
    prevRowMapsRef.current = out
    return out
    /* eslint-enable react-hooks/refs */
  }, [bookings])

  // ── Autocomplete suggestions from existing values ─────────────────────────

  // All resources of each type — passed to rows for suggestions + name autofill
  const crewResources  = useMemo(() => resources.filter(r => r.type === 'crew'),      [resources])
  const equipResources = useMemo(() => resources.filter(r => r.type === 'equipment'), [resources])

  // Keep the "latest" snapshot current so []-stable callbacks below can read
  // frequently-changing values without taking them as deps (which would churn
  // the callback identities and re-render every memoized row).
  // eslint-disable-next-line react-hooks/refs -- latest-value ref, read only in event handlers
  latestRef.current = {
    resources, bookings, shootDays,
    colSpecs, shootDateSet, bookingsByResource,
    setBooking, updateResource, deleteResource,
    moveResourceUp, moveResourceDown,
    findOrCreatePerson, updateCrewPerson,
  }

  // ── Filter + group resources ───────────────────────────────────────────────

  const filtered = resources.filter(r =>
    r.type === effTab &&
    (!classFilter || (r.crewClass ?? 'additional') === classFilter)
  )
  const groupKey = effTab === 'crew' ? 'department' : 'category'
  const FALLBACK = effTab === 'crew' ? 'Unassigned' : 'Uncategorised'

  const groupMap = {}
  for (const r of filtered) {
    const key = r[groupKey].trim() || FALLBACK
    if (!groupMap[key]) groupMap[key] = []
    groupMap[key].push(r)
  }
  const groups = Object.entries(groupMap).sort(([a], [b]) => {
    if (a === FALLBACK) return 1
    if (b === FALLBACK) return -1
    if (effTab === 'crew') {
      const pa = deptPriority(a), pb = deptPriority(b)
      if (pa !== pb) return pa - pb
    }
    return a.localeCompare(b)
  })

  // ── Phase toggle ───────────────────────────────────────────────────────────

  const togglePhase = useCallback(phaseId => {
    setExpandedPhases(s => {
      const next = { ...s, [phaseId]: !s[phaseId] }
      localStorage.setItem('fm_gantt_phases', JSON.stringify(next))
      return next
    })
  }, [])

  function collapseBeforeToday() {
    setExpandedPhases(prev => {
      const next = { ...prev }
      for (const phase of PHASES) {
        const end = production[phase.endKey]
        if (end && end < today) next[phase.id] = false
      }
      localStorage.setItem('fm_gantt_phases', JSON.stringify(next))
      return next
    })
    // After React re-renders, scroll the gantt to today's column
    setTimeout(() => {
      const todayTh = scrollRef.current?.querySelector('th.is-today')
      if (todayTh && scrollRef.current) {
        const containerRect = scrollRef.current.getBoundingClientRect()
        const thRect = todayTh.getBoundingClientRect()
        scrollRef.current.scrollLeft += thRect.left - containerRect.left - 200
      }
    }, 50)
  }

  function switchTab(tab) {
    setActiveTab(tab)
    localStorage.setItem('fm_gantt_tab', tab)
  }

  function switchCrewClassTab(cls) {
    setCrewClassTab(cls)
    localStorage.setItem('fm_gantt_crew_class', cls)
  }

  function handleAddResource() {
    addResource(effTab, effTab === 'crew' && classFilter ? { crewClass: classFilter } : {})
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key.toLowerCase()) {
        case 'c':      setPaintMode('booked');      break
        case 'h':      setPaintMode('hold');        break
        case 'v':      setPaintMode('unavailable'); break
        case 'x':      setPaintMode('cancelled');   break
        case 'escape': setPaintMode(null);          break  // clear
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Drag-paint logic ───────────────────────────────────────────────────────
  //
  // On mousedown we decide the drag action for the entire drag session:
  //   • If the cell already has the same status as paintMode → clear it (toggle off)
  //   • Otherwise → apply paintMode
  // This means clicking an already-confirmed cell auto-clears it without
  // having to switch to the Clear brush.
  //
  // mouseenter during drag only paints shoot days; non-shoot days are skipped
  // (they can still be painted by a discrete single click / mousedown).

  // Paint one cell with the current drag action (dedupe + hire-date dirty
  // tracking). Reads everything through refs so the callers stay []-stable.
  const paintCell = useCallback((resourceId, date, dayId = null) => {
    const key = dayId ? `${resourceId}:${dayId}` : `${resourceId}:${date}`
    if (paintedInDrag.current.has(key)) return
    paintedInDrag.current.add(key)
    // Only track dirty resources for hire-date sync when painting booked/clear
    // on a main-unit cell. Painting cancelled/unavailable/hold triggers no hire-date update,
    // which avoids a race condition where the hire-date DB write triggers a
    // realtime reload that races with the (still in-flight) booking INSERT.
    if (!dayId && (dragActionRef.current === 'booked' || dragActionRef.current === null)) {
      dirtyResources.current.add(resourceId)
    }
    latestRef.current.setBooking(resourceId, date, dragActionRef.current, dayId)
  }, [])

  const handleRowContextMenu = useCallback((resourceId, crewClass, name, x, y) => {
    setRowMenu({ resourceId, crewClass, name, x: Math.min(x, window.innerWidth - 220), y: Math.min(y, window.innerHeight - 90) })
  }, [])

  // Close the row menu on any outside click / Escape
  useEffect(() => {
    if (!rowMenu) return
    const close = () => setRowMenu(null)
    const onKey = e => { if (e.key === 'Escape') setRowMenu(null) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onKey) }
  }, [rowMenu])

  const handleCellMouseDown = useCallback((resourceId, date, dayId = null, specIndex = -1) => {
    isDraggingRef.current = true
    paintedInDrag.current = new Set()
    setIsDragging(true)

    const brush    = paintModeRef.current
    const existing = latestRef.current.bookingsByResource[resourceId]?.[dayId ?? date]
    // Toggle off by re-clicking only for non-cancelled statuses.
    // Cancelled cells must not be wiped by an accidental second click — use
    // the Clear brush (Esc) to explicitly remove a cancelled booking.
    const sameStatus = existing?.status === brush
    dragActionRef.current = (sameStatus && brush !== 'cancelled') ? null : brush

    paintCell(resourceId, date, dayId)
    // Anchor gap filling at the starting cell (main-unit day cells only)
    lastPaintedRef.current = (!dayId && specIndex >= 0) ? { resourceId, specIndex } : null
  }, [paintCell])

  const handleCellMouseEnter = useCallback((resourceId, date, dayId = null, specIndex = -1) => {
    if (!isDraggingRef.current) return
    const { colSpecs, shootDateSet } = latestRef.current

    // Sub-unit (dayId) cells: always paintable on drag, no gap interpolation.
    if (dayId) {
      paintCell(resourceId, date, dayId)
      lastPaintedRef.current = null
      return
    }

    // Main-unit cell. Fast drags skip mouseenter events — when we're still on
    // the row we last painted, fill every main-unit day cell between the last
    // spec index and this one (exclusive → inclusive), in order. Summary
    // columns and sub-unit columns are skipped, and (as for a direct enter)
    // non-shoot dates are skipped during a drag.
    const last = lastPaintedRef.current
    const from = (last && last.resourceId === resourceId && specIndex >= 0 &&
                  last.specIndex !== specIndex && colSpecs[last.specIndex] && colSpecs[specIndex])
      ? last.specIndex
      : specIndex   // no valid anchor → just this cell

    if (specIndex >= 0 && colSpecs[specIndex]) {
      const step = specIndex >= from ? 1 : -1
      for (let i = from === specIndex ? specIndex : from + step; ; i += step) {
        const spec = colSpecs[i]
        if (spec && spec.type === 'day' && !spec.dayId && shootDateSet.has(spec.date)) {
          paintCell(resourceId, spec.date, null)
        }
        if (i === specIndex) break
      }
      lastPaintedRef.current = { resourceId, specIndex }
    } else {
      // No spec index available — mirror the old single-cell behaviour
      if (shootDateSet.has(date)) paintCell(resourceId, date, null)
      lastPaintedRef.current = null
    }
  }, [paintCell])

  // Stop drag on mouseup anywhere in the window
  useEffect(() => {
    function stop() {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      setIsDragging(false)
      clearInterval(scrollInterval.current)
      paintedInDrag.current = new Set()
      lastPaintedRef.current = null
    }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  // ── Direction 1: Paint → Hire dates ───────────────────────────────────────
  // When drag ends (isDragging becomes false), compute min/max 'booked' main-unit
  // date for each painted resource and update their hire start/end if changed.

  useEffect(() => {
    if (isDragging) return
    const toSync = [...dirtyResources.current]
    if (!toSync.length) return
    dirtyResources.current = new Set()

    for (const resourceId of toSync) {
      const myBookedDates = bookings
        .filter(b => b.resourceId === resourceId && b.status === 'booked' && !b.dayId)
        .map(b => b.date)
        .sort()
      const newStart = myBookedDates[0] ?? ''
      const newEnd   = myBookedDates[myBookedDates.length - 1] ?? ''
      const resource = resources.find(r => r.id === resourceId)
      if (!resource) continue
      if (newStart !== (resource.hireStartDate ?? '')) updateResource(resourceId, 'hireStartDate', newStart || null)
      if (newEnd   !== (resource.hireEndDate   ?? '')) updateResource(resourceId, 'hireEndDate',   newEnd   || null)
    }
  }, [bookings, isDragging])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll when dragging near edges ───────────────────────────────────

  function handleScrollAreaMouseMove(e) {
    if (!isDraggingRef.current) return
    const container = scrollRef.current
    if (!container) return
    const rect   = container.getBoundingClientRect()
    const EDGE   = 80
    const SPEED  = 10

    clearInterval(scrollInterval.current)

    if (e.clientX > rect.right - EDGE) {
      scrollInterval.current = setInterval(() => {
        container.scrollLeft += SPEED
      }, 16)
    } else if (e.clientX < rect.left + EDGE) {
      scrollInterval.current = setInterval(() => {
        container.scrollLeft -= SPEED
      }, 16)
    }
  }

  function handleScrollAreaMouseLeave() {
    clearInterval(scrollInterval.current)
  }

  // ── CSV import / export ────────────────────────────────────────────────────

  const CREW_HEADERS  = ['Name','Role','Department','Email','Phone','Cost Amount','Cost Type (daily/weekly)','Week Type (5day/3day)','Vendor Crew (yes/no)','Vendor Company','Notes']
  const EQUIP_HEADERS = ['Name','Category','Supplier','PO Number','Cost Amount','Cost Type (daily/weekly)','Notes']

  function downloadTemplate() {
    const headers = effTab === 'crew' ? CREW_HEADERS : EQUIP_HEADERS
    const example = effTab === 'crew'
      ? ['Jane Smith','Director of Photography','Camera','jane@example.com','+44 7700 900000','850','daily','5day','no','','']
      : ['ARRI ALEXA 35','Camera','Panavision Ltd','PO-1234','1500','daily','']
    const csv = [headers, example].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = effTab === 'crew' ? 'crew_template.csv' : 'equipment_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Very small CSV parser — handles double-quoted fields with commas inside.
  function parseCSV(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
    return lines.map(line => {
      const fields = []
      let cur = '', inQ = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') { inQ = !inQ }
        else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = '' }
        else cur += ch
      }
      fields.push(cur.trim())
      return fields
    })
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    // Crew tracker Excel template → parse, diff against existing crew, and
    // open the approval modal instead of the straight CSV import.
    if (/\.xlsx$/i.test(file.name)) {
      if (effTab !== 'crew') {
        alert('Excel import is only available on the Crew Tracker.')
        return
      }
      try {
        const people = await parseCrewXlsx(file)
        if (!people.length) {
          alert('No crew rows found in this Excel file.')
          return
        }
        const crew = resources.filter(r => r.type === 'crew')
        setXlsxDiff(buildCrewImportDiff(people, crew))
      } catch (err) {
        if (err?.code === 'TEMPLATE_MISMATCH') {
          alert("This Excel doesn't match the crew tracker template.")
        } else {
          console.error('[crew xlsx import]', err)
          alert(`Could not read Excel file: ${err?.message ?? err}`)
        }
      }
      return
    }

    const text = await file.text()
    const rows  = parseCSV(text)
    if (rows.length < 2) return   // header only

    const [header, ...dataRows] = rows
    const h = header.map(s => s.toLowerCase())

    let mapped
    if (effTab === 'crew') {
      mapped = dataRows.map(r => ({
        name:          r[h.indexOf('name')]            ?? '',
        role:          r[h.indexOf('role')]            ?? '',
        department:    r[h.indexOf('department')]      ?? '',
        contactEmail:  r[h.indexOf('email')]           ?? '',
        contactPhone:  r[h.indexOf('phone')]           ?? '',
        costAmount:    r[h.findIndex(x => x.includes('cost amount'))] ?? '',
        costType:      (r[h.findIndex(x => x.includes('cost type'))] ?? '').toLowerCase().includes('week') ? 'weekly' : 'daily',
        weekType:      (r[h.findIndex(x => x.includes('week type'))] ?? '').includes('3') ? '3day' : '5day',
        isVendorCrew:  (r[h.findIndex(x => x.includes('vendor crew'))] ?? '').toLowerCase() === 'yes',
        vendor:        r[h.findIndex(x => x.includes('vendor company'))] ?? '',
        notes:         r[h.indexOf('notes')]           ?? '',
      })).filter(r => r.name)
    } else {
      mapped = dataRows.map(r => ({
        name:       r[h.indexOf('name')]           ?? '',
        category:   r[h.indexOf('category')]       ?? '',
        vendor:     r[h.indexOf('supplier')]       ?? '',
        poNumber:   r[h.findIndex(x => x.includes('po'))] ?? '',
        costAmount: r[h.findIndex(x => x.includes('cost amount'))] ?? '',
        costType:   (r[h.findIndex(x => x.includes('cost type'))] ?? '').toLowerCase().includes('week') ? 'weekly' : 'daily',
        notes:      r[h.indexOf('notes')]          ?? '',
      })).filter(r => r.name)
    }

    if (!mapped.length) return

    const inserted = await importResources(
      effTab,
      mapped,
      effTab === 'crew' && classFilter ? { crewClass: classFilter } : {}
    )
    setImportMsg({ count: inserted.length, type: effTab })
    setTimeout(() => setImportMsg(null), 4000)
  }

  // Apply an approved crew tracker Excel import: insert the checked NEW people
  // (into the active sub-tab's class) and write the checked CHANGED fields.
  async function applyXlsxImport(selectedNew, selectedChanged) {
    setXlsxDiff(null)
    let applied = 0

    // Changed people: per-field updates. updateResource handles numeric-null
    // columns and triggers the fulltime booking sync on hire-date changes.
    for (const entry of selectedChanged) {
      for (const ch of entry.changes) {
        updateResource(entry.resource.id, ch.field, ch.to)
      }
      // When BOTH hire dates change in one import, the per-field syncs above
      // each saw a half-stale range — run one final authoritative sync with
      // the resolved final dates.
      const dateChanges = entry.changes.filter(c => c.field === 'hireStartDate' || c.field === 'hireEndDate')
      if (dateChanges.length && (entry.resource.crewClass ?? 'additional') === 'fulltime') {
        const finalStart = entry.changes.find(c => c.field === 'hireStartDate')?.to ?? entry.resource.hireStartDate
        const finalEnd   = entry.changes.find(c => c.field === 'hireEndDate')?.to   ?? entry.resource.hireEndDate
        if (finalStart) {
          try {
            await syncFulltimeBookings(supabase, entry.resource.id, finalStart, finalEnd || null)
          } catch (err) {
            console.error('[xlsx import] booking sync failed for', entry.resource.name, err)
          }
        }
      }
      applied++
    }

    // New people: bulk insert with the full detail field set.
    if (selectedNew.length) {
      const crewClass = classFilter ?? 'additional'
      const rows = selectedNew.map(p => ({
        name:            p.name,
        role:            p.role,
        department:      p.department,
        contactEmail:    p.email,
        contactPhone:    p.phone,
        agent:           p.agent,
        taxStatus:       p.taxStatus,
        boxPw:           p.boxPw ?? '',
        carAllowance:    p.carAllowance ?? '',
        otRate:          p.otOverride ?? '',
        sixthDayRate:    p.sixthOverride ?? '',
        seventhDayRate:  p.seventhOverride ?? '',
        dealMemoEmailed: p.dealMemoEmailed,
        dealMemoDrafted: p.dealMemoDrafted,
        dealMemoSent:    p.dealMemoSent,
        costAmount:      p.weeklyRate != null ? String(p.weeklyRate) : '',
        costType:        p.weeklyRate != null ? 'weekly' : 'daily',
        hireStartDate:   p.startDate,
        hireEndDate:     p.endDate,
        level:           5,
      }))
      const inserted = await importResources('crew', rows, { crewClass })
      applied += inserted.length

      // Fulltime hires with both dates → auto-book their weekdays.
      if (crewClass === 'fulltime') {
        for (const r of inserted) {
          if (r.hireStartDate) {
            try {
              await syncFulltimeBookings(supabase, r.id, r.hireStartDate, r.hireEndDate || null)
            } catch (err) {
              console.error('[xlsx import] booking sync failed for', r.name, err)
            }
          }
        }
      }
    }

    setImportMsg({ count: applied, type: 'crew' })
    setTimeout(() => setImportMsg(null), 4000)
  }

  // ── Direction 2: Hire dates → Paint ───────────────────────────────────────
  // When a hire date field changes and both start + end are valid, auto-book
  // all main-unit shoot days (not non-shoot) within that range.
  // Does NOT add to dirtyResources so Direction 1 won't subsequently overwrite.

  const handleUpdateResource = useCallback((id, field, value) => {
    const { resources, bookings, shootDays, setBooking, updateResource } = latestRef.current
    updateResource(id, field, value)
    if (field !== 'hireStartDate' && field !== 'hireEndDate') return
    const resource = resources.find(r => r.id === id)
    if (!resource) return
    const newStart = field === 'hireStartDate' ? value : (resource.hireStartDate || '')
    const newEnd   = field === 'hireEndDate'   ? value : (resource.hireEndDate   || '')
    if (!newStart || !newEnd || newStart > newEnd) return

    // Book all main shoot days in the new range
    const inRange = shootDays.filter(
      d => d.dayCategory === 'main' && !d.isNonShootDay && d.date >= newStart && d.date <= newEnd
    )
    for (const day of inRange) {
      setBooking(id, day.date, 'booked', null)
    }

    // Clear any 'booked' main-unit cells that now fall outside the new range
    const outside = bookings.filter(
      b => b.resourceId === id && b.status === 'booked' && !b.dayId &&
           (b.date < newStart || b.date > newEnd)
    )
    for (const b of outside) {
      setBooking(id, b.date, null, null)
    }
  }, [])

  // Stable wrappers around per-render store functions, so memoized rows don't
  // re-render when the store hook recreates its closures.
  const handleDeleteResource = useCallback(id => latestRef.current.deleteResource(id), [])
  const handleMoveUp         = useCallback(id => latestRef.current.moveResourceUp(id), [])
  const handleMoveDown       = useCallback(id => latestRef.current.moveResourceDown(id), [])
  const handleCreatePerson   = useCallback(p  => latestRef.current.findOrCreatePerson(p), [])
  const handleUpdatePerson   = useCallback((id, field, value) => latestRef.current.updateCrewPerson(id, field, value), [])

  if (loading) return <div className="gantt-state-msg">Loading…</div>
  if (error)   return <div className="gantt-state-msg gantt-state-error">Error: {error}</div>

  const typeLabel = effTab === 'crew' ? 'Crew Member' : 'Equipment'
  const crewClassLabel = classFilter === 'fulltime' ? 'full-time' : 'additional'
  const activePaint = PAINT_MODES.find(m => m.value === paintMode)

  return (
    <div className="gantt-module-wrap">

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="gantt-top">

        {mode === 'both' && (
          <div className="gantt-tabs">
            <button className={`gantt-tab${activeTab === 'crew'      ? ' active' : ''}`}
              onClick={() => switchTab('crew')}>Crew</button>
            <button className={`gantt-tab${activeTab === 'equipment' ? ' active' : ''}`}
              onClick={() => switchTab('equipment')}>Equipment</button>
          </div>
        )}
        {mode === 'crew' && (
          <div className="gantt-tabs">
            <button className={`gantt-tab${crewClassTab === 'fulltime'   ? ' active' : ''}`}
              onClick={() => switchCrewClassTab('fulltime')}>Full-Time</button>
            <button className={`gantt-tab${crewClassTab === 'additional' ? ' active' : ''}`}
              onClick={() => switchCrewClassTab('additional')}>Additional</button>
          </div>
        )}

        <div className="gantt-toolbar">
          {/* Add / import resource */}
          <button className="pm-btn pm-btn--primary pm-btn--sm" onClick={handleAddResource}>
            + Add {typeLabel}
          </button>
          {mode === 'crew' && canViewCrewDetails && (
            <button
              className={`pm-btn pm-btn--ghost pm-btn--sm${detailsOpen ? ' is-active' : ''}`}
              onClick={toggleDetails}
              title="Show / hide deal memo, rate and contact detail columns"
            >
              {detailsOpen ? '▾ Details' : '▸ Details'}
            </button>
          )}
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={downloadTemplate} title="Download CSV template">
            ↓ Template
          </button>
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={() => importFileRef.current?.click()} title="Import from CSV (crew tracker Excel also accepted)">
            ↑ Import CSV
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          {importMsg && (
            <span className="gantt-import-msg">
              ✓ Imported {importMsg.count} {importMsg.type} row{importMsg.count !== 1 ? 's' : ''}
            </span>
          )}

          {/* Paint mode selector */}
          <div className="gantt-paint-bar">
            <span className="gantt-paint-label">Paint:</span>
            {PAINT_MODES.map(mode => (
              <button
                key={String(mode.value)}
                className={`gantt-paint-btn${paintMode === mode.value ? ' active' : ''}`}
                style={{
                  '--pm-color': mode.color,
                  '--pm-bg':    mode.bg,
                }}
                onClick={() => setPaintMode(mode.value)}
                title={mode.label}
              >
                <span className="gantt-paint-icon">{mode.icon}</span>
                <span className="gantt-paint-text">{mode.label}</span>
                <span className="gantt-paint-key">{mode.key}</span>
              </button>
            ))}
          </div>

          {/* Phase toggles */}
          {hasPhases && (
            <div className="gantt-phase-toggles">
              {PHASES.map(phase => {
                const ok = production[phase.startKey] && production[phase.endKey]
                if (!ok) return null
                return (
                  <button
                    key={phase.id}
                    className={`gantt-phase-btn${expandedPhases[phase.id] ? ' active' : ''}`}
                    style={{ '--phase-color': phase.color }}
                    onClick={() => togglePhase(phase.id)}
                  >
                    {expandedPhases[phase.id] ? '▾' : '▸'} {phase.label}
                  </button>
                )
              })}
              <button
                className={`pm-btn pm-btn--ghost pm-btn--sm${hidePastDays ? ' is-active' : ''}`}
                onClick={() => {
                  if (hidePastDays) {
                    setHidePastDays(false)
                  } else {
                    setHidePastDays(true)
                    collapseBeforeToday()
                  }
                }}
              >
                {hidePastDays ? 'Show past' : 'Collapse past'}
              </button>
            </div>
          )}

          {/* Legend */}
          <div className="gantt-legend">
            <span className="pm-leg"><span className="pm-leg-sw booked" />Confirmed</span>
            <span className="pm-leg"><span className="pm-leg-sw hold" />On Hold</span>
            <span className="pm-leg"><span className="pm-leg-sw unavailable" />Unavailable</span>
            <span className="pm-leg"><span className="pm-leg-sw cancelled" />Cancelled</span>
          </div>
        </div>
      </div>

      {/* ── Global rate-calc settings strip ──────────────────────────────────── */}
      {showDetails && (
        <div className="crewd-settings">
          {RATE_SETTINGS.map(s => (
            <RateSettingInput
              key={s.key}
              label={s.label}
              value={rateCalcSettings[s.key]}
              onCommit={n => onUpdateProduction?.('rateCalc', { ...getRateCalc(production), [s.key]: n })}
            />
          ))}
          <span className="crewd-settings-caption">
            Rate calculations — applies to all rows; type in a 6th/7th/OT cell to override one row.
          </span>
        </div>
      )}

      {/* ── No phases configured ─────────────────────────────────────────────── */}
      {!hasPhases ? (
        <div className="gantt-empty-msg">
          Set up your production phases in <strong>Project Setup</strong> —
          those date ranges become the columns of this Gantt.
        </div>
      ) : (
        /* ── Gantt table ───────────────────────────────────────────────────── */
        <div
          ref={scrollRef}
          className={`gantt-scroll${isDragging ? ' is-dragging' : ''}`}
          onMouseMove={handleScrollAreaMouseMove}
          onMouseLeave={handleScrollAreaMouseLeave}
        >
          <table className="pm-g-tbl" onDragStart={e => e.preventDefault()}>

            <thead>
              {/* ── Phase banner row ───────────────────────────────────────────── */}
              <tr>
                <th className="pm-g-corner pm-g-corner--tall" rowSpan={2}>
                  {effTab === 'crew' ? 'Name / Role / Dept' : 'Item / Category'}
                </th>
                {showDetails && DETAIL_GROUPS.map((g, i) => (
                  <th key={`dgrp-${i}`} className="crewd-group-th" colSpan={g.span}>
                    {g.label}
                  </th>
                ))}
                {buildPhaseSpans(colSpecs).map(span => (
                  <th
                    key={span.phaseId}
                    colSpan={span.count}
                    className="gantt-phase-banner-th"
                    style={{ '--phase-color': span.color }}
                  >
                    <span className="gantt-phase-banner-label">{span.label}</span>
                  </th>
                ))}
              </tr>

              {/* ── Date columns row ───────────────────────────────────────────── */}
              <tr>
                {showDetails && DETAIL_COLS.map((c, i) => (
                  <th key={`dcol-${i}`} className="crewd-label-th" style={{ width: c.w, minWidth: c.w }}>
                    {c.label}
                  </th>
                ))}
                {colSpecs.map(spec => {
                  if (spec.type === 'summary') {
                    return (
                      <th key={`sum-${spec.phaseId}`}
                          className="gantt-phase-sum-th"
                          style={{ '--phase-color': spec.color }}
                          onClick={() => togglePhase(spec.phaseId)}
                          title={`${spec.label}: ${spec.dayCount} days — click to expand`}>
                        <span className="gantt-sum-label">{spec.label}</span>
                        <span className="gantt-sum-count">{spec.dayCount}d</span>
                        <span className="gantt-sum-expand">▶</span>
                      </th>
                    )
                  }
                  const { date: dStr, wday } = formatColHeader(spec.date)
                  const sd = spec.shootDay
                  const isShoot = shootDateSet.has(spec.date)

                  // Sub-unit column (prep / splinter / other) — compact coloured header
                  if (spec.subUnitCategory) {
                    const isPrep      = spec.subUnitCategory === 'prep'
                    const isSplinter  = spec.subUnitCategory === 'splinter'
                    const isRehearsal = spec.subUnitCategory === 'rehearsal'
                    const colClass   = isPrep ? 'gantt-prep-col' : isSplinter ? 'gantt-splinter-col' : isRehearsal ? 'gantt-rehearsal-col' : 'gantt-other-col'
                    const badgeClass = isPrep ? 'gantt-badge-p'  : isSplinter ? 'gantt-badge-s'      : isRehearsal ? 'gantt-badge-r'       : 'gantt-badge-o'
                    const badgeLbl   = isPrep ? 'P'              : isSplinter ? 'S'                  : isRehearsal ? 'R'                   : 'O'
                    const typeLabel2 = isPrep ? 'Prep'           : isSplinter ? 'Splinter'           : isRehearsal ? 'Rehearsal'           : 'Other'
                    const subLabel   = sd?.dayLabel ? ` (${sd.dayLabel})` : ''
                    return (
                      <th key={`sub-${spec.dayId}`}
                          className={[
                            'pm-g-day',
                            colClass,
                            spec.isToday ? 'is-today' : '',
                          ].filter(Boolean).join(' ')}
                          style={{ '--phase-color': spec.phaseColor }}
                          title={`${typeLabel2}${subLabel} — ${spec.date}${sd?.description ? ': ' + sd.description : ''}`}>
                        <span className={badgeClass}>{badgeLbl}</span>
                        <span className="gantt-day-date" style={{ fontSize: 9 }}>{dStr}</span>
                      </th>
                    )
                  }

                  // Main unit column
                  return (
                    <th key={spec.date}
                        className={[
                          'pm-g-day',
                          sd?.isNonShootDay ? 'non-shoot'  : '',
                          spec.isToday      ? 'is-today'   : '',
                          spec.isWeekend    ? 'is-weekend' : '',
                          !isShoot          ? 'no-shoot'   : '',
                        ].filter(Boolean).join(' ')}
                        style={{ '--phase-color': spec.phaseColor }}
                        title={spec.date}>
                      <span className="gantt-day-num">
                        {sd ? (sd.isNonShootDay ? '—' : `D${sd.dayNumber}`) : ''}
                      </span>
                      <span className="gantt-day-date">{dStr}</span>
                      <span className="gantt-day-wday">{wday}</span>
                    </th>
                  )
                })}
              </tr>
            </thead>

            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={colSpecs.length + 1 + extraCols} className="gantt-empty-row">
                    No {effTab === 'crew'
                      ? (classFilter ? `${crewClassLabel} crew` : 'crew members')
                      : 'equipment'} yet —
                    click + Add above.
                  </td>
                </tr>
              ) : (
                groups.map(([deptName, deptResources]) => (
                  <Fragment key={`dept-${deptName}`}>
                    <tr className="pm-g-dept">
                      <td colSpan={colSpecs.length + 1 + extraCols}>
                        <span className="pm-g-dept-label">{deptName}</span>
                      </td>
                    </tr>
                    {deptResources.map(resource => (
                      <ResourceRow
                        key={resource.id}
                        resource={resource}
                        activeTab={effTab}
                        colSpecs={colSpecs}
                        rowBookings={bookingsByResource[resource.id]}
                        shootDateSet={shootDateSet}
                        onCellMouseDown={handleCellMouseDown}
                        onCellMouseEnter={handleCellMouseEnter}
                        onUpdate={handleUpdateResource}
                        onDelete={handleDeleteResource}
                        onMoveUp={handleMoveUp}
                        onMoveDown={handleMoveDown}
                        onPhaseToggle={togglePhase}
                        typeResources={effTab === 'crew' ? crewResources : equipResources}
                        people={people}
                        onCreatePerson={handleCreatePerson}
                        onUpdatePerson={handleUpdatePerson}
                        estEndDate={production?.shootEndDate ?? ''}
                        onRowContextMenu={handleRowContextMenu}
                        showDetails={showDetails}
                        rateCalcSettings={rateCalcSettings}
                      />
                    ))}
                  </Fragment>
                ))
              )}
              <tr className="gantt-add-bottom-row">
                <td colSpan={colSpecs.length + 1 + extraCols}>
                  <button
                    className="pm-btn pm-btn--ghost pm-btn--sm gantt-add-bottom-btn"
                    onClick={handleAddResource}
                  >
                    + Add {typeLabel}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          {/* ── Row context menu (right-click on a crew name) ───────────────── */}
          {rowMenu && (
            <div
              className="gantt-row-menu"
              style={{ position: 'fixed', left: rowMenu.x, top: rowMenu.y }}
              onMouseDown={e => e.stopPropagation()}
            >
              <div className="gantt-row-menu-name">{rowMenu.name || 'Unnamed'}</div>
              <button
                className="gantt-row-menu-item"
                onClick={() => {
                  const next = rowMenu.crewClass === 'fulltime' ? 'additional' : 'fulltime'
                  updateResource(rowMenu.resourceId, 'crewClass', next)
                  setRowMenu(null)
                }}
              >
                Move to {rowMenu.crewClass === 'fulltime' ? 'Additional Crew' : 'Full-Time Crew'}
              </button>
            </div>
          )}
        </div>
      )}

      {xlsxDiff && (
        <CrewXlsxImportModal
          diff={xlsxDiff}
          crewClassLabel={crewClassLabel}
          onCancel={() => setXlsxDiff(null)}
          onApply={applyXlsxImport}
        />
      )}
    </div>
  )
}
