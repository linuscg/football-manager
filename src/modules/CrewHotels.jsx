import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAccommodationStore } from '../store/useAccommodationStore'
import { useFulltimeCrewStore }  from '../store/useFulltimeCrewStore'
import { useCrewStore }          from '../store/useCrewStore'
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

// Keyboard shortcuts: ` = eraser (-1), 1–9 = 0–8, 0 = 9, - = 10, = = 11
const KEY_TO_INDEX = {
  '`': -1,
  '1': 0, '2': 1, '3': 2, '4': 3, '5': 4,
  '6': 5, '7': 6, '8': 7, '9': 8, '0': 9,
  '-': 10, '=': 11,
}

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
      // Phase exists but all dates are hidden by collapsePast → compact placeholder
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

// Group colSpecs into phase header spans for the top row
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

// ─── Main component ────────────────────────────────────────────────────────────

export default function CastCrewHotels({ production, shootDays = [], castMembers = [] }) {
  const { hotels, assignments, loading: accLoading, setAssignment } = useAccommodationStore()
  const { members: ftMembers,  loading: ftLoading  } = useFulltimeCrewStore()
  const { resources, bookings, loading: crewLoading } = useCrewStore()

  const [selectedIdx, setSelectedIdx] = useState(0)
  const [collapsedPhases, setCollapsedPhases] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fm_ch_phases') ?? '{}') } catch { return {} }
  })
  const [collapsePast, setCollapsePast] = useState(
    () => localStorage.getItem('fm_ch_past') === 'true'
  )

  const isPainting  = useRef(false)
  const scrollRef   = useRef(null)
  const scrollTimer = useRef(null)
  const scrollDone  = useRef(false)

  // Always-fresh refs so callbacks never go stale
  const selectedIdxRef = useRef(selectedIdx)
  const hotelsRef      = useRef(hotels)
  const assignMapRef   = useRef({})           // initialised empty; updated after useMemo below
  selectedIdxRef.current = selectedIdx
  hotelsRef.current      = hotels

  const loading = accLoading || ftLoading || crewLoading
  const today   = todayStr()

  // Column specs
  const colSpecs   = useMemo(
    () => buildColSpecs(production, collapsedPhases, collapsePast, today),
    [production, collapsedPhases, collapsePast, today]
  )
  const phaseSpans = useMemo(() => buildPhaseSpans(colSpecs), [colSpecs])

  // Assignment lookup: `${crewId}|${crewType}|${date}` → hotelId
  const assignMap = useMemo(() => {
    const m = {}
    for (const a of assignments) m[`${a.crewId}|${a.crewType}|${a.date}`] = a.hotelId
    return m
  }, [assignments])

  // Keep ref in sync (must be after assignMap useMemo)
  assignMapRef.current = assignMap

  // Additional crew valid dates (booked dates ±1)
  const additionalValidDates = useMemo(() => {
    const v = {}
    for (const bk of bookings) {
      if (!v[bk.resourceId]) v[bk.resourceId] = new Set()
      v[bk.resourceId].add(bk.date)
      v[bk.resourceId].add(addDays(bk.date, -1))
      v[bk.resourceId].add(addDays(bk.date, 1))
    }
    return v
  }, [bookings])

  // Cast valid dates: dates they appear in scenes ±1
  const castValidDates = useMemo(() => {
    const v = {}
    for (const day of shootDays) {
      if (!day.date) continue
      for (const scene of day.scenes) {
        for (const castId of scene.castMemberIds) {
          if (!v[castId]) v[castId] = new Set()
          v[castId].add(day.date)
          v[castId].add(addDays(day.date, -1))
          v[castId].add(addDays(day.date, 1))
        }
      }
    }
    return v
  }, [shootDays])

  // Group fulltime crew by dept
  const ftByDept = useMemo(() => {
    const m = {}
    for (const mem of ftMembers) {
      const d = mem.department || 'Unassigned'
      if (!m[d]) m[d] = []
      m[d].push(mem)
    }
    return m
  }, [ftMembers])

  // Group additional crew by dept
  const addByDept = useMemo(() => {
    const m = {}
    for (const r of resources.filter(r => r.type === 'crew')) {
      const d = r.department || 'Unassigned'
      if (!m[d]) m[d] = []
      m[d].push(r)
    }
    return m
  }, [resources])

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const idx = KEY_TO_INDEX[e.key]
      if (idx === undefined) return
      e.preventDefault()
      setSelectedIdx(idx)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Stop painting on mouseup
  useEffect(() => {
    const stop = () => { isPainting.current = false }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  // Restore scroll position once data has loaded and the table is rendered
  useEffect(() => {
    if (loading || scrollDone.current) return
    const saved = localStorage.getItem('fm_ch_scroll')
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
        localStorage.setItem('fm_ch_scroll', JSON.stringify([
          scrollRef.current.scrollLeft,
          scrollRef.current.scrollTop,
        ]))
      }
    }, 150)
  }

  // Use refs so callbacks are always stable and never stale
  const onCellMouseDown = useCallback((crewId, crewType, date) => {
    isPainting.current = true
    const idx     = selectedIdxRef.current
    const hotelId = idx === -1 ? null : (hotelsRef.current[idx]?.id ?? null)
    const key     = `${crewId}|${crewType}|${date}`
    if (hotelId === null) {
      // Clear mode: always erase
      setAssignment(crewId, crewType, date, null)
    } else if (assignMapRef.current[key] === hotelId) {
      // Same hotel already painted: toggle off
      setAssignment(crewId, crewType, date, null)
    } else {
      setAssignment(crewId, crewType, date, hotelId)
    }
  }, [setAssignment])

  const onCellMouseEnter = useCallback((crewId, crewType, date) => {
    if (!isPainting.current) return
    const idx     = selectedIdxRef.current
    const hotelId = idx === -1 ? null : (hotelsRef.current[idx]?.id ?? null)
    setAssignment(crewId, crewType, date, hotelId)
  }, [setAssignment])

  function togglePhase(phaseId) {
    setCollapsedPhases(prev => {
      const next = { ...prev, [phaseId]: !prev[phaseId] }
      localStorage.setItem('fm_ch_phases', JSON.stringify(next))
      return next
    })
  }

  function handleCollapsePast() {
    setCollapsePast(v => {
      localStorage.setItem('fm_ch_past', String(!v))
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

  if (hotels.length === 0) {
    return (
      <div className="ftc-empty">
        <div className="ftc-empty-icon">🏨</div>
        <div className="ftc-empty-title">No hotels yet</div>
        <div className="ftc-empty-sub">Add hotels in the Hotel List tab first.</div>
      </div>
    )
  }

  if (loading) return <div className="ftc-state">Loading…</div>

  const hasFulltime   = ftMembers.length > 0
  const hasAdditional = resources.filter(r => r.type === 'crew').length > 0
  const hasCast       = castMembers.length > 0

  if (!hasFulltime && !hasAdditional && !hasCast) {
    return (
      <div className="ftc-empty">
        <div className="ftc-empty-icon">👥</div>
        <div className="ftc-empty-title">No crew or cast yet</div>
        <div className="ftc-empty-sub">Add crew in Fulltime Crew or the Crew Gantt, and cast in the Schedule.</div>
      </div>
    )
  }

  const selectedHotel = selectedIdx === -1 ? null : hotels[selectedIdx]
  const colCount      = colSpecs.length

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div className="ch-wrap">

      {/* ── Palette toolbar ───────────────────────────────────────────────────── */}
      <div className="ch-palette">

        {/* Eraser */}
        <button
          className={`ch-palette-btn ch-palette-btn--clear${selectedIdx === -1 ? ' is-active' : ''}`}
          title="Clear hotel (` key)"
          onClick={() => setSelectedIdx(-1)}
        >
          <span className="ch-palette-icon">○</span>
          <span className="ch-palette-label">Clear</span>
          <span className="ch-palette-key">`</span>
        </button>

        {/* Hotels */}
        {hotels.map((hotel, i) => {
          const color    = hotelColor(i)
          const KEYS     = ['1','2','3','4','5','6','7','8','9','0','-','=']
          const keyLabel = KEYS[i] ?? null
          return (
            <button
              key={hotel.id}
              className={`ch-palette-btn${selectedIdx === i ? ' is-active' : ''}`}
              style={{ '--hotel-color': color }}
              onClick={() => setSelectedIdx(i)}
            >
              <span className="ch-palette-swatch" style={{ background: color }} />
              <span className="ch-palette-label">{hotel.name || `Hotel ${i + 1}`}</span>
              {keyLabel && <span className="ch-palette-key">{keyLabel}</span>}
            </button>
          )
        })}

        <div className="ch-palette-sep" />

        {/* Collapse-past toggle */}
        <button
          className={`ch-ctrl-btn${collapsePast ? ' is-active' : ''}`}
          onClick={handleCollapsePast}
          title={collapsePast ? 'Show past dates' : 'Hide dates before today'}
        >
          {collapsePast ? '◀ Past hidden' : '◀ Hide past'}
        </button>

        <div className="ch-palette-hint">
          {selectedIdx === -1
            ? 'Click or drag to clear'
            : `Painting: ${selectedHotel?.name || `Hotel ${selectedIdx + 1}`}`}
        </div>
      </div>

      {/* ── Gantt table ──────────────────────────────────────────────────────── */}
      <div className="ch-gantt-outer" ref={scrollRef} onScroll={onGanttScroll}>
        <table
          className="ch-gantt"
          onMouseLeave={() => { isPainting.current = false }}
        >
          <colgroup>
            <col className="ch-col-name" />
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
              <th className="ch-th-name ch-th-corner" />
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
              <th className="ch-th-name" />
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

            {/* ── Fulltime crew ── */}
            {hasFulltime && (
              <>
                <tr className="ch-section-row">
                  <td colSpan={colCount + 1}><span className="ch-section-label">Fulltime Crew</span></td>
                </tr>
                {Object.entries(ftByDept)
                  .sort(([a], [b]) => a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b))
                  .map(([dept, members]) =>
                    members.map((m, mi) => (
                      <CrewRow
                        key={m.id}
                        name={m.name} role={m.role}
                        dept={mi === 0 ? dept : null}
                        crewId={m.id} crewType="fulltime"
                        colSpecs={colSpecs}
                        validDates={null}
                        assignMap={assignMap} hotels={hotels}
                        onMouseDown={onCellMouseDown}
                        onMouseEnter={onCellMouseEnter}
                      />
                    ))
                  )
                }
              </>
            )}

            {/* ── Additional crew ── */}
            {hasAdditional && (
              <>
                <tr className="ch-section-row">
                  <td colSpan={colCount + 1}><span className="ch-section-label">Additional Crew</span></td>
                </tr>
                {Object.entries(addByDept)
                  .sort(([a], [b]) => a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b))
                  .map(([dept, deptResources]) =>
                    deptResources.map((r, ri) => (
                      <CrewRow
                        key={r.id}
                        name={r.name} role={r.role}
                        dept={ri === 0 ? dept : null}
                        crewId={r.id} crewType="additional"
                        colSpecs={colSpecs}
                        validDates={additionalValidDates[r.id] ?? new Set()}
                        assignMap={assignMap} hotels={hotels}
                        onMouseDown={onCellMouseDown}
                        onMouseEnter={onCellMouseEnter}
                      />
                    ))
                  )
                }
              </>
            )}

            {/* ── Cast ── */}
            {hasCast && (
              <>
                <tr className="ch-section-row">
                  <td colSpan={colCount + 1}><span className="ch-section-label">Cast</span></td>
                </tr>
                {[...castMembers]
                  .sort((a, b) => (a.castNumber ?? 9999) - (b.castNumber ?? 9999))
                  .map(c => (
                    <CrewRow
                      key={c.id}
                      name={c.name} role={c.role}
                      dept={null}
                      castNum={c.castNumber}
                      crewId={c.id} crewType="cast"
                      colSpecs={colSpecs}
                      validDates={castValidDates[c.id] ?? new Set()}
                      assignMap={assignMap} hotels={hotels}
                      onMouseDown={onCellMouseDown}
                      onMouseEnter={onCellMouseEnter}
                    />
                  ))
                }
              </>
            )}

          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── CrewRow ───────────────────────────────────────────────────────────────────

function CrewRow({
  name, role, dept, castNum, crewId, crewType,
  colSpecs, validDates, assignMap, hotels, onMouseDown, onMouseEnter,
}) {
  return (
    <tr className="ch-crew-row">
      <td className="ch-td-name">
        {dept && <div className="ch-dept-label">{dept}</div>}
        <div className="ch-name-row">
          {castNum != null && <span className="ch-cast-num">#{castNum}</span>}
          <span className="ch-crew-name">{name || '—'}</span>
        </div>
        {role && <div className="ch-crew-role">{role}</div>}
      </td>

      {colSpecs.map((spec, i) => {
        // Collapsed phase column — non-interactive dim stripe
        if (spec.type === 'collapsed') {
          return (
            <td
              key={`${spec.phaseId}-cell-${i}`}
              className="ch-td-cell ch-td-phase-collapsed"
              style={{ '--phase-color': spec.color }}
            />
          )
        }

        const { date, isWeekend, isMonday, isToday } = spec
        const isValid  = validDates === null || validDates.has(date)
        const hotelId  = assignMap[`${crewId}|${crewType}|${date}`]
        const hotel    = hotelId ? hotels.find(h => h.id === hotelId) : null
        const hotelIdx = hotel ? hotels.indexOf(hotel) : -1
        const color    = hotel ? hotelColor(hotelIdx) : null

        return (
          <td
            key={date + i}
            className={[
              'ch-td-cell',
              isValid   ? 'ch-td-cell--valid'   : 'ch-td-cell--disabled',
              hotel     ? 'ch-td-cell--filled'  : '',
              isWeekend ? 'ch-td-cell--weekend' : '',
              isToday   ? 'ch-td-cell--today'   : '',
              isMonday  ? 'ch-td-cell--monday'  : '',
            ].filter(Boolean).join(' ')}
            style={color ? { background: color + '33', borderColor: color } : {}}
            onMouseDown={isValid ? () => onMouseDown(crewId, crewType, date) : undefined}
            onMouseEnter={isValid ? () => onMouseEnter(crewId, crewType, date) : undefined}
          >
            {hotel && (
              <div className="ch-cell-label" style={{ color }}>
                {hotel.name ? hotel.name.slice(0, 4) : `H${hotelIdx + 1}`}
              </div>
            )}
          </td>
        )
      })}
    </tr>
  )
}
