import { useState, useEffect, useRef, useMemo } from 'react'
import { useFulltimeCrewStore }    from '../store/useFulltimeCrewStore'
import { useCrewStore }            from '../store/useCrewStore'
import { useBackpageStore }        from '../store/useBackpageStore'
import { exportBackpageXLSX }      from '../lib/exportBackpage'
import { generatePreCallSummary }  from '../lib/backpageSummary'
import { supabase }                from '../lib/supabase'

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

const STATUS_OPTIONS = ['work', 'O/C', 'SPL', 'N/A', 'PREP', 'MAIN', 'OTHER']

// Maps a sub-unit dayCategory to the label written on the main day
// when the coordinator moves someone from main to that unit.
function subUnitLabel(dayCategory) {
  if (dayCategory === 'prep')     return 'PREP'
  if (dayCategory === 'other')    return 'OTHER'
  return 'SPL'  // splinter (default for all other sub-unit categories)
}

/**
 * Derive the effective (displayed) status for a crew member, cross-referencing
 * sibling days that fall on the same date.
 *
 * Sub-unit pages (splinter / prep / other):
 *   • If main unit says "work" → show "MAIN" (they're on main)
 *   • If main unit says "SPL"/"PREP" → they've been sent to sub, show own
 *   • N/A / O/C on main carries through to sub
 *
 * Main-unit page:
 *   • N/A / O/C on any sub-unit day carries through to main (when own is "work")
 *
 * Own N/A / O/C always wins over derivation.
 */
function getEffectiveStatus(dayId, dayCategory, sameDateDays, memberId, ownOverride, getMemberOverride) {
  const ownSt = ownOverride?.status ?? 'work'

  // Own explicit absence always wins
  if (ownSt === 'N/A' || ownSt === 'O/C') return ownSt

  if (dayCategory !== 'main' && sameDateDays?.length > 0) {
    // Sub-unit: derive from the main unit's status for this member
    const mainDay = sameDateDays.find(d => d.dayCategory === 'main')
    if (mainDay) {
      const mainSt = getMemberOverride(mainDay.id, memberId)?.status ?? 'work'
      // Carry absence through from main
      if (mainSt === 'N/A' || mainSt === 'O/C') return mainSt
      // Main says "work" → member is on main unit (show MAIN on sub)
      // only auto-derive when sub has no call-time override (a call time means
      // the coordinator explicitly put them on sub)
      if (mainSt === 'work' && ownSt === 'work' && !ownOverride?.callTime) return 'MAIN'
      // mainSt is SPL / PREP / OTHER → sent to a specific sub unit.
      // Only show 'work' on the page whose category matches the assigned status.
      // All other sub-unit pages show the status label (e.g. 'SPL' on the prep page).
      if (mainSt === 'SPL' || mainSt === 'PREP' || mainSt === 'OTHER') {
        return mainSt === subUnitLabel(dayCategory) ? ownSt : mainSt
      }
      return ownSt
    }
  }

  if (dayCategory === 'main' && sameDateDays?.length > 0 && ownSt === 'work') {
    // Main: carry through N/A / O/C from any sub-unit day
    for (const sd of sameDateDays) {
      const subSt = getMemberOverride(sd.id, memberId)?.status ?? 'work'
      if (subSt === 'N/A' || subSt === 'O/C') return subSt
    }
  }

  return ownSt
}

