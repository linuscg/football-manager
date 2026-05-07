import { useState, useRef } from 'react'
import SceneRow from './SceneRow'

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
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [isDragOver, setIsDragOver] = useState(false)
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
          {day.location && (
            <span className="day-location-display">{day.location}</span>
          )}
          {!day.isNonShootDay && (
            <span className="day-scene-count">
              {sceneCount} scene{sceneCount !== 1 ? 's' : ''}
            </span>
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
              <label className="field-label">Location</label>
              <input
                className="field-input"
                type="text"
                value={day.location}
                placeholder="Stage 4A, Prague"
                onChange={e => onUpdate(day.id, 'location', e.target.value)}
              />
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
