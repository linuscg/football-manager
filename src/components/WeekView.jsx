import { useState, useMemo } from 'react'
import { CATEGORY_STYLE, dayLabel, addDaysToDate, DayEditModal } from './CalendarView'

const LS_WEEK = 'fm_schedule_week'

// Monday (ISO) of the week containing dateStr → 'YYYY-MM-DD'
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = d.getDay() // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow
  return addDaysToDate(dateStr, offset)
}

function todayStr() {
  const t = new Date()
  return [t.getFullYear(), String(t.getMonth() + 1).padStart(2, '0'), String(t.getDate()).padStart(2, '0')].join('-')
}

function fmtWeekday(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' })
}
function fmtDayMonth(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
function fmtRange(monday) {
  const sunday = addDaysToDate(monday, 6)
  const a = new Date(monday + 'T00:00:00')
  const b = new Date(sunday + 'T00:00:00')
  const opts = { day: '2-digit', month: 'short' }
  return `${a.toLocaleDateString('en-GB', opts)} – ${b.toLocaleDateString('en-GB', { ...opts, year: 'numeric' })}`
}

// Sum scene `pages` (supports "n/d" eighths or decimal) → friendly string.
function totalPages(scenes) {
  let total = 0
  for (const s of scenes ?? []) {
    const raw = String(s.pages ?? '').trim()
    if (!raw) continue
    if (raw.includes('/')) {
      const parts = raw.split(' ')
      for (const p of parts) {
        if (p.includes('/')) { const [n, d] = p.split('/').map(Number); if (d > 0) total += n / d }
        else { const v = parseFloat(p); if (!isNaN(v)) total += v }
      }
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

function DayContent({ day, castById, additionals, onClick }) {
  const style = CATEGORY_STYLE[day.dayCategory] ?? CATEGORY_STYLE.other
  const scenes = day.scenes ?? []
  const locs = (day.locations?.filter(Boolean) ?? [])
  const locText = locs.length ? locs.join(' · ') : (day.location || '')
  const pages = totalPages(scenes)

  return (
    <div className="week-day-card" onClick={() => onClick(day.id)} title="Click to edit">
      <div className="week-day-head" style={{ '--cat-bg': style.bg, '--cat-text': style.text }}>
        {dayLabel(day)}
      </div>

      <div className="week-day-meta">
        {day.generalCall && <span className="week-day-call">📞 {day.generalCall}</span>}
        {day.dayType && <span className="week-day-type">{day.dayType}</span>}
      </div>

      {(locText || day.unitBase) && (
        <div className="week-day-loc">
          {locText && <div>📍 {locText}</div>}
          {day.unitBase && <div className="week-day-unitbase">Base: {day.unitBase}</div>}
        </div>
      )}

      {day.dayCategory === 'rehearsal' && (day.castMemberIds?.length ?? 0) > 0 && (
        <div className="week-day-rehcast">
          <span className="week-day-rehcast-label">Rehearsal cast:</span>{' '}
          {(day.castMemberIds ?? [])
            .map(id => castById[id])
            .filter(Boolean)
            .sort((a, b) => (a.castNumber ?? 999) - (b.castNumber ?? 999))
            .map(c => c.name || (c.castNumber != null ? `#${c.castNumber}` : '?'))
            .join(', ')}
        </div>
      )}

      {scenes.length > 0 && (
        <div className="week-scenes">
          {scenes.map((s, i) => {
            const cast = castSummary(s, castById)
            return (
              <div className="week-scene" key={s.id ?? i}>
                <div className="week-scene-top">
                  <span className="week-scene-num">{s.sceneNumber || '—'}</span>
                  {s.intExt && <span className="week-scene-tag">{s.intExt}</span>}
                  <span className="week-scene-set">{s.location || ''}</span>
                  {s.dayNight && <span className="week-scene-dn">{s.dayNight}</span>}
                  {s.storyDay && <span className="week-scene-sd">SD{s.storyDay}</span>}
                  {s.pages && <span className="week-scene-pages">{s.pages}</span>}
                </div>
                {s.description && <div className="week-scene-desc">{s.description}</div>}
                {cast && <div className="week-scene-cast">Cast: {cast}</div>}
              </div>
            )
          })}
        </div>
      )}

      {day.notes && <div className="week-day-notes">{day.notes}</div>}

      {additionals.length > 0 && (
        <div className="week-day-adds">
          <span className="week-day-adds-label">Additional ({additionals.length}):</span>{' '}
          {additionals.slice(0, 6).map(a => a.name).filter(Boolean).join(', ')}
          {additionals.length > 6 ? '…' : ''}
        </div>
      )}

      <div className="week-day-foot">
        <span>{scenes.length} scene{scenes.length !== 1 ? 's' : ''}</span>
        {pages && <span>{pages} pg</span>}
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
  const [weekMonday, setWeekMonday] = useState(() => {
    const saved = localStorage.getItem(LS_WEEK)
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) return mondayOf(saved)
    return mondayOf(todayStr())
  })

  function goWeek(monday) {
    setWeekMonday(monday)
    localStorage.setItem(LS_WEEK, monday)
  }

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

  // The 7 days of the visible week.
  const days = useMemo(() => {
    const out = []
    for (let i = 0; i < 7; i++) {
      const dateStr = addDaysToDate(weekMonday, i)
      out.push({ dateStr, dayList: byDate[dateStr] ?? [], isWeekend: i >= 5 })
    }
    return out
  }, [weekMonday, byDate])

  // Shoot-week number = count of weeks containing ≥1 main day from the first
  // dated week up to (and including) this one.
  const shootWeekN = useMemo(() => {
    const dated = shootDays.filter(d => d.date).map(d => d.date).sort()
    if (!dated.length) return null
    const firstMon = mondayOf(dated[0])
    if (weekMonday < firstMon) return null
    let n = 0
    let cursor = firstMon
    for (let guard = 0; guard < 520 && cursor <= weekMonday; guard++) {
      let hasMain = false
      for (let i = 0; i < 7; i++) {
        const ds = addDaysToDate(cursor, i)
        if ((byDate[ds] ?? []).some(d => d.dayCategory === 'main')) { hasMain = true; break }
      }
      if (hasMain) n += 1
      if (cursor === weekMonday) return hasMain ? n : null
      cursor = addDaysToDate(cursor, 7)
    }
    return null
  }, [shootDays, byDate, weekMonday])

  const editingDay = editingDayId ? shootDays.find(d => d.id === editingDayId) : null
  const todayMonday = mondayOf(todayStr())

  return (
    <div className="week-view week-view--single">
      {/* ── Week navigator ─────────────────────────────────────────────────── */}
      <div className="week-nav">
        <button className="week-nav-btn" onClick={() => goWeek(addDaysToDate(weekMonday, -7))} title="Previous week">‹</button>
        <div className="week-nav-label">
          <span className="week-nav-range">{fmtRange(weekMonday)}</span>
          {shootWeekN != null && <span className="week-block-badge">Shoot Week {shootWeekN}</span>}
        </div>
        <button className="week-nav-btn" onClick={() => goWeek(addDaysToDate(weekMonday, 7))} title="Next week">›</button>
        {weekMonday !== todayMonday && (
          <button className="week-nav-today" onClick={() => goWeek(todayMonday)}>This week</button>
        )}
      </div>

      {/* ── 7-day grid ─────────────────────────────────────────────────────── */}
      <div className="week-grid">
        {days.map(({ dateStr, dayList, isWeekend }) => {
          const empty = dayList.length === 0
          const isToday = dateStr === todayStr()
          return (
            <div
              key={dateStr}
              className={[
                'week-day',
                empty ? 'week-day--empty' : '',
                isWeekend ? 'week-day--weekend' : '',
                isToday ? 'week-day--today' : '',
              ].filter(Boolean).join(' ')}
            >
              <div className="week-day-date">
                <span className="week-day-wd">{fmtWeekday(dateStr)}</span>
                <span className="week-day-dm">{fmtDayMonth(dateStr)}</span>
              </div>
              {dayList.map(day => {
                const additionals = day.dayCategory === 'main'
                  ? (additionalsByDate[day.date] ?? [])
                  : (additionalsByDayId[day.id] ?? [])
                return (
                  <DayContent
                    key={day.id}
                    day={day}
                    castById={castById}
                    additionals={additionals}
                    onClick={setEditingDayId}
                  />
                )
              })}
            </div>
          )
        })}
      </div>

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
