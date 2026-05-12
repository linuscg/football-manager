import { useState, useMemo } from 'react'
import { useAccommodationStore } from '../store/useAccommodationStore'
import { useFulltimeCrewStore }  from '../store/useFulltimeCrewStore'
import { useCrewStore }          from '../store/useCrewStore'
import { hotelColor }            from './HotelList'

// ─── Date helpers ──────────────────────────────────────────────────────────────

function ds(d) {
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}

function addDays(dateS, n) {
  const d = new Date(dateS + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return ds(d)
}

function todayStr() { return ds(new Date()) }

function getSundayOf(dateS) {
  const d = new Date(dateS + 'T00:00:00')
  d.setDate(d.getDate() - d.getDay())   // getDay() 0 = Sun → subtract 0
  return ds(d)
}

function getAllSundays(startS, endS) {
  if (!startS || !endS) return []
  const sundays = []
  // Anchor to the Sunday on or before startS
  const cur = new Date(startS + 'T00:00:00')
  cur.setDate(cur.getDate() - cur.getDay())
  const end = new Date(endS + 'T00:00:00')
  while (cur <= end) {
    sundays.push(ds(cur))
    cur.setDate(cur.getDate() + 7)
  }
  return sundays
}

function formatWeekLabel(sundayS) {
  const d = new Date(sundayS + 'T00:00:00')
  return 'w/c ' + d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDate(dateS) {
  if (!dateS) return '—'
  const d = new Date(dateS + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function WeeklyTMO({ production, castMembers = [] }) {
  const { hotels, assignments, loading: accLoading } = useAccommodationStore()
  const { members: ftMembers, loading: ftLoading }   = useFulltimeCrewStore()
  const { resources, loading: crewLoading }          = useCrewStore()

  const loading   = accLoading || ftLoading || crewLoading
  const today     = todayStr()
  const prodStart = production.prepStartDate  || production.shootStartDate
  const prodEnd   = production.wrapEndDate    || production.shootEndDate

  const allSundays = useMemo(() => getAllSundays(prodStart, prodEnd), [prodStart, prodEnd])

  const [weekStart, setWeekStart] = useState(() => {
    const tw = getSundayOf(today)
    return allSundays.find(s => s === tw) ?? (allSundays[0] ?? tw)
  })

  const [selectedHotelId, setSelectedHotelId] = useState(() => hotels[0]?.id ?? null)

  // The 7 dates in the selected week (Sun → Sat)
  const weekDates    = useMemo(() => [0,1,2,3,4,5,6].map(n => addDays(weekStart, n)), [weekStart])
  const weekDatesSet = useMemo(() => new Set(weekDates), [weekDates])

  // Navigate weeks
  const weekIdx = allSundays.indexOf(weekStart)
  function prevWeek()       { if (weekIdx > 0)                     setWeekStart(allSundays[weekIdx - 1]) }
  function nextWeek()       { if (weekIdx < allSundays.length - 1) setWeekStart(allSundays[weekIdx + 1]) }
  function jumpToThisWeek() {
    const tw = getSundayOf(today)
    const match = allSundays.find(s => s === tw)
    if (match) setWeekStart(match)
  }

  // Build table rows: everyone in selectedHotel during the week
  const rows = useMemo(() => {
    if (!selectedHotelId) return []

    // All assignments for this hotel (all dates)
    const hotelAll = assignments.filter(a => a.hotelId === selectedHotelId)

    // Who appears during this week?
    const weekAssigns = hotelAll.filter(a => weekDatesSet.has(a.date))
    const seen = new Set()
    const persons = []
    for (const a of weekAssigns) {
      const key = `${a.crewId}|${a.crewType}`
      if (!seen.has(key)) { seen.add(key); persons.push({ crewId: a.crewId, crewType: a.crewType }) }
    }

    return persons.map(({ crewId, crewType }) => {
      let name = '—', role = '', typeLabel = ''

      if (crewType === 'fulltime') {
        const m = ftMembers.find(x => x.id === crewId)
        name = m?.name || '—'; role = m?.role || ''; typeLabel = 'Fulltime Crew'
      } else if (crewType === 'additional') {
        const r = resources.find(x => x.id === crewId)
        name = r?.name || '—'; role = r?.role || ''; typeLabel = 'Additional Crew'
      } else if (crewType === 'cast') {
        const c = castMembers.find(x => x.id === crewId)
        name = c?.name || '—'; role = c?.role || ''
        typeLabel = c?.castNumber ? `Cast #${c.castNumber}` : 'Cast'
      }

      // Full stay at this hotel: first night → day after last night
      const stayDates = hotelAll
        .filter(a => a.crewId === crewId && a.crewType === crewType)
        .map(a => a.date)
        .sort()
      const checkIn  = stayDates[0] ?? null
      const checkOut = stayDates.length ? addDays(stayDates[stayDates.length - 1], 1) : null

      // Nights = calendar distance check-in → check-out
      const nights = checkIn && checkOut
        ? (new Date(checkOut + 'T00:00:00') - new Date(checkIn + 'T00:00:00')) / 86400000
        : 0

      return { crewId, crewType, name, role, typeLabel, checkIn, checkOut, nights }
    }).sort((a, b) => {
      // Sort: fulltime → additional → cast, then name
      const order = { fulltime: 0, additional: 1, cast: 2 }
      const diff  = (order[a.crewType] ?? 3) - (order[b.crewType] ?? 3)
      return diff !== 0 ? diff : a.name.localeCompare(b.name)
    })
  }, [selectedHotelId, assignments, weekDatesSet, ftMembers, resources, castMembers])

  const selectedHotel    = hotels.find(h => h.id === selectedHotelId)
  const selectedHotelIdx = hotels.indexOf(selectedHotel)

  // ── Empty / loading states ─────────────────────────────────────────────────────

  if (!prodStart || !prodEnd) {
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

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div className="tmo-wrap">

      {/* ── Controls bar ─────────────────────────────────────────────────────── */}
      <div className="tmo-controls">

        {/* Week selector */}
        <div className="tmo-control-group">
          <span className="tmo-control-label">Week</span>
          <button
            className="tmo-nav-btn"
            onClick={prevWeek}
            disabled={weekIdx <= 0}
            title="Previous week"
          >‹</button>

          <select
            className="tmo-select"
            value={weekStart}
            onChange={e => setWeekStart(e.target.value)}
          >
            {allSundays.map(s => (
              <option key={s} value={s}>{formatWeekLabel(s)}</option>
            ))}
          </select>

          <button
            className="tmo-nav-btn"
            onClick={nextWeek}
            disabled={weekIdx >= allSundays.length - 1}
            title="Next week"
          >›</button>

          <button className="tmo-jump-btn" onClick={jumpToThisWeek}>
            This week
          </button>
        </div>

        {/* Hotel selector */}
        <div className="tmo-control-group">
          <span className="tmo-control-label">Hotel</span>
          {selectedHotel && (
            <span
              className="tmo-hotel-dot"
              style={{ background: hotelColor(selectedHotelIdx) }}
            />
          )}
          <select
            className="tmo-select tmo-select--hotel"
            value={selectedHotelId ?? ''}
            onChange={e => setSelectedHotelId(e.target.value)}
          >
            {hotels.map((h, i) => (
              <option key={h.id} value={h.id}>{h.name || `Hotel ${i + 1}`}</option>
            ))}
          </select>
        </div>

      </div>

      {/* ── Hotel info strip ─────────────────────────────────────────────────── */}
      {selectedHotel?.address && (
        <div className="tmo-hotel-info">
          <span className="tmo-hotel-info-icon">📍</span>
          {selectedHotel.address}
        </div>
      )}

      {/* ── Guest table ──────────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="tmo-empty">
          <div className="tmo-empty-icon">🛏️</div>
          <div className="tmo-empty-title">No guests this week</div>
          <div className="tmo-empty-sub">
            No crew or cast assigned to {selectedHotel?.name || 'this hotel'} during {formatWeekLabel(weekStart)}.
          </div>
        </div>
      ) : (
        <div className="tmo-table-wrap">
          <table className="tmo-table">
            <thead>
              <tr>
                <th className="tmo-th tmo-th--name">Name</th>
                <th className="tmo-th tmo-th--role">Role</th>
                <th className="tmo-th tmo-th--type">Type</th>
                <th className="tmo-th tmo-th--date">Check In</th>
                <th className="tmo-th tmo-th--date">Check Out</th>
                <th className="tmo-th tmo-th--nights">Nights</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={`${row.crewId}|${row.crewType}`} className="tmo-tr">
                  <td className="tmo-td tmo-td--name">{row.name}</td>
                  <td className="tmo-td tmo-td--role">{row.role || '—'}</td>
                  <td className="tmo-td">
                    <span className={`tmo-type-badge tmo-type-badge--${row.crewType}`}>
                      {row.typeLabel}
                    </span>
                  </td>
                  <td className="tmo-td">{formatDate(row.checkIn)}</td>
                  <td className="tmo-td">{formatDate(row.checkOut)}</td>
                  <td className="tmo-td tmo-td--nights">{row.nights}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="tmo-footer">
            {rows.length} {rows.length === 1 ? 'guest' : 'guests'} ·{' '}
            {selectedHotel?.name || 'hotel'} · {formatWeekLabel(weekStart)}
          </div>
        </div>
      )}

    </div>
  )
}
