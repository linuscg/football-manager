import { useState, useRef, useEffect } from 'react'
import ShootDayCard from '../components/ShootDayCard'
import { useCrewStore } from '../store/useCrewStore'

export default function Schedule({ store, actions }) {
  const { shootDays } = store
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

  return (
    <div className="module-wrap">
      <div className="module-header">
        <h1 className="module-title">Shooting Schedule</h1>
        <button className="btn btn-primary" onClick={handleAddDay}>
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
          {shootDays.map((day, index) => (
            <ShootDayCard
              key={day.id}
              day={day}
              index={index}
              totalDays={shootDays.length}
              defaultExpanded={day.id === newestId}
              onUpdate={actions.updateShootDay}
              onDelete={actions.deleteShootDay}
              onMoveUp={actions.moveDayUp}
              onMoveDown={actions.moveDayDown}
              onReorder={actions.reorderDays}
              onAddScene={actions.addScene}
              onDeleteScene={actions.deleteScene}
              onUpdateScene={actions.updateScene}
              additionals={additionalsByDate[day.date] ?? []}
            />
          ))}
          <div ref={listBottomRef} />
        </>
      )}
    </div>
  )
}
