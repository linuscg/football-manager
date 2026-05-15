import { useState, useMemo } from 'react'
import { useFullCrewList } from '../store/useFullCrewList'
import { useCrewStore }         from '../store/useCrewStore'
import { useBackpageStore }     from '../store/useBackpageStore'
// xlsx-js-style is loaded lazily (same pattern as exportBackpage.js)

// ─── Time helpers (same logic as Backpage) ────────────────────────────────────

function addMins(timeStr, mins) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':').map(Number)
  const total  = h * 60 + (m || 0) + mins
  const norm   = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`
}

function calcWrapTime(generalCall, dayType, production, lunchIncluded = true) {
  if (!generalCall) return null
  const type  = dayType || production.defaultDayType || 'SWD'
  const lunch = lunchIncluded
    ? (type === 'CWD'  ? (production.cwdLunch  ?? 0)
     : type === 'SCWD' ? (production.scwdLunch ?? 30)
     :                   (production.swdLunch  ?? 60))
    : 0
  return addMins(generalCall, (production.workHours ?? 10) * 60 + lunch)
}

// ─── Week helpers ─────────────────────────────────────────────────────────────

function getMonday(date) {
  const d   = new Date(date)
  const day = d.getDay()                       // 0 = Sun
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

function toDateStr(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function getWeekDates(monday) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    return toDateStr(d)
  })
}

function fmtWeekRange(monday) {
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  const opts = { day: 'numeric', month: 'short' }
  return `${monday.toLocaleDateString('en-GB', opts)} – ${sunday.toLocaleDateString('en-GB', { ...opts, year: 'numeric' })}`
}

function fmtColHeader(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return {
    wday:      d.toLocaleDateString('en-GB', { weekday: 'short' }),
    dateLabel: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    isWeekend: d.getDay() === 0 || d.getDay() === 6,
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

const FALLBACK = 'Unassigned'

export default function Timesheets({ store }) {
  const { production, shootDays } = store
  const { members }               = useFullCrewList()
  const { resources, bookings }   = useCrewStore()
  const {
    getDeptSetting, getMemberOverride, getDaySetting,
  } = useBackpageStore()

  // ── Week navigation (persisted to localStorage) ───────────────────────────

  const [weekMonday, setWeekMonday] = useState(() => {
    const saved = localStorage.getItem('fm_ts_week')
    if (saved) {
      const d = new Date(saved + 'T00:00:00')
      if (!isNaN(d)) return d
    }
    return getMonday(new Date())
  })

  function _setWeek(d) {
    setWeekMonday(d)
    localStorage.setItem('fm_ts_week', toDateStr(d))
  }

  function prevWeek() { _setWeek(new Date(weekMonday.getFullYear(), weekMonday.getMonth(), weekMonday.getDate() - 7)) }
  function nextWeek() { _setWeek(new Date(weekMonday.getFullYear(), weekMonday.getMonth(), weekMonday.getDate() + 7)) }
  function goToday()  { _setWeek(getMonday(new Date())) }

  const weekDates = useMemo(() => getWeekDates(weekMonday), [weekMonday])

  // ── Primary shoot day per date (main unit preferred) ─────────────────────
  // Used for general call time and dept settings lookup.
  const primaryByDate = useMemo(() => {
    const map = {}
    for (const date of weekDates) {
      const days = shootDays.filter(d =>
        d.date === date && ['main', 'splinter', 'prep', 'rehearsal', 'other'].includes(d.dayCategory)
      )
      map[date] = days.find(d => d.dayCategory === 'main') ?? days[0] ?? null
    }
    return map
  }, [weekDates, shootDays])

  // ── Time derivation ───────────────────────────────────────────────────────

  function getFulltimeTimes(member, date) {
    const day = primaryByDate[date]
    if (!day) return null

    const daySetting    = getDaySetting(day.id)
    const lunchIncluded = daySetting?.lunchIncluded ?? true
    const deptSetting   = getDeptSetting(day.id, member.department?.trim() || FALLBACK)
    const preCallMins   = deptSetting?.preCallMins ?? 0
    const derigMins     = deptSetting?.derigMins   ?? 0

    const override = getMemberOverride(day.id, member.id)
    const status   = override?.status ?? 'work'

    if (override?.exclude)              return { type: 'excluded' }
    if (status === 'N/A' || status === 'O/C') return { type: 'status', label: status }

    if (!day.generalCall) return { type: 'noCall' }

    const baseWrap = calcWrapTime(day.generalCall, day.dayType, production, lunchIncluded)
    return {
      type:     'times',
      callTime: override?.callTime || addMins(day.generalCall, -preCallMins),
      wrapTime: override?.wrapTime || (baseWrap ? addMins(baseWrap, derigMins) : null),
    }
  }

  function getAdditionalTimes(resource, date) {
    // Find active booking on this date
    const booking = bookings.find(b =>
      b.resourceId === resource.id &&
      b.date       === date &&
      (b.status === 'booked' || b.status === 'hold')
    )
    if (!booking) return null

    // Resolve the shoot day from the booking
    const day = booking.dayId
      ? shootDays.find(d => d.id === booking.dayId)
      : shootDays.find(d => d.date === date && d.dayCategory === 'main')
    if (!day) return null

    const daySetting    = getDaySetting(day.id)
    const lunchIncluded = daySetting?.lunchIncluded ?? true
    const deptKey       = `${resource.department?.trim() || FALLBACK} - Additional`
    const deptSetting   = getDeptSetting(day.id, deptKey)
    const preCallMins   = deptSetting?.preCallMins ?? 0
    const derigMins     = deptSetting?.derigMins   ?? 0

    const override = getMemberOverride(day.id, resource.id)
    const status   = override?.status ?? 'work'

    if (override?.exclude)                    return { type: 'excluded' }
    if (status === 'N/A' || status === 'O/C') return { type: 'status', label: status }

    if (!day.generalCall) return { type: 'noCall' }

    const baseWrap = calcWrapTime(day.generalCall, day.dayType, production, lunchIncluded)
    return {
      type:     'times',
      callTime: override?.callTime || addMins(day.generalCall, -preCallMins),
      wrapTime: override?.wrapTime || (baseWrap ? addMins(baseWrap, derigMins) : null),
    }
  }

  // ── Grouping ──────────────────────────────────────────────────────────────

  const ftGroupMap = useMemo(() => {
    const map = {}
    for (const m of members) {
      const key = m.department?.trim() || FALLBACK
      if (!map[key]) map[key] = []
      map[key].push(m)
    }
    return map
  }, [members])

  const ftDepts = useMemo(() =>
    Object.keys(ftGroupMap).sort((a, b) => {
      if (a === FALLBACK) return 1
      if (b === FALLBACK) return -1
      return a.localeCompare(b)
    })
  , [ftGroupMap])

  // Additional crew active at least one day this week
  const addThisWeek = useMemo(() => {
    const dateSet = new Set(weekDates)
    return resources
      .filter(r => r.type === 'crew' && bookings.some(b =>
        b.resourceId === r.id &&
        dateSet.has(b.date) &&
        (b.status === 'booked' || b.status === 'hold')
      ))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }, [resources, bookings, weekDates])

  const addGroupMap = useMemo(() => {
    const map = {}
    for (const r of addThisWeek) {
      const key = r.department?.trim() || FALLBACK
      if (!map[key]) map[key] = []
      map[key].push(r)
    }
    return map
  }, [addThisWeek])

  const addDepts = useMemo(() =>
    Object.keys(addGroupMap).sort((a, b) => {
      if (a === FALLBACK) return 1
      if (b === FALLBACK) return -1
      return a.localeCompare(b)
    })
  , [addGroupMap])

  // ── Excel export ──────────────────────────────────────────────────────────

  async function handleExport() {
    const XLSX = (await import('xlsx-js-style')).default

    const dayHeaders = weekDates.flatMap(date => {
      const { wday, dateLabel } = fmtColHeader(date)
      return [`${wday} ${dateLabel} IN`, `${wday} ${dateLabel} OUT`]
    })
    const headers = ['Department', 'Name', 'Role', ...dayHeaders]

    function timesToCells(times) {
      if (!times)                    return ['', '']
      if (times.type === 'excluded') return ['EXCL', '']
      if (times.type === 'status')   return [times.label, '']
      if (times.type === 'noCall')   return ['—', '']
      return [times.callTime || '', times.wrapTime || '']
    }

    const rows = []

    for (const dept of ftDepts) {
      for (const m of ftGroupMap[dept]) {
        const row = [dept, m.name, m.role]
        for (const date of weekDates) row.push(...timesToCells(getFulltimeTimes(m, date)))
        rows.push(row)
      }
    }

    for (const dept of addDepts) {
      for (const r of addGroupMap[dept]) {
        const row = [`${dept} – Additional`, r.name, r.role]
        for (const date of weekDates) row.push(...timesToCells(getAdditionalTimes(r, date)))
        rows.push(row)
      }
    }

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [
      { wch: 22 }, { wch: 22 }, { wch: 18 },
      ...weekDates.flatMap(() => [{ wch: 11 }, { wch: 11 }]),
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Timesheets')
    XLSX.writeFile(wb, `Timesheets_${toDateStr(weekMonday)}.xlsx`)
  }

  // ── Cell renderer ─────────────────────────────────────────────────────────

  function TimeCell({ times, hasDay }) {
    if (!hasDay) return <td className="ts-td ts-td-day ts-td--noday" />
    return (
      <td className="ts-td ts-td-day">
        {!times ? (
          <span className="ts-dash">—</span>
        ) : times.type === 'excluded' ? (
          <span className="ts-badge ts-badge--excl">Excl</span>
        ) : times.type === 'status' ? (
          <span className={`ts-badge ts-badge--${times.label === 'N/A' ? 'na' : 'oc'}`}>{times.label}</span>
        ) : times.type === 'noCall' ? (
          <span className="ts-dash">No call</span>
        ) : (
          <div className="ts-times">
            <span className="ts-time ts-time--in">{times.callTime || '—'}</span>
            <span className="ts-time-sep">/</span>
            <span className="ts-time ts-time--out">{times.wrapTime || '—'}</span>
          </div>
        )}
      </td>
    )
  }

  // ── Build table rows imperatively (avoids Fragment-key issues) ────────────

  function buildRows() {
    const rows = []

    // Fulltime crew
    for (const dept of ftDepts) {
      rows.push(
        <tr key={`ftd-${dept}`} className="ts-dept-row">
          <td colSpan={3 + weekDates.length} className="ts-dept-cell">{dept}</td>
        </tr>
      )
      for (const m of ftGroupMap[dept]) {
        rows.push(
          <tr key={`ft-${m.id}`} className="ts-row">
            <td className="ts-td ts-td-name">{m.name}</td>
            <td className="ts-td ts-td-role">{m.role}</td>
            <td className="ts-td ts-td-dept">{m.department || '—'}</td>
            {weekDates.map(date => (
              <TimeCell key={date} times={getFulltimeTimes(m, date)} hasDay={!!primaryByDate[date]} />
            ))}
          </tr>
        )
      }
    }

    // Additional crew section header
    if (addThisWeek.length > 0) {
      rows.push(
        <tr key="add-header" className="ts-section-row">
          <td colSpan={3 + weekDates.length} className="ts-section-cell">Additional Crew</td>
        </tr>
      )
      for (const dept of addDepts) {
        rows.push(
          <tr key={`add-d-${dept}`} className="ts-dept-row">
            <td colSpan={3 + weekDates.length} className="ts-dept-cell">{dept} — Additional</td>
          </tr>
        )
        for (const r of addGroupMap[dept]) {
          rows.push(
            <tr key={`add-${r.id}`} className="ts-row">
              <td className="ts-td ts-td-name">{r.name}</td>
              <td className="ts-td ts-td-role">{r.role}</td>
              <td className="ts-td ts-td-dept">{r.department || '—'}</td>
              {weekDates.map(date => (
                <TimeCell key={date} times={getAdditionalTimes(r, date)} hasDay={!!primaryByDate[date]} />
              ))}
            </tr>
          )
        }
      }
    }

    return rows
  }

  // ── Empty state ───────────────────────────────────────────────────────────

  if (members.length === 0 && addThisWeek.length === 0) {
    return (
      <div className="ts-empty">
        <div style={{ fontSize: 32, opacity: 0.2 }}>📋</div>
        <div className="ts-empty-title">No crew yet</div>
        <div className="ts-empty-sub">
          Add crew in Fulltime Crew and book additional crew in the Crew Gantt.
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="ts-wrap">

      {/* ── Week bar ──────────────────────────────────────────────────────── */}
      <div className="ts-bar">
        <div className="ts-bar-nav">
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={prevWeek}>‹</button>
          <span className="ts-week-label">{fmtWeekRange(weekMonday)}</span>
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={nextWeek}>›</button>
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={goToday}>This week</button>
        </div>
        <button className="pm-btn pm-btn--primary pm-btn--sm" onClick={handleExport}>
          ↓ Export Excel
        </button>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="ts-scroll">
        <table className="ts-table">
          <thead>
            <tr>
              <th className="ts-th ts-th-name">Name</th>
              <th className="ts-th ts-th-role">Role</th>
              <th className="ts-th ts-th-dept">Dept</th>
              {weekDates.map(date => {
                const { wday, dateLabel, isWeekend } = fmtColHeader(date)
                const hasDay = !!primaryByDate[date]
                return (
                  <th key={date} className={[
                    'ts-th ts-th-day',
                    isWeekend ? 'ts-th-day--weekend' : '',
                    hasDay    ? 'ts-th-day--active'  : '',
                  ].filter(Boolean).join(' ')}>
                    <div className="ts-col-wday">{wday}</div>
                    <div className="ts-col-date">{dateLabel}</div>
                    {hasDay && <div className="ts-col-sub"><span>In</span><span>Out</span></div>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {buildRows()}
          </tbody>
        </table>
      </div>

    </div>
  )
}
