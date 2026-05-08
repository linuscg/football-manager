import { useState, Fragment } from 'react'
import { useFulltimeCrewStore } from '../store/useFulltimeCrewStore'
import { useBackpageStore }     from '../store/useBackpageStore'

// ─── Time helpers ─────────────────────────────────────────────────────────────

// Add (or subtract) minutes from a HH:MM string. Returns HH:MM or '' if no input.
function addMins(timeStr, mins) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':').map(Number)
  const total  = h * 60 + (m || 0) + mins
  const norm   = ((total % 1440) + 1440) % 1440   // wrap midnight safely
  return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`
}

// Calculate wrap time from general call, day type and production settings
function calcWrapTime(generalCall, dayType, production) {
  if (!generalCall) return null
  const type = dayType || production.defaultDayType || 'SWD'
  const lunch = type === 'CWD'  ? (production.cwdLunch  ?? 0)
              : type === 'SCWD' ? (production.scwdLunch ?? 30)
              :                   (production.swdLunch  ?? 60)   // SWD
  const totalMins = (production.workHours ?? 10) * 60 + lunch
  return addMins(generalCall, totalMins)
}

function fmt12(timeStr) {
  if (!timeStr) return '—'
  const [h, m] = timeStr.split(':').map(Number)
  const ampm  = h >= 12 ? 'pm' : 'am'
  const hh    = h % 12 || 12
  return `${hh}:${String(m).padStart(2, '0')}${ampm}`
}

function fmt24(timeStr) {
  return timeStr || '—'
}

// Format minutes as a readable offset label
function fmtMins(mins) {
  if (!mins || mins === 0) return null
  const h = Math.floor(Math.abs(mins) / 60)
  const m = Math.abs(mins) % 60
  const parts = []
  if (h) parts.push(`${h}hr`)
  if (m) parts.push(`${m}min`)
  return parts.join(' ')
}

// ─── DeptSection ──────────────────────────────────────────────────────────────

function DeptSection({ dept, members, dayId, generalCall, wrapTime, getDeptSetting, upsertDeptSetting }) {
  const setting     = getDeptSetting(dayId, dept)
  const preCallMins = setting.preCallMins ?? 0
  const derigMins   = setting.derigMins   ?? 0

  const deptCall = generalCall ? addMins(generalCall, -preCallMins) : null
  const deptWrap = wrapTime    ? addMins(wrapTime,     derigMins)   : null

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

      {/* Crew rows */}
      <table className="bp-crew-table">
        <thead>
          <tr>
            <th className="bp-th">Name</th>
            <th className="bp-th">Role</th>
            <th className="bp-th bp-th-time">Call</th>
            <th className="bp-th bp-th-time">Wrap</th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => {
            const callLabel = fmtMins(preCallMins)
            const derigLabel = fmtMins(derigMins)
            return (
              <tr key={m.id} className="bp-crew-row">
                <td className="bp-td bp-td-name">{m.name || <span className="bp-empty-name">—</span>}</td>
                <td className="bp-td bp-td-role">{m.role}</td>
                <td className="bp-td bp-td-time">
                  {deptCall
                    ? <><strong>{fmt24(deptCall)}</strong>{callLabel ? <span className="bp-time-tag">{callLabel} pre-call</span> : null}</>
                    : <span className="bp-no-time">—</span>
                  }
                </td>
                <td className="bp-td bp-td-time">
                  {deptWrap
                    ? <><strong>{fmt24(deptWrap)}</strong>{derigLabel ? <span className="bp-time-tag">{derigLabel} derig</span> : null}</>
                    : <span className="bp-no-time">—</span>
                  }
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Backpage({ store }) {
  const { production, shootDays } = store
  const { members } = useFulltimeCrewStore()
  const { deptSettings, loading: bpLoading, getDeptSetting, upsertDeptSetting } = useBackpageStore()

  // ── Day selector — main shoot days only (not non-shoot, not prep/splinter) ──
  const shootingDays = shootDays
    .filter(d => d.dayCategory === 'main' && !d.isNonShootDay)
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  const [selectedDayId, setSelectedDayId] = useState(() => {
    // Default to today's shoot day, else first upcoming, else first
    const today = new Date().toISOString().slice(0, 10)
    return (
      shootingDays.find(d => d.date === today)?.id ??
      shootingDays.find(d => d.date >= today)?.id  ??
      shootingDays[0]?.id ?? null
    )
  })

  const day     = shootDays.find(d => d.id === selectedDayId) ?? null
  const wrapTime = day ? calcWrapTime(day.generalCall, day.dayType, production) : null
  const effectiveDayType = day ? (day.dayType || production.defaultDayType || 'SWD') : null

  // ── Group fulltime crew alphabetically by department ───────────────────────

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

  // ── No shoot days ──────────────────────────────────────────────────────────

  if (shootingDays.length === 0) {
    return (
      <div className="bp-empty-wrap">
        <div className="bp-empty-icon">📋</div>
        <div className="bp-empty-title">No shoot days yet</div>
        <div className="bp-empty-sub">Generate shoot days in Project Setup to use the Backpage.</div>
      </div>
    )
  }

  // ── No crew ────────────────────────────────────────────────────────────────

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

      {/* ── Day selector bar ─────────────────────────────────────────────────── */}
      <div className="bp-selector-bar">
        <div className="bp-selector-l">
          <label className="bp-selector-label">Shoot Day</label>
          <select
            className="bp-day-select"
            value={selectedDayId ?? ''}
            onChange={e => setSelectedDayId(e.target.value || null)}
          >
            {shootingDays.map(d => {
              const dateStr = d.date
                ? new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
                : 'No date'
              return (
                <option key={d.id} value={d.id}>
                  D{d.dayNumber} — {dateStr}{d.locations?.[0] ? ` · ${d.locations[0]}` : ''}
                </option>
              )
            })}
          </select>
        </div>

        {/* Day info pills */}
        {day && (
          <div className="bp-selector-info">
            {day.date && (
              <span className="bp-info-pill">
                {new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
            )}
            {day.locations?.[0] && <span className="bp-info-pill bp-info-pill--loc">📍 {day.locations[0]}</span>}
            {day.unitBase      && <span className="bp-info-pill">🚌 {day.unitBase}</span>}
          </div>
        )}
      </div>

      {/* ── Call / Wrap strip ─────────────────────────────────────────────────── */}
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
          {wrapTime && (
            <div className="bp-time-block">
              <div className="bp-time-label">Lunch</div>
              <div className="bp-time-value">
                {effectiveDayType === 'CWD'  ? (production.cwdLunch  ?? 0)  + ' min'
               : effectiveDayType === 'SCWD' ? (production.scwdLunch ?? 30) + ' min'
               :                               (production.swdLunch  ?? 60) + ' min'}
              </div>
            </div>
          )}
          <div className="bp-time-spacer" />
          {!day.generalCall && (
            <div className="bp-time-warn">⚠ No general call set for this day — set it in Schedule</div>
          )}
        </div>
      )}

      {/* ── Department sections ───────────────────────────────────────────────── */}
      {day && (
        <div className="bp-body">
          {depts.map(dept => (
            <DeptSection
              key={dept}
              dept={dept}
              members={groupMap[dept]}
              dayId={day.id}
              generalCall={day.generalCall}
              wrapTime={wrapTime}
              getDeptSetting={getDeptSetting}
              upsertDeptSetting={upsertDeptSetting}
            />
          ))}
        </div>
      )}
    </div>
  )
}
