import { useState, useRef } from 'react'
import SceneRow from './SceneRow'

const DAY_TYPES = [
  { value: 'SWD',  label: 'SWD — Standard' },
  { value: 'CWD',  label: 'CWD — Continuous' },
  { value: 'SCWD', label: 'SCWD — Semi-Continuous' },
]

function calcWrapTime(generalCall, workHours, lunchMinutes) {
  if (!generalCall) return null
  const [h, m] = generalCall.split(':').map(Number)
  const total = h * 60 + m + Math.round(workHours * 60) + (lunchMinutes ?? 0)
  const wh = Math.floor(total / 60) % 24
  const wm = total % 60
  return `${String(wh).padStart(2, '0')}:${String(wm).padStart(2, '0')}`
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const STATUS_LABEL = { booked: 'Confirmed', hold: 'On Hold', unavailable: 'Unavailable' }
const STATUS_ICON  = { booked: '✓',         hold: 'H',         unavailable: '✕' }

export default function ShootDayCard({
  day,
  index,
  totalDays,
  defaultExpanded = false,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onReorder,
  onAddScene,
  onDeleteScene,
  onUpdateScene,
  additionals = [],
  production = {},
}) {
  // Resolve which day type applies and calculate wrap time
  const effectiveDayType = day.dayType || production.defaultDayType || 'SWD'
  const lunchMinutes = effectiveDayType === 'CWD'  ? (production.cwdLunch  ?? 0)
                     : effectiveDayType === 'SCWD' ? (production.scwdLunch ?? 30)
                     :                               (production.swdLunch  ?? 60)
  const wrapTime = calcWrapTime(day.generalCall, production.workHours ?? 10, lunchMinutes)
  const [expanded,         setExpanded]         = useState(defaultExpanded)
  const [additionalsOpen,  setAdditionalsOpen]  = useState(false)
  const [isDragOver,       setIsDragOver]       = useState(false)
  const cardRef = useRef(null)

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  // Only activate dragging when the user grabs the handle — otherwise text
  // selection inside the card is impossible.
  function onHandleMouseDown() {
    cardRef.current?.setAttribute('draggable', 'true')
  }

  function handleDragStart(e) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', day.id)
  }

  function handleDragEnd() {
    cardRef.current?.setAttribute('draggable', 'false')
    setIsDragOver(false)
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  function handleDragLeave() {
    setIsDragOver(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    setIsDragOver(false)
    const fromId = e.dataTransfer.getData('text/plain')
    if (fromId && fromId !== day.id) {
      onReorder(fromId, day.id)
    }
  }

  // ── Delete with confirmation ───────────────────────────────────────────────
  function handleDelete(e) {
    e.stopPropagation()
    if (window.confirm(`Delete Day ${day.dayNumber}? This cannot be undone.`)) {
      onDelete(day.id)
    }
  }

  const sceneCount = day.scenes.length

  return (
    <div
      ref={cardRef}
      className={`day-card${day.isNonShootDay ? ' non-shoot' : ''}${isDragOver ? ' drag-over' : ''}`}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="day-card-header" onClick={() => setExpanded(e => !e)}>
        <span
          className="drag-handle"
          onMouseDown={onHandleMouseDown}
          onClick={e => e.stopPropagation()}
          title="Drag to reorder"
        >
          ⠿
        </span>

        {!day.isNonShootDay && (
          <span className="day-number-label">Day {day.dayNumber}</span>
        )}

        <div className="day-summary">
          <span className="day-date-display">{formatDateDisplay(day.date)}</span>
          {day.isNonShootDay ? (
            <span className="day-location-display">
              {day.description || <span style={{ color: '#d1d5db', fontStyle: 'italic' }}>Non-shooting</span>}
            </span>
          ) : (
            <>
              {(day.locations ?? [day.location]).filter(Boolean).length > 0 && (
                <span className="day-location-display">
                  {(day.locations ?? [day.location]).filter(Boolean).join(' · ')}
                </span>
              )}
              <span className="day-scene-count">
                {sceneCount} scene{sceneCount !== 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>

        {day.isNonShootDay && (
          <span className="non-shoot-badge">Non-shooting</span>
        )}

        <div
          className="day-header-actions"
          onClick={e => e.stopPropagation()}
        >
          <button
            className="btn-icon"
            onClick={() => onMoveUp(day.id)}
            disabled={index === 0}
            title="Move up"
          >
            ↑
          </button>
          <button
            className="btn-icon"
            onClick={() => onMoveDown(day.id)}
            disabled={index === totalDays - 1}
            title="Move down"
          >
            ↓
          </button>
          <button
            className="btn-icon danger"
            onClick={handleDelete}
            title="Delete day"
          >
            ✕
          </button>
        </div>

        <span className={`chevron${expanded ? ' open' : ''}`}>▶</span>
      </div>

      {/* ── Expanded body ──────────────────────────────────────────────────── */}
      {expanded && (
        <div className="day-card-body">
          <div className="field-grid">
            {!day.isNonShootDay && (
              <div className="field-group">
                <label className="field-label">Day #</label>
                <input
                  className="field-input"
                  type="number"
                  min="1"
                  value={day.dayNumber ?? ''}
                  onChange={e =>
                    onUpdate(day.id, 'dayNumber', parseInt(e.target.value, 10) || 1)
                  }
                />
              </div>
            )}

            <div className="field-group">
              <label className="field-label">Date</label>
              <input
                className="field-input"
                type="date"
                value={day.date}
                onChange={e => onUpdate(day.id, 'date', e.target.value)}
              />
            </div>

            {day.isNonShootDay && (
              <div className="field-group">
                <label className="field-label">Description</label>
                <input
                  className="field-input"
                  type="text"
                  value={day.description}
                  placeholder="e.g. Holiday, Travel day, Turnaround…"
                  autoFocus
                  onChange={e => onUpdate(day.id, 'description', e.target.value)}
                />
              </div>
            )}

            {!day.isNonShootDay && (
              <>
                <div className="field-group">
                  <label className="field-label">General Call</label>
                  <input
                    className="field-input"
                    type="time"
                    value={day.generalCall}
                    onChange={e => onUpdate(day.id, 'generalCall', e.target.value)}
                  />
                </div>

                <div className="field-group">
                  <label className="field-label">Day Type</label>
                  <select
                    className="field-input"
                    value={day.dayType}
                    onChange={e => onUpdate(day.id, 'dayType', e.target.value)}
                  >
                    <option value="">Default ({production.defaultDayType || 'SWD'})</option>
                    {DAY_TYPES.map(dt => (
                      <option key={dt.value} value={dt.value}>{dt.label}</option>
                    ))}
                  </select>
                </div>

                {wrapTime && (
                  <div className="field-group">
                    <label className="field-label">Est. Wrap</label>
                    <div className="field-wrap-time">
                      {wrapTime}
                      <span className="field-wrap-hint">
                        {production.workHours ?? 10}h + {lunchMinutes}min lunch
                      </span>
                    </div>
                  </div>
                )}

                <div className="field-group field-full">
                  <label className="field-label">Location(s)</label>
                  {(day.locations ?? [day.location ?? '']).map((loc, i) => (
                    <div key={i} className="location-row">
                      <input
                        className="field-input"
                        type="text"
                        value={loc}
                        placeholder={i === 0 ? 'Stage 4A, Prague…' : 'Additional location…'}
                        onChange={e => {
                          const next = [...(day.locations ?? [day.location ?? ''])]
                          next[i] = e.target.value
                          onUpdate(day.id, 'locations', next)
                        }}
                      />
                      {(day.locations ?? []).length > 1 && (
                        <button
                          className="btn-icon danger location-remove"
                          title="Remove location"
                          onClick={() => {
                            const next = [...day.locations]
                            next.splice(i, 1)
                            onUpdate(day.id, 'locations', next)
                          }}
                        >✕</button>
                      )}
                    </div>
                  ))}
                  <button
                    className="btn btn-secondary btn-sm btn-add-location"
                    onClick={() => {
                      const current = day.locations ?? [day.location ?? '']
                      onUpdate(day.id, 'locations', [...current, ''])
                    }}
                  >+ Add location</button>
                </div>

                <div className="field-group">
                  <label className="field-label">Unit Base</label>
                  <input
                    className="field-input"
                    type="text"
                    value={day.unitBase}
                    placeholder="Stage car park"
                    onChange={e => onUpdate(day.id, 'unitBase', e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="field-group field-full">
              <label className="field-label">Notes</label>
              <textarea
                className="field-input"
                value={day.notes}
                placeholder="Free notes for this day…"
                onChange={e => onUpdate(day.id, 'notes', e.target.value)}
              />
            </div>
          </div>

          {/* ── Scenes ──────────────────────────────────────────────────────── */}
          {!day.isNonShootDay && (
            <div className="scenes-section">
              <div className="scenes-header">
                <span className="scenes-label">Scenes</span>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => onAddScene(day.id)}
                >
                  + Scene
                </button>
              </div>

              {sceneCount === 0 && (
                <p className="scenes-empty">
                  No scenes — click + Scene to add one.
                </p>
              )}

              {day.scenes.map(scene => (
                <SceneRow
                  key={scene.id}
                  scene={scene}
                  dayId={day.id}
                  onUpdate={onUpdateScene}
                  onDelete={onDeleteScene}
                />
              ))}
            </div>
          )}

          {/* ── Additionals ──────────────────────────────────────────────────── */}
          {!day.isNonShootDay && (
            <div className="additionals-section">
              <div
                className="additionals-header"
                onClick={() => setAdditionalsOpen(o => !o)}
              >
                <span className="scenes-label">Additionals</span>
                {additionals.length > 0 && (
                  <span className="additionals-count">{additionals.length}</span>
                )}
                <span className={`chevron${additionalsOpen ? ' open' : ''}`}>▶</span>
              </div>

              {additionalsOpen && (
                <div className="additionals-body">
                  {additionals.length === 0 ? (
                    <p className="scenes-empty">
                      No crew or equipment booked for this day yet.
                    </p>
                  ) : (() => {
                    const crewItems  = additionals.filter(i => i.type === 'crew')
                    const equipItems = additionals.filter(i => i.type === 'equipment')
                    return (
                      <>
                        {crewItems.length > 0 && (
                          <>
                            <div className="additionals-sub-header">Crew</div>
                            {crewItems.map(item => (
                              <div key={item.id} className="additional-row">
                                <span className={`additional-status-dot ${item.bookingStatus}`} />
                                <span className="additional-name">{item.name}</span>
                                <span className="additional-role">
                                  {[item.role, item.department].filter(Boolean).join(' · ')}
                                </span>
                                <span className={`additional-badge ${item.bookingStatus}`}>
                                  {STATUS_ICON[item.bookingStatus]} {STATUS_LABEL[item.bookingStatus]}
                                </span>
                              </div>
                            ))}
                          </>
                        )}
                        {equipItems.length > 0 && (
                          <>
                            <div className="additionals-sub-header">Equipment</div>
                            {equipItems.map(item => (
                              <div key={item.id} className="additional-row">
                                <span className={`additional-status-dot ${item.bookingStatus}`} />
                                <span className="additional-name">{item.name}</span>
                                <span className="additional-role">{item.category}</span>
                                <span className={`additional-badge ${item.bookingStatus}`}>
                                  {STATUS_ICON[item.bookingStatus]} {STATUS_LABEL[item.bookingStatus]}
                                </span>
                              </div>
                            ))}
                          </>
                        )}
                      </>
                    )
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Non-shoot toggle (always visible at the bottom) ────────────────── */}
      <div
        className="toggle-row"
        onClick={() => onUpdate(day.id, 'isNonShootDay', !day.isNonShootDay)}
      >
        <div className={`toggle-track${day.isNonShootDay ? ' on' : ''}`}>
          <div className="toggle-thumb" />
        </div>
        <span className="toggle-label">Non-shooting day</span>
      </div>
    </div>
  )
}
