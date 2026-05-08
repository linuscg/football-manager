import { useState, useEffect, useRef, useMemo } from 'react'
import { useFulltimeCrewStore }    from '../store/useFulltimeCrewStore'
import { useCrewStore }            from '../store/useCrewStore'
import { useBackpageStore }        from '../store/useBackpageStore'
import { exportBackpageXLSX }      from '../lib/exportBackpage'
import { generatePreCallSummary }  from '../lib/backpageSummary'

// ─── Time helpers ─────────────────────────────────────────────────────────────

function addMins(timeStr, mins) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':').map(Number)
  const total  = h * 60 + (m || 0) + mins
  const norm   = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`
}

function calcWrapTime(generalCall, dayType, production, lunchIncluded = true) {
  if (!generalCall) return null
  const type  = dayType || production.defaultDayType || 'SWD'
  const lunch = lunchIncluded
    ? (type === 'CWD'  ? (production.cwdLunch  ?? 0)
     : type === 'SCWD' ? (production.scwdLunch ?? 30)
     :                   (production.swdLunch  ?? 60))
    : 0
  return addMins(generalCall, (production.workHours ?? 10) * 60 + lunch)
}

function fmt24(timeStr) { return timeStr || '—' }

function fmtMins(mins) {
  if (!mins || mins === 0) return null
  const h = Math.floor(Math.abs(mins) / 60)
  const m = Math.abs(mins) % 60
  const parts = []
  if (h) parts.push(`${h}hr`)
  if (m) parts.push(`${m}min`)
  return parts.join(' ')
}

// Label for day selector dropdown
function dayOptionLabel(d) {
  const dateStr = d.date
    ? new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', {
        weekday: 'short', day: '2-digit', month: 'short',
      })
    : 'No date'
  if (d.dayCategory === 'main') {
    return `D${d.dayNumber} — ${dateStr}${d.locations?.[0] ? ` · ${d.locations[0]}` : ''}`
  }
  const cat = d.dayCategory
    ? d.dayCategory.charAt(0).toUpperCase() + d.dayCategory.slice(1)
    : 'Day'
  return `${cat} — ${dateStr}${d.locations?.[0] ? ` · ${d.locations[0]}` : ''}`
}

// ─── CrewRow ──────────────────────────────────────────────────────────────────

function CrewRow({ m, dayId, deptCall, deptWrap, getMemberOverride, upsertMemberOverride }) {
  const override = getMemberOverride(dayId, m.id)

  const [lCall, setLCall] = useState(override?.callTime ?? '')
  const [lWrap, setLWrap] = useState(override?.wrapTime ?? '')

  useEffect(() => setLCall(override?.callTime ?? ''), [override?.callTime])
  useEffect(() => setLWrap(override?.wrapTime ?? ''), [override?.wrapTime])

  function commitCall() { upsertMemberOverride(dayId, m.id, 'callTime', lCall) }
  function commitWrap() { upsertMemberOverride(dayId, m.id, 'wrapTime', lWrap) }

  const hasCallOv     = Boolean(lCall)
  const hasWrapOv     = Boolean(lWrap)
  const lunch         = override?.lunch         ?? true
  const scenechronize = override?.scenechronize ?? false
  const exclude       = override?.exclude       ?? false

  return (
    <tr className={`bp-crew-row${exclude ? ' bp-crew-row--excluded' : ''}`}>
      <td className="bp-td bp-td-name">{m.name || <span className="bp-empty-name">—</span>}</td>
      <td className="bp-td bp-td-role">{m.role}</td>

      {/* Call time — editable per member */}
      <td className="bp-td bp-td-time">
        <div className="bp-time-cell">
          <input
            className={`bp-time-input${hasCallOv ? ' is-override' : ''}`}
            value={lCall}
            placeholder={deptCall || '—'}
            onChange={e => setLCall(e.target.value)}
            onBlur={commitCall}
            title={hasCallOv ? 'Override active — clear to use dept default' : 'Type to override'}
          />
          {hasCallOv && (
            <button
              className="bp-clear-btn"
              title="Clear override"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { setLCall(''); upsertMemberOverride(dayId, m.id, 'callTime', '') }}
            >×</button>
          )}
        </div>
      </td>

      {/* Wrap time — editable per member */}
      <td className="bp-td bp-td-time">
        <div className="bp-time-cell">
          <input
            className={`bp-time-input${hasWrapOv ? ' is-override' : ''}`}
            value={lWrap}
            placeholder={deptWrap || '—'}
            onChange={e => setLWrap(e.target.value)}
            onBlur={commitWrap}
            title={hasWrapOv ? 'Override active — clear to use dept default' : 'Type to override'}
          />
          {hasWrapOv && (
            <button
              className="bp-clear-btn"
              title="Clear override"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { setLWrap(''); upsertMemberOverride(dayId, m.id, 'wrapTime', '') }}
            >×</button>
          )}
        </div>
      </td>

      {/* Exclude checkbox */}
      <td className="bp-td bp-td-check">
        <input
          type="checkbox"
          className="bp-row-check bp-row-check--exclude"
          checked={exclude}
          title={exclude ? 'Excluded — click to include' : 'Included — click to exclude'}
          onChange={e => upsertMemberOverride(dayId, m.id, 'exclude', e.target.checked)}
        />
      </td>

      {/* Lunch checkbox */}
      <td className="bp-td bp-td-check">
        <input
          type="checkbox"
          className="bp-row-check"
          checked={lunch}
          title={lunch ? 'Taking lunch' : 'No lunch'}
          onChange={e => upsertMemberOverride(dayId, m.id, 'lunch', e.target.checked)}
        />
      </td>

      {/* Scenechronize checkbox */}
      <td className="bp-td bp-td-check">
        <input
          type="checkbox"
          className="bp-row-check"
          checked={scenechronize}
          title={scenechronize ? 'On Scenechronize' : 'Not on Scenechronize'}
          onChange={e => upsertMemberOverride(dayId, m.id, 'scenechronize', e.target.checked)}
        />
      </td>
    </tr>
  )
}

// ─── DeptSection ──────────────────────────────────────────────────────────────

function DeptSection({
  dept, members, dayId, generalCall, wrapTime,
  getDeptSetting, upsertDeptSetting,
  getMemberOverride, upsertMemberOverride,
}) {
  const setting     = getDeptSetting(dayId, dept)
  const preCallMins = setting.preCallMins ?? 0
  const derigMins   = setting.derigMins   ?? 0

  const deptCall = generalCall ? addMins(generalCall, -preCallMins) : null
  const deptWrap = wrapTime    ? addMins(wrapTime,     derigMins)   : null

  // ── Select-all state ──────────────────────────────────────────────────────
  const lunchCount = members.filter(m => (getMemberOverride(dayId, m.id)?.lunch ?? true)).length
  const scCount    = members.filter(m => (getMemberOverride(dayId, m.id)?.scenechronize ?? false)).length
  const n          = members.length

  const lunchAllRef = useRef(null)
  const scAllRef    = useRef(null)

  useEffect(() => {
    if (lunchAllRef.current) lunchAllRef.current.indeterminate = lunchCount > 0 && lunchCount < n
  }, [lunchCount, n])
  useEffect(() => {
    if (scAllRef.current) scAllRef.current.indeterminate = scCount > 0 && scCount < n
  }, [scCount, n])

  function toggleAllLunch() {
    const newVal = lunchCount < n   // if not all on, turn all on; if all on, turn all off
    members.forEach(m => upsertMemberOverride(dayId, m.id, 'lunch', newVal))
  }
  function toggleAllSc() {
    const newVal = scCount < n
    members.forEach(m => upsertMemberOverride(dayId, m.id, 'scenechronize', newVal))
  }

  return (
    <div className="bp-dept">
      {/* Dept header row */}
      <div className="bp-dept-head">
        <span className="bp-dept-name">{dept}</span>

        <div className="bp-dept-controls">
          <label className="bp-ctrl-label">Pre-call</label>
          <input
            className="bp-ctrl-input"
            type="number"
            min="0"
            step="5"
            value={preCallMins}
            onChange={e => upsertDeptSetting(dayId, dept, 'preCallMins', Number(e.target.value) || 0)}
            title="Minutes before general call"
          />
          <span className="bp-ctrl-unit">min</span>
          {deptCall && <span className="bp-ctrl-result">→ {fmt24(deptCall)}</span>}
        </div>

        <div className="bp-dept-controls">
          <label className="bp-ctrl-label">Derig</label>
          <input
            className="bp-ctrl-input"
            type="number"
            min="0"
            step="5"
            value={derigMins}
            onChange={e => upsertDeptSetting(dayId, dept, 'derigMins', Number(e.target.value) || 0)}
            title="Minutes after wrap time"
          />
          <span className="bp-ctrl-unit">min</span>
          {deptWrap && <span className="bp-ctrl-result">→ {fmt24(deptWrap)}</span>}
        </div>

        <span className="bp-dept-count">{members.length}</span>
      </div>

      {/* Crew table */}
      <table className="bp-crew-table">
        <thead>
          <tr>
            <th className="bp-th">Name</th>
            <th className="bp-th">Role</th>
            <th className="bp-th bp-th-time">Call</th>
            <th className="bp-th bp-th-time">Wrap</th>
            <th className="bp-th bp-th-check" title="Exclude from backpage and export">Ex</th>
            <th className="bp-th bp-th-check" title="Lunch — click to toggle all">
              <label className="bp-th-selectall">
                <span className="bp-th-check-label">L</span>
                <input
                  ref={lunchAllRef}
                  type="checkbox"
                  className="bp-row-check"
                  checked={lunchCount === n}
                  onChange={toggleAllLunch}
                />
              </label>
            </th>
            <th className="bp-th bp-th-check" title="Scenechronize — click to toggle all">
              <label className="bp-th-selectall">
                <span className="bp-th-check-label">Sc</span>
                <input
                  ref={scAllRef}
                  type="checkbox"
                  className="bp-row-check"
                  checked={scCount === n && n > 0}
                  onChange={toggleAllSc}
                />
              </label>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <CrewRow
              key={m.id}
              m={m}
              dayId={dayId}
              deptCall={deptCall}
              deptWrap={deptWrap}
              getMemberOverride={getMemberOverride}
              upsertMemberOverride={upsertMemberOverride}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Backpage({ store }) {
  const { production, shootDays } = store
  const { members }                    = useFulltimeCrewStore()
  const { resources, bookings }        = useCrewStore()
  const {
    loading: bpLoading,
    getDeptSetting,    upsertDeptSetting,
    getDaySetting,     upsertDaySetting,
    getMemberOverride, upsertMemberOverride,
  } = useBackpageStore()

  const [exporting, setExporting] = useState(false)
  const [summaryCopied, setSummaryCopied] = useState(false)

  // ── All non-non-shoot days (includes prep, splinter, main) ─────────────
  const allDays = shootDays
    .filter(d => !d.isNonShootDay)
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  const today       = new Date().toISOString().slice(0, 10)
  const todayDayId  = allDays.find(d => d.date === today)?.id ?? null

  const BP_DAY_KEY = 'fm_bp_day_id'
  const [selectedDayId, setSelectedDayIdRaw] = useState(() => {
    const saved = localStorage.getItem(BP_DAY_KEY)
    if (saved && allDays.find(d => d.id === saved)) return saved
    return (
      allDays.find(d => d.date === today)?.id ??
      allDays.find(d => d.date >= today)?.id  ??
      allDays[0]?.id ?? null
    )
  })

  function setSelectedDayId(id) {
    setSelectedDayIdRaw(id)
    if (id) localStorage.setItem(BP_DAY_KEY, id)
    else     localStorage.removeItem(BP_DAY_KEY)
  }

  const day              = shootDays.find(d => d.id === selectedDayId) ?? null
  const daySetting       = day ? getDaySetting(day.id) : null
  const lunchIncluded    = daySetting?.lunchIncluded ?? true
  const scenechronize    = daySetting?.scenechronize  ?? false
  const effectiveDayType = day ? (day.dayType || production.defaultDayType || 'SWD') : null
  const wrapTime         = day ? calcWrapTime(day.generalCall, day.dayType, production, lunchIncluded) : null

  // ── Group fulltime crew by department ──────────────────────────────────
  const FALLBACK = 'Unassigned'
  const groupMap = {}
  for (const m of members) {
    const key = m.department.trim() || FALLBACK
    if (!groupMap[key]) groupMap[key] = []
    groupMap[key].push(m)
  }
  const depts = Object.keys(groupMap).sort((a, b) => {
    if (a === FALLBACK) return 1
    if (b === FALLBACK) return -1
    return a.localeCompare(b)
  })

  // ── Additional crew (Gantt resources booked on this day) ───────────────
  const additionalMembers = useMemo(() => {
    if (!day) return []
    const isMain = day.dayCategory === 'main'
    const bookedIds = new Set(
      bookings
        .filter(b => {
          if (b.status !== 'booked' && b.status !== 'hold') return false
          // Main unit bookings have no dayId — match by date only on main days.
          // Sub-unit days (splinter/prep/other) must match their specific dayId
          // so they never show crew booked on the main unit of the same date.
          return isMain
            ? (b.date === day.date && !b.dayId)
            : (b.dayId === day.id)
        })
        .map(b => b.resourceId)
    )
    return resources
      .filter(r => r.type === 'crew' && bookedIds.has(r.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }, [day, resources, bookings])

  const addGroupMap = useMemo(() => {
    const map = {}
    for (const m of additionalMembers) {
      const key = m.department.trim() || FALLBACK
      if (!map[key]) map[key] = []
      map[key].push(m)
    }
    return map
  }, [additionalMembers])

  const addDepts = useMemo(() =>
    Object.keys(addGroupMap).sort((a, b) => {
      if (a === FALLBACK) return 1
      if (b === FALLBACK) return -1
      return a.localeCompare(b)
    })
  , [addGroupMap])

  // ── Excel export ───────────────────────────────────────────────────────
  async function handleExport() {
    if (!day || exporting) return
    setExporting(true)
    try {
      function buildDeptRows(deptList, sourceMap, settingsKeyFn) {
        return deptList.map(dept => {
          const key         = settingsKeyFn(dept)
          const setting     = getDeptSetting(day.id, key)
          const preCallMins = setting.preCallMins ?? 0
          const derigMins   = setting.derigMins   ?? 0
          const deptCall    = day.generalCall ? addMins(day.generalCall, -preCallMins) : ''
          const deptWrap    = wrapTime        ? addMins(wrapTime,         derigMins)   : ''
          return {
            name: key,
            members: (sourceMap[dept] ?? []).map(m => {
              const ov = getMemberOverride(day.id, m.id)
              return {
                name:     m.name,
                role:     m.role,
                callTime: ov?.callTime || deptCall || '',
                wrapTime: ov?.wrapTime || deptWrap || '',
                excluded: ov?.exclude  ?? false,
              }
            }),
          }
        })
      }

      // Fulltime crew — settings key is just the dept name
      const exportDepts    = buildDeptRows(depts,    groupMap,    d => d)
      // Additional crew — settings key includes the "- Additional" suffix (matches UI)
      const exportAddDepts = buildDeptRows(addDepts, addGroupMap, d => `${d} - Additional`)

      await exportBackpageXLSX({ production, day, depts: exportDepts, addDepts: exportAddDepts })
    } catch (err) {
      console.error('[backpage] export error:', err)
      alert('Export failed — check console for details.')
    } finally {
      setExporting(false)
    }
  }

  // ── Lunch / Scenechronize totals (fulltime + additional) ───────────────
  const allDayMembers      = day ? [...members, ...additionalMembers] : []
  const totalCrew          = allDayMembers.length
  const totalLunch         = day
    ? allDayMembers.filter(m => (getMemberOverride(day.id, m.id)?.lunch ?? true)).length
    : 0
  const totalScenechronize = day
    ? allDayMembers.filter(m => (getMemberOverride(day.id, m.id)?.scenechronize ?? false)).length
    : 0

  // ── Pre-call summary ────────────────────────────────────────────────────

  const preCallSummary = day
    ? generatePreCallSummary({
        dayId:             day.id,
        depts,
        groupMap,
        getDeptSetting,
        getMemberOverride,
        generalCall:       day.generalCall,
      })
    : ''

  async function copySummary() {
    if (!preCallSummary) return
    try {
      await navigator.clipboard.writeText(preCallSummary)
    } catch {
      const el = document.createElement('textarea')
      el.value = preCallSummary
      document.body.appendChild(el); el.select(); document.execCommand('copy')
      document.body.removeChild(el)
    }
    setSummaryCopied(true)
    setTimeout(() => setSummaryCopied(false), 2000)
  }

  // ── Empty states ────────────────────────────────────────────────────

  if (allDays.length === 0) {
    return (
      <div className="bp-empty-wrap">
        <div className="bp-empty-icon">📋</div>
        <div className="bp-empty-title">No shoot days yet</div>
        <div className="bp-empty-sub">Generate shoot days in Project Setup to use the Backpage.</div>
      </div>
    )
  }

  if (members.length === 0) {
    return (
      <div className="bp-empty-wrap">
        <div className="bp-empty-icon">👥</div>
        <div className="bp-empty-title">No fulltime crew yet</div>
        <div className="bp-empty-sub">Add crew in Crew Times → Fulltime Crew first.</div>
      </div>
    )
  }

  return (
    <div className="bp-wrap">

      {/* ── Day selector bar ──────────────────────────────────────────────── */}
      <div className="bp-selector-bar">
        <div className="bp-selector-l">
          <label className="bp-selector-label">Day</label>
          <select
            className="bp-day-select"
            value={selectedDayId ?? ''}
            onChange={e => setSelectedDayId(e.target.value || null)}
          >
            {allDays.map(d => (
              <option key={d.id} value={d.id}>{dayOptionLabel(d)}</option>
            ))}
          </select>
        </div>

        {/* Info pills */}
        {day && (
          <div className="bp-selector-info">
            {day.date && (
              <span className="bp-info-pill">
                {new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', {
                  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                })}
              </span>
            )}
            {day.dayCategory !== 'main' && (
              <span className="bp-info-pill bp-info-pill--cat">
                {day.dayCategory?.toUpperCase()}
              </span>
            )}
            {day.locations?.[0] && <span className="bp-info-pill bp-info-pill--loc">📍 {day.locations[0]}</span>}
            {day.unitBase      && <span className="bp-info-pill">🚌 {day.unitBase}</span>}
          </div>
        )}

        {/* Action buttons */}
        <div className="bp-selector-actions">
          {todayDayId && todayDayId !== selectedDayId && (
            <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={() => setSelectedDayId(todayDayId)}>
              Open Today
            </button>
          )}
          {day && (
            <button
              className="pm-btn pm-btn--primary pm-btn--sm"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? 'Exporting…' : '↓ Export Excel'}
            </button>
          )}
        </div>
      </div>

      {/* ── Call / Wrap / Day Type strip ──────────────────────────────────── */}
      {day && (
        <div className="bp-time-strip">
          <div className="bp-time-block">
            <div className="bp-time-label">General Call</div>
            <div className="bp-time-value">{fmt24(day.generalCall) || '—'}</div>
          </div>
          <div className="bp-time-divider" />
          <div className="bp-time-block">
            <div className="bp-time-label">Wrap</div>
            <div className="bp-time-value">{wrapTime ? fmt24(wrapTime) : '—'}</div>
          </div>
          <div className="bp-time-divider" />
          <div className="bp-time-block">
            <div className="bp-time-label">Day Type</div>
            <div className="bp-time-value bp-time-value--tag">{effectiveDayType}</div>
          </div>
          <div className="bp-time-block">
            <div className="bp-time-label">Hours</div>
            <div className="bp-time-value">{production.workHours ?? 10}h</div>
          </div>
          <div className="bp-time-divider" />
          <div className="bp-time-block">
            <div className="bp-time-label">Lunch</div>
            <div className="bp-time-value">
              {totalLunch}
              <span className="bp-time-sub">/{totalCrew}</span>
            </div>
          </div>
          <div className="bp-time-block">
            <div className="bp-time-label">Scenechronize</div>
            <div className="bp-time-value">
              {totalScenechronize}
              <span className="bp-time-sub">/{totalCrew}</span>
            </div>
          </div>
          <div className="bp-time-spacer" />
          {!day.generalCall && (
            <div className="bp-time-warn">⚠ No general call set — set it in Schedule</div>
          )}
        </div>
      )}

      {/* ── Single scrollable content area ───────────────────────────────── */}
      {day && (
        <div className="bp-scroll-area">

          <div className="bp-hint">
            Dept Pre-call / Derig adjusts the whole department.
            Click any individual Call or Wrap time to override it for that person.
          </div>

          {/* Fulltime crew */}
          <div className="bp-body">
            {depts.map(dept => (
              <DeptSection
                key={`ftc-${dept}`}
                dept={dept}
                members={groupMap[dept]}
                dayId={day.id}
                generalCall={day.generalCall}
                wrapTime={wrapTime}
                getDeptSetting={getDeptSetting}
                upsertDeptSetting={upsertDeptSetting}
                getMemberOverride={getMemberOverride}
                upsertMemberOverride={upsertMemberOverride}
              />
            ))}
          </div>

          {/* Additional crew — each dept gets a "- Additional" suffix so its
              pre-call/derig settings are stored separately from fulltime */}
          {additionalMembers.length > 0 && (
            <>
              <div className="bp-additional-header">
                <span className="bp-additional-title">Additional Crew</span>
                <span className="bp-additional-count">{additionalMembers.length}</span>
                <span className="bp-additional-sub">booked via Crew Gantt</span>
              </div>
              <div className="bp-body">
                {addDepts.map(dept => (
                  <DeptSection
                    key={`add-${dept}`}
                    dept={`${dept} - Additional`}
                    members={addGroupMap[dept]}
                    dayId={day.id}
                    generalCall={day.generalCall}
                    wrapTime={wrapTime}
                    getDeptSetting={getDeptSetting}
                    upsertDeptSetting={upsertDeptSetting}
                    getMemberOverride={getMemberOverride}
                    upsertMemberOverride={upsertMemberOverride}
                  />
                ))}
              </div>
            </>
          )}

        </div>
      )}

      {/* ── Pre-call summary bar ─────────────────────────────────────────── */}
      {day && (
        <div className="bp-summary-bar">
          <div className="bp-summary-label">Pre-call Summary</div>
          {preCallSummary ? (
            <>
              <div className="bp-summary-text">{preCallSummary}</div>
              <button
                className={`bp-summary-copy${summaryCopied ? ' copied' : ''}`}
                onClick={copySummary}
                title="Copy to clipboard"
              >
                {summaryCopied ? '✓ Copied' : '⎘ Copy'}
              </button>
            </>
          ) : (
            <div className="bp-summary-empty">
              No pre-calls set — add a Pre-call offset to any department above, or override individual call times.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
