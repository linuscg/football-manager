import { useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { saDayTotal, saDayGroups, saRowsForDay } from '../lib/saTotals'

const fmtDay = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
  weekday: 'short', day: '2-digit', month: 'short',
})

function dayLabel(d) {
  if (d.dayCategory === 'main' && d.dayNumber != null) return `D${d.dayNumber}`
  const cat = d.dayCategory ?? 'day'
  return cat.charAt(0).toUpperCase() + cat.slice(1)
}

// Local-state editable cell
function Cell({ value, onCommit, type = 'text', placeholder, width }) {
  const [v, setV] = useState(value ?? '')
  return (
    <input
      className="tr-input"
      style={width ? { width } : undefined}
      type={type}
      value={v}
      placeholder={placeholder}
      onChange={e => setV(e.target.value)}
      onBlur={() => { if (v !== (value ?? '')) onCommit(v) }}
    />
  )
}

// ─── One day's SA editor ──────────────────────────────────────────────────────
function DayCard({ day, actions }) {
  const rows = saRowsForDay(day).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const total = saDayTotal(day)

  function linkRows(row, otherId) {
    if (!otherId) {   // unlink
      actions.updateDayExtra(day.id, row.id, 'linkKey', null)
      return
    }
    const other = rows.find(r => r.id === otherId)
    if (!other) return
    const key = other.linkKey ?? row.linkKey ?? crypto.randomUUID()
    if (other.linkKey !== key) actions.updateDayExtra(day.id, other.id, 'linkKey', key)
    if (row.linkKey !== key)   actions.updateDayExtra(day.id, row.id, 'linkKey', key)
  }

  // Which link group (1-based index) a row belongs to, for the badge colour
  const linkIndex = {}
  let li = 0
  for (const r of rows) {
    if (r.linkKey && !(r.linkKey in linkIndex)) linkIndex[r.linkKey] = ++li
  }

  return (
    <div className="sa-day-card" id={`sa-day-${day.id}`}>
      <div className="sa-day-head">
        <span className="sa-day-label">{dayLabel(day)}</span>
        <span className="sa-day-date">{day.date ? fmtDay(day.date) : 'No date'}</span>
        {day.location && <span className="sa-day-loc">{day.location}</span>}
        <span className="sa-day-total" title="Deduplicated headcount — linked groups count once">
          {total} SA{total === 1 ? '' : 's'}
        </span>
        <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={() => actions.addDayExtra(day.id, 'extras')}>
          + SA group
        </button>
      </div>
      {rows.length > 0 && (
        <table className="crew-db-table sa-table">
          <thead>
            <tr>
              <th className="crew-db-th" style={{ width: 64 }}>Sc.</th>
              <th className="crew-db-th">Description</th>
              <th className="crew-db-th" style={{ width: 64 }}>No.</th>
              <th className="crew-db-th" style={{ width: 70 }}>DooD</th>
              <th className="crew-db-th" style={{ width: 230 }}>Same people as…</th>
              <th className="crew-db-th" style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="tr-row">
                <td className="tr-td"><Cell key={`s${r.id}${r.scene}`} value={r.scene} placeholder="Sc." onCommit={v => actions.updateDayExtra(day.id, r.id, 'scene', v)} /></td>
                <td className="tr-td"><Cell key={`n${r.id}${r.saName}`} value={r.saName} placeholder="SA description…" onCommit={v => actions.updateDayExtra(day.id, r.id, 'saName', v)} /></td>
                <td className="tr-td"><Cell key={`t${r.id}${r.totalNumber ?? ''}`} value={r.totalNumber == null ? '' : String(r.totalNumber)} type="number" onCommit={v => actions.updateDayExtra(day.id, r.id, 'totalNumber', v === '' ? null : parseInt(v, 10))} /></td>
                <td className="tr-td sa-dood-cell">{r.doodId ? `#${r.doodId}` : ''}</td>
                <td className="tr-td">
                  <div className="sa-link-wrap">
                    {r.linkKey && (
                      <span className={`sa-link-badge sa-link-badge--${(linkIndex[r.linkKey] - 1) % 6}`} title="Linked — counted once in the day total">
                        ⛓ {linkIndex[r.linkKey]}
                      </span>
                    )}
                    <select
                      className="tr-input tr-select"
                      value=""
                      onChange={e => linkRows(r, e.target.value)}
                    >
                      <option value="">{r.linkKey ? 'Unlink' : 'Not linked'}</option>
                      {rows.filter(o => o.id !== r.id).map(o => (
                        <option key={o.id} value={o.id}>
                          Sc.{o.scene || '?'} — {(o.saName || 'unnamed').slice(0, 30)} ({o.totalNumber ?? '?'})
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="tr-td">
                  <button className="pm-icon-btn danger" title="Delete" onClick={() => actions.deleteDayExtra(day.id, r.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── DooD import modal ────────────────────────────────────────────────────────
function DoodModal({ plan, onCancel, onApply, busy }) {
  const [choices, setChoices] = useState(() => {
    const c = {}
    for (const item of plan) c[item.key] = item.suggestion
    return c
  })
  const matchedCount = Object.values(choices).filter(v => v && v !== 'skip').length
  return (
    <div className="sched-import-backdrop" onClick={onCancel}>
      <div className="sched-import-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 860 }}>
        <div className="sched-import-head">
          <h3 className="sched-import-title">Day out of Days Import</h3>
          <button className="sched-import-close" onClick={onCancel}>×</button>
        </div>
        <div className="sched-import-body">
          <div className="sched-import-summary">
            <strong>{plan.length}</strong> group-days from the DooD ·{' '}
            <strong>{matchedCount}</strong> will apply.
            <span className="sched-import-day-meta">
              Matched rows get the DooD description, headcount and link (so same-day
              scenes count once). "Create new" adds an SA row to that day. Change any
              match that looks wrong.
            </span>
          </div>
          <div className="sched-import-days">
            {plan.map(item => (
              <div key={item.key} className="sched-import-day">
                <div className="sched-import-day-head sa-dood-row">
                  <span className="sched-import-day-title">
                    #{item.doodId} {item.description} ({item.total})
                  </span>
                  <span className="sched-import-day-meta">{item.dayText}</span>
                  <select
                    className="tr-input tr-select sa-dood-pick"
                    value={choices[item.key] ?? 'skip'}
                    onChange={e => setChoices(c => ({ ...c, [item.key]: e.target.value }))}
                  >
                    <option value="create">➕ Create new SA row on this day</option>
                    {item.candidates.map(c => (
                      <option key={c.id} value={c.id}>
                        Match: Sc.{c.scene || '?'} — {(c.saName || 'unnamed').slice(0, 26)} ({c.totalNumber ?? '?'})
                      </option>
                    ))}
                    <option value="skip">Skip</option>
                  </select>
                </div>
              </div>
            ))}
            {plan.length === 0 && (
              <p className="admin-empty">No DooD work dates landed on schedule days — check the dates match your shoot days.</p>
            )}
          </div>
        </div>
        <div className="sched-import-foot">
          <button className="pm-btn pm-btn--ghost" onClick={onCancel}>Cancel</button>
          <button className="pm-btn pm-btn--primary" disabled={busy || plan.length === 0} onClick={() => onApply(choices)}>
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main module ──────────────────────────────────────────────────────────────
export default function SupportingArtists({ store, actions }) {
  const { shootDays } = store
  const [view, setView] = useState(() => localStorage.getItem('fm_sa_view') ?? 'list')
  const [selectedDay, setSelectedDay] = useState(null)
  const [doodPlan, setDoodPlan] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [applying, setApplying] = useState(false)
  const fileRef = useRef(null)

  const days = useMemo(
    () => [...shootDays]
      .filter(d => d.dayCategory !== 'unscheduled')
      .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [shootDays]
  )
  const grandTotal = useMemo(() => days.reduce((s, d) => s + saDayTotal(d), 0), [days])

  function pickView(v) { setView(v); localStorage.setItem('fm_sa_view', v) }

  // ── DooD upload → parse → match plan ───────────────────────────────────────
  async function handleDoodFile(file) {
    if (!file) return
    setParsing(true)
    try {
      const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result).split(',')[1])
        fr.onerror = () => reject(new Error('Could not read the file.'))
        fr.readAsDataURL(file)
      })
      const { data, error } = await supabase.functions.invoke('parse-dood-pdf', { body: { pdfBase64: b64 } })
      if (error || data?.error) {
        let detail = data?.error ?? null
        if (!detail && error?.context?.json) { try { detail = (await error.context.json())?.error } catch { /* ignore */ } }
        throw new Error(detail ?? error?.message ?? 'Parse failed')
      }
      const groups = data.result?.groups ?? []
      if (!groups.length) throw new Error('No groups found in the PDF.')

      // Build the matching plan: one entry per (group, work date) that lands
      // on a schedule day.
      const daysByDate = {}
      for (const d of days) {
        if (!d.date) continue
        if (!daysByDate[d.date]) daysByDate[d.date] = []
        daysByDate[d.date].push(d)
      }
      const claimed = new Set()
      const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
      const similar = (a, b) => {
        const A = new Set(norm(a)); const B = norm(b)
        if (!A.size || !B.length) return 0
        return B.filter(w => A.has(w)).length / Math.max(A.size, B.length)
      }
      const plan = []
      for (const g of groups) {
        for (const date of g.workDates ?? []) {
          const dayList = daysByDate[date]
          if (!dayList) continue
          // Prefer the main day on the date
          const day = dayList.find(d => d.dayCategory === 'main') ?? dayList[0]
          const rows = saRowsForDay(day).filter(r => !claimed.has(r.id))
          // Suggestion: exact headcount match first, then name similarity
          let suggestion = 'create'
          const exact = rows.filter(r => Number(r.totalNumber) === Number(g.total))
          const byName = rows.filter(r => similar(r.saName, g.description) >= 0.5)
          const best = exact.length === 1 ? exact[0]
                     : byName.length === 1 ? byName[0]
                     : exact.find(r => similar(r.saName, g.description) >= 0.3) ?? null
          if (best) { suggestion = best.id; claimed.add(best.id) }
          plan.push({
            key: `${g.doodId}|${date}`,
            doodId: String(g.doodId), description: g.description, total: g.total,
            date, dayId: day.id,
            dayText: `${dayLabel(day)} · ${fmtDay(date)}`,
            candidates: saRowsForDay(day),
            suggestion,
          })
        }
      }
      plan.sort((a, b) => a.date.localeCompare(b.date) || a.doodId.localeCompare(b.doodId, undefined, { numeric: true }))
      setDoodPlan(plan)
    } catch (err) {
      window.alert(`DooD import failed: ${err.message}`)
    } finally {
      setParsing(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function applyDood(choices) {
    setApplying(true)
    try {
      for (const item of doodPlan) {
        const choice = choices[item.key]
        if (!choice || choice === 'skip') continue
        const linkKey = `dood-${item.doodId}`
        if (choice === 'create') {
          actions.addSaRow(item.dayId, {
            saName: item.description, totalNumber: item.total,
            doodId: item.doodId, linkKey,
          })
        } else {
          const row = saRowsForDay(days.find(d => d.id === item.dayId) ?? {}).find(r => r.id === choice)
          actions.updateDayExtra(item.dayId, choice, 'doodId', item.doodId)
          actions.updateDayExtra(item.dayId, choice, 'linkKey', linkKey)
          if (row && !(row.saName ?? '').trim()) actions.updateDayExtra(item.dayId, choice, 'saName', item.description)
          if (row && (row.totalNumber == null || row.totalNumber === '')) actions.updateDayExtra(item.dayId, choice, 'totalNumber', item.total)
        }
      }
      setDoodPlan(null)
    } finally {
      setApplying(false)
    }
  }

  // ── Calendar view ──────────────────────────────────────────────────────────
  const [calMonth, setCalMonth] = useState(() => {
    const first = days.find(d => d.date)?.date
    return (first ?? new Date().toISOString().slice(0, 10)).slice(0, 7)
  })
  function calCells() {
    const [y, m] = calMonth.split('-').map(Number)
    const first = new Date(Date.UTC(y, m - 1, 1))
    const startDow = (first.getUTCDay() + 6) % 7   // Monday-first
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const cells = []
    for (let i = 0; i < startDow; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${calMonth}-${String(d).padStart(2, '0')}`
      cells.push({ iso, dayNum: d, days: days.filter(x => x.date === iso) })
    }
    return cells
  }
  function shiftMonth(delta) {
    const [y, m] = calMonth.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + delta, 1))
    setCalMonth(d.toISOString().slice(0, 7))
  }

  const selected = days.find(d => d.id === selectedDay)

  return (
    <div className="pm-module">
      <div className="pm-module-head">
        <div>
          <div className="pm-eyebrow">Football Manager</div>
          <h1 className="pm-h1">Supporting Artists</h1>
          <div className="pm-h1-sub">{grandTotal} SA days across the schedule (linked groups counted once)</div>
        </div>
        <div className="pm-module-head-actions">
          <div className="gantt-tabs" style={{ marginRight: 8 }}>
            <button className={`gantt-tab${view === 'list' ? ' active' : ''}`} onClick={() => pickView('list')}>List</button>
            <button className={`gantt-tab${view === 'calendar' ? ' active' : ''}`} onClick={() => pickView('calendar')}>Calendar</button>
          </div>
          <button className="pm-btn pm-btn--primary" onClick={() => fileRef.current?.click()} disabled={parsing}>
            {parsing ? 'Parsing…' : '↑ Upload DooD'}
          </button>
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }}
            onChange={e => handleDoodFile(e.target.files?.[0])} />
        </div>
      </div>

      {view === 'calendar' && (
        <>
          <div className="cal-nav" style={{ marginBottom: 10 }}>
            <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={() => shiftMonth(-1)}>‹</button>
            <span className="sa-cal-month">
              {new Date(calMonth + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
            </span>
            <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={() => shiftMonth(1)}>›</button>
          </div>
          <div className="sa-cal-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="sa-cal-dow">{d}</div>)}
            {calCells().map((cell, i) => cell === null
              ? <div key={`b${i}`} className="sa-cal-cell sa-cal-cell--blank" />
              : (
                <div
                  key={cell.iso}
                  className={`sa-cal-cell${cell.days.length ? ' sa-cal-cell--shoot' : ''}${cell.days.some(d => d.id === selectedDay) ? ' is-selected' : ''}`}
                  onClick={() => cell.days[0] && setSelectedDay(cell.days[0].id)}
                >
                  <div className="sa-cal-daynum">{cell.dayNum}</div>
                  {cell.days.map(d => {
                    const t = saDayTotal(d)
                    return (
                      <div key={d.id} className="sa-cal-chip">
                        {dayLabel(d)}{t > 0 ? ` · ${t} SAs` : ''}
                      </div>
                    )
                  })}
                  {cell.days[0] && saDayGroups(cell.days[0]).slice(0, 3).map((g, gi) => (
                    <div key={gi} className="sa-cal-group">{g.name.slice(0, 20)} ×{g.total}</div>
                  ))}
                </div>
              ))}
          </div>
          {selected && <DayCard day={selected} actions={actions} />}
        </>
      )}

      {view === 'list' && days.map(day => (
        (saRowsForDay(day).length > 0 || day.dayCategory === 'main') &&
          <DayCard key={day.id} day={day} actions={actions} />
      ))}

      {doodPlan && (
        <DoodModal
          plan={doodPlan}
          busy={applying}
          onCancel={() => setDoodPlan(null)}
          onApply={applyDood}
        />
      )}
    </div>
  )
}
