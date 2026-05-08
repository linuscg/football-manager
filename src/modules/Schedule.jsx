import { useState } from 'react'
import ShootDayCard from '../components/ShootDayCard'
import { useCrewStore } from '../store/useCrewStore'

function todayStr() {
  const t = new Date()
  return [t.getFullYear(), String(t.getMonth()+1).padStart(2,'0'), String(t.getDate()).padStart(2,'0')].join('-')
}

export default function Schedule({ store, actions }) {
  const { shootDays, production, castMembers } = store
  const { resources, bookings } = useCrewStore()

  // Build two separate lookups so main-unit and sub-unit bookings don't bleed
  // into each other when multiple day types share the same calendar date.
  //   Main unit bookings  → no dayId in DB → keyed by date
  //   Sub-unit bookings   → have a dayId   → keyed by dayId
  const additionalsByDate  = {}   // main unit days
  const additionalsByDayId = {}   // splinter / prep / other days

  for (const b of bookings) {
    const resource = resources.find(r => r.id === b.resourceId)
    if (!resource) continue
    if (b.dayId) {
      if (!additionalsByDayId[b.dayId]) additionalsByDayId[b.dayId] = []
      additionalsByDayId[b.dayId].push({ ...resource, bookingStatus: b.status })
    } else {
      if (!additionalsByDate[b.date]) additionalsByDate[b.date] = []
      additionalsByDate[b.date].push({ ...resource, bookingStatus: b.status })
    }
  }

  const statusOrder = { booked: 0, hold: 1, unavailable: 2 }
  for (const list of [
    ...Object.values(additionalsByDate),
    ...Object.values(additionalsByDayId),
  ]) {
    list.sort((a, b) =>
      (statusOrder[a.bookingStatus] - statusOrder[b.bookingStatus]) ||
      a.name.localeCompare(b.name)
    )
  }

  // Persist which cards are expanded across tab switches and refreshes
  const [expandedIds, setExpandedIds] = useState(() => {
    try {
      const saved = localStorage.getItem('fm_schedule_expanded')
      return new Set(saved ? JSON.parse(saved) : [])
    } catch { return new Set() }
  })

  function handleToggleExpanded(id, isExpanded) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (isExpanded) next.add(id); else next.delete(id)
      localStorage.setItem('fm_schedule_expanded', JSON.stringify([...next]))
      return next
    })
  }

  function handleAddDay() {
    const id = actions.addShootDay('main', null)
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.add(id)
      localStorage.setItem('fm_schedule_expanded', JSON.stringify([...next]))
      return next
    })
  }

  // Beside-card "+" button: add an 'other' day on the same date — no auto-scroll
  function handleAddBeside(date) {
    const id = actions.addShootDay('other', date)
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.add(id)
      localStorage.setItem('fm_schedule_expanded', JSON.stringify([...next]))
      return next
    })
  }

  // Group shoot days by date, then within each date group:
  // main/splinter days first (sorted by sortOrder), then prep days beneath
  const dateGroups = []
  const seenDates  = []
  const byDate     = {}

  for (const day of shootDays) {
    const key = day.date || `no-date-${day.id}`
    if (!byDate[key]) {
      byDate[key] = []
      seenDates.push(key)
    }
    byDate[key].push(day)
  }

  // Sort date groups chronologically; undated days go at the end
  seenDates.sort((a, b) => {
    if (a.startsWith('no-date')) return 1
    if (b.startsWith('no-date')) return -1
    return a.localeCompare(b)
  })

  for (const date of seenDates) {
    const group = byDate[date]
    const mainSplinter = group
      .filter(d => d.dayCategory !== 'prep')
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const prep = group
      .filter(d => d.dayCategory === 'prep')
      .sort((a, b) => a.sortOrder - b.sortOrder)
    dateGroups.push([date, [...mainSplinter, ...prep]])
  }

  // Flat ordered list with all days for index/total props
  const allOrdered = dateGroups.flatMap(([, days]) => days)
  const totalDays  = allOrdered.length

  const shootStart = production.shootStartDate
  const shootEnd   = production.shootEndDate
  function fmtDate(d) {
    if (!d) return ''
    const dt = new Date(d + 'T00:00:00')
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const today = todayStr()
  const hasTodayCard = shootDays.some(d => d.date === today)

  function jumpToToday() {
    document.querySelector(`[data-day-date="${today}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="pm-module">
      {hasTodayCard && (
        <button className="schedule-jump-today" onClick={jumpToToday}>
          Jump to today
        </button>
      )}
      <div className="pm-module-head">
        <div>
          <div className="pm-eyebrow">Section II</div>
          <h1 className="pm-h1">Shooting Schedule</h1>
          {shootStart && shootEnd && (
            <div className="pm-h1-sub">
              Principal photography · {fmtDate(shootStart)} → {fmtDate(shootEnd)}
            </div>
          )}
        </div>
        <div className="pm-module-head-actions">
          <button className="pm-btn pm-btn--ghost" onClick={() => window.print()}>Print board</button>
          <button className="pm-btn pm-btn--primary" onClick={handleAddDay}>
            + Add shoot day
          </button>
        </div>
      </div>

      {shootDays.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-text">No shoot days yet.</div>
          <div className="empty-state-sub">
            Click &ldquo;Add shoot day&rdquo; to get started.
          </div>
        </div>
      ) : (
        <div className="pm-day-list">
          {dateGroups.map(([, daysInGroup]) =>
            daysInGroup.map((day) => {
              const index = allOrdered.findIndex(d => d.id === day.id)
              const isNonMain = day.dayCategory !== 'main'
              return (
                <div
                  key={day.id}
                  className={`schedule-day-row${isNonMain ? ' schedule-day-row--indent' : ''}`}
                  data-day-date={day.date}
                >
                  <div className="schedule-day-card-wrap">
                    <ShootDayCard
                      day={day}
                      index={index}
                      totalDays={totalDays}
                      defaultExpanded={expandedIds.has(day.id)}
                      onUpdate={actions.updateShootDay}
                      onDelete={actions.deleteShootDay}
                      onMoveUp={actions.moveDayUp}
                      onMoveDown={actions.moveDayDown}
                      onReorder={actions.reorderDays}
                      onAddScene={actions.addScene}
                      onDeleteScene={actions.deleteScene}
                      onUpdateScene={actions.updateScene}
                      onAddPrepDay={actions.addPrepDay}
                      onAddSplinterDay={actions.addSplinterDay}
                      onAddDayExtra={actions.addDayExtra}
                      onDeleteDayExtra={actions.deleteDayExtra}
                      onUpdateDayExtra={actions.updateDayExtra}
                      onUpdateSceneCast={actions.updateSceneCast}
                      onToggleExpanded={handleToggleExpanded}
                      additionals={
                        day.dayCategory === 'main'
                          ? (additionalsByDate[day.date]  ?? [])
                          : (additionalsByDayId[day.id]   ?? [])
                      }
                      production={production}
                      castMembers={castMembers ?? []}
                    />
                  </div>
                  <button
                    className="schedule-add-beside"
                    onClick={() => handleAddBeside(day.date)}
                    title="Add day on this date"
                  >+</button>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
