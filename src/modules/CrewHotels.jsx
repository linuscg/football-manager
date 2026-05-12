import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccommodationStore } from '../store/useAccommodationStore'
import { useFulltimeCrewStore }  from '../store/useFulltimeCrewStore'
import { useCrewStore }          from '../store/useCrewStore'
import { hotelColor, HOTEL_PALETTE } from './HotelList'

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

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}

function formatColHeader(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return {
    day:       d.toLocaleDateString('en-GB', { day: '2-digit' }),
    month:     d.toLocaleDateString('en-GB', { month: 'short' }),
    wday:      d.toLocaleDateString('en-GB', { weekday: 'short' }),
    isWeekend: d.getDay() === 0 || d.getDay() === 6,
    isMonday:  d.getDay() === 1,
  }
}

function todayStr() {
  const t = new Date()
  return [t.getFullYear(), String(t.getMonth()+1).padStart(2,'0'), String(t.getDate()).padStart(2,'0')].join('-')
}

// Keyboard shortcut map: key → hotel index (0-based)
// ` = clear (-1), 1-9 = 0-8, 0 = 9, - = 10, = = 11
const KEY_TO_INDEX = {
  '`': -1,
  '1': 0,  '2': 1,  '3': 2,  '4': 3,  '5': 4,
  '6': 5,  '7': 6,  '8': 7,  '9': 8,  '0': 9,
  '-': 10, '=': 11,
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CrewHotels({ production }) {
  const { hotels, assignments, loading: accLoading, setAssignment } = useAccommodationStore()
  const { members: ftMembers,  loading: ftLoading  } = useFulltimeCrewStore()
  const { resources, bookings, loading: crewLoading } = useCrewStore()

  // Selected hotel index (-1 = clear/eraser)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const isPainting = useRef(false)

  const loading = accLoading || ftLoading || crewLoading
  const today   = todayStr()

  // Date range: prep start → wrap end
  const dates = eachDay(
    production.prepStartDate  || production.shootStartDate,
    production.wrapEndDate    || production.shootEndDate,
  )

  // ── Build assignment lookup: `${crewId}|${crewType}|${date}` → hotelId ───────
  const assignMap = {}
  for (const a of assignments) {
    assignMap[`${a.crewId}|${a.crewType}|${a.date}`] = a.hotelId
  }

  // ── Build valid-date sets for additional crew ─────────────────────────────────
  // A crew member can get a hotel on any date they're booked ±1 day
  const additionalValidDates = {}
  for (const bk of bookings) {
    if (!additionalValidDates[bk.resourceId]) additionalValidDates[bk.resourceId] = new Set()
    additionalValidDates[bk.resourceId].add(bk.date)
    additionalValidDates[bk.resourceId].add(addDays(bk.date, -1))
    additionalValidDates[bk.resourceId].add(addDays(bk.date, 1))
  }

  // ── Crew row groups ───────────────────────────────────────────────────────────
  // Group fulltime crew by department, then additional crew by department
  const ftByDept = {}
  for (const m of ftMembers) {
    const dept = m.department || 'Unassigned'
    if (!ftByDept[dept]) ftByDept[dept] = []
    ftByDept[dept].push(m)
  }

  const addByDept = {}
  for (const r of resources.filter(r => r.type === 'crew')) {
    const dept = r.department || 'Unassigned'
    if (!addByDept[dept]) addByDept[dept] = []
    addByDept[dept].push(r)
  }

  // ── Paint logic ───────────────────────────────────────────────────────────────
  function paintCell(crewId, crewType, date) {
    const hotelId = selectedIdx === -1 ? null : (hotels[selectedIdx]?.id ?? null)
    const key = `${crewId}|${crewType}|${date}`
    // Toggle: if already has this hotel, clear it
    if (assignMap[key] === hotelId && hotelId !== null) {
      setAssignment(crewId, crewType, date, null)
    } else {
      setAssignment(crewId, crewType, date, hotelId)
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
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

  // ── Paint-drag (mousedown+mouseover) ─────────────────────────────────────────
  const onCellMouseDown = useCallback((crewId, crewType, date) => {
    isPainting.current = true
    paintCell(crewId, crewType, date)
  }, [selectedIdx, hotels, assignMap]) // eslint-disable-line react-hooks/exhaustive-deps

  const onCellMouseEnter = useCallback((crewId, crewType, date) => {
    if (!isPainting.current) return
    const hotelId = selectedIdx === -1 ? null : (hotels[selectedIdx]?.id ?? null)
    setAssignment(crewId, crewType, date, hotelId)
  }, [selectedIdx, hotels, setAssignment])

  useEffect(() => {
    const stop = () => { isPainting.current = false }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  // ── No setup ──────────────────────────────────────────────────────────────────
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
        <div className="ftc-empty-sub">Add hotels in the Hotel List tab first, then come back to assign them to crew.</div>
      </div>
    )
  }

  if (loading) return <div className="ftc-state">Loading…</div>

  const hasFulltime   = ftMembers.length > 0
  const hasAdditional = resources.filter(r => r.type === 'crew').length > 0

  if (!hasFulltime && !hasAdditional) {
    return (
      <div className="ftc-empty">
        <div className="ftc-empty-icon">👥</div>
        <div className="ftc-empty-title">No crew yet</div>
        <div className="ftc-empty-sub">Add crew in Fulltime Crew or the Crew Gantt first.</div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const selectedHotel = selectedIdx === -1 ? null : hotels[selectedIdx]

  return (
    <div className="ch-wrap">

      {/* ── Hotel palette toolbar ────────────────────────────────────────────── */}
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
          const color  = hotelColor(i)
          const KEYS   = ['1','2','3','4','5','6','7','8','9','0','-','=']
          const keyLabel = KEYS[i] ?? null
          const isActive = selectedIdx === i
          return (
            <button
              key={hotel.id}
              className={`ch-palette-btn${isActive ? ' is-active' : ''}`}
              style={{ '--hotel-color': color }}
              title={hotel.name || `Hotel ${i + 1}`}
              onClick={() => setSelectedIdx(i)}
            >
              <span className="ch-palette-swatch" style={{ background: color }} />
              <span className="ch-palette-label">{hotel.name || `Hotel ${i + 1}`}</span>
              {keyLabel && <span className="ch-palette-key">{keyLabel}</span>}
            </button>
          )
        })}

        <div className="ch-palette-hint">
          {selectedIdx === -1
            ? 'Click cells to clear'
            : `Painting: ${selectedHotel?.name || `Hotel ${selectedIdx + 1}`}`
          }
        </div>
      </div>

      {/* ── Gantt grid ───────────────────────────────────────────────────────── */}
      <div className="ch-gantt-outer">
        <table className="ch-gantt" onMouseLeave={() => { isPainting.current = false }}>

          {/* Column widths */}
          <colgroup>
            <col className="ch-col-name" />
            {dates.map(d => <col key={d} className="ch-col-date" />)}
          </colgroup>

          {/* Date header */}
          <thead>
            <tr className="ch-header-row">
              <th className="ch-th-name" />
              {dates.map(d => {
                const { day, month, wday, isWeekend, isMonday } = formatColHeader(d)
                return (
                  <th
                    key={d}
                    className={[
                      'ch-th-date',
                      isWeekend ? 'ch-th--weekend' : '',
                      isMonday  ? 'ch-th--monday'  : '',
                      d === today ? 'ch-th--today'   : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <div className="ch-th-wday">{wday}</div>
                    <div className="ch-th-day">{day}</div>
                    <div className="ch-th-month">{month}</div>
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
                  <td colSpan={dates.length + 1}>
                    <span className="ch-section-label">Fulltime Crew</span>
                  </td>
                </tr>
                {Object.entries(ftByDept)
                  .sort(([a], [b]) => a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b))
                  .map(([dept, deptMembers]) => (
                    deptMembers.map((m, mi) => (
                      <CrewRow
                        key={m.id}
                        name={m.name}
                        role={m.role}
                        dept={mi === 0 ? dept : null}
                        crewId={m.id}
                        crewType="fulltime"
                        dates={dates}
                        today={today}
                        validDates={null} // fulltime: all dates valid
                        assignMap={assignMap}
                        hotels={hotels}
                        onMouseDown={onCellMouseDown}
                        onMouseEnter={onCellMouseEnter}
                      />
                    ))
                  ))
                }
              </>
            )}

            {/* ── Additional crew ── */}
            {hasAdditional && (
              <>
                <tr className="ch-section-row">
                  <td colSpan={dates.length + 1}>
                    <span className="ch-section-label">Additional Crew</span>
                  </td>
                </tr>
                {Object.entries(addByDept)
                  .sort(([a], [b]) => a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b))
                  .map(([dept, deptResources]) => (
                    deptResources.map((r, ri) => (
                      <CrewRow
                        key={r.id}
                        name={r.name}
                        role={r.role}
                        dept={ri === 0 ? dept : null}
                        crewId={r.id}
                        crewType="additional"
                        dates={dates}
                        today={today}
                        validDates={additionalValidDates[r.id] ?? new Set()}
                        assignMap={assignMap}
                        hotels={hotels}
                        onMouseDown={onCellMouseDown}
                        onMouseEnter={onCellMouseEnter}
                      />
                    ))
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

// ─── CrewRow ──────────────────────────────────────────────────────────────────

function CrewRow({
  name, role, dept, crewId, crewType, dates, today,
  validDates, assignMap, hotels, onMouseDown, onMouseEnter,
}) {
  return (
    <tr className="ch-crew-row">
      <td className="ch-td-name">
        {dept && <div className="ch-dept-label">{dept}</div>}
        <div className="ch-crew-name">{name || '—'}</div>
        {role && <div className="ch-crew-role">{role}</div>}
      </td>
      {dates.map(date => {
        // Additional crew: only valid on booked dates ±1
        const isValid  = validDates === null || validDates.has(date)
        const hotelId  = assignMap[`${crewId}|${crewType}|${date}`]
        const hotel    = hotelId ? hotels.find(h => h.id === hotelId) : null
        const hotelIdx = hotel ? hotels.indexOf(hotel) : -1
        const color    = hotel ? hotelColor(hotelIdx) : null
        const isWeekend = new Date(date + 'T00:00:00').getDay() % 6 === 0

        return (
          <td
            key={date}
            className={[
              'ch-td-cell',
              isValid   ? 'ch-td-cell--valid'   : 'ch-td-cell--disabled',
              hotel     ? 'ch-td-cell--filled'   : '',
              isWeekend ? 'ch-td-cell--weekend'  : '',
              date === today ? 'ch-td-cell--today' : '',
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
