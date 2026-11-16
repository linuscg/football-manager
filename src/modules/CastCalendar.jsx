import { useState, useMemo } from 'react'

import { castNumCompare } from '../lib/castNum'
const fmtDay = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
  weekday: 'short', day: '2-digit', month: 'short',
})

function dayLabel(d) {
  if (d.dayCategory === 'main' && d.dayNumber != null) return `D${d.dayNumber}`
  const cat = d.dayCategory ?? 'day'
  return cat.charAt(0).toUpperCase() + cat.slice(1)
}

export default function CastCalendar({ store }) {
  const { shootDays, castMembers } = store
  const [view, setView] = useState(() => localStorage.getItem('fm_castcal_view') ?? 'calendar')
  function pickView(v) { setView(v); localStorage.setItem('fm_castcal_view', v) }

  const days = useMemo(
    () => [...shootDays]
      .filter(d => d.date && d.dayCategory !== 'unscheduled')
      .sort((a, b) => a.date.localeCompare(b.date) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [shootDays]
  )

  // Per day: cast ids working (scenes + rehearsal-day cast); per cast: first/last/count
  const { castByDay, castSpans } = useMemo(() => {
    const byDay = {}   // dayId → Set of cast ids
    const spans = {}   // castId → { dates: [] }
    for (const d of days) {
      const ids = new Set()
      for (const sc of d.scenes ?? []) for (const id of sc.castMemberIds ?? []) ids.add(id)
      for (const id of d.castMemberIds ?? []) ids.add(id)
      byDay[d.id] = ids
      for (const id of ids) {
        if (!spans[id]) spans[id] = { dates: [] }
        spans[id].dates.push(d.date)
      }
    }
    for (const sp of Object.values(spans)) {
      sp.dates.sort()
      sp.first = sp.dates[0]
      sp.last = sp.dates[sp.dates.length - 1]
      sp.count = new Set(sp.dates).size
    }
    return { castByDay: byDay, castSpans: spans }
  }, [days])

  const workingCast = useMemo(
    () => castMembers
      .filter(c => castSpans[c.id])
      .sort((a, b) => castNumCompare(a.castNumber, b.castNumber)),
    [castMembers, castSpans]
  )

  const castLabel = c => [c.castNumber != null && c.castNumber !== '' ? `${c.castNumber}.` : null, c.name || '(unnamed)'].filter(Boolean).join(' ')

  function chip(c, date) {
    const sp = castSpans[c.id]
    const isFirst = sp?.first === date
    const isLast = sp?.last === date
    const cls = isFirst && isLast ? ' cc-chip--only' : isFirst ? ' cc-chip--first' : isLast ? ' cc-chip--last' : ''
    return (
      <span key={c.id} className={`cc-chip${cls}`}
        title={`${castLabel(c)}${isFirst ? ' — FIRST day' : ''}${isLast ? `${isFirst ? ' and' : ' —'} LAST day` : ''}`}>
        {c.castNumber != null && c.castNumber !== '' ? c.castNumber : (c.name || '?').slice(0, 8)}
        {isFirst && <span className="cc-flag cc-flag--first">1st</span>}
        {isLast && <span className="cc-flag cc-flag--last">last</span>}
      </span>
    )
  }

  // ── Calendar grid ──────────────────────────────────────────────────────────
  const [calMonth, setCalMonth] = useState(() => (days[0]?.date ?? new Date().toISOString().slice(0, 10)).slice(0, 7))
  function shiftMonth(delta) {
    const [y, m] = calMonth.split('-').map(Number)
    setCalMonth(new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7))
  }
  function calCells() {
    const [y, m] = calMonth.split('-').map(Number)
    const startDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const cells = []
    for (let i = 0; i < startDow; i++) cells.push(null)
    for (let d = 1; d <= dim; d++) {
      const iso = `${calMonth}-${String(d).padStart(2, '0')}`
      cells.push({ iso, dayNum: d, days: days.filter(x => x.date === iso) })
    }
    return cells
  }

  return (
    <div className="pm-module">
      <div className="pm-module-head">
        <div>
          <div className="pm-eyebrow">Football Manager</div>
          <h1 className="pm-h1">Cast Calendar</h1>
          <div className="pm-h1-sub">{workingCast.length} cast with scheduled days — first/last days flagged</div>
        </div>
        <div className="pm-module-head-actions">
          <div className="gantt-tabs">
            <button className={`gantt-tab${view === 'calendar' ? ' active' : ''}`} onClick={() => pickView('calendar')}>Calendar</button>
            <button className={`gantt-tab${view === 'list' ? ' active' : ''}`} onClick={() => pickView('list')}>List</button>
          </div>
        </div>
      </div>

      {/* Cast spans summary — gifts planning at a glance */}
      <div className="crew-db-table-wrap" style={{ marginBottom: 18 }}>
        <table className="crew-db-table">
          <thead>
            <tr>
              <th className="crew-db-th">Cast</th>
              <th className="crew-db-th">Role</th>
              <th className="crew-db-th">First day</th>
              <th className="crew-db-th">Last day</th>
              <th className="crew-db-th">Days</th>
            </tr>
          </thead>
          <tbody>
            {workingCast.map(c => {
              const sp = castSpans[c.id]
              return (
                <tr key={c.id} className="crew-db-row">
                  <td className="crew-db-cell" style={{ fontWeight: 600 }}>{castLabel(c)}</td>
                  <td className="crew-db-cell" style={{ color: '#6b7280' }}>{c.role || '—'}</td>
                  <td className="crew-db-cell"><span className="cc-date cc-date--first">{fmtDay(sp.first)}</span></td>
                  <td className="crew-db-cell"><span className="cc-date cc-date--last">{fmtDay(sp.last)}</span></td>
                  <td className="crew-db-cell">{sp.count}</td>
                </tr>
              )
            })}
            {workingCast.length === 0 && (
              <tr><td className="crew-db-cell" colSpan={5} style={{ color: '#9ca3af' }}>
                No cast scheduled yet — assign cast to scenes in the Schedule, or import a schedule PDF.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {view === 'calendar' && (
        <>
          <div className="cal-nav" style={{ marginBottom: 10 }}>
            <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={() => shiftMonth(-1)}>‹</button>
            <span className="sa-cal-month">
              {new Date(calMonth + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
            </span>
            <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={() => shiftMonth(1)}>›</button>
          </div>
          <div className="sa-cal-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="sa-cal-dow">{d}</div>)}
            {calCells().map((cell, i) => cell === null
              ? <div key={`b${i}`} className="sa-cal-cell sa-cal-cell--blank" />
              : (
                <div key={cell.iso} className={`sa-cal-cell${cell.days.length ? ' sa-cal-cell--shoot' : ''}`}>
                  <div className="sa-cal-daynum">{cell.dayNum}</div>
                  {cell.days.map(d => (
                    <div key={d.id}>
                      <div className="sa-cal-chip">{dayLabel(d)}</div>
                      <div className="cc-chips">
                        {workingCast.filter(c => castByDay[d.id]?.has(c.id)).map(c => chip(c, d.date))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        </>
      )}

      {view === 'list' && days.map(d => {
        const cast = workingCast.filter(c => castByDay[d.id]?.has(c.id))
        if (!cast.length) return null
        return (
          <div key={d.id} className="sa-day-card">
            <div className="sa-day-head">
              <span className="sa-day-label">{dayLabel(d)}</span>
              <span className="sa-day-date">{fmtDay(d.date)}</span>
              {d.location && <span className="sa-day-loc">{d.location}</span>}
              <span className="sa-day-total">{cast.length} cast</span>
            </div>
            <div className="cc-list-chips">
              {cast.map(c => {
                const sp = castSpans[c.id]
                const isFirst = sp.first === d.date
                const isLast = sp.last === d.date
                return (
                  <span key={c.id} className={`cc-list-item${isFirst ? ' is-first' : ''}${isLast ? ' is-last' : ''}`}>
                    {castLabel(c)}
                    {isFirst && <span className="cc-flag cc-flag--first">FIRST DAY</span>}
                    {isLast && <span className="cc-flag cc-flag--last">LAST DAY</span>}
                  </span>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
