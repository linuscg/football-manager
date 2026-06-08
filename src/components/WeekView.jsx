import { useState, useMemo } from 'react'
import { CATEGORY_STYLE, dayLabel, addDaysToDate, DayEditModal } from './CalendarView'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Monday (ISO) of the week containing dateStr → 'YYYY-MM-DD'
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = d.getDay() // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow
  return addDaysToDate(dateStr, offset)
}

function fmtWeekday(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })
}
function fmtDayMonth(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
function fmtWeekLabel(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  })
}

// Sum scene `pages` (supports "n/d" eighths or decimal) → friendly string.
function totalPages(scenes) {
  let total = 0
  for (const s of scenes ?? []) {
    const raw = String(s.pages ?? '').trim()
    if (!raw) continue
    if (raw.includes('/')) {
      const [n, d] = raw.split('/').map(Number)
      if (!isNaN(n) && !isNaN(d) && d > 0) total += n / d
    } else {
      const v = parseFloat(raw)
      if (!isNaN(v)) total += v
    }
  }
  if (total === 0) return null
  const whole = Math.floor(total)
  const frac = total - whole
  if (frac === 0) return String(whole)
  if (frac >= 0.875) return String(whole + 1)
  if (frac >= 0.625) return whole ? `${whole}⅞` : '⅞'
  if (frac >= 0.375) return whole ? `${whole}½` : '½'
  if (frac >= 0.125) return whole ? `${whole}¼` : '¼'
  return String(whole)
}

function castSummary(scene, castById) {
  const ids = scene.castMemberIds ?? []
  if (ids.length === 0) return ''
  return ids
    .map(id => castById[id])
    .filter(Boolean)
    .slice()
    .sort((a, b) => (a.castNumber ?? 999) - (b.castNumber ?? 999))
    .map(c => (c.castNumber != null ? String(c.castNumber) : (c.name || '?')))
    .join(', ')
}

function DayContent({ day, castById, additionalsCount, onClick }) {
  const style = CATEGORY_STYLE[day.dayCategory] ?? CATEGORY_STYLE.other
  const scenes = day.scenes ?? []
  const locs = (day.locations?.filter(Boolean) ?? [])
  const locText = locs.length ? locs.join(' · ') : (day.location || '')
  const pages = totalPages(scenes)

  return (
    <div className="week-day-card" onClick={() => onClick(day.id)} title="Click to edit">
      <div
        className="week-day-head"
        style={{ '--cat-bg': style.bg, '--cat-text': style.text }}
      >
        {dayLabel(day)}
      </div>
      {day.generalCall && <div className="week-day-call">Call {day.generalCall}</div>}
      {(locText || day.unitBase) && (
        <div className="week-day-loc">
          {locText}
          {day.unitBase ? <span className="week-day-unitbase"> · Base: {day.unitBase}</span> : null}
        </div>
      )}
      {scenes.length > 0 && (
        <div className="week-scenes">
          {scenes.map((s, i) => {
            const cast = castSummary(s, castById)
            return (
              <div className="week-scene" key={s.id ?? i}>
                <span className="week-scene-num">{s.sceneNumber || '—'}</span>
                {s.intExt && <span className="week-scene-tag">{s.intExt}</span>}
                <span className="week-scene-set">{s.location || s.description || ''}</span>
                {s.dayNight && <span className="week-scene-dn">{s.dayNight}</span>}
                {s.pages && <span className="week-scene-pages">{s.pages}</span>}
                {cast && <span className="week-scene-cast">{cast}</span>}
              </div>
            )
          })}
        </div>
      )}
      <div className="week-day-foot">
        <span>{scenes.length} scene{scenes.length !== 1 ? 's' : ''}</span>
        {pages && <span>{pages} pg</span>}
        {additionalsCount > 0 && <span>{additionalsCount} crew/equip</span>}
      </div>
    </div>
  )
}

