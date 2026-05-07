import { useState, useMemo } from 'react'
import { useCrewStore } from '../store/useCrewStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABEL = { booked: 'Confirmed', hold: 'On Hold', unavailable: 'Unavailable', cancelled: 'Cancelled' }
const STATUS_ICON  = { booked: '✓',         hold: 'H',        unavailable: '✕',           cancelled: '✕' }

const EXTRAS_CATEGORY_LABELS = {
  animals:  'Animals',
  risk:     'Risk Assessments',
  stunts:   'Stunts',
  vfx:      'VFX',
  extras:   'Extras',
  visitors: 'Visitors',
}

function formatDateFull(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function formatDateShort(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  })
}

// Wrap time: General Call + work hours + lunch minutes → "HH:MM"
function calcWrapTime(generalCall, workHours, lunchMinutes) {
  if (!generalCall) return null
  const [h, m] = generalCall.split(':').map(Number)
  const total = h * 60 + m + Math.round(workHours * 60) + (lunchMinutes ?? 0)
  const wh = Math.floor(total / 60) % 24
  const wm = total % 60
  return `${String(wh).padStart(2, '0')}:${String(wm).padStart(2, '0')}`
}

// Build a TSV string (tab-separated) from an array of row arrays
function toTSV(headers, rows) {
  return [headers, ...rows].map(r => r.join('\t')).join('\n')
}

