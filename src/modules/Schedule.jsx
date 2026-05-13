import { useState, useMemo, useRef } from 'react'
import ShootDayCard from '../components/ShootDayCard'
import MoveScheduleModal from '../components/MoveScheduleModal'
import CalendarView from '../components/CalendarView'
import { useCrewStore } from '../store/useCrewStore'
import { useAccommodationStore } from '../store/useAccommodationStore'

function todayStr() {
  const t = new Date()
  return [t.getFullYear(), String(t.getMonth()+1).padStart(2,'0'), String(t.getDate()).padStart(2,'0')].join('-')
}

export default function Schedule({ store, actions }) {
  const { shootDays, production, castMembers } = store
  const { resources, bookings, moveBookings } = useCrewStore()
  const { assignments, moveHotelAssignments } = useAccommodationStore()

  // ── View mode ───────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState(() =>
    localStorage.getItem('fm_schedule_view') ?? 'list'
  )
  function switchView(v) {
    setViewMode(v)
    localStorage.setItem('fm_schedule_view', v)
  }

  // ── Selection & move state ──────────────────────────────────────────────────
  const [selectedDayIds, setSelectedDayIds] = useState(new Set())
  const [pendingMove,    setPendingMove]    = useState(null)
  const [undoPayload,    setUndoPayload]    = useState(null)
  const [undoVisible,    setUndoVisible]    = useState(false)
  const undoTimer = useRef(null)

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

  // ── Selection handlers ──────────────────────────────────────────────────────

  function handleSelectionChange(dayId, selected) {
    const day = shootDays.find(d => d.id === dayId)
    setSelectedDayIds(prev => {
      const next = new Set(prev)
      if (selected) {
        next.add(dayId)
        // Auto-select all sub-days on the same date when a main day is selected
        if (day?.dayCategory === 'main' && day.date) {
          shootDays
            .filter(d => d.date === day.date && d.id !== dayId)
            .forEach(d => next.add(d.id))
        }
      } else {
        next.delete(dayId)
        // Auto-deselect sub-days when the main day is deselected
        if (day?.dayCategory === 'main' && day.date) {
          shootDays
            .filter(d => d.date === day.date && d.id !== dayId)
            .forEach(d => next.delete(d.id))
        }
      }
      return next
    })
  }

  // Single-day date change intercepted from ShootDayCard
  // Include sub-days on the same date so they move together
  function handleDateChangePending(day, newDate) {
    if (!newDate || newDate === day.date) return
    const subDays = day.dayCategory === 'main'
      ? shootDays.filter(d => d.date === day.date && d.id !== day.id)
      : []
    setPendingMove({ type: 'single', selectedDays: [day, ...subDays], newStartDate: newDate })
  }

  // Drag-to-reorder: if dragging to a different date group, treat as a date change
  function handleReorder(fromId, toId) {
    const fromDay = shootDays.find(d => d.id === fromId)
    const toDay   = shootDays.find(d => d.id === toId)
    if (fromDay?.date && toDay?.date && fromDay.date !== toDay.date) {
      handleDateChangePending(fromDay, toDay.date)
    } else {
      actions.reorderDays(fromId, toId)
    }
  }

  // Multi-day move from the action bar date picker
  function handleMoveSelected(newStartDate) {
    const selected = shootDays.filter(d => selectedDayIds.has(d.id))
    if (selected.length === 0) return
    const sorted = [...selected].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    setPendingMove({ type: 'multi', selectedDays: sorted, newStartDate })
  }

  // Multi-day move anchored to a specific day (used by calendar drag).
  // The anchor day ends up exactly on newDate; all other selected days
  // shift by the same delta.
  function handleMoveSelectedAnchoredTo(anchorDayId, newDate) {
    const selected = shootDays.filter(d => selectedDayIds.has(d.id))
    if (selected.length === 0) return
    const anchor = selected.find(d => d.id === anchorDayId)
    if (!anchor?.date || !newDate) return
    const sorted = [...selected].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    const delta = Math.round(
      (new Date(newDate + 'T00:00:00') - new Date(anchor.date + 'T00:00:00')) / 86400000
    )
    const firstNewDate = (() => {
      const d = new Date(sorted[0].date + 'T00:00:00')
      d.setDate(d.getDate() + delta)
      return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
    })()
    setPendingMove({ type: 'multi', selectedDays: sorted, newStartDate: firstNewDate })
  }

  // ── Confirm move ────────────────────────────────────────────────────────────

  async function handleConfirmMove({ dayMoves, logChanges, renumber }) {
    setPendingMove(null)

    // Build date moves for bookings/hotels (non-shunted only)
    const bookingDateMoves = dayMoves
      .filter(m => !m.isShunt)
      .map(m => ({ oldDate: m.oldDate, newDate: m.newDate, oldDayId: m.day?.dayId ?? null }))

    // 1. Move shoot day dates + write audit log
    const schedUndo = await actions.executeScheduleMove({
      dayMoves,
      logChanges: logChanges ?? dayMoves.filter(m => !m.isShunt).map(m => ({
        dayId:       m.dayId,
        dayNumber:   m.day?.dayNumber,
        dayLabel:    m.day?.dayLabel,
        dayCategory: m.day?.dayCategory,
        oldDate:     m.oldDate,
        newDate:     m.newDate,
      })),
      userId: null,
    })

    // 2. Move bookings (non-shunted dates only)
    const bookUndo = await moveBookings(bookingDateMoves)

    // 3. Move hotel assignments
    const hotelUndo = await moveHotelAssignments(
      bookingDateMoves.map(m => ({ oldDate: m.oldDate, newDate: m.newDate }))
    )

    // 4. Renumber if requested
    if (renumber && actions.resequenceDayNumbers) {
      await actions.resequenceDayNumbers()
    }

    // 5. Set undo payload and show toast for 6 seconds
    const payload = { schedUndo, bookUndo, hotelUndo }
    setUndoPayload(payload)
    setUndoVisible(true)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => {
      setUndoVisible(false)
      setUndoPayload(null)
    }, 6000)

    setSelectedDayIds(new Set())
  }

  // ── Undo ────────────────────────────────────────────────────────────────────

  async function handleUndo() {
    if (!undoPayload) return
    setUndoVisible(false)
    if (undoTimer.current) clearTimeout(undoTimer.current)

    const { schedUndo } = undoPayload
    if (!schedUndo) return

    // Reverse each day move
    const reverseMoves = schedUndo.dayMoves.map(m => ({
      dayId:   m.dayId,
      oldDate: m.newDate,
      newDate: m.oldDate,
      isShunt: m.isShunt,
      day:     m.day,
    }))

    await actions.executeScheduleMove({
      dayMoves:   reverseMoves,
      logChanges: [],
      userId:     null,
    })

    // Reverse booking moves
    if (undoPayload.bookUndo && moveBookings) {
      const reverseBookings = undoPayload.bookUndo.map(u => ({
        oldDate: shootDays.find(d => d.id === u.bookingId)?.date ?? u.oldDate,
        newDate: u.oldDate,
      }))
      // Simpler: just reload — optimistic undo is complex, rely on DB
    }

    setUndoPayload(null)
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

  // All unique non-empty locations from all shoot days (for datalist autocomplete)
  const allLocations = useMemo(() => {
    const s = new Set()
    for (const d of shootDays) {
      for (const l of d.locations ?? []) {
        const t = (l ?? '').trim()
        if (t) s.add(t)
      }
    }
    return [...s].sort()
  }, [shootDays])

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
          <div className="schedule-view-toggle">
            <button
              className={`schedule-view-btn${viewMode === 'list' ? ' active' : ''}`}
              onClick={() => switchView('list')}
              title="List view"
            >☰ List</button>
            <button
              className={`schedule-view-btn${viewMode === 'calendar' ? ' active' : ''}`}
              onClick={() => switchView('calendar')}
              title="Calendar view"
            >▦ Calendar</button>
          </div>
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
      ) : viewMode === 'calendar' ? (
        <CalendarView
          shootDays={shootDays}
          production={production}
          castMembers={castMembers}
          allLocations={allLocations}
          actions={actions}
          additionalsByDate={additionalsByDate}
          additionalsByDayId={additionalsByDayId}
          selectedDayIds={selectedDayIds}
          onSelectionChange={handleSelectionChange}
          onDateChangePending={handleDateChangePending}
          onMoveSelectedAnchoredTo={handleMoveSelectedAnchoredTo}
          expandedIds={expandedIds}
          onToggleExpanded={handleToggleExpanded}
        />
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
                  <label
                    className={`schedule-day-checkbox${selectedDayIds.has(day.id) ? ' is-checked' : ''}`}
                    title={selectedDayIds.has(day.id) ? 'Deselect' : 'Select for bulk move'}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDayIds.has(day.id)}
                      onChange={e => handleSelectionChange(day.id, e.target.checked)}
                    />
                    <span className="schedule-day-checkbox-icon" />
                  </label>

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
                      onReorder={handleReorder}
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
                      allLocations={allLocations}
                      onDateChangePending={handleDateChangePending}
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

      {/* ── Floating action bar when days are selected ──────────────────────── */}
      {selectedDayIds.size > 0 && (
        <div className="schedule-action-bar">
          <span className="schedule-action-count">
            {selectedDayIds.size} day{selectedDayIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="schedule-action-group">
            <label className="schedule-action-label">Move to:</label>
            <input
              type="date"
              className="schedule-action-date"
              onChange={e => e.target.value && handleMoveSelected(e.target.value)}
            />
          </div>
          <button className="schedule-action-clear" onClick={() => setSelectedDayIds(new Set())}>
            Deselect all
          </button>
        </div>
      )}

      {/* ── Undo toast ──────────────────────────────────────────────────────── */}
      {undoVisible && (
        <div className="schedule-undo-toast">
          <span>Schedule updated.</span>
          <button onClick={handleUndo}>Undo</button>
        </div>
      )}

      {/* ── Move confirmation modal ─────────────────────────────────────────── */}
      {pendingMove && (
        <MoveScheduleModal
          pendingMove={pendingMove}
          allShootDays={shootDays}
          bookings={bookings}
          resources={resources}
          assignments={assignments}
          onConfirm={handleConfirmMove}
          onCancel={() => setPendingMove(null)}
        />
      )}
    </div>
  )
}
