import { useState, useRef, useEffect } from 'react'
import ShootDayCard from './ShootDayCard'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const CATEGORY_STYLE = {
  main:      { bg: '#2563eb', text: '#fff' },
  prep:      { bg: '#7c3aed', text: '#fff' },
  splinter:  { bg: '#0891b2', text: '#fff' },
  rehearsal: { bg: '#059669', text: '#fff' },
  unscheduled: { bg: '#b45309', text: '#fff' },
  other:     { bg: '#6b7280', text: '#fff' },
}

export function dayLabel(day) {
  const loc = (day.location || day.locations?.[0] || '').trim()
  const locStr = loc ? ' — ' + loc : ''
  switch (day.dayCategory) {
    case 'main': {
      // No date = in the scratchpad, show TBD regardless of stored number
      const num = day.date ? (day.dayNumber ?? 'TBD') : 'TBD'
      return `Day ${num}${locStr}`
    }
    case 'prep':      return `Prep${day.dayLabel ? ' ' + day.dayLabel : ''}${locStr}`
    case 'splinter':  return `Splinter${day.dayLabel ? ' ' + day.dayLabel : ''}${locStr}`
    case 'rehearsal': return `Rehearsal${day.dayLabel ? ' ' + day.dayLabel : ''}${locStr}`
    case 'unscheduled': return `Unscheduled${locStr}`
    default:          return `${day.dayLabel ? day.dayLabel : 'Other'}${locStr}`
  }
}

function todayStr() {
  const t = new Date()
  return [t.getFullYear(), String(t.getMonth()+1).padStart(2,'0'), String(t.getDate()).padStart(2,'0')].join('-')
}

export function addDaysToDate(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}

function diffDays(a, b) {
  return Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00')) / 86400000)
}

// Build a 6-row × 7-col grid of date strings (Mon-first). Nulls = padding.
function buildMonthGrid(year, month) {
  const firstDow = new Date(year, month, 1).getDay() // 0=Sun
  const startOffset = firstDow === 0 ? 6 : firstDow - 1 // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const pad = (v) => String(v).padStart(2, '0')
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${pad(month + 1)}-${pad(d)}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  const rows = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  return rows
}