export default function WeekView({
  shootDays, production, castMembers, allLocations, actions,
  additionalsByDate, additionalsByDayId,
  expandedIds, onToggleExpanded, onDateChange,
}) {
  const [editingDayId, setEditingDayId] = useState(null)

  const castById = useMemo(() => {
    const m = {}
    for (const c of castMembers ?? []) m[c.id] = c
    return m
  }, [castMembers])

  // Group dated days by date.
  const byDate = useMemo(() => {
    const m = {}
    for (const day of shootDays) {
      if (!day.date) continue
      if (!m[day.date]) m[day.date] = []
      m[day.date].push(day)
    }
    for (const key of Object.keys(m)) {
      const main = m[key].filter(d => d.dayCategory !== 'prep').sort((a, b) => a.sortOrder - b.sortOrder)
      const prep = m[key].filter(d => d.dayCategory === 'prep').sort((a, b) => a.sortOrder - b.sortOrder)
      m[key] = [...main, ...prep]
    }
    return m
  }, [shootDays])

  // Build week blocks from min Monday → max date.
  const weeks = useMemo(() => {
    const dated = shootDays.filter(d => d.date).map(d => d.date).sort()
    if (dated.length === 0) return []
    const start = mondayOf(dated[0])
    const end = dated[dated.length - 1]
    const out = []
    let shootWeekN = 0
    let cursor = start
    // guard against runaway loops
    for (let guard = 0; guard < 520 && cursor <= end; guard++) {
      const days = []
      let hasMain = false
      for (let i = 0; i < 7; i++) {
        const dateStr = addDaysToDate(cursor, i)
        const dayList = byDate[dateStr] ?? []
        if (dayList.some(d => d.dayCategory === 'main')) hasMain = true
        days.push({ dateStr, dayList, isWeekend: i >= 5 })
      }
      if (hasMain) shootWeekN += 1
      out.push({ monday: cursor, days, shootWeekN: hasMain ? shootWeekN : null })
      cursor = addDaysToDate(cursor, 7)
    }
    return out
  }, [shootDays, byDate])

  const editingDay = editingDayId ? shootDays.find(d => d.id === editingDayId) : null

  if (weeks.length === 0) {
    return (
      <div className="week-view">
        <div className="week-empty">No dated shoot days to show. Add dates to your days to see the week view.</div>
      </div>
    )
  }

  return (
    <div className="week-view">
      {weeks.map(({ monday, days, shootWeekN }) => (
        <div className="week-block" key={monday}>
          <div className="week-block-head">
            <span className="week-block-title">Week of {fmtWeekLabel(monday)}</span>
            {shootWeekN != null && <span className="week-block-badge">Shoot Week {shootWeekN}</span>}
          </div>
          <div className="week-grid">
            {days.map(({ dateStr, dayList, isWeekend }) => {
              const empty = dayList.length === 0
              return (
                <div
                  key={dateStr}
                  className={[
                    'week-day',
                    empty ? 'week-day--empty' : '',
                    isWeekend ? 'week-day--weekend' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <div className="week-day-date">
                    <span className="week-day-wd">{fmtWeekday(dateStr)}</span>
                    <span className="week-day-dm">{fmtDayMonth(dateStr)}</span>
                  </div>
                  {dayList.map(day => {
                    const additionalsCount = day.dayCategory === 'main'
                      ? (additionalsByDate[day.date]?.length ?? 0)
                      : (additionalsByDayId[day.id]?.length ?? 0)
                    return (
                      <DayContent
                        key={day.id}
                        day={day}
                        castById={castById}
                        additionalsCount={additionalsCount}
                        onClick={setEditingDayId}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {editingDay && (
        <DayEditModal
          day={editingDay}
          shootDays={shootDays}
          actions={actions}
          additionalsByDate={additionalsByDate}
          additionalsByDayId={additionalsByDayId}
          production={production}
          castMembers={castMembers}
          allLocations={allLocations}
          onDateChange={onDateChange}
          onClose={() => setEditingDayId(null)}
        />
      )}
    </div>
  )
}
