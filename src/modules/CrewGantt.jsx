import { useState, useEffect, useRef, Fragment } from 'react'
import { useCrewStore } from '../store/useCrewStore'

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
  { value: 'cancelled',   label: 'Cancelled', icon: '✗', key: 'X',   color: '#374151', bg: '#f3f4f6' },
  { value: null,          label: 'Clear',     icon: '○', key: 'Esc', color: '#9ca3af', bg: '#ffffff' },
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

// ─── ResourceRow — isolated so local text state never loses focus ─────────────

// Derive unique sorted values for a given field from a resource list
function uniq(arr) { return [...new Set(arr.filter(Boolean))].sort() }

function ResourceRow({
  resource, activeTab, colSpecs, bMap,
  shootDateSet, paintMode, isDragging,
  onCellMouseDown, onCellMouseEnter,
  onUpdate, onDelete, onMoveUp, onMoveDown, onPhaseToggle,
  typeResources,
}) {
  // Build suggestions from all other resources of the same type
  const others = typeResources.filter(r => r.id !== resource.id)
  const nameSuggestions  = uniq(others.map(r => r.name))
  const roleSuggestions  = uniq(others.map(r => r.role))
  const deptSuggestions  = uniq(others.map(r => r.department))
  const catSuggestions   = uniq(others.map(r => r.category))
  const vendorSuggestions = uniq(others.map(r => r.vendor))
  const [expanded,       setExpanded]       = useState(false)
  const [lName,          setLName]          = useState(resource.name)
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

  useEffect(() => setLName(resource.name),                   [resource.name])
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

  // When a name is chosen that matches an existing resource, auto-fill blank fields
  function handleNameBlur() {
    commit('name', lName, resource.name)
    if (!lName.trim()) return
    const match = typeResources.find(
      r => r.id !== resource.id &&
           r.name.trim().toLowerCase() === lName.trim().toLowerCase()
    )
    if (!match) return
    const fills = [
      ['role',         lRole,         match.role,         setLRole],
      ['department',   lDept,         match.department,   setLDept],
      ['category',     lCat,          match.category,     setLCat],
      ['contactEmail', lContactEmail, match.contactEmail, setLContactEmail],
      ['contactPhone', lContactPhone, match.contactPhone, setLContactPhone],
      ['vendor',        lVendor,     match.vendor,         setLVendor],
      ['poNumber',      lPoNumber,   match.poNumber,       setLPoNumber],
      ['notes',         lNotes,      match.notes,          setLNotes],
      ['hireStartDate', lHireStart,  match.hireStartDate,  setLHireStart],
      ['hireEndDate',   lHireEnd,    match.hireEndDate,    setLHireEnd],
    ]
    for (const [field, current, value, setter] of fills) {
      if (!current && value) { setter(value); onUpdate(resource.id, field, value) }
    }
    // Copy cost settings if not yet set
    if (!lCostAmount && match.costAmount) {
      setLCostAmount(match.costAmount)
      onUpdate(resource.id, 'costAmount',  match.costAmount)
      onUpdate(resource.id, 'costType',    match.costType)
      onUpdate(resource.id, 'weekType',    match.weekType)
    }
  }

  return (
    <Fragment>
      <tr className="gantt-resource-row">
        {/* ── Sticky name cell ─────────────────────────────────────────────────── */}
        <td className="pm-g-name">
          <div className="gantt-name-cell">
            <button
              className={`gantt-row-expand${expanded ? ' open' : ''}`}
              onClick={() => setExpanded(e => !e)}
              title={expanded ? 'Hide details' : 'Show cost / contact details'}
            >
              {expanded ? '▾' : '▸'}
            </button>
            <div className="gantt-name-fields">
              <input
                className="gantt-input gantt-input-name"
                value={lName}
                placeholder={activeTab === 'crew' ? 'Name' : 'Item name'}
                list={`name-${resource.id}`}
                onChange={e => setLName(e.target.value)}
                onBlur={handleNameBlur}
              />
              <datalist id={`name-${resource.id}`}>
                {nameSuggestions.map(s => <option key={s} value={s} />)}
              </datalist>

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

        {/* ── Day / summary cells ──────────────────────────────────────────────── */}
        {colSpecs.map(spec => {
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

          const bKey       = spec.dayId ? `${resource.id}:${spec.dayId}` : `${resource.id}:${spec.date}`
          const booking    = bMap[bKey]
          const status     = booking?.status ?? null
          const isShootDay = shootDateSet.has(spec.date)

          const isSubUnit = !!spec.subUnitCategory
          const statusCls = status === 'unavailable' ? 'pm-g-cell--unavail'
                          : status ? `pm-g-cell--${status}` : ''
          const cls = [
            'pm-g-cell',
            statusCls,
            spec.subUnitCategory === 'prep'     ? 'cell-prep'     : '',
            spec.subUnitCategory === 'splinter' ? 'cell-splinter' : '',
            spec.subUnitCategory === 'other'    ? 'cell-other'    : '',
            spec.shootDay?.isNonShootDay && !isSubUnit ? 'cell-nonshoot' : '',
            spec.isWeekend ? 'cell-weekend'  : '',
            spec.isToday   ? 'cell-today'    : '',
            !isShootDay && !isSubUnit ? 'cell-no-shoot' : '',
          ].filter(Boolean).join(' ')

          const unitLabel = spec.subUnitCategory === 'prep'     ? 'Prep'
                          : spec.subUnitCategory === 'splinter' ? 'Splinter'
                          : spec.subUnitCategory === 'other'    ? 'Other'
                          : null

          return (
            <td
              key={spec.dayId ?? spec.date}
              className={cls}
              onMouseDown={e => { e.preventDefault(); onCellMouseDown(resource.id, spec.date, spec.dayId) }}
              onMouseEnter={() => onCellMouseEnter(resource.id, spec.date, spec.dayId)}
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

      {/* ── Details row ─────────────────────────────────────────────────────────── */}
      {expanded && (
        <tr className="gantt-details-row">
          <td colSpan={colSpecs.length + 1}>
            <div className="gantt-details-panel">

              {/* Cost */}
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

              {/* Crew: email + phone + vendor crew */}
              {activeTab === 'crew' && (
                <>
                  <div className="details-group">
                    <label className="details-label">Email</label>
                    <input
                      className="details-input"
                      type="email"
                      value={lContactEmail}
                      placeholder="email@example.com"
                      onChange={e => setLContactEmail(e.target.value)}
                      onBlur={() => commit('contactEmail', lContactEmail, resource.contactEmail)}
                    />
                  </div>
                  <div className="details-group">
                    <label className="details-label">Phone</label>
                    <input
                      className="details-input"
                      type="tel"
                      value={lContactPhone}
                      placeholder="+44 7700 900000"
                      onChange={e => setLContactPhone(e.target.value)}
                      onBlur={() => commit('contactPhone', lContactPhone, resource.contactPhone)}
                    />
                  </div>
                  <div className="details-group">
                    <label className="details-label details-label-check">
                      <input
                        type="checkbox"
                        className="details-checkbox"
                        checked={resource.isVendorCrew}
                        onChange={e => onUpdate(resource.id, 'isVendorCrew', e.target.checked)}
                      />
                      Vendor crew
                    </label>
                  </div>
                  {resource.isVendorCrew && (
                    <div className="details-group">
                      <label className="details-label">Vendor</label>
                      <input
                        className="details-input"
                        type="text"
                        value={lVendor}
                        placeholder="Vendor company"
                        list={`vendor-${resource.id}`}
                        onChange={e => setLVendor(e.target.value)}
                        onBlur={() => commit('vendor', lVendor, resource.vendor)}
                      />
                      <datalist id={`vendor-${resource.id}`}>
                        {vendorSuggestions.map(s => <option key={s} value={s} />)}
                      </datalist>
                    </div>
                  )}
                </>
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

              {/* Hire period */}
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
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CrewGantt({ production, shootDays }) {
  const [activeTab, setActiveTab] = useState(() =>
    localStorage.getItem('fm_gantt_tab') ?? 'crew'
  )
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
  const scrollRef       = useRef(null)        // gantt-scroll container
  const scrollInterval  = useRef(null)
  const dirtyResources  = useRef(new Set())   // resource IDs whose bookings changed via painting

  const {
    loading, error,
    resources, bookings,
    addResource, deleteResource, updateResource,
    importResources,
    setBooking,
    moveResourceUp, moveResourceDown,
  } = useCrewStore()

  const importFileRef = useRef(null)
  const [importMsg, setImportMsg] = useState(null)  // null | { count, type }

  const today = todayStr()

  // ── Derived data ───────────────────────────────────────────────────────────

  const hasPhases = PHASES.some(p => production[p.startKey] && production[p.endKey])

  // date → main shootDay map (for column labels — main unit only)
  const dateMap = {}
  for (const sd of shootDays) {
    if (sd.date && sd.dayCategory === 'main') dateMap[sd.date] = sd
  }

  // date → [subUnit, ...] map — prep, splinter AND other units get their own columns
  const subUnitsByDate = {}
  for (const sd of shootDays) {
    if ((sd.dayCategory === 'prep' || sd.dayCategory === 'splinter' || sd.dayCategory === 'other') && sd.date) {
      if (!subUnitsByDate[sd.date]) subUnitsByDate[sd.date] = []
      subUnitsByDate[sd.date].push(sd)
    }
  }

  // Set of shoot-day dates that are NOT non-shoot (drag-paint skips others)
  const shootDateSet = new Set(
    shootDays.filter(sd => !sd.isNonShootDay).map(sd => sd.date)
  )

  let colSpecs = hasPhases
    ? buildColSpecs(production, expandedPhases, dateMap, today, subUnitsByDate)
    : []
  if (hidePastDays) {
    colSpecs = colSpecs.filter(spec => spec.type === 'summary' || spec.date >= today)
  }

  // booking lookup:
  //   prep bookings  → `${resourceId}:${dayId}`
  //   main bookings  → `${resourceId}:${dateStr}`
  const bMap = {}
  for (const b of bookings) {
    const key = b.dayId ? `${b.resourceId}:${b.dayId}` : `${b.resourceId}:${b.date}`
    bMap[key] = b
  }

  // ── Autocomplete suggestions from existing values ─────────────────────────

  // All resources of each type — passed to rows for suggestions + name autofill
  const crewResources  = resources.filter(r => r.type === 'crew')
  const equipResources = resources.filter(r => r.type === 'equipment')

  // ── Filter + group resources ───────────────────────────────────────────────

  const filtered = resources.filter(r => r.type === activeTab)
  const groupKey = activeTab === 'crew' ? 'department' : 'category'
  const FALLBACK = activeTab === 'crew' ? 'Unassigned' : 'Uncategorised'

  const groupMap = {}
  for (const r of filtered) {
    const key = r[groupKey].trim() || FALLBACK
    if (!groupMap[key]) groupMap[key] = []
    groupMap[key].push(r)
  }
  const groups = Object.entries(groupMap).sort(([a], [b]) => {
    if (a === FALLBACK) return 1
    if (b === FALLBACK) return -1
    return a.localeCompare(b)
  })

  // ── Phase toggle ───────────────────────────────────────────────────────────

  function togglePhase(phaseId) {
    setExpandedPhases(s => {
      const next = { ...s, [phaseId]: !s[phaseId] }
      localStorage.setItem('fm_gantt_phases', JSON.stringify(next))
      return next
    })
  }

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

  function handleCellMouseDown(resourceId, date, dayId = null) {
    isDraggingRef.current = true
    paintedInDrag.current = new Set()
    setIsDragging(true)

    dirtyResources.current.add(resourceId)

    const key      = dayId ? `${resourceId}:${dayId}` : `${resourceId}:${date}`
    const existing = bMap[key]
    dragActionRef.current = (existing?.status === paintMode) ? null : paintMode

    paintedInDrag.current.add(key)
    setBooking(resourceId, date, dragActionRef.current, dayId)
  }

  function handleCellMouseEnter(resourceId, date, dayId = null) {
    if (!isDraggingRef.current) return
    // For prep columns always allow drag; for main columns skip non-shoot dates
    if (!dayId && !shootDateSet.has(date)) return
    const key = dayId ? `${resourceId}:${dayId}` : `${resourceId}:${date}`
    if (paintedInDrag.current.has(key)) return
    paintedInDrag.current.add(key)
    dirtyResources.current.add(resourceId)
    setBooking(resourceId, date, dragActionRef.current, dayId)
  }

  // Stop drag on mouseup anywhere in the window
  useEffect(() => {
    function stop() {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      setIsDragging(false)
      clearInterval(scrollInterval.current)
      paintedInDrag.current = new Set()
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
    const headers = activeTab === 'crew' ? CREW_HEADERS : EQUIP_HEADERS
    const example = activeTab === 'crew'
      ? ['Jane Smith','Director of Photography','Camera','jane@example.com','+44 7700 900000','850','daily','5day','no','','']
      : ['ARRI ALEXA 35','Camera','Panavision Ltd','PO-1234','1500','daily','']
    const csv = [headers, example].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = activeTab === 'crew' ? 'crew_template.csv' : 'equipment_template.csv'
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

    const text = await file.text()
    const rows  = parseCSV(text)
    if (rows.length < 2) return   // header only

    const [header, ...dataRows] = rows
    const h = header.map(s => s.toLowerCase())

    let mapped
    if (activeTab === 'crew') {
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

    const count = await importResources(activeTab, mapped)
    setImportMsg({ count, type: activeTab })
    setTimeout(() => setImportMsg(null), 4000)
  }

  // ── Direction 2: Hire dates → Paint ───────────────────────────────────────
  // When a hire date field changes and both start + end are valid, auto-book
  // all main-unit shoot days (not non-shoot) within that range.
  // Does NOT add to dirtyResources so Direction 1 won't subsequently overwrite.

  function handleUpdateResource(id, field, value) {
    updateResource(id, field, value)
    if (field !== 'hireStartDate' && field !== 'hireEndDate') return
    const resource = resources.find(r => r.id === id)
    if (!resource) return
    const newStart = field === 'hireStartDate' ? value : (resource.hireStartDate || '')
    const newEnd   = field === 'hireEndDate'   ? value : (resource.hireEndDate   || '')
    if (!newStart || !newEnd || newStart > newEnd) return
    const inRange = shootDays.filter(
      d => d.dayCategory === 'main' && !d.isNonShootDay && d.date >= newStart && d.date <= newEnd
    )
    for (const day of inRange) {
      setBooking(id, day.date, 'booked', null)
    }
  }

  if (loading) return <div className="gantt-state-msg">Loading…</div>
  if (error)   return <div className="gantt-state-msg gantt-state-error">Error: {error}</div>

  const typeLabel = activeTab === 'crew' ? 'Crew Member' : 'Equipment'
  const activePaint = PAINT_MODES.find(m => m.value === paintMode)

  return (
    <div className="gantt-module-wrap">

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="gantt-top">

        <div className="gantt-tabs">
          <button className={`gantt-tab${activeTab === 'crew'      ? ' active' : ''}`}
            onClick={() => switchTab('crew')}>Crew</button>
          <button className={`gantt-tab${activeTab === 'equipment' ? ' active' : ''}`}
            onClick={() => switchTab('equipment')}>Equipment</button>
        </div>

        <div className="gantt-toolbar">
          {/* Add / import resource */}
          <button className="pm-btn pm-btn--primary pm-btn--sm" onClick={() => addResource(activeTab)}>
            + Add {typeLabel}
          </button>
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={downloadTemplate} title="Download CSV template">
            ↓ Template
          </button>
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={() => importFileRef.current?.click()} title="Import from CSV">
            ↑ Import CSV
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".csv,text/csv"
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
              <tr>
                <th className="pm-g-corner">
                  {activeTab === 'crew' ? 'Name / Role / Dept' : 'Item / Category'}
                </th>
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
                    const isPrep     = spec.subUnitCategory === 'prep'
                    const isSplinter = spec.subUnitCategory === 'splinter'
                    const isOther    = spec.subUnitCategory === 'other'
                    const colClass   = isPrep ? 'gantt-prep-col' : isSplinter ? 'gantt-splinter-col' : 'gantt-other-col'
                    const badgeClass = isPrep ? 'gantt-badge-p'  : isSplinter ? 'gantt-badge-s'      : 'gantt-badge-o'
                    const badgeLbl   = isPrep ? 'P'              : isSplinter ? 'S'                  : 'O'
                    const typeLabel2 = isPrep ? 'Prep'           : isSplinter ? 'Splinter'           : 'Other'
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
                  <td colSpan={colSpecs.length + 1} className="gantt-empty-row">
                    No {activeTab === 'crew' ? 'crew members' : 'equipment'} yet —
                    click + Add above.
                  </td>
                </tr>
              ) : (
                groups.map(([deptName, deptResources]) => (
                  <Fragment key={`dept-${deptName}`}>
                    <tr className="pm-g-dept">
                      <td colSpan={colSpecs.length + 1}>
                        <span className="pm-g-dept-label">{deptName}</span>
                      </td>
                    </tr>
                    {deptResources.map(resource => (
                      <ResourceRow
                        key={resource.id}
                        resource={resource}
                        activeTab={activeTab}
                        colSpecs={colSpecs}
                        bMap={bMap}
                        shootDateSet={shootDateSet}
                        paintMode={paintMode}
                        isDragging={isDragging}
                        onCellMouseDown={handleCellMouseDown}
                        onCellMouseEnter={handleCellMouseEnter}
                        onUpdate={handleUpdateResource}
                        onDelete={deleteResource}
                        onMoveUp={moveResourceUp}
                        onMoveDown={moveResourceDown}
                        onPhaseToggle={togglePhase}
                        typeResources={activeTab === 'crew' ? crewResources : equipResources}
                      />
                    ))}
                  </Fragment>
                ))
              )}
              <tr className="gantt-add-bottom-row">
                <td colSpan={colSpecs.length + 1}>
                  <button
                    className="pm-btn pm-btn--ghost pm-btn--sm gantt-add-bottom-btn"
                    onClick={() => addResource(activeTab)}
                  >
                    + Add {typeLabel}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
