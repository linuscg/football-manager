import { useState, useMemo } from 'react'
import { useCrewStore }           from '../store/useCrewStore'
import { useFulltimeCrewStore }   from '../store/useFulltimeCrewStore'
import { useBackpageStore }       from '../store/useBackpageStore'
import { generatePreCallSummary } from '../lib/backpageSummary'

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
  other:    'Other',
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

function todayDateStr() {
  const t = new Date()
  return [t.getFullYear(), String(t.getMonth()+1).padStart(2,'0'), String(t.getDate()).padStart(2,'0')].join('-')
}

export default function CallSheet({ store, castMembers = [] }) {
  const { shootDays, production } = store
  const { resources, bookings }   = useCrewStore()
  const { members: ftcMembers }   = useFulltimeCrewStore()
  const { getDeptSetting, getMemberOverride } = useBackpageStore()

  // All days sorted chronologically, then by sortOrder within the same date
  const allDays = useMemo(
    () => [...shootDays].sort((a, b) => {
      if (a.date < b.date) return -1
      if (a.date > b.date) return  1
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    }),
    [shootDays]
  )

  const [summaryCopied, setSummaryCopied] = useState(false)
  const [selectedId, setSelectedId] = useState(() => {
    const sorted = [...shootDays].sort((a, b) => {
      if (a.date < b.date) return -1
      if (a.date > b.date) return  1
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    })
    // Default to first main day; fall back to first day of any type
    return sorted.find(d => d.dayCategory === 'main')?.id ?? sorted[0]?.id ?? null
  })

  const day        = allDays.find(d => d.id === selectedId) ?? allDays[0] ?? null
  const currentIdx = allDays.findIndex(d => d.id === day?.id)

  const isMain     = day?.dayCategory === 'main'
  const isPrep     = day?.dayCategory === 'prep'
  const isSplinter = day?.dayCategory === 'splinter'
  const isOther    = day?.dayCategory === 'other'

  // Wrap time for the selected day
  const wrapTime = useMemo(() => {
    if (!day) return null
    const effectiveDayType = day.dayType || production.defaultDayType || 'SWD'
    const lunchMinutes = effectiveDayType === 'CWD'  ? (production.cwdLunch  ?? 0)
                       : effectiveDayType === 'SCWD' ? (production.scwdLunch ?? 30)
                       :                               (production.swdLunch  ?? 60)
    return calcWrapTime(day.generalCall, production.workHours ?? 10, lunchMinutes)
  }, [day, production])

  // ── Fulltime crew groupMap (for pre-call summary) ────────────────────────
  const { ftcDepts, ftcGroupMap } = useMemo(() => {
    const FALLBACK = 'Unassigned'
    const map = {}
    for (const m of ftcMembers) {
      const key = m.department?.trim() || FALLBACK
      if (!map[key]) map[key] = []
      map[key].push(m)
    }
    const ftcDepts = Object.keys(map).sort((a, b) => {
      if (a === FALLBACK) return 1
      if (b === FALLBACK) return -1
      return a.localeCompare(b)
    })
    return { ftcDepts, ftcGroupMap: map }
  }, [ftcMembers])

  // Additional crew groupMap — derived from crewGroups (already built from dayBookings)
  // Dept names here are the plain dept strings; settingsKeyFn adds "- Additional"
  const { addDepts: csAddDepts, addGroupMap: csAddGroupMap } = useMemo(() => {
    const map = {}
    for (const [dept, members] of crewGroups) {
      map[dept] = members
    }
    return { addDepts: Object.keys(map), addGroupMap: map }
  }, [crewGroups])

  const preCallSummary = useMemo(() => {
    if (!day) return ''
    return generatePreCallSummary({
      dayId:             day.id,
      depts:             ftcDepts,
      groupMap:          ftcGroupMap,
      addDepts:          csAddDepts,
      addGroupMap:       csAddGroupMap,
      getDeptSetting,
      getMemberOverride,
      generalCall:       day.generalCall,
    })
  }, [day, ftcDepts, ftcGroupMap, csAddDepts, csAddGroupMap, getDeptSetting, getMemberOverride])

  const statusOrder = { booked: 0, hold: 1, unavailable: 2 }
  function sortByStatusThenName(a, b) {
    return (statusOrder[a.bookingStatus] - statusOrder[b.bookingStatus]) ||
           a.name.localeCompare(b.name)
  }

  // Bookings for the selected day:
  //   main days  → matched by date (no dayId)
  //   non-main   → matched by dayId
  const dayBookings = useMemo(() => {
    if (!day) return []
    return bookings
      .filter(b => {
        if (isMain) return b.date === day.date && !b.dayId && b.status !== 'cancelled'
        return b.dayId === day.id && b.status !== 'cancelled'
      })
      .map(b => {
        const resource = resources.find(r => r.id === b.resourceId)
        return resource ? { ...resource, bookingStatus: b.status } : null
      })
      .filter(Boolean)
  }, [day, isMain, bookings, resources])

  // Sub-unit groups (prep / splinter / other on the same date) —
  // shown only when the selected day is a main unit day
  const subUnitGroups = useMemo(() => {
    if (!day || !isMain) return []
    const subDays = shootDays.filter(d =>
      d.date === day.date &&
      (d.dayCategory === 'prep' || d.dayCategory === 'splinter' || d.dayCategory === 'other')
    )
    return subDays.map(subDay => {
      const items = bookings
        .filter(b => b.dayId === subDay.id && b.status !== 'cancelled')
        .map(b => {
          const resource = resources.find(r => r.id === b.resourceId)
          return resource ? { ...resource, bookingStatus: b.status } : null
        })
        .filter(Boolean)
        .sort(sortByStatusThenName)
      return { subDay, items }
    })
    // Show even if no bookings — so the section header/description still appears
  }, [day, isMain, shootDays, bookings, resources])

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
    return allCrew
      .map(r => [r.name, r.role, r.department, r.contactEmail, r.contactPhone, STATUS_LABEL[r.bookingStatus] ?? r.bookingStatus].join('\t'))
      .join('\n')
  }

  function equipTSV() {
    return allEquip
      .map(r => [r.name, r.category, r.vendor, STATUS_LABEL[r.bookingStatus] ?? r.bookingStatus].join('\t'))
      .join('\n')
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

  // Cast for each scene: show cast numbers (or names as fallback)
  function sceneCastDisplay(scene) {
    const ids = scene.castMemberIds ?? []
    if (!ids.length) return null
    return castMembers
      .filter(c => ids.includes(c.id))
      .sort((a, b) => (a.castNumber ?? 999) - (b.castNumber ?? 999))
      .map(c => c.castNumber != null ? String(c.castNumber) : (c.name || '?'))
      .join(', ')
  }

  // ── Empty state ─────────────────────────────────────────────────────────────

  if (allDays.length === 0) {
    return (
      <div className="pm-module">
        <div className="empty-state">
          <div className="empty-state-icon">☰</div>
          <div className="empty-state-text">No days scheduled yet.</div>
          <div className="empty-state-sub">Add shoot days in the Schedule tab first.</div>
        </div>
      </div>
    )
  }

  // ── Jump to today ───────────────────────────────────────────────────────────

  const todayStr  = todayDateStr()
  const todayDay  = allDays.find(d => d.date === todayStr)
  const isOnToday = day?.date === todayStr

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="cs-wrap">

      {/* ── Day selector bar ───────────────────────────────────────────────── */}
      <div className="cs-selector no-print">
        <button
          className="pm-btn pm-btn--ghost pm-btn--sm"
          disabled={currentIdx <= 0}
          onClick={() => setSelectedId(allDays[currentIdx - 1].id)}
        >
          ← Prev
        </button>

        <select
          className="cs-day-select"
          value={day?.id ?? ''}
          onChange={e => setSelectedId(e.target.value)}
        >
          {allDays.map(d => {
            const datePart = formatDateShort(d.date)
            const loc = (d.locations ?? [d.location]).filter(Boolean)[0]
            if (d.dayCategory === 'main') {
              return (
                <option key={d.id} value={d.id}>
                  {`Day ${d.dayNumber} — ${datePart}${loc ? ` · ${loc}` : ''}`}
                </option>
              )
            }
            const catLabel = d.dayCategory === 'prep' ? 'Prep'
                           : d.dayCategory === 'splinter' ? 'Splinter'
                           : 'Other'
            const labelPart = d.dayLabel ? ` ${d.dayLabel}` : ''
            const descPart  = d.description ? ` · ${d.description}` : ''
            return (
              <option key={d.id} value={d.id}>
                {`${catLabel}${labelPart} — ${datePart}${descPart}`}
              </option>
            )
          })}
        </select>

        <button
          className="pm-btn pm-btn--ghost pm-btn--sm"
          disabled={currentIdx >= allDays.length - 1}
          onClick={() => setSelectedId(allDays[currentIdx + 1].id)}
        >
          Next →
        </button>

        <button
          className="pm-btn pm-btn--ghost pm-btn--sm"
          disabled={!todayDay || isOnToday}
          onClick={() => todayDay && setSelectedId(todayDay.id)}
          title={todayDay ? (isOnToday ? 'Already on today' : 'Jump to today\'s day') : 'No day scheduled for today'}
        >
          Open Today
        </button>
        <button
          className="pm-btn pm-btn--primary pm-btn--sm cs-print-btn"
          onClick={() => window.print()}
        >
          🖨 Print / Save PDF
        </button>
      </div>

      {/* ── Scrollable document area ────────────────────────────────────────── */}
      {day && (
        <div className="cs-scroll">
          <div className="pm-cs-doc">

            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className={`pm-cs-header${isPrep ? ' pm-cs-header--prep' : isSplinter ? ' pm-cs-header--splinter' : isOther ? ' pm-cs-header--other' : ''}`}>
              <div className="cs-header-left">
                <div className="pm-cs-prod">{production.name || 'Untitled Production'}</div>
                <div className="cs-date-line">{formatDateFull(day.date)}</div>
              </div>
              <div className="cs-header-center">
                {isMain && <>
                  <div className="pm-cs-stamp">CALL SHEET</div>
                  {day.dayNumber != null && (
                    <div className="pm-cs-daynum">Shoot Day {day.dayNumber}</div>
                  )}
                </>}
                {isPrep && <>
                  <div className="pm-cs-stamp pm-cs-stamp--prep">PREP DAY</div>
                  {day.dayLabel && <div className="pm-cs-daynum pm-cs-daynum--prep">{day.dayLabel}</div>}
                </>}
                {isSplinter && <>
                  <div className="pm-cs-stamp pm-cs-stamp--splinter">SPLINTER UNIT</div>
                  {day.dayLabel && <div className="pm-cs-daynum pm-cs-daynum--splinter">{day.dayLabel}</div>}
                </>}
                {isOther && <>
                  <div className="pm-cs-stamp pm-cs-stamp--other">OTHER</div>
                  {day.dayLabel && <div className="pm-cs-daynum pm-cs-daynum--other">{day.dayLabel}</div>}
                </>}
              </div>
              <div className="cs-header-right">
                {day.generalCall ? (
                  <div className="pm-cs-call-block">
                    <span className="pm-cs-call-label">General Call</span>
                    <span className="pm-cs-call-val">{day.generalCall.slice(0, 5)}</span>
                  </div>
                ) : (
                  <div className="pm-cs-call-block cs-call-empty">
                    <span className="pm-cs-call-label">General Call</span>
                    <span className="pm-cs-call-val cs-call-tbd">TBC</span>
                  </div>
                )}
                {wrapTime && (
                  <div className="pm-cs-call-block cs-wrap-block">
                    <span className="pm-cs-call-label">Est. Wrap</span>
                    <span className="pm-cs-call-val cs-wrap-value">{wrapTime}</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── Info strip ──────────────────────────────────────────────── */}
            {(() => {
              const locs = (day.locations ?? [day.location]).filter(Boolean)
              const showStrip = locs.length > 0 || day.unitBase || (!isMain && day.description)
              if (!showStrip) return null
              return (
                <div className="pm-cs-strip">
                  {!isMain && day.description && (
                    <div className="pm-cs-strip-item">
                      <span className="pm-cs-strip-label">Description</span>
                      <span className="pm-cs-strip-val">{day.description}</span>
                    </div>
                  )}
                  {locs.length === 1 && (
                    <div className="pm-cs-strip-item">
                      <span className="pm-cs-strip-label">Location</span>
                      <span className="pm-cs-strip-val">{locs[0]}</span>
                    </div>
                  )}
                  {locs.length > 1 && locs.map((loc, i) => (
                    <div key={i} className="pm-cs-strip-item">
                      <span className="pm-cs-strip-label">Location {i + 1}</span>
                      <span className="pm-cs-strip-val">{loc}</span>
                    </div>
                  ))}
                  {day.unitBase && (
                    <div className="pm-cs-strip-item">
                      <span className="pm-cs-strip-label">Unit Base</span>
                      <span className="pm-cs-strip-val">{day.unitBase}</span>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* ── Pre-call summary ────────────────────────────────────────── */}
            {preCallSummary && (
              <div className="pm-cs-section cs-precall-section">
                <div className="pm-cs-section-head">
                  Pre-call Summary
                  <button
                    className={`cs-copy-btn no-print${summaryCopied ? ' copied' : ''}`}
                    onClick={() => copyText(preCallSummary, setSummaryCopied)}
                    title="Copy pre-call summary"
                  >
                    {summaryCopied ? '✓ Copied' : '⎘ Copy'}
                  </button>
                </div>
                <div className="cs-precall-text">{preCallSummary}</div>
              </div>
            )}

            {/* ── Scenes ──────────────────────────────────────────────────── */}
            {day.scenes.length > 0 && (
              <div className="pm-cs-section">
                <div className="pm-cs-section-head">Scenes</div>
                <table className="pm-cs-tbl">
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
                      const castStr = sceneCastDisplay(scene)
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
              <div className="pm-cs-section">
                <div className="pm-cs-section-head">Additional Info</div>
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
              <div className="pm-cs-section">
                <div className="pm-cs-section-head">
                  Additional Crew
                  <span className="cs-section-count">{allCrew.length}</span>
                  <CopyBtn getText={crewTSV} />
                </div>
                {crewGroups.map(([dept, members]) => (
                  <div key={dept} className="cs-group">
                    <div className="cs-group-header">{dept}</div>
                    <table className="pm-cs-tbl">
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
              <div className="pm-cs-section">
                <div className="pm-cs-section-head">
                  Additional Equipment
                  <span className="cs-section-count">{allEquip.length}</span>
                  <CopyBtn getText={equipTSV} />
                </div>
                {equipGroups.map(([cat, items]) => (
                  <div key={cat} className="cs-group">
                    <div className="cs-group-header">{cat}</div>
                    <table className="pm-cs-tbl">
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
              <div className="pm-cs-section">
                <div className="pm-cs-section-head">
                  Notes
                  <CopyBtn getText={notesTSV} />
                </div>
                <div className="cs-notes">{day.notes}</div>
              </div>
            )}

            {/* ── Sub-unit sections (prep / splinter / other on same date) ── */}
            {subUnitGroups.map(({ subDay, items }) => {
              const cat      = subDay.dayCategory
              const subCrew  = items.filter(r => r.type === 'crew')
              const subEquip = items.filter(r => r.type === 'equipment')
              const subLoc   = (subDay.locations ?? []).filter(Boolean)[0] || ''
              const subDesc  = subDay.description || ''
              const subInfo  = [subDay.dayLabel, subLoc || subDesc].filter(Boolean).join(' · ')

              const sectionClass = cat === 'splinter' ? 'cs-section-splinter'
                                 : cat === 'other'    ? 'cs-section-other'
                                 :                      'cs-section-prep'
              const badgeClass   = cat === 'splinter' ? 'cs-splinter-badge'
                                 : cat === 'other'    ? 'cs-other-badge'
                                 :                      'cs-prep-badge'
              const badgeLabel   = cat === 'splinter' ? 'SPLINTER UNIT'
                                 : cat === 'other'    ? 'OTHER'
                                 :                      'PREP UNIT'

              return (
                <div key={subDay.id} className={`pm-cs-section ${sectionClass}`}>
                  <div className="pm-cs-section-head">
                    <span className={badgeClass}>{badgeLabel}</span>
                    {subInfo && <span style={{ fontWeight: 400, fontSize: 12, color: '#6b7280', marginLeft: 8 }}>{subInfo}</span>}
                    {items.length > 0 && <span className="cs-section-count">{items.length}</span>}
                  </div>

                  {items.length === 0 && (
                    <p className="cs-empty" style={{ marginTop: 6 }}>No crew or equipment booked for this unit yet.</p>
                  )}

                  {subCrew.length > 0 && (
                    <div className="cs-group">
                      <div className="cs-group-header">Crew</div>
                      <table className="pm-cs-tbl">
                        <thead><tr>
                          <th className="cs-th cs-th-name">Name</th>
                          <th className="cs-th">Role</th>
                          <th className="cs-th">Department</th>
                          <th className="cs-th cs-th-status">Status</th>
                        </tr></thead>
                        <tbody>
                          {subCrew.sort(sortByStatusThenName).map(r => (
                            <tr key={r.id} className="cs-tr">
                              <td className="cs-td cs-td-name">{r.name}</td>
                              <td className="cs-td cs-td-role">{r.role || '—'}</td>
                              <td className="cs-td cs-td-role">{r.department || '—'}</td>
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
                  )}
                  {subEquip.length > 0 && (
                    <div className="cs-group">
                      <div className="cs-group-header">Equipment</div>
                      <table className="pm-cs-tbl">
                        <thead><tr>
                          <th className="cs-th cs-th-name">Name</th>
                          <th className="cs-th">Category</th>
                          <th className="cs-th cs-th-status">Status</th>
                        </tr></thead>
                        <tbody>
                          {subEquip.sort(sortByStatusThenName).map(r => (
                            <tr key={r.id} className="cs-tr">
                              <td className="cs-td cs-td-name">{r.name}</td>
                              <td className="cs-td cs-td-role">{r.category || '—'}</td>
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
                  )}
                </div>
              )
            })}

            {/* ── Truly empty state ───────────────────────────────────────── */}
            {day.scenes.length === 0 && crewGroups.length === 0 &&
             equipGroups.length === 0 && subUnitGroups.length === 0 && !day.notes && extrasWithEntries.length === 0 && (
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
