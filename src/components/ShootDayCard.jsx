import { useState, useRef } from 'react'
import SceneRow from './SceneRow'

const DAY_TYPES = [
  { value: 'SWD',  label: 'SWD — Standard' },
  { value: 'CWD',  label: 'CWD — Continuous' },
  { value: 'SCWD', label: 'SCWD — Semi-Continuous' },
]

const EXTRAS_CATEGORIES = [
  { key: 'animals',  label: 'Animals' },
  { key: 'risk',     label: 'Risk Assessments' },
  { key: 'stunts',   label: 'Stunts' },
  { key: 'vfx',      label: 'VFX' },
  { key: 'extras',   label: 'Extras' },
  { key: 'visitors', label: 'Visitors' },
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

// ─── ExtraSubRow — individual editable extra entry ───────────────────────────

function ExtraSubRow({ dayId, extra, onUpdate, onDelete }) {
  const [lDesc, setLDesc] = useState(extra.description)

  return (
    <div className="extras-sub-row">
      <input
        className="scene-input"
        type="text"
        value={lDesc}
        placeholder="Description…"
        onChange={e => setLDesc(e.target.value)}
        onBlur={() => {
          if (lDesc !== extra.description) onUpdate(dayId, extra.id, lDesc)
        }}
        style={{ flex: 1 }}
      />
      <button
        className="btn-icon danger"
        onClick={() => onDelete(dayId, extra.id)}
        title="Remove"
      >✕</button>
    </div>
  )
}

// ─── ExtrasSection — the "Additional Info" collapsible block ─────────────────

function ExtrasSection({ day, onAddDayExtra, onDeleteDayExtra, onUpdateDayExtra }) {
  const [open,         setOpen]         = useState(false)
  const [openCats,     setOpenCats]     = useState({})

  const totalCount = EXTRAS_CATEGORIES.reduce((s, c) => {
    return s + (day.extras?.[c.key]?.length ?? 0)
  }, 0)

  function toggleCat(key) {
    setOpenCats(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="extras-section">
      <div
        className="additionals-header"
        onClick={() => setOpen(o => !o)}
      >
        <span className="scenes-label">Additional Info</span>
        {totalCount > 0 && (
          <span className="additionals-count">{totalCount}</span>
        )}
        <span className={`chevron${open ? ' open' : ''}`}>▶</span>
      </div>

      {open && (
        <div className="additionals-body">
          {EXTRAS_CATEGORIES.map(({ key, label }) => {
            const items = day.extras?.[key] ?? []
            const isOpen = !!openCats[key]
            return (
              <div key={key} className="extras-cat-block">
                <div
                  className="additionals-sub-header extras-cat-header"
                  onClick={() => toggleCat(key)}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <span style={{ flex: 1 }}>{label}</span>
                  {items.length > 0 && (
                    <span className="additionals-count">{items.length}</span>
                  )}
                  <span className={`chevron${isOpen ? ' open' : ''}`} style={{ fontSize: 9 }}>▶</span>
                </div>

                {isOpen && (
                  <div style={{ padding: '4px 0 4px 8px' }}>
                    {items.map(extra => (
                      <ExtraSubRow
                        key={extra.id}
                        dayId={day.id}
                        extra={extra}
                        onUpdate={onUpdateDayExtra}
                        onDelete={onDeleteDayExtra}
                      />
                    ))}
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: 4 }}
                      onClick={() => {
                        onAddDayExtra(day.id, key)
                        setOpenCats(prev => ({ ...prev, [key]: true }))
                      }}
                    >
                      + Add {label}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main ShootDayCard ────────────────────────────────────────────────────────

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
  onAddPrepDay,
  onAddSplinterDay,
  onAddDayExtra,
  onDeleteDayExtra,
  onUpdateDayExtra,
  onUpdateSceneCast,
  additionals = [],
  production = {},
  castMembers = [],
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

  const category = day.dayCategory ?? 'main'
  const isPrep     = category === 'prep'
  const isSplinter = category === 'splinter'

  // Category-specific CSS classes
  const categoryClass = isPrep ? ' day-card--prep' : isSplinter ? ' day-card--splinter' : ''

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
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
    const label = isPrep ? 'Prep unit' : isSplinter ? 'Splinter unit' : `Day ${day.dayNumber}`
    if (window.confirm(`Delete ${label}? This cannot be undone.`)) {
      onDelete(day.id)
    }
  }

  const sceneCount = day.scenes.length

  return (
    <div
      ref={cardRef}
      className={`day-card${day.isNonShootDay ? ' non-shoot' : ''}${isDragOver ? ' drag-over' : ''}${categoryClass}`}
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

        {/* Badge: Day N / Prep / Splinter */}
        {isPrep ? (
          <span className="prep-badge">Prep</span>
        ) : isSplinter ? (
          <>
            <span className="splinter-badge">Splinter</span>
            {day.dayNumber != null && (
              <span className="day-number-label" style={{ marginLeft: 4 }}>D{day.dayNumber}</span>
            )}
          </>
        ) : !day.isNonShootDay ? (
          <span className="day-number-label">Day {day.dayNumber}</span>
        ) : null}

        <div className="day-summary">
          <span className="day-date-display">{formatDateDisplay(day.date)}</span>
          {isPrep ? (
            <span className="day-location-display">
              {(day.locations ?? []).filter(Boolean)[0] || day.description ||
               <span style={{ color: '#d1d5db', fontStyle: 'italic' }}>Prep unit</span>}
            </span>
          ) : day.isNonShootDay ? (
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

        {day.isNonShootDay && !isPrep && (
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
            {!day.isNonShootDay && !isPrep && (
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

            {/* Non-shoot main days: description only */}
            {day.isNonShootDay && !isPrep && (
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

            {/* Prep day fields: location(s) + description */}
            {isPrep && (
              <>
                <div className="field-group field-full">
                  <label className="field-label">Location(s)</label>
                  {(day.locations ?? [day.location ?? '']).map((loc, i) => (
                    <div key={i} className="location-row">
                      <input
                        className="field-input"
                        type="text"
                        value={loc}
                        placeholder={i === 0 ? 'Stage 4A, prep area…' : 'Additional location…'}
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
                <div className="field-group field-full">
                  <label className="field-label">Description</label>
                  <input
                    className="field-input"
                    type="text"
                    value={day.description}
                    placeholder="e.g. Camera tests, costume fittings, rigging…"
                    onChange={e => onUpdate(day.id, 'description', e.target.value)}
                  />
                </div>
              </>
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
                  castMembers={castMembers}
                  onUpdateSceneCast={onUpdateSceneCast}
                />
              ))}
            </div>
          )}

          {/* ── Additional Info (extras) ─────────────────────────────────────── */}
          {!day.isNonShootDay && (
            <ExtrasSection
              day={day}
              onAddDayExtra={onAddDayExtra}
              onDeleteDayExtra={onDeleteDayExtra}
              onUpdateDayExtra={onUpdateDayExtra}
            />
          )}

          {/* ── Prep / Splinter actions (main days only) ─────────────────────── */}
          {!day.isNonShootDay && category === 'main' && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f0f0ea', display: 'flex', gap: 8 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => onAddPrepDay(day)}
                title="Add a prep unit for this date"
              >
                ＋ Prep Unit
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => onAddSplinterDay(day)}
                title="Add a splinter unit for this date"
              >
                ＋ Splinter
              </button>
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

      {/* ── Non-shoot toggle — hidden for prep days (always non-shoot) ─────── */}
      {!isPrep && (
        <div
          className="toggle-row"
          onClick={() => onUpdate(day.id, 'isNonShootDay', !day.isNonShootDay)}
        >
          <div className={`toggle-track${day.isNonShootDay ? ' on' : ''}`}>
            <div className="toggle-thumb" />
          </div>
          <span className="toggle-label">Non-shooting day</span>
        </div>
      )}
    </div>
  )
}
