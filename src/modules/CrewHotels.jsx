import { useState, useEffect, useRef, useMemo } from 'react'
import { useAccommodationStore } from '../store/useAccommodationStore'
import { useFullCrewList }       from '../store/useFullCrewList'
import { useCrewPeopleStore }    from '../store/useCrewPeopleStore'
import { hotelColor }            from './HotelList'

// ─── Phase definitions ─────────────────────────────────────────────────────────

const PHASES = [
  { id: 'prep',  label: 'Pre-Prod', color: '#7c3aed', startKey: 'prepStartDate',  endKey: 'prepEndDate'  },
  { id: 'shoot', label: 'Shoot',    color: '#2563eb', startKey: 'shootStartDate', endKey: 'shootEndDate' },
  { id: 'wrap',  label: 'Wrap',     color: '#16a34a', startKey: 'wrapStartDate',  endKey: 'wrapEndDate'  },
]

// ─── Date helpers ──────────────────────────────────────────────────────────────

function ds(d) {
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}

function eachDay(startStr, endStr) {
  if (!startStr || !endStr) return []
  const result = []
  const cur = new Date(startStr + 'T00:00:00')
  const end = new Date(endStr   + 'T00:00:00')
  while (cur <= end) {
    result.push(ds(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return result
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return ds(d)
}

function todayStr() { return ds(new Date()) }

function fmtShort(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

// Keyboard shortcuts: ` = eraser (clear), T = TBC, 1–9/0/-/= = hotels
const KEY_TO_SELECTION = {
  '`': 'clear',
  't': 'TBC', 'T': 'TBC',
  '1': 0, '2': 1, '3': 2, '4': 3, '5': 4,
  '6': 5, '7': 6, '8': 7, '9': 8, '0': 9,
  '-': 10, '=': 11,
}

const HOTEL_KEYS = ['1','2','3','4','5','6','7','8','9','0','-','=']

// ─── Column spec builder ───────────────────────────────────────────────────────

function buildColSpecs(production, collapsedPhases, collapsePast, today) {
  const specs = []
  for (const phase of PHASES) {
    const start = production[phase.startKey]
    const end   = production[phase.endKey]
    if (!start || !end) continue

    if (collapsedPhases[phase.id]) {
      specs.push({ type: 'collapsed', phaseId: phase.id, label: phase.label, color: phase.color })
      continue
    }

    const days    = eachDay(start, end)
    const visible = collapsePast ? days.filter(d => d >= today) : days

    if (visible.length === 0) {
      specs.push({ type: 'collapsed', phaseId: phase.id, label: phase.label, color: phase.color, pastOnly: true })
      continue
    }

    for (const date of visible) {
      const d = new Date(date + 'T00:00:00')
      specs.push({
        type:      'day',
        date,
        phaseId:   phase.id,
        phaseColor: phase.color,
        wday:      d.toLocaleDateString('en-GB', { weekday: 'short' }),
        day:       String(d.getDate()).padStart(2, '0'),
        month:     d.toLocaleDateString('en-GB', { month: 'short' }),
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
        isMonday:  d.getDay() === 1,
        isToday:   date === today,
      })
    }
  }
  return specs
}

function buildPhaseSpans(colSpecs) {
  const spans = []
  for (const spec of colSpecs) {
    const last = spans[spans.length - 1]
    if (last && last.phaseId === spec.phaseId) {
      last.count++
    } else {
      const phase = PHASES.find(p => p.id === spec.phaseId)
      spans.push({
        phaseId: spec.phaseId, label: phase.label, color: phase.color,
        count: 1, isCollapsed: spec.type === 'collapsed',
      })
    }
  }
  return spans
}

// ─── Derived stay summary from its nights ──────────────────────────────────────

function deriveStay(stay, stayNights) {
  const valued = stayNights
    .filter(n => n.hotelId || n.tbc)
    .map(n => n.date)
    .sort()
  if (valued.length === 0) {
    return { checkIn: '', checkOut: '', totalNights: 0, totalCost: 0 }
  }
  const checkIn  = valued[0]
  const checkOut = addDays(valued[valued.length - 1], 1)
  const totalNights = valued.length
  const totalCost   = totalNights * (Number(stay.costPerNight) || 0)
  return { checkIn, checkOut, totalNights, totalCost }
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function AccommodationLog({ production, castMembers = [] }) {
  const {
    hotels, stays, nights, loading: accLoading,
    addStay, updateStay, deleteStay, setNight,
  } = useAccommodationStore()
  const { members: ftMembers, loading: ftLoading } = useFullCrewList()
  const { people, loading: peopleLoading, findOrCreatePerson } = useCrewPeopleStore()

  // selection: 'clear' | 'TBC' | hotel index number
  const [selection, setSelection] = useState('TBC')
  const [collapsedPhases, setCollapsedPhases] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fm_accom_phases') ?? '{}') } catch { return {} }
  })
  const [collapsePast, setCollapsePast] = useState(
    () => localStorage.getItem('fm_accom_past') === 'true'
  )

  const isDraggingRef = useRef(false)
  const dragActionRef = useRef(null)   // value locked in for the whole drag session
  const paintedInDrag = useRef(new Set())
  const scrollRef     = useRef(null)
  const scrollTimer   = useRef(null)
  const scrollDone    = useRef(false)

  const selectionRef = useRef(selection)
  const hotelsRef    = useRef(hotels)
  const nightMapRef  = useRef({})
  useEffect(() => { selectionRef.current = selection }, [selection])
  useEffect(() => { hotelsRef.current = hotels },       [hotels])

  const loading = accLoading
  const today   = todayStr()

  const colSpecs   = useMemo(
    () => buildColSpecs(production, collapsedPhases, collapsePast, today),
    [production, collapsedPhases, collapsePast, today]
  )
  const phaseSpans = useMemo(() => buildPhaseSpans(colSpecs), [colSpecs])

  // nights grouped by stay; map `${stayId}|${date}` → night
  const nightsByStay = useMemo(() => {
    const m = {}
    for (const n of nights) {
      if (!m[n.stayId]) m[n.stayId] = []
      m[n.stayId].push(n)
    }
    return m
  }, [nights])

  const nightMap = useMemo(() => {
    const m = {}
    for (const n of nights) m[`${n.stayId}|${n.date}`] = n
    return m
  }, [nights])
  useEffect(() => { nightMapRef.current = nightMap }, [nightMap])

  // Group stays by department (Unassigned last)
  const staysByDept = useMemo(() => {
    const m = {}
    for (const s of stays) {
      const d = (s.department || '').trim() || 'Unassigned'
      if (!m[d]) m[d] = []
      m[d].push(s)
    }
    return Object.entries(m).sort(([a], [b]) =>
      a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b)
    )
  }, [stays])

  // Keyboard shortcuts (only when not editing an input)
  useEffect(() => {
    function onKeyDown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const sel = KEY_TO_SELECTION[e.key]
      if (sel === undefined) return
      if (typeof sel === 'number' && sel >= hotels.length) return
      e.preventDefault()
      setSelection(sel)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hotels.length])

  useEffect(() => {
    function stop() {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      paintedInDrag.current = new Set()
    }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  useEffect(() => {
    if (loading || scrollDone.current) return
    const saved = localStorage.getItem('fm_accom_scroll')
    if (saved && scrollRef.current) {
      try {
        const [left, top] = JSON.parse(saved)
        scrollRef.current.scrollLeft = left
        scrollRef.current.scrollTop  = top
        scrollDone.current = true
      } catch { /* ignore */ }
    }
  }, [loading])

  function onGanttScroll() {
    clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      if (scrollRef.current) {
        localStorage.setItem('fm_accom_scroll', JSON.stringify([
          scrollRef.current.scrollLeft,
          scrollRef.current.scrollTop,
        ]))
      }
    }, 150)
  }

  // Resolve a selection value into the value passed to setNight
  function selectionToValue(sel) {
    if (sel === 'clear') return null
    if (sel === 'TBC')   return 'TBC'
    return hotelsRef.current[sel]?.id ?? null
  }

  function onCellMouseDown(stayId, date) {
    isDraggingRef.current = true
    paintedInDrag.current = new Set()

    const sel   = selectionRef.current
    const value = selectionToValue(sel)
    const key   = `${stayId}|${date}`

    // Toggle off if the same value is already painted
    const existing = nightMapRef.current[key]
    let same = false
    if (value === null)      same = false
    else if (value === 'TBC') same = existing && existing.tbc
    else                      same = existing && existing.hotelId === value

    dragActionRef.current = same ? null : value
    paintedInDrag.current.add(key)
    setNight(stayId, date, dragActionRef.current)
  }

  function onCellMouseEnter(stayId, date) {
    if (!isDraggingRef.current) return
    const key = `${stayId}|${date}`
    if (paintedInDrag.current.has(key)) return
    paintedInDrag.current.add(key)
    setNight(stayId, date, dragActionRef.current)
  }

  function togglePhase(phaseId) {
    setCollapsedPhases(prev => {
      const next = { ...prev, [phaseId]: !prev[phaseId] }
      localStorage.setItem('fm_accom_phases', JSON.stringify(next))
      return next
    })
  }

  function handleCollapsePast() {
    setCollapsePast(v => {
      localStorage.setItem('fm_accom_past', String(!v))
      return !v
    })
  }

  // ── Empty / loading states ─────────────────────────────────────────────────────

  if (!production.prepStartDate && !production.shootStartDate) {
    return (
      <div className="ftc-empty">
        <div className="ftc-empty-icon">📅</div>
        <div className="ftc-empty-title">No dates set</div>
        <div className="ftc-empty-sub">Set your production dates in Project Setup first.</div>
      </div>
    )
  }

  if (loading || ftLoading || peopleLoading) return <div className="ftc-state">Loading…</div>

  const colCount = colSpecs.length

  return (
    <div className="ch-wrap">

      {/* ── Palette toolbar ───────────────────────────────────────────────────── */}
      <div className="ch-palette">

        {/* Eraser */}
        <button
          className={`ch-palette-btn ch-palette-btn--clear${selection === 'clear' ? ' is-active' : ''}`}
          title="Clear night (` key)"
          onClick={() => setSelection('clear')}
        >
          <span className="ch-palette-icon">○</span>
          <span className="ch-palette-label">Clear</span>
          <span className="ch-palette-key">`</span>
        </button>

        {/* TBC */}
        <button
          className={`ch-palette-btn accom-palette-tbc${selection === 'TBC' ? ' is-active' : ''}`}
          title="Mark unbooked night (T key)"
          onClick={() => setSelection('TBC')}
        >
          <span className="ch-palette-swatch accom-tbc-swatch" />
          <span className="ch-palette-label">TBC</span>
          <span className="ch-palette-key">T</span>
        </button>

        {/* Hotels */}
        {hotels.map((hotel, i) => {
          const color    = hotelColor(i)
          const keyLabel = HOTEL_KEYS[i] ?? null
          return (
            <button
              key={hotel.id}
              className={`ch-palette-btn${selection === i ? ' is-active' : ''}`}
              style={{ '--hotel-color': color }}
              onClick={() => setSelection(i)}
            >
              <span className="ch-palette-swatch" style={{ background: color }} />
              <span className="ch-palette-label">
                {hotel.code ? `${hotel.code} · ` : ''}{hotel.name || `Hotel ${i + 1}`}
              </span>
              {keyLabel && <span className="ch-palette-key">{keyLabel}</span>}
            </button>
          )
        })}

        <div className="ch-palette-sep" />

        <button
          className={`ch-ctrl-btn${collapsePast ? ' is-active' : ''}`}
          onClick={handleCollapsePast}
          title={collapsePast ? 'Show past dates' : 'Hide dates before today'}
        >
          {collapsePast ? '◀ Past hidden' : '◀ Hide past'}
        </button>

        <div className="ch-palette-hint">
          {hotels.length === 0
            ? 'Add hotels in the Hotel List to paint real bookings'
            : selection === 'clear' ? 'Click or drag to clear'
            : selection === 'TBC'   ? 'Painting: TBC (unbooked)'
            : `Painting: ${hotels[selection]?.name || `Hotel ${selection + 1}`}`}
        </div>
      </div>

      {/* ── Gantt table ──────────────────────────────────────────────────────── */}
      <div className="ch-gantt-outer" ref={scrollRef} onScroll={onGanttScroll}>
        <table className="ch-gantt accom-gantt" draggable="false">
          <colgroup>
            <col className="accom-col-info" />
            {colSpecs.map((spec, i) => (
              <col
                key={spec.type === 'day' ? spec.date + i : `${spec.phaseId}-col-${i}`}
                className={spec.type === 'collapsed' ? 'ch-col-phase' : 'ch-col-date'}
              />
            ))}
          </colgroup>

          <thead>
            {/* Row 1: Phase group headers */}
            <tr className="ch-phase-row">
              <th className="accom-th-info ch-th-corner">
                <div className="accom-info-head">
                  <span>TMO #</span><span>Job Title</span><span>Name</span>
                  <span>Room / Conf.</span><span>£/Night</span>
                  <span>In</span><span>Out</span><span>Nts</span><span>Total</span>
                  <span>Cost Code</span><span>PO #</span><span>Note</span><span></span>
                </div>
              </th>
              {phaseSpans.map(span => (
                <th
                  key={span.phaseId}
                  colSpan={span.count}
                  className="ch-ph-th"
                  style={{ '--phase-color': span.color }}
                >
                  <button
                    className="ch-phase-toggle"
                    onClick={() => togglePhase(span.phaseId)}
                    title={span.isCollapsed ? `Expand ${span.label}` : `Collapse ${span.label}`}
                  >
                    <span className="ch-phase-arrow">{span.isCollapsed ? '▸' : '▾'}</span>
                    {span.label}
                  </button>
                </th>
              ))}
            </tr>

            {/* Row 2: Individual date headers */}
            <tr className="ch-header-row">
              <th className="accom-th-info" />
              {colSpecs.map((spec, i) => {
                if (spec.type === 'collapsed') {
                  return (
                    <th
                      key={`${spec.phaseId}-hdr-${i}`}
                      className="ch-th-collapsed"
                      style={{ '--phase-color': spec.color }}
                    >
                      <span className="ch-th-collapsed-label">···</span>
                    </th>
                  )
                }
                return (
                  <th
                    key={spec.date + i}
                    className={[
                      'ch-th-date',
                      spec.isWeekend ? 'ch-th--weekend' : '',
                      spec.isMonday  ? 'ch-th--monday'  : '',
                      spec.isToday   ? 'ch-th--today'   : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <div className="ch-th-wday">{spec.wday}</div>
                    <div className="ch-th-day">{spec.day}</div>
                    <div className="ch-th-month">{spec.month}</div>
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {stays.length === 0 && (
              <tr>
                <td colSpan={colCount + 1} className="accom-empty-cell">
                  <div className="accom-empty">
                    No stays yet. Add a stay to start logging accommodation.
                  </div>
                </td>
              </tr>
            )}

            {staysByDept.map(([dept, deptStays]) => (
              <DepartmentGroup
                key={dept}
                dept={dept}
                deptStays={deptStays}
                colSpecs={colSpecs}
                colCount={colCount}
                hotels={hotels}
                nightsByStay={nightsByStay}
                nightMap={nightMap}
                ftMembers={ftMembers}
                castMembers={castMembers}
                people={people}
                onAddStay={addStay}
                onUpdateStay={updateStay}
                onDeleteStay={deleteStay}
                onCreatePerson={findOrCreatePerson}
                onCellMouseDown={onCellMouseDown}
                onCellMouseEnter={onCellMouseEnter}
              />
            ))}

            {/* Global add-stay row */}
            <tr className="accom-add-row">
              <td colSpan={colCount + 1}>
                <AddStayInline
                  department=""
                  ftMembers={ftMembers}
                  castMembers={castMembers}
                  people={people}
                  onAddStay={addStay}
                  onCreatePerson={findOrCreatePerson}
                  label="+ Add stay"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Department group (header + its stay rows + dept add button) ────────────────

function DepartmentGroup({
  dept, deptStays, colSpecs, colCount, hotels,
  nightsByStay, nightMap, ftMembers, castMembers, people,
  onAddStay, onUpdateStay, onDeleteStay, onCreatePerson,
  onCellMouseDown, onCellMouseEnter,
}) {
  return (
    <>
      <tr className="ch-section-row">
        <td colSpan={colCount + 1}><span className="ch-section-label">{dept}</span></td>
      </tr>
      {deptStays.map(stay => (
        <StayRow
          key={stay.id}
          stay={stay}
          colSpecs={colSpecs}
          hotels={hotels}
          stayNights={nightsByStay[stay.id] ?? []}
          nightMap={nightMap}
          onUpdate={onUpdateStay}
          onDelete={onDeleteStay}
          onCellMouseDown={onCellMouseDown}
          onCellMouseEnter={onCellMouseEnter}
        />
      ))}
      <tr className="accom-add-row accom-add-row--dept">
        <td colSpan={colCount + 1}>
          <AddStayInline
            department={dept === 'Unassigned' ? '' : dept}
            ftMembers={ftMembers}
            castMembers={castMembers}
            people={people}
            onAddStay={onAddStay}
            onCreatePerson={onCreatePerson}
            label={`+ Add to ${dept}`}
          />
        </td>
      </tr>
    </>
  )
}

// ─── Stay row — frozen info columns + gantt cells ───────────────────────────────

function StayRow({
  stay, colSpecs, hotels, stayNights, nightMap,
  onUpdate, onDelete, onCellMouseDown, onCellMouseEnter,
}) {
  // Local state for editable fields (commit on blur to avoid focus loss)
  const [lName,     setLName]     = useState(stay.name)
  const [lJob,      setLJob]      = useState(stay.jobTitle)
  const [lRoom,     setLRoom]     = useState(stay.roomType)
  const [lCost,     setLCost]     = useState(stay.costPerNight ?? '')
  const [lCostCode, setLCostCode] = useState(stay.costCode)
  const [lPo,       setLPo]       = useState(stay.poNumber)
  const [lTmo,      setLTmo]      = useState(stay.tmoNumber)
  const [lNote,     setLNote]     = useState(stay.note)

  useEffect(() => setLName(stay.name),               [stay.name])
  useEffect(() => setLJob(stay.jobTitle),            [stay.jobTitle])
  useEffect(() => setLRoom(stay.roomType),           [stay.roomType])
  useEffect(() => setLCost(stay.costPerNight ?? ''), [stay.costPerNight])
  useEffect(() => setLCostCode(stay.costCode),       [stay.costCode])
  useEffect(() => setLPo(stay.poNumber),             [stay.poNumber])
  useEffect(() => setLTmo(stay.tmoNumber),           [stay.tmoNumber])
  useEffect(() => setLNote(stay.note),               [stay.note])

  const derived = useMemo(() => deriveStay(stay, stayNights), [stay, stayNights])

  function commit(field, local, original) {
    if (local !== original) onUpdate(stay.id, field, local)
  }
  function commitCost() {
    const v = lCost === '' ? null : Number(lCost)
    if (v !== stay.costPerNight) onUpdate(stay.id, 'costPerNight', v)
  }

  return (
    <tr className="ch-crew-row accom-stay-row">
      <td className="accom-td-info">
        <div className="accom-info-grid">
          <input className="accom-inp accom-inp--tmo" value={lTmo} placeholder="TMO#"
            onChange={e => setLTmo(e.target.value)} onBlur={() => commit('tmoNumber', lTmo, stay.tmoNumber)} />
          <input className="accom-inp accom-inp--job" value={lJob} placeholder="Job title"
            onChange={e => setLJob(e.target.value)} onBlur={() => commit('jobTitle', lJob, stay.jobTitle)} />
          <input className="accom-inp accom-inp--name" value={lName} placeholder="Name"
            onChange={e => setLName(e.target.value)} onBlur={() => commit('name', lName, stay.name)} />
          <input className="accom-inp accom-inp--room" value={lRoom} placeholder="Room / conf."
            onChange={e => setLRoom(e.target.value)} onBlur={() => commit('roomType', lRoom, stay.roomType)} />
          <input className="accom-inp accom-inp--cost" type="number" min="0" step="0.01" value={lCost} placeholder="0"
            onChange={e => setLCost(e.target.value)} onBlur={commitCost} />
          <span className="accom-derived" title="Check in">{fmtShort(derived.checkIn) || '—'}</span>
          <span className="accom-derived" title="Check out">{fmtShort(derived.checkOut) || '—'}</span>
          <span className="accom-derived accom-derived--num" title="Total nights">{derived.totalNights}</span>
          <span className="accom-derived accom-derived--num" title="Total cost">
            {derived.totalCost ? derived.totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
          </span>
          <input className="accom-inp accom-inp--code" value={lCostCode} placeholder="Code"
            onChange={e => setLCostCode(e.target.value)} onBlur={() => commit('costCode', lCostCode, stay.costCode)} />
          <input className="accom-inp accom-inp--po" value={lPo} placeholder="PO#"
            onChange={e => setLPo(e.target.value)} onBlur={() => commit('poNumber', lPo, stay.poNumber)} />
          <input className="accom-inp accom-inp--note" value={lNote} placeholder="Note"
            onChange={e => setLNote(e.target.value)} onBlur={() => commit('note', lNote, stay.note)} />
          <button className="accom-del-btn" title="Delete stay"
            onClick={() => { if (window.confirm(`Delete stay for "${stay.name || 'this person'}"?`)) onDelete(stay.id) }}>✕</button>
        </div>
      </td>

      {colSpecs.map((spec, i) => {
        if (spec.type === 'collapsed') {
          return (
            <td key={`${spec.phaseId}-cell-${i}`}
              className="ch-td-cell ch-td-phase-collapsed"
              style={{ '--phase-color': spec.color }} />
          )
        }

        const { date, isWeekend, isMonday, isToday } = spec
        const night    = nightMap[`${stay.id}|${date}`]
        const isTbc    = night?.tbc
        const hotelId  = night?.hotelId
        const hotel    = hotelId ? hotels.find(h => h.id === hotelId) : null
        const hotelIdx = hotel ? hotels.indexOf(hotel) : -1
        const color    = hotel ? hotelColor(hotelIdx) : null

        return (
          <td
            key={date + i}
            className={[
              'ch-td-cell', 'ch-td-cell--valid',
              hotel   ? 'ch-td-cell--filled' : '',
              isTbc   ? 'accom-cell--tbc'    : '',
              isWeekend ? 'ch-td-cell--weekend' : '',
              isToday   ? 'ch-td-cell--today'   : '',
              isMonday  ? 'ch-td-cell--monday'  : '',
            ].filter(Boolean).join(' ')}
            style={color ? { background: color + '33', borderColor: color } : {}}
            onMouseDown={e => { e.preventDefault(); onCellMouseDown(stay.id, date) }}
            onMouseEnter={() => onCellMouseEnter(stay.id, date)}
          >
            {hotel && (
              <div className="ch-cell-label" style={{ color }}>
                {hotel.code || (hotel.name ? hotel.name.slice(0, 3).toUpperCase() : `H${hotelIdx + 1}`)}
              </div>
            )}
            {isTbc && <div className="ch-cell-label accom-cell-label--tbc">TBC</div>}
          </td>
        )
      })}
    </tr>
  )
}

// ─── Inline add-stay row with searchable person dropdown ────────────────────────

function AddStayInline({
  department, ftMembers, castMembers, people,
  onAddStay, onCreatePerson, label,
}) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')

  // Build combined searchable options
  const options = useMemo(() => {
    const opts = []
    for (const c of castMembers) {
      opts.push({
        key: `cast-${c.id}`, source: 'cast', personId: c.id, personType: 'cast',
        name: c.name || '', jobTitle: c.role || '', department: '',
      })
    }
    for (const p of people) {
      // crew dept/role best-effort from fulltime list
      const ft = ftMembers.find(m => m.name && p.name && m.name.toLowerCase() === p.name.toLowerCase())
      opts.push({
        key: `crew-${p.id}`, source: 'crew', personId: p.id, personType: 'crew',
        name: p.name || '', jobTitle: ft?.role || '', department: ft?.department || '',
      })
    }
    return opts
  }, [castMembers, people, ftMembers])

  const filtered = query.trim()
    ? options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    : options
  const exactMatch = options.some(o => o.name.toLowerCase() === query.trim().toLowerCase())

  function reset() { setQuery(''); setOpen(false) }

  async function pick(opt) {
    await onAddStay({
      personId:   opt.personId,
      personType: opt.personType,
      name:       opt.name,
      jobTitle:   opt.jobTitle,
      department: department || opt.department || '',
    })
    reset()
  }

  async function createNew() {
    const name = query.trim()
    if (!name) return
    const personId = await onCreatePerson({ name })
    await onAddStay({
      personId, personType: 'crew',
      name, jobTitle: '', department: department || '',
    })
    reset()
  }

  if (!open) {
    return (
      <button className="accom-addstay-trigger" onClick={() => setOpen(true)}>{label}</button>
    )
  }

  return (
    <div className="accom-addstay">
      <div className="accom-addstay-search">
        <input
          className="accom-inp accom-addstay-input"
          value={query}
          autoFocus
          placeholder="Search cast or crew, or type a new name…"
          onChange={e => setQuery(e.target.value)}
          onBlur={() => setTimeout(reset, 150)}
        />
        <div className="cast-dropdown accom-person-dropdown">
          {filtered.slice(0, 12).map(opt => (
            <div
              key={opt.key}
              className="cast-dropdown-item accom-person-item"
              onMouseDown={e => { e.preventDefault(); pick(opt) }}
            >
              <span className={`accom-person-tag accom-person-tag--${opt.source}`}>
                {opt.source === 'cast' ? 'Cast' : 'Crew'}
              </span>
              <span className="cast-dropdown-name">{opt.name || '(unnamed)'}</span>
              {opt.jobTitle && <span className="cast-dropdown-role">{opt.jobTitle}</span>}
            </div>
          ))}
          {query.trim() && !exactMatch && (
            <div
              className="cast-dropdown-item accom-person-item accom-person-create"
              onMouseDown={e => { e.preventDefault(); createNew() }}
            >
              + Add &ldquo;{query.trim()}&rdquo; to crew database
            </div>
          )}
          {filtered.length === 0 && !query.trim() && (
            <div className="cast-dropdown-empty">No cast or crew yet — type a name to add one.</div>
          )}
        </div>
      </div>
    </div>
  )
}