function CrewRow({
  m, dayId, deptCall, deptWrap,
  dayCategory, sameDateDays,
  getMemberOverride, upsertMemberOverride,
  onStatusSync,   // optional — only provided for Gantt (additional) crew
}) {
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

  // Effective (displayed) status — may be derived from sibling days
  const status = getEffectiveStatus(dayId, dayCategory, sameDateDays, m.id, override, getMemberOverride)

  const isOffWork = status !== 'work'  // any non-work status dims the row
  const isNA      = status === 'N/A'  // N/A additionally strikes through

  // Hide the status option that describes this page's own unit
  // (e.g. no 'SPL' on a splinter page, no 'PREP' on a prep page, no 'MAIN' on main)
  const selfStatus = dayCategory === 'main' ? 'MAIN' : subUnitLabel(dayCategory)
  const visibleOptions = STATUS_OPTIONS.filter(opt => opt !== selfStatus)

  const rowClass = [
    'bp-crew-row',
    (isOffWork || exclude) ? 'bp-crew-row--dimmed' : '',
    isNA                   ? 'bp-crew-row--na'     : '',
  ].filter(Boolean).join(' ')

  return (
    <tr className={rowClass}>
      <td className="bp-td bp-td-name">{m.name || <span className="bp-empty-name">—</span>}</td>
      <td className="bp-td bp-td-role">{m.role}</td>

      {/* Status dropdown — shows derived status; bidirectional writes on sub-unit pages */}
      <td className="bp-td bp-td-status">
        <select
          className={`bp-status-select${isOffWork ? ' is-offwork' : ''}`}
          value={status}
          title={status === 'MAIN' ? 'Auto-derived: on main unit — change to Work to move here, or set SPL/PREP/OTHER on the main day' : undefined}
          onChange={e => {
            const newVal = e.target.value

            // ── Bidirectional logic for sub-unit pages ─────────────────────
            if (dayCategory !== 'main' && sameDateDays?.length > 0) {
              const mainDay = sameDateDays.find(d => d.dayCategory === 'main')
              if (mainDay) {
                const mainSt = getMemberOverride(mainDay.id, m.id)?.status ?? 'work'

                // Displayed as MAIN (main='work') and user picks 'Work'
                // → move them to this sub unit by writing the sub label on MAIN
                if (mainSt === 'work' && newVal === 'work') {
                  upsertMemberOverride(mainDay.id, m.id, 'status', subUnitLabel(dayCategory))
                  onStatusSync?.(m.id, 'sub-to-sub')
                  return  // own sub-day stays default (no row = 'work')
                }

                // User explicitly picks 'MAIN'
                // → put them back on main by clearing the sub label from MAIN
                if (newVal === 'MAIN') {
                  upsertMemberOverride(mainDay.id, m.id, 'status', 'work')
                  onStatusSync?.(m.id, 'sub-to-main')
                  return  // own sub-day stays default
                }
              }
            }

            // Default: N/A, O/C, SPL, PREP, OTHER, or any status on own day
            upsertMemberOverride(dayId, m.id, 'status', newVal)
            // Sync Gantt only for main-page changes (sub-unit writes handled above)
            if (dayCategory === 'main') {
              onStatusSync?.(m.id, 'main-change', newVal)
            }
          }}
        >
          {visibleOptions.map(opt => (
            <option key={opt} value={opt}>
              {opt === 'work' ? 'Work' : opt}
            </option>
          ))}
        </select>
      </td>

      {/* Call time — shows status label when off-work, editable when working */}
      <td className="bp-td bp-td-time">
        {isOffWork ? (
          <span className="bp-status-label">{status}</span>
        ) : (
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
        )}
      </td>

      {/* Wrap time — hidden when off-work */}
      <td className="bp-td bp-td-time">
        {!isOffWork && (
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
        )}
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
  dayCategory, sameDateDays,
  getDeptSetting, upsertDeptSetting,
  getMemberOverride, upsertMemberOverride,
  onStatusSync,
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
            <th className="bp-th bp-th-status">Status</th>
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
              dayCategory={dayCategory}
              sameDateDays={sameDateDays}
              getMemberOverride={getMemberOverride}
              upsertMemberOverride={upsertMemberOverride}
              onStatusSync={onStatusSync}
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
  const { resources, bookings } = useCrewStore()
  const {
    loading: bpLoading,
    getDeptSetting,    upsertDeptSetting,
    getDaySetting,     upsertDaySetting,
    getMemberOverride, upsertMemberOverride,
  } = useBackpageStore()

  const [exporting, setExporting] = useState(false)
  const [summaryCopied, setSummaryCopied] = useState(false)

  // ── All productive days (main + splinter + prep + other) ──────────────
  // Prep and other days have isNonShootDay=true in the DB, but they still
  // need a backpage, so we include them explicitly by dayCategory.
  const allDays = shootDays
    .filter(d => !d.isNonShootDay || d.dayCategory === 'prep' || d.dayCategory === 'other')
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

  const currentIdx = allDays.findIndex(d => d.id === selectedDayId)
  const prevDay    = currentIdx > 0                    ? allDays[currentIdx - 1] : null
  const nextDay    = currentIdx < allDays.length - 1   ? allDays[currentIdx + 1] : null

  const day              = shootDays.find(d => d.id === selectedDayId) ?? null
  const daySetting       = day ? getDaySetting(day.id) : null
  const lunchIncluded    = daySetting?.lunchIncluded ?? true
  const scenechronize    = daySetting?.scenechronize  ?? false
  const effectiveDayType = day ? (day.dayType || production.defaultDayType || 'SWD') : null
  const wrapTime         = day ? calcWrapTime(day.generalCall, day.dayType, production, lunchIncluded) : null

  // ── Same-date sibling days (for cross-day status derivation) ───────────
  // e.g. main + splinter on same calendar date → statuses cross-reference
  const sameDateDays = day
    ? allDays.filter(d => d.date === day.date && d.id !== day.id)
    : []

  // ── Gantt booking sync ─────────────────────────────────────────────────
  // Called after a status change for an ADDITIONAL crew member (Gantt resource).
  // Moves ✓/✗ bookings in the Gantt to match the new backpage status.
  //
  // Uses direct Supabase writes (not setBooking) to avoid stale-closure
  // issues when two booking mutations are needed in sequence.
  // The realtime channel will fire loadAll() in both Backpage + Gantt
  // instances, keeping both views in sync automatically.
  //
  // On main page:
  //   work   → restore main booking to 'booked', delete all sub bookings
  //   SPL    → cancel main + create/update splinter booking
  //   PREP   → cancel main + create/update prep booking
  //   OTHER  → cancel main + create/update other booking
  //   N/A/OC → cancel main (leave sub bookings alone)
  //
  // On sub-unit page:
  //   sub-to-sub  → cancel main + create sub booking (moving MAIN→this unit)
  //   sub-to-main → delete sub booking + restore main booking
  async function syncGantt(memberId, actionTag, payload) {
    if (!day) return
    const date = day.date

    // Snapshot bookings once for this call (fresh from component state)
    const mainBk = bookings.find(b => b.resourceId === memberId && b.date === date && !b.dayId)
    const allSubBks = bookings.filter(b => b.resourceId === memberId && b.date === date && b.dayId)
    const thisDayBk = bookings.find(b => b.resourceId === memberId && b.dayId === day.id)


    // Helper — upsert a booking for a given day slot
    async function ensureBooked(targetDayId) {
      const existing = targetDayId
        ? bookings.find(b => b.resourceId === memberId && b.dayId === targetDayId)
        : mainBk
      if (existing) {
        if (existing.status !== 'booked') {
          const { error } = await supabase.from('resource_bookings')
            .update({ status: 'booked' }).eq('id', existing.id)
          if (error) console.error('[syncGantt] ensureBooked update:', error)
        }
      } else {
        const { error } = await supabase.from('resource_bookings').insert({
          id: crypto.randomUUID(),
          resource_id: memberId,
          booking_date: date,
          day_id: targetDayId ?? null,
          status: 'booked',
        })
        if (error) console.error('[syncGantt] ensureBooked insert:', error)
      }
    }

    // Helper — cancel a booking (main or sub)
    async function cancel(targetDayId) {
      const existing = targetDayId
        ? bookings.find(b => b.resourceId === memberId && b.dayId === targetDayId)
        : mainBk
      if (!existing) return
      if (existing.status !== 'cancelled') {
        const { error } = await supabase.from('resource_bookings')
          .update({ status: 'cancelled' }).eq('id', existing.id)
        if (error) console.error('[syncGantt] cancel:', error)
      }
    }

    // Helper — delete a booking entirely
    async function remove(targetDayId) {
      const existing = targetDayId
        ? bookings.find(b => b.resourceId === memberId && b.dayId === targetDayId)
        : mainBk
      if (!existing) return
      const { error } = await supabase.from('resource_bookings')
        .delete().eq('id', existing.id)
      if (error) console.error('[syncGantt] remove:', error)
    }

    if (actionTag === 'main-change') {
      const newVal = payload
      if (newVal === 'work') {
        // Back on main — restore main booking, remove all sub bookings for this date
        await ensureBooked(null)
        await Promise.all(allSubBks.map(b =>
          supabase.from('resource_bookings').delete().eq('id', b.id)
        ))
      } else if (newVal === 'SPL' || newVal === 'PREP' || newVal === 'OTHER') {
        const cat       = newVal === 'SPL' ? 'splinter' : newVal === 'PREP' ? 'prep' : 'other'
        const targetDay = sameDateDays.find(d => d.dayCategory === cat)
        await cancel(null)                                    // ✗ main
        if (targetDay) await ensureBooked(targetDay.id)       // ✓ sub
      } else if (newVal === 'N/A' || newVal === 'O/C') {
        await cancel(null)                                    // ✗ main
      }
    } else if (actionTag === 'sub-to-sub') {
      // User on sub page picked 'Work' (was MAIN) → moving from main → this sub unit
      await cancel(null)             // ✗ main
      await ensureBooked(day.id)    // ✓ this sub unit
    } else if (actionTag === 'sub-to-main') {
      // User on sub page picked 'MAIN' → moving back to main unit
      await remove(day.id)          // delete sub booking
      await ensureBooked(null)      // ✓ main
    }
  }

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
              // Use the same cross-day derivation as the UI
              const st        = getEffectiveStatus(day.id, day.dayCategory, sameDateDays, m.id, ov, getMemberOverride)
              const isOffWork = st !== 'work'
              return {
                name:     m.name,
                role:     m.role,
                callTime: isOffWork ? st   : (ov?.callTime || deptCall || ''),
                wrapTime: isOffWork ? ''   : (ov?.wrapTime || deptWrap || ''),
                excluded: ov?.exclude ?? false,
                status:   st,
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
    <div className={`bp-wrap bp-wrap--${day?.dayCategory ?? 'main'}`}>

      {/* ── Day selector bar ──────────────────────────────────────────────── */}
      <div className="bp-selector-bar">
        <div className="bp-selector-l">
          <label className="bp-selector-label">Day</label>
          <button
            className="pm-btn pm-btn--ghost pm-btn--sm bp-nav-btn"
            onClick={() => prevDay && setSelectedDayId(prevDay.id)}
            disabled={!prevDay}
            title={prevDay ? dayOptionLabel(prevDay) : 'No previous day'}
          >‹</button>
          <select
            className="bp-day-select"
            value={selectedDayId ?? ''}
            onChange={e => setSelectedDayId(e.target.value || null)}
          >
            {allDays.map(d => (
              <option key={d.id} value={d.id}>{dayOptionLabel(d)}</option>
            ))}
          </select>
          <button
            className="pm-btn pm-btn--ghost pm-btn--sm bp-nav-btn"
            onClick={() => nextDay && setSelectedDayId(nextDay.id)}
            disabled={!nextDay}
            title={nextDay ? dayOptionLabel(nextDay) : 'No next day'}
          >›</button>
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
                dayCategory={day.dayCategory}
                sameDateDays={sameDateDays}
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
                    dayCategory={day.dayCategory}
                    sameDateDays={sameDateDays}
                    getDeptSetting={getDeptSetting}
                    upsertDeptSetting={upsertDeptSetting}
                    getMemberOverride={getMemberOverride}
                    upsertMemberOverride={upsertMemberOverride}
                    onStatusSync={syncGantt}
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
