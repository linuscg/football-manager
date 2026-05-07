import { useState, useRef, useEffect } from 'react'
import ShootDayCard from '../components/ShootDayCard'
import { useCrewStore } from '../store/useCrewStore'

export default function Schedule({ store, actions }) {
  const { shootDays, production, castMembers } = store
  const { resources, bookings } = useCrewStore()

  // Build date → sorted list of booked crew/equipment for that day
  const additionalsByDate = {}
  for (const b of bookings) {
    const resource = resources.find(r => r.id === b.resourceId)
    if (!resource) continue
    if (!additionalsByDate[b.date]) additionalsByDate[b.date] = []
    additionalsByDate[b.date].push({ ...resource, bookingStatus: b.status })
  }
  // Sort each date's list: booked → hold → unavailable, then alphabetically
  const statusOrder = { booked: 0, hold: 1, unavailable: 2 }
  for (const list of Object.values(additionalsByDate)) {
    list.sort((a, b) =>
      (statusOrder[a.bookingStatus] - statusOrder[b.bookingStatus]) ||
      a.name.localeCompare(b.name)
    )
  }

  // Track the id of the most recently added day so we can auto-expand it.
  const [newestId, setNewestId] = useState(null)
  const listBottomRef = useRef(null)

  function handleAddDay() {
    const id = actions.addShootDay()
    setNewestId(id)
  }

  // Scroll the new card into view after it renders.
  useEffect(() => {
    if (newestId && listBottomRef.current) {
      listBottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [newestId, shootDays.length])

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

  return (
    <div className="pm-module">
      <div className="pm-module-head">
        <h1 className="pm-h1">Shooting Schedule</h1>
        <button className="pm-btn pm-btn--primary" onClick={handleAddDay}>
          + Add shoot day
        </button>
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
        <>
          {dateGroups.map(([, daysInGroup]) =>
            daysInGroup.map((day) => {
              const index = allOrdered.findIndex(d => d.id === day.id)
              const isPrep = day.dayCategory === 'prep'
              return (
                <div
                  key={day.id}
                  style={isPrep ? { marginLeft: 32 } : undefined}
                >
                  <ShootDayCard
                    day={day}
                    index={index}
                    totalDays={totalDays}
                    defaultExpanded={day.id === newestId}
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
                    additionals={additionalsByDate[day.date] ?? []}
                    production={production}
                    castMembers={castMembers ?? []}
                  />
                </div>
              )
            })
          )}
          <div ref={listBottomRef} />
        </>
      )}
    </div>
  )
}