async function copyText(text, setFn) {
  try {
    await navigator.clipboard.writeText(text)
    setFn(true)
    setTimeout(() => setFn(false), 1800)
  } catch {
    // fallback for older browsers
    const el = document.createElement('textarea')
    el.value = text
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    setFn(true)
    setTimeout(() => setFn(false), 1800)
  }
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyBtn({ getText }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={`cs-copy-btn no-print${copied ? ' copied' : ''}`}
      onClick={() => copyText(getText(), setCopied)}
      title="Copy to clipboard (paste into Excel)"
    >
      {copied ? '✓ Copied' : '⎘ Copy'}
    </button>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CallSheet({ store, castMembers = [] }) {
  const { shootDays, production } = store
  const { resources, bookings } = useCrewStore()

  // Only real shoot days (not non-shoot days)
  const shootingDays = useMemo(
    () => shootDays.filter(d => !d.isNonShootDay && d.dayCategory === 'main'),
    [shootDays]
  )

  const [selectedId, setSelectedId] = useState(() => shootingDays[0]?.id ?? null)

  const day = shootingDays.find(d => d.id === selectedId) ?? shootingDays[0] ?? null
  const currentIdx = shootingDays.findIndex(d => d.id === day?.id)

  // Wrap time for the selected day
  const wrapTime = useMemo(() => {
    if (!day) return null
    const effectiveDayType = day.dayType || production.defaultDayType || 'SWD'
    const lunchMinutes = effectiveDayType === 'CWD'  ? (production.cwdLunch  ?? 0)
                       : effectiveDayType === 'SCWD' ? (production.scwdLunch ?? 30)
                       :                               (production.swdLunch  ?? 60)
    return calcWrapTime(day.generalCall, production.workHours ?? 10, lunchMinutes)
  }, [day, production])

  // All booked resources for this day's date
  const dayBookings = useMemo(() => {
    if (!day) return []
    return bookings
      .filter(b => b.date === day.date && b.status !== 'cancelled')
      .map(b => {
        const resource = resources.find(r => r.id === b.resourceId)
        return resource ? { ...resource, bookingStatus: b.status } : null
      })
      .filter(Boolean)
  }, [day, bookings, resources])

  const statusOrder = { booked: 0, hold: 1, unavailable: 2 }
  function sortByStatusThenName(a, b) {
    return (statusOrder[a.bookingStatus] - statusOrder[b.bookingStatus]) ||
           a.name.localeCompare(b.name)
  }

  // Crew grouped by department
  const crewGroups = useMemo(() => {
    const grouped = {}
    for (const r of dayBookings.filter(r => r.type === 'crew')) {
      const key = r.department.trim() || 'Unassigned'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(r)
    }
    return Object.entries(grouped)
      .sort(([a], [b]) => a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b))
      .map(([dept, members]) => [dept, [...members].sort(sortByStatusThenName)])
  }, [dayBookings])

  // Equipment grouped by category
  const equipGroups = useMemo(() => {
    const grouped = {}
    for (const r of dayBookings.filter(r => r.type === 'equipment')) {
      const key = r.category.trim() || 'Uncategorised'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(r)
    }
    return Object.entries(grouped)
      .sort(([a], [b]) => a === 'Uncategorised' ? 1 : b === 'Uncategorised' ? -1 : a.localeCompare(b))
      .map(([cat, items]) => [cat, [...items].sort(sortByStatusThenName)])
  }, [dayBookings])

  // All crew flattened (for copy)
  const allCrew  = crewGroups.flatMap(([, m]) => m)
  const allEquip = equipGroups.flatMap(([, m]) => m)

  function crewTSV() {
    return toTSV(
      ['Name', 'Role', 'Department', 'Email', 'Phone', 'Status'],
      allCrew.map(r => [r.name, r.role, r.department, r.contactEmail, r.contactPhone, STATUS_LABEL[r.bookingStatus] ?? r.bookingStatus])
    )
  }

  function equipTSV() {
    return toTSV(
      ['Name', 'Category', 'Supplier', 'Status'],
      allEquip.map(r => [r.name, r.category, r.vendor, STATUS_LABEL[r.bookingStatus] ?? r.bookingStatus])
    )
  }

  function notesTSV() {
    return day?.notes ?? ''
  }

  // Extras categories with entries (non-empty only)
  const extrasWithEntries = useMemo(() => {
    if (!day?.extras) return []
    return Object.entries(EXTRAS_CATEGORY_LABELS)
      .map(([key, label]) => ({ key, label, items: day.extras[key] ?? [] }))
      .filter(e => e.items.length > 0)
  }, [day])

  // Cast for each scene: resolve ids to member objects
  function scenecastNames(scene) {
    const ids = scene.castMemberIds ?? []
    if (!ids.length) return null
    return castMembers
      .filter(c => ids.includes(c.id))
      .map(c => c.name || '(unnamed)')
      .join(', ')
  }

  // ── Empty state ─────────────────────────────────────────────────────────────

  if (shootingDays.length === 0) {
    return (
      <div className="module-wrap">
        <div className="empty-state">
          <div className="empty-state-icon">☰</div>
          <div className="empty-state-text">No shoot days yet.</div>
          <div className="empty-state-sub">Add shoot days in the Schedule tab first.</div>
        </div>
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="cs-wrap">

      {/* ── Day selector bar ───────────────────────────────────────────────── */}
      <div className="cs-selector no-print">
        <button
          className="btn btn-secondary btn-sm"
          disabled={currentIdx <= 0}
          onClick={() => setSelectedId(shootingDays[currentIdx - 1].id)}
        >
          ← Prev
        </button>

        <select
          className="cs-day-select"
          value={day?.id ?? ''}
          onChange={e => setSelectedId(e.target.value)}
        >
          {shootingDays.map(d => (
            <option key={d.id} value={d.id}>
              {`Day ${d.dayNumber} — ${formatDateShort(d.date)}${(d.locations ?? [d.location]).filter(Boolean)[0] ? ` · ${(d.locations ?? [d.location]).filter(Boolean)[0]}` : ''}`}
            </option>
          ))}
        </select>

        <button
          className="btn btn-secondary btn-sm"
          disabled={currentIdx >= shootingDays.length - 1}
          onClick={() => setSelectedId(shootingDays[currentIdx + 1].id)}
        >
          Next →
        </button>

        <button
          className="btn btn-primary btn-sm cs-print-btn"
          onClick={() => window.print()}
        >
          🖨 Print / Save PDF
        </button>
      </div>

      {/* ── Scrollable document area ────────────────────────────────────────── */}
      {day && (
        <div className="cs-scroll">
          <div className="cs-doc">

            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="cs-header">
              <div className="cs-header-left">
                <div className="cs-prod-name">{production.name || 'Untitled Production'}</div>
                <div className="cs-date-line">{formatDateFull(day.date)}</div>
              </div>
              <div className="cs-header-center">
                <div className="cs-title-badge">DAILY INFO</div>
                {day.dayNumber != null && (
                  <div className="cs-day-num">Shoot Day {day.dayNumber}</div>
                )}
              </div>
              <div className="cs-header-right">
                {day.generalCall ? (
                  <div className="cs-call-block">
                    <span className="cs-call-label">General Call</span>
                    <span className="cs-call-value">{day.generalCall}</span>
                  </div>
                ) : (
                  <div className="cs-call-block cs-call-empty">
                    <span className="cs-call-label">General Call</span>
                    <span className="cs-call-value cs-call-tbd">TBC</span>
                  </div>
                )}
                {wrapTime && (
                  <div className="cs-call-block cs-wrap-block">
                    <span className="cs-call-label">Est. Wrap</span>
                    <span className="cs-call-value cs-wrap-value">{wrapTime}</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── Info strip ──────────────────────────────────────────────── */}
            {(() => {
              const locs = (day.locations ?? [day.location]).filter(Boolean)
              const showStrip = locs.length > 0 || day.unitBase
              if (!showStrip) return null
              return (
                <div className="cs-info-strip">
                  {locs.length === 1 && (
                    <div className="cs-info-item">
                      <span className="cs-info-label">Location</span>
                      <span className="cs-info-value">{locs[0]}</span>
                    </div>
                  )}
                  {locs.length > 1 && locs.map((loc, i) => (
                    <div key={i} className="cs-info-item">
                      <span className="cs-info-label">Location {i + 1}</span>
                      <span className="cs-info-value">{loc}</span>
                    </div>
                  ))}
                  {day.unitBase && (
                    <div className="cs-info-item">
                      <span className="cs-info-label">Unit Base</span>
                      <span className="cs-info-value">{day.unitBase}</span>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* ── Scenes ──────────────────────────────────────────────────── */}
            {day.scenes.length > 0 && (
              <div className="cs-section">
                <div className="cs-section-title">Scenes</div>
                <table className="cs-table">
                  <thead>
                    <tr>
                      <th className="cs-th cs-th-sc">Sc #</th>
                      <th className="cs-th cs-th-tag">Int/Ext</th>
                      <th className="cs-th cs-th-loc">Location</th>
                      <th className="cs-th cs-th-tag">D/N</th>
                      <th className="cs-th cs-th-desc">Description</th>
                      <th className="cs-th">Cast</th>
                      <th className="cs-th cs-th-pages">Pages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.scenes.map(scene => {
                      const castStr = scenecastNames(scene)
                      return (
                        <tr key={scene.id} className="cs-tr">
                          <td className="cs-td cs-td-sc">{scene.sceneNumber || '—'}</td>
                          <td className="cs-td">
                            <span className={`cs-tag ${scene.intExt.toLowerCase()}`}>{scene.intExt}</span>
                          </td>
                          <td className="cs-td">{scene.location || '—'}</td>
                          <td className="cs-td">
                            <span className={`cs-tag ${scene.dayNight.toLowerCase()}`}>{scene.dayNight}</span>
                          </td>
                          <td className="cs-td">{scene.description || '—'}</td>
                          <td className="cs-td cs-td-cast">{castStr || '—'}</td>
                          <td className="cs-td cs-td-pages">{scene.pages || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Additional Info (extras) ─────────────────────────────────── */}
            {extrasWithEntries.length > 0 && (
              <div className="cs-section">
                <div className="cs-section-title">Additional Info</div>
                {extrasWithEntries.map(({ key, label, items }) => (
                  <div key={key} className="cs-group">
                    <div className="cs-group-header">{label}</div>
                    <ul style={{ margin: '4px 0 8px 8px', paddingLeft: 16 }}>
                      {items.map(e => (
                        <li key={e.id} style={{ fontSize: 12.5, color: '#1f2937', lineHeight: 1.7 }}>
                          {e.description || '(no description)'}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {/* ── Crew ────────────────────────────────────────────────────── */}
            {crewGroups.length > 0 && (
              <div className="cs-section">
                <div className="cs-section-title">
                  Crew
                  <span className="cs-section-count">{allCrew.length}</span>
                  <CopyBtn getText={crewTSV} />
                </div>
                {crewGroups.map(([dept, members]) => (
                  <div key={dept} className="cs-group">
                    <div className="cs-group-header">{dept}</div>
                    <table className="cs-table">
                      <thead>
                        <tr>
                          <th className="cs-th cs-th-name">Name</th>
                          <th className="cs-th">Role</th>
                          <th className="cs-th">Department</th>
                          <th className="cs-th">Email</th>
                          <th className="cs-th">Phone</th>
                          <th className="cs-th cs-th-status">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.map(r => (
                          <tr key={r.id} className="cs-tr">
                            <td className="cs-td cs-td-name">{r.name}</td>
                            <td className="cs-td cs-td-role">{r.role || '—'}</td>
                            <td className="cs-td cs-td-role">{r.department || '—'}</td>
                            <td className="cs-td cs-td-contact">{r.contactEmail || '—'}</td>
                            <td className="cs-td cs-td-contact">{r.contactPhone || '—'}</td>
                            <td className="cs-td cs-td-status">
                              <span className={`cs-status-badge ${r.bookingStatus}`}>
                                {STATUS_ICON[r.bookingStatus]} {STATUS_LABEL[r.bookingStatus]}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}

            {/* ── Equipment ───────────────────────────────────────────────── */}
            {equipGroups.length > 0 && (
              <div className="cs-section">
                <div className="cs-section-title">
                  Equipment
                  <span className="cs-section-count">{allEquip.length}</span>
                  <CopyBtn getText={equipTSV} />
                </div>
                {equipGroups.map(([cat, items]) => (
                  <div key={cat} className="cs-group">
                    <div className="cs-group-header">{cat}</div>
                    <table className="cs-table">
                      <thead>
                        <tr>
                          <th className="cs-th cs-th-name">Name</th>
                          <th className="cs-th">Category</th>
                          <th className="cs-th">Supplier</th>
                          <th className="cs-th cs-th-status">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(r => (
                          <tr key={r.id} className="cs-tr">
                            <td className="cs-td cs-td-name">{r.name}</td>
                            <td className="cs-td cs-td-role">{r.category || '—'}</td>
                            <td className="cs-td cs-td-role">{r.vendor || '—'}</td>
                            <td className="cs-td cs-td-status">
                              <span className={`cs-status-badge ${r.bookingStatus}`}>
                                {STATUS_ICON[r.bookingStatus]} {STATUS_LABEL[r.bookingStatus]}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}

            {/* ── Notes ───────────────────────────────────────────────────── */}
            {day.notes && (
              <div className="cs-section">
                <div className="cs-section-title">
                  Notes
                  <CopyBtn getText={notesTSV} />
                </div>
                <div className="cs-notes">{day.notes}</div>
              </div>
            )}

            {/* ── Truly empty state ───────────────────────────────────────── */}
            {day.scenes.length === 0 && crewGroups.length === 0 &&
             equipGroups.length === 0 && !day.notes && extrasWithEntries.length === 0 && (
              <div className="cs-empty">
                No scenes, crew, or equipment booked for this day yet.
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  )
}
