import { useState, useEffect, useRef, Fragment } from 'react'
import { useCrewStore } from '../store/useCrewStore'
import { getNotifiedIds, markIdsNotified } from '../lib/ganttNotified'

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

function formatNoticeDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

// ─── Column spec builder ──────────────────────────────────────────────────────

function buildColSpecs(production, expandedPhases, dateMap, today) {
  const specs = []
  for (const phase of PHASES) {
    const start = production[phase.startKey]
    const end   = production[phase.endKey]
    if (!start || !end) continue

    if (expandedPhases[phase.id]) {
      for (const date of eachDay(start, end)) {
        const { isWeekend } = formatColHeader(date)
        specs.push({
          type: 'day', date,
          phaseId: phase.id, phaseColor: phase.color,
          isToday: date === today, isWeekend,
          shootDay: dateMap[date] ?? null,
        })
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

function ResourceRow({
  resource, activeTab, colSpecs, bMap,
  shootDateSet, paintMode, isDragging,
  onCellMouseDown, onCellMouseEnter,
  onUpdate, onDelete, onMoveUp, onMoveDown, onPhaseToggle,
}) {
  const [expanded,       setExpanded]       = useState(false)
  const [lName,          setLName]          = useState(resource.name)
  const [lRole,          setLRole]          = useState(resource.role)
  const [lCat,           setLCat]           = useState(resource.category)
  const [lDept,          setLDept]          = useState(resource.department)
  const [lCostAmount,    setLCostAmount]    = useState(resource.costAmount)
  const [lContactEmail,  setLContactEmail]  = useState(resource.contactEmail)
  const [lContactPhone,  setLContactPhone]  = useState(resource.contactPhone)
  const [lVendor,        setLVendor]        = useState(resource.vendor)

  useEffect(() => setLName(resource.name),                 [resource.name])
  useEffect(() => setLRole(resource.role),                 [resource.role])
  useEffect(() => setLCat(resource.category),              [resource.category])
  useEffect(() => setLDept(resource.department),           [resource.department])
  useEffect(() => setLCostAmount(resource.costAmount),     [resource.costAmount])
  useEffect(() => setLContactEmail(resource.contactEmail), [resource.contactEmail])
  useEffect(() => setLContactPhone(resource.contactPhone), [resource.contactPhone])
  useEffect(() => setLVendor(resource.vendor),             [resource.vendor])

  function commit(field, local, original) {
    if (local !== original) onUpdate(resource.id, field, local)
  }

  return (
    <Fragment>
      <tr className="gantt-resource-row">
        {/* ── Sticky name cell ─────────────────────────────────────────────────── */}
        <td className="gantt-name-td">
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
                onChange={e => setLName(e.target.value)}
                onBlur={() => commit('name', lName, resource.name)}
              />
              {activeTab === 'crew' ? (
                <input
                  className="gantt-input gantt-input-role"
                  value={lRole}
                  placeholder="Role"
                  onChange={e => setLRole(e.target.value)}
                  onBlur={() => commit('role', lRole, resource.role)}
                />
              ) : (
                <input
                  className="gantt-input gantt-input-role"
                  value={lCat}
                  placeholder="Category"
                  onChange={e => setLCat(e.target.value)}
                  onBlur={() => commit('category', lCat, resource.category)}
                />
              )}
              {activeTab === 'crew' && (
                <input
                  className="gantt-input gantt-input-dept"
                  value={lDept}
                  placeholder="Department"
                  onChange={e => setLDept(e.target.value)}
                  onBlur={() => commit('department', lDept, resource.department)}
                />
              )}
            </div>
            <div className="gantt-name-actions">
              <button className="btn-icon" onClick={() => onMoveUp(resource.id)}   title="Move up">↑</button>
              <button className="btn-icon" onClick={() => onMoveDown(resource.id)} title="Move down">↓</button>
              <button className="btn-icon danger" title="Delete"
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

          const booking    = bMap[`${resource.id}:${spec.date}`]
          const status     = booking?.status ?? null
          const isShootDay = shootDateSet.has(spec.date)

          const cls = [
            'gantt-cell',
            status ?? '',
            spec.shootDay?.isNonShootDay ? 'cell-nonshoot' : '',
            spec.isWeekend ? 'cell-weekend'  : '',
            spec.isToday   ? 'cell-today'    : '',
            !isShootDay    ? 'cell-no-shoot' : '',
          ].filter(Boolean).join(' ')

          return (
            <td
              key={spec.date}
              className={cls}
              onMouseDown={e => { e.preventDefault(); onCellMouseDown(resource.id, spec.date) }}
              onMouseEnter={() => onCellMouseEnter(resource.id, spec.date)}
              title={
                status
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

              {/* Crew: email + phone */}
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
                </>
              )}

              {/* Equipment: vendor */}
              {activeTab === 'equipment' && (
                <div className="details-group">
                  <label className="details-label">Vendor</label>
                  <input
                    className="details-input"
                    type="text"
                    value={lVendor}
                    placeholder="Vendor name"
                    onChange={e => setLVendor(e.target.value)}
                    onBlur={() => commit('vendor', lVendor, resource.vendor)}
                  />
                </div>
              )}

            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CrewGantt({ production, shootDays }) {
  const [activeTab,      setActiveTab]      = useState('crew')
  const [expandedPhases, setExpandedPhases] = useState({ prep: true, shoot: true, wrap: true })
  const [paintMode,      setPaintMode]      = useState('booked')   // the selected brush
  const [isDragging,     setIsDragging]     = useState(false)
  const [notices,        setNotices]        = useState([])

  const isDraggingRef  = useRef(false)
  const dragActionRef  = useRef(paintMode)   // the status being applied for the current drag
  const paintedInDrag  = useRef(new Set())   // keys painted this drag session
  const scrollRef      = useRef(null)        // gantt-scroll container
  const scrollInterval = useRef(null)

  const {
    loading, error,
    resources, bookings,
    addResource, deleteResource, updateResource,
    setBooking,
    moveResourceUp, moveResourceDown,
  } = useCrewStore()

  const today = todayStr()

  // ── Notices: detect newly-added shoot days ─────────────────────────────────

  useEffect(() => {
    const notified = getNotifiedIds()
    const newDays  = shootDays.filter(sd => !sd.isNonShootDay && !notified.has(sd.id))
    setNotices(newDays)
  }, [shootDays])

  function dismissNotice(id) {
    markIdsNotified([id])
    setNotices(n => n.filter(sd => sd.id !== id))
  }

  function dismissAllNotices() {
    markIdsNotified(notices.map(n => n.id))
    setNotices([])
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const hasPhases = PHASES.some(p => production[p.startKey] && production[p.endKey])

  // date → shootDay map (for column labels)
  const dateMap = {}
  for (const sd of shootDays) { if (sd.date) dateMap[sd.date] = sd }

  // Set of shoot-day dates that are NOT non-shoot (paint is allowed only here)
  const shootDateSet = new Set(
    shootDays.filter(sd => !sd.isNonShootDay).map(sd => sd.date)
  )

  const colSpecs = hasPhases
    ? buildColSpecs(production, expandedPhases, dateMap, today)
    : []

  // booking lookup: `${resourceId}:${dateStr}` → booking
  const bMap = {}
  for (const b of bookings) bMap[`${b.resourceId}:${b.date}`] = b

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
    setExpandedPhases(s => ({ ...s, [phaseId]: !s[phaseId] }))
  }

  function collapseBeforeToday() {
    setExpandedPhases(prev => {
      const next = { ...prev }
      for (const phase of PHASES) {
        const end = production[phase.endKey]
        if (end && end < today) next[phase.id] = false
      }
      return next
    })
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

  function handleCellMouseDown(resourceId, date) {
    isDraggingRef.current = true
    paintedInDrag.current = new Set()
    setIsDragging(true)

    // Determine what this drag session will apply
    const key      = `${resourceId}:${date}`
    const existing = bMap[key]
    dragActionRef.current = (existing?.status === paintMode) ? null : paintMode

    paintedInDrag.current.add(key)
    setBooking(resourceId, date, dragActionRef.current)
  }

  function handleCellMouseEnter(resourceId, date) {
    if (!isDraggingRef.current) return
    if (!shootDateSet.has(date)) return          // drag skips non-shoot days
    const key = `${resourceId}:${date}`
    if (paintedInDrag.current.has(key)) return
    paintedInDrag.current.add(key)
    setBooking(resourceId, date, dragActionRef.current)
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

  if (loading) return <div className="gantt-state-msg">Loading…</div>
  if (error)   return <div className="gantt-state-msg gantt-state-error">Error: {error}</div>

  const typeLabel = activeTab === 'crew' ? 'Crew Member' : 'Equipment'
  const activePaint = PAINT_MODES.find(m => m.value === paintMode)

  return (
    <div className="gantt-module-wrap">

      {/* ── New shoot-day notices ─────────────────────────────────────────────── */}
      {notices.length > 0 && (
        <div className="gantt-notices">
          <div className="gantt-notices-header">
            <span className="gantt-notices-title">
              ⚠ {notices.length} new shoot day{notices.length !== 1 ? 's' : ''} added
              — check crew &amp; equipment bookings
            </span>
            <button className="gantt-notices-dismiss-all" onClick={dismissAllNotices}>
              Dismiss all
            </button>
          </div>
          {notices.map(sd => (
            <div key={sd.id} className="gantt-notice">
              <span>
                <strong>D{sd.dayNumber} — {formatNoticeDate(sd.date)}</strong>
                {sd.location ? ` · ${sd.location}` : ''}
                <span className="gantt-notice-hint">
                  {' '}— check bookings for surrounding days too
                </span>
              </span>
              <button className="gantt-notice-dismiss" onClick={() => dismissNotice(sd.id)}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="gantt-top">

        <div className="gantt-tabs">
          <button className={`gantt-tab${activeTab === 'crew'      ? ' active' : ''}`}
            onClick={() => setActiveTab('crew')}>Crew</button>
          <button className={`gantt-tab${activeTab === 'equipment' ? ' active' : ''}`}
            onClick={() => setActiveTab('equipment')}>Equipment</button>
        </div>

        <div className="gantt-toolbar">
          {/* Add resource */}
          <button className="btn btn-primary btn-sm" onClick={() => addResource(activeTab)}>
            + Add {typeLabel}
          </button>

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
              <button className="btn btn-secondary btn-sm" onClick={collapseBeforeToday}>
                Collapse past
              </button>
            </div>
          )}

          {/* Legend */}
          <div className="gantt-legend">
            <span className="legend-item"><span className="legend-swatch booked" />Confirmed</span>
            <span className="legend-item"><span className="legend-swatch hold" />On Hold</span>
            <span className="legend-item"><span className="legend-swatch unavailable" />Unavailable</span>
            <span className="legend-item"><span className="legend-swatch cancelled" />Cancelled</span>
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
          <table className="gantt-table" onDragStart={e => e.preventDefault()}>

            <thead>
              <tr>
                <th className="gantt-name-th">
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
                  return (
                    <th key={spec.date}
                        className={[
                          'gantt-day-th',
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
                    <tr className="gantt-dept-row">
                      <td colSpan={colSpecs.length + 1}>{deptName}</td>
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
                        onUpdate={updateResource}
                        onDelete={deleteResource}
                        onMoveUp={moveResourceUp}
                        onMoveDown={moveResourceDown}
                        onPhaseToggle={togglePhase}
                      />
                    ))}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
