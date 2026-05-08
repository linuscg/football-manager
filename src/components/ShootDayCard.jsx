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

const STATUS_LABEL = { booked: 'Confirmed', hold: 'On Hold', unavailable: 'Unavailable' }
const STATUS_ICON  = { booked: '✓',         hold: 'H',         unavailable: '✕' }
const STATUS_PM = { booked: 'w', hold: 'h', unavailable: 'u' }

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

// ─── ExtraSubRow — individual editable extra entry ───────────────────────────

function ExtraSubRow({ dayId, extra, onUpdate, onDelete }) {
  const [lDesc, setLDesc] = useState(extra.description)

  return (
    <div className="extras-sub-row">
      <input
        className="pm-input"
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
        className="pm-icon-btn danger"
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
        <span className="pm-section-label">Additional Info</span>
        {totalCount > 0 && (
          <span className="additionals-count">{totalCount}</span>
        )}
        <span className={`pm-chev${open ? ' open' : ''}`}>▶</span>
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
                  <span className={`pm-chev${isOpen ? ' open' : ''}`} style={{ fontSize: 9 }}>▶</span>
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
                      className="pm-btn pm-btn--ghost pm-btn--sm"
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
  const categoryClass = isPrep ? ' pm-day--prep' : isSplinter ? ' pm-day--splinter' : ''

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
      className={`pm-day${day.isNonShootDay ? ' pm-day--nonshoot' : ''}${isDragOver ? ' drag-over' : ''}${categoryClass}`}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="pm-day-head" onClick={() => setExpanded(e => !e)}>

        {/* Day tab — drag handle lives inside so colour extends into grab area */}
        {isPrep ? (
          <div className="pm-day-tab">
            <span className="pm-day-tab-drag" onMouseDown={onHandleMouseDown} onClick={e => e.stopPropagation()} title="Drag to reorder">⠿</span>
            <span className="pm-day-tab-label">PREP</span>
          </div>
        ) : isSplinter ? (
          <div className="pm-day-tab">
            <span className="pm-day-tab-drag" onMouseDown={onHandleMouseDown} onClick={e => e.stopPropagation()} title="Drag to reorder">⠿</span>
            <span className="pm-day-tab-label">SPLIT</span>
            {day.dayNumber != null && (
              <span className="pm-day-tab-num" style={{ fontSize: 18 }}>D{day.dayNumber}</span>
            )}
          </div>
        ) : day.isNonShootDay ? (
          <div className="pm-day-tab" style={{ background: 'var(--pm-tab-non-bg)' }}>
            <span className="pm-day-tab-drag" style={{ color: 'rgba(0,0,0,0.2)' }} onMouseDown={onHandleMouseDown} onClick={e => e.stopPropagation()} title="Drag to reorder">⠿</span>
            <span className="pm-day-tab-label" style={{ color: '#6b7280' }}>OFF</span>
          </div>
        ) : (
          <div className="pm-day-tab">
            <span className="pm-day-tab-drag" onMouseDown={onHandleMouseDown} onClick={e => e.stopPropagation()} title="Drag to reorder">⠿</span>
            <span className="pm-day-tab-label">DAY</span>
            <span className="pm-day-tab-num">{String(day.dayNumber ?? '—').padStart(2, '0')}</span>
          </div>
        )}

        <div className="pm-day-summary">
          <span className="pm-day-date">{formatDateDisplay(day.date)}</span>
          {isPrep ? (
            <span className="pm-day-loc">
              {(day.locations ?? []).filter(Boolean)[0] || day.description ||
               <span style={{ color: '#d1d5db', fontStyle: 'italic' }}>Prep unit</span>}
            </span>
          ) : day.isNonShootDay ? (
            <span className="pm-day-loc">
              {day.description || <span style={{ color: '#d1d5db', fontStyle: 'italic' }}>Non-shooting</span>}
            </span>
          ) : (
            <>
              {(day.locations ?? [day.location]).filter(Boolean).length > 0 && (
                <span className="pm-day-loc">
                  {(day.locations ?? [day.location]).filter(Boolean).join(' · ')}
                </span>
              )}
            </>
          )}
        </div>

        {!isPrep && !isSplinter && !day.isNonShootDay && (
          <div className="pm-day-meta">
            {day.generalCall && (
              <div className="pm-day-meta-item">
                <span className="pm-day-meta-label">CALL</span>
                <span className="pm-day-meta-val">{day.generalCall.slice(0, 5)}</span>
              </div>
            )}
            {wrapTime && (
              <div className="pm-day-meta-item">
                <span className="pm-day-meta-label">WRAP</span>
                <span className="pm-day-meta-val">{wrapTime}</span>
              </div>
            )}
            <div className="pm-day-meta-item">
              <span className="pm-day-meta-label">TYPE</span>
              <span className="pm-day-meta-val">{effectiveDayType}</span>
            </div>
            <div className="pm-day-meta-item">
              <span className="pm-day-meta-label">SCENES</span>
              <span className="pm-day-meta-val">{sceneCount}</span>
            </div>
          </div>
        )}

        <div
          className="day-header-actions"
          onClick={e => e.stopPropagation()}
        >
          <button
            className="pm-icon-btn"
            onClick={() => onMoveUp(day.id)}
            disabled={index === 0}
            title="Move up"
          >
            ↑
          </button>
          <button
            className="pm-icon-btn"
            onClick={() => onMoveDown(day.id)}
            disabled={index === totalDays - 1}
            title="Move down"
          >
            ↓
          </button>
          <button
            className="pm-icon-btn danger"
            onClick={handleDelete}
            title="Delete day"
          >
            ✕
          </button>
        </div>

        <span className={`pm-day-chev${expanded ? ' is-open' : ''}`}>▶</span>
      </div>

      {/* ── Expanded body ──────────────────────────────────────────────────── */}
      {expanded && (
        <div className="pm-day-body">
          <div className="pm-field-grid">
            {/* Day number — only for main shoot days */}
            {category === 'main' && !day.isNonShootDay && (
              <div className="pm-field-group">
                <label className="pm-field-label">Day #</label>
                <input
                  className="pm-input"
                  type="number"
                  min="1"
                  value={day.dayNumber ?? ''}
                  onChange={e =>
                    onUpdate(day.id, 'dayNumber', parseInt(e.target.value, 10) || 1)
                  }
                />
              </div>
            )}

            <div className="pm-field-group">
              <label className="pm-field-label">Date</label>
              <input
                className="pm-input"
                type="date"
                value={day.date}
                onChange={e => onUpdate(day.id, 'date', e.target.value)}
              />
            </div>

            {/* Description — for non-shoot and prep days */}
            {(day.isNonShootDay || isPrep) && (
              <div className="pm-field-group">
                <label className="pm-field-label">Description</label>
                <input
                  className="pm-input"
                  type="text"
                  value={day.description}
                  placeholder={isPrep ? 'e.g. Camera tests, costume fittings, rigging…' : 'e.g. Holiday, Travel day, Turnaround…'}
                  onChange={e => onUpdate(day.id, 'description', e.target.value)}
                />
              </div>
            )}

            {/* General Call — all day types */}
            <div className="pm-field-group">
              <label className="pm-field-label">General Call</label>
              <input
                className="pm-input"
                type="time"
                value={day.generalCall}
                onChange={e => onUpdate(day.id, 'generalCall', e.target.value)}
              />
            </div>

            {/* Day Type + Wrap — all day types */}
            <div className="pm-field-group">
              <label className="pm-field-label">Day Type</label>
              <select
                className="pm-input"
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
              <div className="pm-field-group">
                <label className="pm-field-label">Est. Wrap</label>
                <div className="field-wrap-time">
                  {wrapTime}
                  <span className="field-wrap-hint">
                    {production.workHours ?? 10}h + {lunchMinutes}min lunch
                  </span>
                </div>
              </div>
            )}

            {/* Locations — all day types */}
            <div className="pm-field-group field-full">
              <label className="pm-field-label">Location(s)</label>
              {(day.locations ?? [day.location ?? '']).map((loc, i) => (
                <div key={i} className="location-row">
                  <input
                    className="pm-input"
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
                      className="pm-icon-btn danger location-remove"
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
                className="pm-btn pm-btn--ghost pm-btn--sm btn-add-location"
                onClick={() => {
                  const current = day.locations ?? [day.location ?? '']
                  onUpdate(day.id, 'locations', [...current, ''])
                }}
              >+ Add location</button>
            </div>

            {/* Unit Base — all day types */}
            <div className="pm-field-group">
              <label className="pm-field-label">Unit Base</label>
              <input
                className="pm-input"
                type="text"
                value={day.unitBase}
                placeholder="Stage car park"
                onChange={e => onUpdate(day.id, 'unitBase', e.target.value)}
              />
            </div>

            <div className="pm-field-group field-full">
              <label className="pm-field-label">Notes</label>
              <textarea
                className="pm-input"
                value={day.notes}
                placeholder="Free notes for this day…"
                onChange={e => onUpdate(day.id, 'notes', e.target.value)}
              />
            </div>
          </div>

          {/* ── Scenes — all day types ───────────────────────────────────────── */}
          <div className="pm-scenes">
            <div className="pm-scenes-head">
              <span className="pm-section-label">Scenes</span>
              <button
                className="pm-btn pm-btn--ghost pm-btn--sm"
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

          {/* ── Additional Info (extras) — all day types ─────────────────────── */}
          <ExtrasSection
            day={day}
            onAddDayExtra={onAddDayExtra}
            onDeleteDayExtra={onDeleteDayExtra}
            onUpdateDayExtra={onUpdateDayExtra}
          />

          {/* ── Prep / Splinter actions (main days only) ─────────────────────── */}
          {category === 'main' && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f0f0ea', display: 'flex', gap: 8 }}>
              <button
                className="pm-btn pm-btn--ghost pm-btn--sm"
                onClick={() => onAddPrepDay(day)}
                title="Add a prep unit for this date"
              >
                ＋ Prep Unit
              </button>
              <button
                className="pm-btn pm-btn--ghost pm-btn--sm"
                onClick={() => onAddSplinterDay(day)}
                title="Add a splinter unit for this date"
              >
                ＋ Splinter
              </button>
            </div>
          )}

          {/* ── Crew & Equipment from gantt — all day types ──────────────────── */}
          <div className="additionals-section">
              <div
                className="additionals-header"
                onClick={() => setAdditionalsOpen(o => !o)}
              >
                <span className="pm-section-label">Additionals</span>
                {additionals.length > 0 && (
                  <span className="additionals-count">{additionals.length}</span>
                )}
                <span className={`pm-chev${additionalsOpen ? ' open' : ''}`}>▶</span>
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
                                <span className={`pm-status pm-status--${STATUS_PM[item.bookingStatus] ?? item.bookingStatus}`}>
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
                                <span className={`pm-status pm-status--${STATUS_PM[item.bookingStatus] ?? item.bookingStatus}`}>
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
        </div>
      )}

      {/* ── Non-shoot toggle — hidden for prep days (always non-shoot) ─────── */}
      {!isPrep && (
        <div
          className="pm-toggle-row"
          onClick={() => onUpdate(day.id, 'isNonShootDay', !day.isNonShootDay)}
        >
          <div className={`pm-toggle${day.isNonShootDay ? ' on' : ''}`}>
            <div className="pm-toggle-thumb" />
          </div>
          <span className="toggle-label">Non-shooting day</span>
        </div>
      )}
    </div>
  )
}
