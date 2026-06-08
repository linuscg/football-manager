import { useState, useMemo, useEffect, useRef } from 'react'
import ShootDayCard from '../components/ShootDayCard'
import CalendarView from '../components/CalendarView'
import WeekView from '../components/WeekView'
import { useCrewStore } from '../store/useCrewStore'
import { useAccommodationStore } from '../store/useAccommodationStore'
import { exportScheduleListPDF, exportScheduleCalendarPDF } from '../lib/exportSchedulePDF'
import ScheduleImportModal from './ScheduleImportModal'

function todayStr() {
  const t = new Date()
  return [t.getFullYear(), String(t.getMonth()+1).padStart(2,'0'), String(t.getDate()).padStart(2,'0')].join('-')
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}

export default function Schedule({ store, actions }) {
  const { shootDays, production, castMembers } = store
  const { resources, bookings } = useCrewStore()
  const { assignments } = useAccommodationStore()

  // ── Auto-renumber: runs after React commits whenever any main day's date changes
  // Uses a ref so the effect always calls the latest store closure.
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  const renumberKey = useMemo(() =>
    shootDays
      .filter(d => d.dayCategory === 'main' && d.date)
      .map(d => `${d.id}:${d.date}`)
      .sort()
      .join('|')
  , [shootDays])

  useEffect(() => {
    if (renumberKey) actionsRef.current.resequenceDayNumbers()
  }, [renumberKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── View mode ───────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState(() =>
    localStorage.getItem('fm_schedule_view') ?? 'list'
  )
  function switchView(v) {
    setViewMode(v)
    localStorage.setItem('fm_schedule_view', v)
  }

  // ── AI PDF import ─────────────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false)

  // ── Selection ───────────────────────────────────────────────────────────────
  const [selectedDayIds, setSelectedDayIds] = useState(new Set())

  function handleSelectionChange(dayId, selected) {
    const day = shootDays.find(d => d.id === dayId)
    setSelectedDayIds(prev => {
      const next = new Set(prev)
      if (selected) {
        next.add(dayId)
        // Auto-select all days sharing the same date when a main day is selected
        if (day?.dayCategory === 'main' && day.date) {
          shootDays.filter(d => d.date === day.date && d.id !== dayId).forEach(d => next.add(d.id))
        }
      } else {
        next.delete(dayId)
        if (day?.dayCategory === 'main' && day.date) {
          shootDays.filter(d => d.date === day.date && d.id !== dayId).forEach(d => next.delete(d.id))
        }
      }
      return next
    })
  }

  // ── Date changes — direct, no modal ────────────────────────────────────────

  // Single day: also moves sub-days on the same date (main day only)
  function handleDateChange(day, newDate) {
    if (!newDate || newDate === day.date) return
    // Block placing a second main day on a date that already has one
    if (day.dayCategory === 'main') {
      const clash = shootDays.find(
        d => d.dayCategory === 'main' && d.date === newDate && d.id !== day.id
      )
      if (clash) return
    }
    actions.updateShootDay(day.id, 'date', newDate)
    if (day.dayCategory === 'main' && day.date) {
      shootDays
        .filter(d => d.date === day.date && d.id !== day.id)
        .forEach(d => actions.updateShootDay(d.id, 'date', newDate))
    }
  }

  // Move all selected days by the same delta, anchored to the first selected
  function handleMoveSelected(newStartDate) {
    const selected = shootDays.filter(d => selectedDayIds.has(d.id) && d.date)
    if (selected.length === 0) return
    const sorted = [...selected].sort((a, b) => a.date.localeCompare(b.date))
    const delta = Math.round(
      (new Date(newStartDate + 'T00:00:00') - new Date(sorted[0].date + 'T00:00:00')) / 86400000
    )
    // Check for main-day clashes (existing main days NOT in selection)
    const existingMainDates = new Set(
      shootDays
        .filter(d => d.dayCategory === 'main' && d.date && !selectedDayIds.has(d.id))
        .map(d => d.date)
    )
    const wouldClash = sorted.some(d => {
      if (d.dayCategory !== 'main') return false
      return existingMainDates.has(addDays(d.date, delta))
    })
    if (wouldClash) return
    sorted.forEach(d => actions.updateShootDay(d.id, 'date', addDays(d.date, delta)))
    setSelectedDayIds(new Set())
  }

  // Calendar drag: anchored to the dragged strip
  function handleMoveDaysTo(anchorDayId, newDate) {
    const selected = shootDays.filter(d => selectedDayIds.has(d.id) && d.date)
    const anchor = selected.find(d => d.id === anchorDayId)
    if (!anchor || !newDate) return
    const delta = Math.round(
      (new Date(newDate + 'T00:00:00') - new Date(anchor.date + 'T00:00:00')) / 86400000
    )
    selected.forEach(d => actions.updateShootDay(d.id, 'date', addDays(d.date, delta)))
    setSelectedDayIds(new Set())
  }

  // List-view drag: cross-date reorder
  function handleReorder(fromId, toId) {
    const fromDay = shootDays.find(d => d.id === fromId)
    const toDay   = shootDays.find(d => d.id === toId)
    if (fromDay?.date && toDay?.date && fromDay.date !== toDay.date) {
      handleDateChange(fromDay, toDay.date)
    } else {
      actions.reorderDays(fromId, toId)
    }
  }

  // ── Crew booking lookups ────────────────────────────────────────────────────
  const additionalsByDate  = {}
  const additionalsByDayId = {}

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
  for (const list of [...Object.values(additionalsByDate), ...Object.values(additionalsByDayId)]) {
    list.sort((a, b) =>
      (statusOrder[a.bookingStatus] - statusOrder[b.bookingStatus]) || a.name.localeCompare(b.name)
    )
  }

  // ── Expanded card state ─────────────────────────────────────────────────────
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

  // ── Add handlers ────────────────────────────────────────────────────────────

  function handleAddDay() {
    const id = actions.addShootDay('main', null)
    setExpandedIds(prev => {
      const next = new Set(prev); next.add(id)
      localStorage.setItem('fm_schedule_expanded', JSON.stringify([...next]))
      return next
    })
  }

  function handleAddBeside(date) {
    const id = actions.addShootDay('other', date)
    setExpandedIds(prev => {
      const next = new Set(prev); next.add(id)
      localStorage.setItem('fm_schedule_expanded', JSON.stringify([...next]))
      return next
    })
  }

  // ── Locations autocomplete ──────────────────────────────────────────────────
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

  // ── List view grouping ──────────────────────────────────────────────────────
  const dateGroups = []
  const seenDates  = []
  const byDate     = {}

  for (const day of shootDays) {
    const key = day.date || `no-date-${day.id}`
    if (!byDate[key]) { byDate[key] = []; seenDates.push(key) }
    byDate[key].push(day)
  }

  seenDates.sort((a, b) => {
    if (a.startsWith('no-date')) return 1
    if (b.startsWith('no-date')) return -1
    return a.localeCompare(b)
  })

  for (const date of seenDates) {
    const group = byDate[date]
    const mainSplinter = group.filter(d => d.dayCategory !== 'prep').sort((a, b) => a.sortOrder - b.sortOrder)
    const prep         = group.filter(d => d.dayCategory === 'prep').sort((a, b) => a.sortOrder - b.sortOrder)
    dateGroups.push([date, [...mainSplinter, ...prep]])
  }

  const allOrdered = dateGroups.flatMap(([, days]) => days)
  const totalDays  = allOrdered.length

  // ── Render helpers ──────────────────────────────────────────────────────────
  const shootStart = production.shootStartDate
  const shootEnd   = production.shootEndDate
  function fmtDate(d) {
    if (!d) return ''
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const today        = todayStr()
  const hasTodayCard = shootDays.some(d => d.date === today)

  function jumpToToday() {
    document.querySelector(`[data-day-date="${today}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="pm-module">
      {viewMode === 'list' && hasTodayCard && (
        <button className="schedule-jump-today" onClick={jumpToToday}>Jump to today</button>
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
              className={`schedule-view-btn${viewMode === 'list'     ? ' active' : ''}`}
              onClick={() => switchView('list')}     title="List view"
            >☰ List</button>
            <button
              className={`schedule-view-btn${viewMode === 'calendar' ? ' active' : ''}`}
              onClick={() => switchView('calendar')} title="Calendar view"
            >▦ Calendar</button>
            <button
              className={`schedule-view-btn${viewMode === 'week' ? ' active' : ''}`}
              onClick={() => switchView('week')} title="Week view"
            >▤ Week</button>
          </div>
          <button
            className="pm-btn pm-btn--ghost"
            onClick={() => {
              if (viewMode === 'calendar') {
                exportScheduleCalendarPDF({ shootDays, production })
              } else {
                exportScheduleListPDF({ shootDays, production, castMembers: castMembers ?? [] })
              }
            }}
          >↓ Export PDF</button>
          <button className="pm-btn pm-btn--ghost" onClick={() => setImportOpen(true)}>↑ Import PDF</button>
          <button className="pm-btn pm-btn--primary" onClick={handleAddDay}>+ Add shoot day</button>
        </div>
      </div>

      {shootDays.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-text">No shoot days yet.</div>
          <div className="empty-state-sub">Click &ldquo;Add shoot day&rdquo; to get started.</div>
        </div>

      ) : viewMode === 'week' ? (
        <WeekView
          shootDays={shootDays}
          production={production}
          castMembers={castMembers}
          allLocations={allLocations}
          actions={actions}
          additionalsByDate={additionalsByDate}
          additionalsByDayId={additionalsByDayId}
          expandedIds={expandedIds}
          onToggleExpanded={handleToggleExpanded}
          onDateChange={handleDateChange}
        />

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
          onDateChange={handleDateChange}
          onMoveDaysTo={handleMoveDaysTo}
          expandedIds={expandedIds}
          onToggleExpanded={handleToggleExpanded}
        />

      ) : (
        <div className="pm-day-list">
          {dateGroups.map(([, daysInGroup]) =>
            daysInGroup.map((day) => {
              const index    = allOrdered.findIndex(d => d.id === day.id)
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
                      onDateChange={(d, newDate) => handleDateChange(d, newDate)}
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

      {importOpen && (
        <ScheduleImportModal
          existing={{ shootDays: store.shootDays, castMembers: store.castMembers ?? [] }}
          onClose={() => setImportOpen(false)}
          onApply={async (plan) => { return await actions.applyScheduleImport(plan) }}
        />
      )}
    </div>
  )
}