function fmtMonthYear(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

// ─── DayEditModal — wraps ShootDayCard in an overlay ─────────────────────────

export function DayEditModal({
  day, shootDays, actions,
  additionalsByDate, additionalsByDayId,
  production, castMembers, allLocations,
  onDateChange, onClose,
}) {
  const index = shootDays.findIndex(d => d.id === day.id)
  const additionals = day.dayCategory === 'main'
    ? (additionalsByDate[day.date]  ?? [])
    : (additionalsByDayId[day.id]   ?? [])

  function handleDelete(id) {
    actions.deleteShootDay(id)
    onClose()
  }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="cal-edit-overlay" onClick={onClose}>
      <div className="cal-edit-modal" onClick={e => e.stopPropagation()}>
        <button className="cal-edit-close" onClick={onClose} title="Close">✕</button>
        <div className="cal-edit-inner">
          <ShootDayCard
            day={day}
            index={index}
            totalDays={shootDays.length}
            defaultExpanded={true}
            onUpdate={actions.updateShootDay}
            onDelete={handleDelete}
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
            onToggleExpanded={() => {}}
            additionals={additionals}
            production={production}
            castMembers={castMembers ?? []}
            allLocations={allLocations}
            onDateChange={(d, newDate) => {
              onDateChange(d, newDate)
              onClose()
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Day strip (draggable pill inside a cell) ─────────────────────────────────

function DayStrip({
  day, isSelected, onSelect, onClick,
  onDragStart, onDragEnd, inDrawer = false,
}) {
  const style  = CATEGORY_STYLE[day.dayCategory] ?? CATEGORY_STYLE.other
  const isSub  = day.dayCategory !== 'main'
  const scenes = day.scenes ?? []
  const sceneNums = scenes.map(s => s.sceneNumber).filter(Boolean)

  return (
    <div
      className={[
        'cal-strip',
        isSub     ? 'cal-strip--sub'      : '',
        isSelected ? 'cal-strip--selected' : '',
        inDrawer   ? 'cal-strip--drawer'   : '',
      ].filter(Boolean).join(' ')}
      style={{ '--strip-bg': style.bg, '--strip-text': style.text }}
      draggable
      onDragStart={e => onDragStart(e, day.id)}
      onDragEnd={onDragEnd}
      onClick={e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) { e.stopPropagation(); onSelect(day.id) }
        else onClick(day.id)
      }}
      title={`${dayLabel(day)}${day.date ? ' — ' + day.date : ''}${day._virtualDate ? '\n(Unscheduled — shown here at wrap+1; not actually dated)' : ''}\nCmd/Ctrl+click to select`}
    >
      <span
        className="cal-strip-check"
        onClick={e => { e.stopPropagation(); onSelect(day.id) }}
        title={isSelected ? 'Deselect' : 'Select'}
      >
        {isSelected ? '✓' : ''}
      </span>
      <div className="cal-strip-body">
        <span className="cal-strip-label">{dayLabel(day)}</span>
        {inDrawer && sceneNums.length > 0 && (
          <span className="cal-strip-scenes">Sc {sceneNums.join(', ')}</span>
        )}
      </div>
    </div>
  )
}

// ─── Add-day dropdown ─────────────────────────────────────────────────────────

function AddDayMenu({ date, mainDayOnDate, onAdd, onClose }) {
  const items = [
    { label: '+ Shoot Day',     cat: 'main'      },
    { label: '+ Prep Day',      cat: 'prep'      },
    { label: '+ Splinter Day',  cat: 'splinter'  },
    { label: '+ Rehearsal Day', cat: 'rehearsal' },
    { label: '+ Other Day',     cat: 'other'     },
  ]
  return (
    <div className="cal-add-menu" onClick={e => e.stopPropagation()}>
      {items.map(({ label, cat }) => {
        const disabled = cat === 'main' && !!mainDayOnDate
        return (
          <button
            key={cat}
            className={`cal-add-menu-item${disabled ? ' cal-add-menu-item--disabled' : ''}`}
            disabled={disabled}
            title={disabled ? 'A main shoot day already exists on this date' : undefined}
            onMouseDown={e => {
              e.preventDefault()
              if (disabled) return
              onAdd(cat, date, mainDayOnDate)
              onClose()
            }}
          >
            {label}
            {disabled && <span className="cal-add-menu-item-note"> (already scheduled)</span>}
          </button>
        )
      })}
    </div>
  )
}

// ─── Main CalendarView component ──────────────────────────────────────────────

export default function CalendarView({
  shootDays, production, castMembers, allLocations, actions,
  additionalsByDate, additionalsByDayId,
  selectedDayIds, onSelectionChange,
  onDateChange, onMoveDaysTo,
  expandedIds, onToggleExpanded,
}) {
  const today = todayStr()

  // ── Month state — persisted to localStorage ────────────────────────────────
  const [monthState, setMonthState] = useState(() => {
    try {
      const saved = localStorage.getItem('fm_calendar_month')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (typeof parsed.year === 'number' && typeof parsed.month === 'number') return parsed
      }
    } catch {}
    const firstDated = [...shootDays]
      .filter(d => d.date)
      .sort((a, b) => a.date.localeCompare(b.date))[0]
    const ref = firstDated ? new Date(firstDated.date + 'T00:00:00') : new Date()
    return { year: ref.getFullYear(), month: ref.getMonth() }
  })

  function saveAndSetMonth(newState) {
    localStorage.setItem('fm_calendar_month', JSON.stringify(newState))
    setMonthState(newState)
  }

  const { year, month } = monthState
  const grid = buildMonthGrid(year, month)

  // ── Edit modal & add-menu state ────────────────────────────────────────────
  const [editingDayId, setEditingDayId] = useState(null)
  const [addMenuDate,  setAddMenuDate]  = useState(null)

  // ── Drawer state ───────────────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false)

  // ── Drag state ─────────────────────────────────────────────────────────────
  const draggingIdRef    = useRef(null)
  const [dragOverDate,   setDragOverDate]   = useState(null)
  const [dragOverDrawer, setDragOverDrawer] = useState(false)

  // ── Build date → days map ──────────────────────────────────────────────────
  // Unscheduled days (scenes not yet assigned to a shoot day) have no real date.
  // We place them virtually on the calendar at wrap+1 (the day after the last
  // dated main shoot day) so they're visible — without writing that date to the DB.
  const wrapDate = shootDays
    .filter(d => d.dayCategory === 'main' && d.date)
    .reduce((max, d) => (max == null || d.date > max ? d.date : max), null)
  const unschedDate = wrapDate ? addDaysToDate(wrapDate, 1) : null

  const byDate = {}
  const undated = []
  for (const day of shootDays) {
    // Unscheduled days with no date → virtual placement at wrap+1 (if we know it).
    if (day.dayCategory === 'unscheduled' && !day.date) {
      if (unschedDate) {
        if (!byDate[unschedDate]) byDate[unschedDate] = []
        byDate[unschedDate].push({ ...day, date: unschedDate, _virtualDate: true })
      } else {
        undated.push(day) // no wrap date known — fall back to scratchpad so it's not lost
      }
      continue
    }
    if (!day.date) { undated.push(day); continue }
    if (!byDate[day.date]) byDate[day.date] = []
    byDate[day.date].push(day)
  }
  // Within each date: main/splinter first by sortOrder, then prep
  for (const key of Object.keys(byDate)) {
    const main = byDate[key].filter(d => d.dayCategory !== 'prep').sort((a,b) => a.sortOrder - b.sortOrder)
    const prep = byDate[key].filter(d => d.dayCategory === 'prep').sort((a,b) => a.sortOrder - b.sortOrder)
    byDate[key] = [...main, ...prep]
  }

  // ── Month navigation ───────────────────────────────────────────────────────
  function prevMonth() {
    setMonthState(s => {
      const next = s.month === 0 ? { year: s.year - 1, month: 11 } : { ...s, month: s.month - 1 }
      localStorage.setItem('fm_calendar_month', JSON.stringify(next))
      return next
    })
  }
  function nextMonth() {
    setMonthState(s => {
      const next = s.month === 11 ? { year: s.year + 1, month: 0 } : { ...s, month: s.month + 1 }
      localStorage.setItem('fm_calendar_month', JSON.stringify(next))
      return next
    })
  }
  function goToToday() {
    const now = new Date()
    const next = { year: now.getFullYear(), month: now.getMonth() }
    saveAndSetMonth(next)
  }

  // ── Add day from calendar ──────────────────────────────────────────────────
  function handleAddDay(cat, date, mainDayOnDate) {
    if (cat === 'prep' && mainDayOnDate) {
      actions.addPrepDay({ date, id: mainDayOnDate.id, dayNumber: mainDayOnDate.dayNumber })
    } else if (cat === 'splinter' && mainDayOnDate) {
      actions.addSplinterDay({ date, id: mainDayOnDate.id, dayNumber: mainDayOnDate.dayNumber })
    } else {
      actions.addShootDay(cat, date)
    }
  }

  // ── Drag handlers ──────────────────────────────────────────────────────────
  function onStripDragStart(e, dayId) {
    draggingIdRef.current = dayId
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', dayId)
    const day = shootDays.find(d => d.id === dayId)
    if (day) e.dataTransfer.setData('application/json', JSON.stringify({ label: dayLabel(day) }))
    // Pop the drawer open as a visible drop target as soon as a drag begins
    setDrawerOpen(true)
  }

  function onStripDragEnd() {
    draggingIdRef.current = null
    setDragOverDate(null)
    setDragOverDrawer(false)
    // Leave drawer open so user can see what landed there
  }

  function onCellDragOver(e, dateStr) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverDate(dateStr)
  }

  function onCellDragLeave(dateStr) {
    setDragOverDate(d => d === dateStr ? null : d)
  }

  function onCellDrop(e, dropDate) {
    e.preventDefault()
    setDragOverDate(null)
    const dayId = draggingIdRef.current
    if (!dayId) return
    const day = shootDays.find(d => d.id === dayId)
    if (!day || day.date === dropDate) return

    if (selectedDayIds.has(dayId) && selectedDayIds.size > 1) {
      // Multi-select move: check if any dragged main day would clash with an
      // existing main day on the target date (after applying the same delta)
      const selected = shootDays.filter(d => selectedDayIds.has(d.id) && d.date)
      const anchor   = selected.find(d => d.id === dayId)
      if (anchor) {
        const delta = Math.round(
          (new Date(dropDate + 'T00:00:00') - new Date(anchor.date + 'T00:00:00')) / 86400000
        )
        // Build a set of dates occupied by main days NOT in the selection
        const existingMainDates = new Set(
          shootDays
            .filter(d => d.dayCategory === 'main' && d.date && !selectedDayIds.has(d.id))
            .map(d => d.date)
        )
        const wouldClash = selected.some(d => {
          if (d.dayCategory !== 'main') return false
          const newDate = addDaysToDate(d.date, delta)
          return existingMainDates.has(newDate)
        })
        if (wouldClash) return
      }
      onMoveDaysTo(dayId, dropDate)
    } else {
      // Single-day move: block if dragging a main day onto a date that already has one
      if (day.dayCategory === 'main') {
        const existingMain = shootDays.find(
          d => d.dayCategory === 'main' && d.date === dropDate && d.id !== day.id
        )
        if (existingMain) return
      }
      onDateChange(day, dropDate)
    }
  }

  function onDrawerDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverDrawer(true)
  }

  function onDrawerDrop(e) {
    e.preventDefault()
    setDragOverDrawer(false)
    const dayId = draggingIdRef.current
    if (!dayId) return

    if (selectedDayIds.has(dayId) && selectedDayIds.size > 1) {
      // Move the whole selection into the scratchpad
      shootDays
        .filter(d => selectedDayIds.has(d.id) && d.date)
        .forEach(d => actions.updateShootDay(d.id, 'date', ''))
    } else {
      const day = shootDays.find(d => d.id === dayId)
      if (!day || !day.date) return
      actions.updateShootDay(dayId, 'date', '')
    }
  }

  // ── Selection ──────────────────────────────────────────────────────────────
  function handleSelect(dayId) {
    const day = shootDays.find(d => d.id === dayId)
    const nowSelected = !selectedDayIds.has(dayId)
    onSelectionChange(dayId, nowSelected)
  }

  // ── Editing ────────────────────────────────────────────────────────────────
  const editingDay = editingDayId ? shootDays.find(d => d.id === editingDayId) : null

  // ── Check if any shoot days fall in the displayed month ───────────────────
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`
  const hasShootDaysThisMonth = shootDays.some(d => d.date?.startsWith(monthStr))

  return (
    <div className="cal-root">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="cal-header">
        <div className="cal-nav">
          <button className="cal-nav-btn" onClick={prevMonth} title="Previous month">‹</button>
          <span className="cal-month-label">{fmtMonthYear(year, month)}</span>
          <button className="cal-nav-btn" onClick={nextMonth} title="Next month">›</button>
        </div>
        <div className="cal-header-actions">
          {undated.length > 0 && (
            <button
              className={`cal-drawer-toggle${drawerOpen ? ' active' : ''}`}
              onClick={() => setDrawerOpen(v => !v)}
            >
              Scratchpad {undated.length > 0 && <span className="cal-drawer-badge">{undated.length}</span>}
            </button>
          )}
          <button className="pm-btn pm-btn--ghost cal-today-btn" onClick={goToToday}>Today</button>
        </div>
      </div>

      {/* ── Weekday labels ─────────────────────────────────────────────────── */}
      <div className="cal-weekdays">
        {WEEKDAYS.map(w => (
          <div key={w} className={`cal-weekday${w === 'Sat' || w === 'Sun' ? ' cal-weekday--weekend' : ''}`}>
            {w}
          </div>
        ))}
      </div>

      {/* ── Grid ───────────────────────────────────────────────────────────── */}
      <div className="cal-grid">
        {grid.map((row, ri) => (
          <div key={ri} className="cal-row">
            {row.map((dateStr, ci) => {
              const isToday   = dateStr === today
              const isWeekend = ci >= 5
              const daysHere  = dateStr ? (byDate[dateStr] ?? []) : []
              const isDragOver = dateStr && dragOverDate === dateStr
              const mainDay   = daysHere.find(d => d.dayCategory === 'main') ?? null

              return (
                <div
                  key={ci}
                  className={[
                    'cal-cell',
                    !dateStr          ? 'cal-cell--empty'   : '',
                    isToday           ? 'cal-cell--today'   : '',
                    isWeekend         ? 'cal-cell--weekend' : '',
                    isDragOver        ? 'cal-cell--dragover' : '',
                    daysHere.length   ? 'cal-cell--has-days' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setAddMenuDate(null)}
                  onDragOver={dateStr ? e => onCellDragOver(e, dateStr) : undefined}
                  onDragLeave={dateStr ? () => onCellDragLeave(dateStr) : undefined}
                  onDrop={dateStr ? e => onCellDrop(e, dateStr) : undefined}
                >
                  {dateStr && (
                    <>
                      <div className="cal-cell-head">
                        <span className={`cal-date-num${isToday ? ' cal-date-num--today' : ''}`}>
                          {parseInt(dateStr.slice(8))}
                        </span>
                        <button
                          className="cal-add-btn"
                          title="Add shoot day"
                          onClick={e => {
                            e.stopPropagation()
                            setAddMenuDate(prev => prev === dateStr ? null : dateStr)
                          }}
                        >+</button>
                        {addMenuDate === dateStr && (
                          <AddDayMenu
                            date={dateStr}
                            mainDayOnDate={mainDay}
                            onAdd={handleAddDay}
                            onClose={() => setAddMenuDate(null)}
                          />
                        )}
                      </div>
                      <div className="cal-cell-days">
                        {daysHere.map(day => (
                          <DayStrip
                            key={day.id}
                            day={day}
                            isSelected={selectedDayIds.has(day.id)}
                            onSelect={handleSelect}
                            onClick={id => setEditingDayId(id)}
                            onDragStart={onStripDragStart}
                            onDragEnd={onStripDragEnd}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* ── Scratchpad drawer ──────────────────────────────────────────────── */}
      <div
        className={`cal-drawer${drawerOpen ? ' cal-drawer--open' : ''}${dragOverDrawer ? ' cal-drawer--dragover' : ''}`}
        onDragOver={onDrawerDragOver}
        onDragLeave={() => setDragOverDrawer(false)}
        onDrop={onDrawerDrop}
      >
        <div className="cal-drawer-bar" onClick={() => setDrawerOpen(v => !v)}>
          <span>Scratchpad — unscheduled days</span>
          <span className="cal-drawer-caret">{drawerOpen ? '▾' : '▴'}</span>
        </div>
        {drawerOpen && (
          <div className="cal-drawer-content">
            {undated.length === 0 ? (
              <div className="cal-drawer-empty">
                Drag shoot days here to remove their date.
                <br/>Drag from here onto the calendar to reschedule.
              </div>
            ) : (
              <div className="cal-drawer-strips">
                {undated.map(day => (
                  <DayStrip
                    key={day.id}
                    day={day}
                    isSelected={selectedDayIds.has(day.id)}
                    onSelect={handleSelect}
                    onClick={id => setEditingDayId(id)}
                    onDragStart={onStripDragStart}
                    onDragEnd={onStripDragEnd}
                    inDrawer={true}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Day edit modal ─────────────────────────────────────────────────── */}
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
