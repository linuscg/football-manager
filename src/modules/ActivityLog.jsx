import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

// Admin → Activity Log. Rows come from the activity_log table, written by a
// database trigger on every change to production data — in the app, through
// an AI assistant (Claude / ChatGPT connector), or by automatic syncs.
// Visible to production owners/admins (RLS).

const PAGE = 400

const AREA = {
  production: 'Project setup', production_members: 'Team member',
  resources: 'Crew / equipment', resource_rates: 'Rate', resource_bookings: 'Booking',
  timesheet_ot: 'Timesheet OT', new_starter_status: 'New starter',
  fulltime_crew: 'Fulltime crew', hods: 'HOD',
  shoot_days: 'Shoot day', scenes: 'Scene', day_extras: 'Scene info', cast_members: 'Cast member',
  transport_log: 'Transport trip', transport_sheet_rows: 'Transport sheet row',
  transport_drivers: 'Driver', transport_locations: 'Location',
  accom_stays: 'Accommodation stay', accom_nights: 'Hotel night', hotels: 'Hotel',
  hotel_travel_times: 'Travel time', crew_hotel_assignments: 'Hotel assignment',
  budget_items: 'Budget item', budget_codes: 'Budget code',
  dpr_day: 'DPR', catering_collections: 'Catering',
  backpage_day_settings: 'Backpage', backpage_dept_settings: 'Backpage', backpage_member_overrides: 'Backpage',
}
const AREA_GROUPS = [
  ['crew', 'Crew & equipment', ['resources', 'resource_rates', 'resource_bookings', 'timesheet_ot', 'new_starter_status', 'fulltime_crew', 'hods']],
  ['schedule', 'Schedule', ['shoot_days', 'scenes', 'day_extras', 'cast_members']],
  ['transport', 'Transport', ['transport_log', 'transport_sheet_rows', 'transport_drivers', 'transport_locations']],
  ['accomm', 'Accommodation', ['accom_stays', 'accom_nights', 'hotels', 'hotel_travel_times', 'crew_hotel_assignments']],
  ['other', 'Setup, budget, DPR & other', null],
]
const SOURCES = [['', 'Everyone'], ['app', 'In the app'], ['assistant', 'AI assistant'], ['system', 'Automatic']]
const VERB = { insert: 'added', update: 'changed', delete: 'removed' }

const pretty = k => k.replace(/_id$/, '').replace(/_/g, ' ')
const HIDE_FIELDS = new Set(['id', 'production_id', 'resource_id', 'day_id', 'stay_id', 'scene_id', 'hotel_id', 'log_id', 'person_id', 'user_id', 'link_key'])
function fmtVal(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (Array.isArray(v)) return v.length ? v.map(fmtVal).join(', ') : '—'
  if (typeof v === 'object') { const s = JSON.stringify(v); return s.length > 80 ? s.slice(0, 77) + '…' : s }
  const s = String(v)
  return s.length > 80 ? s.slice(0, 77) + '…' : s
}
function fmtTime(iso) {
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function dateRuns(ds) {
  const sorted = [...new Set(ds.filter(Boolean))].sort()
  const out = []
  let a = null, b = null
  const next = s => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA') }
  for (const d of sorted) {
    if (b && next(b) === d) { b = d; continue }
    if (a) out.push(a === b ? a : `${a} → ${b}`)
    a = b = d
  }
  if (a) out.push(a === b ? a : `${a} → ${b}`)
  return out
}

// Field-level detail lines for one entry
function detailLines(e) {
  const c = e.changes ?? {}
  const keys = Object.keys(c).filter(k => !HIDE_FIELDS.has(k))
  if (e.table_name === 'resource_rates') return keys.length ? [`${keys.map(pretty).join(', ')} (values hidden)`] : []
  if (e.op === 'update') return keys.map(k => `${pretty(k)}: ${fmtVal(c[k]?.[0])} → ${fmtVal(c[k]?.[1])}`)
  return keys.slice(0, 8).map(k => `${pretty(k)}: ${fmtVal(c[k])}`)
}

// Consecutive entries by the same person, same kind of change, same thing,
// within 5 minutes collapse into one line (e.g. painting 20 booking days).
function groupEntries(rows) {
  const groups = []
  for (const e of rows) {
    const g = groups.at(-1)
    if (g && g.actor_id === e.actor_id && g.source === e.source && g.table_name === e.table_name
        && g.op === e.op && (g.label ?? '') === (e.label ?? '')
        && new Date(g.items.at(-1).at) - new Date(e.at) < 5 * 60 * 1000) {
      g.items.push(e)
    } else {
      groups.push({ key: e.id, actor_id: e.actor_id, actor_name: e.actor_name, source: e.source, table_name: e.table_name, op: e.op, label: e.label, at: e.at, items: [e] })
    }
  }
  return groups
}

function summary(g) {
  const area = AREA[g.table_name] ?? pretty(g.table_name)
  const n = g.items.length
  if (g.table_name === 'resource_bookings' && g.op !== 'update') {
    const dates = g.items.map(i => i.changes?.booking_date)
    const status = g.items[0].changes?.status
    const runs = dateRuns(dates)
    return <>{g.op === 'insert' ? `booked ${n} day${n === 1 ? '' : 's'}${status && status !== 'booked' ? ` (${status})` : ''}` : `removed ${n} booked day${n === 1 ? '' : 's'}`} for <strong>{g.label ?? 'unknown'}</strong>{runs.length ? <span className="al-dim"> · {runs.slice(0, 3).join(', ')}{runs.length > 3 ? ` +${runs.length - 3} more` : ''}</span> : null}</>
  }
  const what = n > 1 ? `${n} × ${area.toLowerCase()}` : area.toLowerCase()
  return <>{VERB[g.op] ?? g.op} {what}{g.label ? <> <strong>{g.label}</strong></> : null}</>
}

function SourceBadge({ source }) {
  if (source === 'app') return null
  if (source === 'assistant') return <span className="al-badge al-badge--ai">AI assistant</span>
  return <span className="al-badge al-badge--sys">{source === 'system' ? 'Automatic' : source}</span>
}

function Group({ g }) {
  const [open, setOpen] = useState(false)
  const lines = g.items.length === 1 ? detailLines(g.items[0]) : []
  const expandable = g.items.length > 1 || lines.length > 0
  return (
    <div className={`al-row al-row--${g.op}`}>
      <div className="al-time" title={new Date(g.at).toLocaleString('en-GB')}>{fmtTime(g.at)}</div>
      <div className="al-main">
        <div className="al-line">
          <span className="al-who">{g.actor_name || (g.source === 'app' ? 'Someone' : 'System')}</span>{' '}
          {summary(g)}
          <SourceBadge source={g.source} />
          {expandable && (
            <button className="al-more" onClick={() => setOpen(o => !o)}>{open ? 'hide' : 'details'}</button>
          )}
        </div>
        {open && (
          <div className="al-details">
            {g.items.length === 1
              ? lines.map((l, i) => <div key={i}>{l}</div>)
              : g.items.map(i => (
                  <div key={i.id} className="al-sub">
                    <span className="al-dim">{new Date(i.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>{' '}
                    {detailLines(i).join(' · ') || '—'}
                  </div>
                ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ActivityLog() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [source, setSource] = useState('')
  const [area, setArea] = useState('')
  const [person, setPerson] = useState('')
  const genRef = useRef(0)

  async function load(before = null) {
    const gen = ++genRef.current
    const pid = getCurrentProductionId()
    if (!pid) return
    setLoading(true)
    let q = supabase.from('activity_log')
      .select('id, at, actor_id, actor_name, source, table_name, row_id, op, label, changes')
      .eq('production_id', pid).order('id', { ascending: false }).limit(PAGE)
    // Page by id, not time: one bulk change shares a single timestamp.
    if (before) q = q.lt('id', before)
    const { data, error: e } = await q
    if (gen !== genRef.current) return
    if (e) { setError(e.message); setLoading(false); return }
    setError(null)
    setRows(rs => before ? [...rs, ...data] : data)
    setHasMore(data.length === PAGE)
    setLoading(false)
  }

  useEffect(() => {
    load()
    const unsub = onProductionChange(() => { setRows([]); load() })
    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const people = useMemo(() => [...new Set(rows.map(r => r.actor_name).filter(Boolean))].sort(), [rows])

  const groups = useMemo(() => {
    const areaTables = AREA_GROUPS.find(a => a[0] === area)?.[2]
    const known = new Set(AREA_GROUPS.flatMap(a => a[2] ?? []))
    const filtered = rows.filter(r =>
      (!source || (source === 'system' ? !['app', 'assistant'].includes(r.source) : r.source === source)) &&
      (!person || r.actor_name === person) &&
      (!area || (areaTables ? areaTables.includes(r.table_name) : !known.has(r.table_name))))
    return groupEntries(filtered)
  }, [rows, source, area, person])

  // Day headings
  const byDay = useMemo(() => {
    const out = []
    for (const g of groups) {
      const day = new Date(g.at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      if (out.at(-1)?.day !== day) out.push({ day, groups: [] })
      out.at(-1).groups.push(g)
    }
    return out
  }, [groups])

  return (
    <div className="pm-module">
      <div className="pm-module-head">
        <div>
          <div className="pm-eyebrow">Admin</div>
          <h1 className="pm-h1">Activity Log</h1>
          <div className="pm-h1-sub">Every change to this production — made in the app, through an AI assistant, or by automatic syncs.</div>
        </div>
        <div className="pm-module-head-actions">
          <select className="tr-filter" value={source} onChange={e => setSource(e.target.value)}>
            {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="tr-filter" value={area} onChange={e => setArea(e.target.value)}>
            <option value="">All areas</option>
            {AREA_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="tr-filter" value={person} onChange={e => setPerson(e.target.value)}>
            <option value="">All people</option>
            {people.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button className="pm-btn pm-btn--ghost" onClick={() => load()}>⟳ Refresh</button>
        </div>
      </div>

      {error && <div className="acct-error">{error}</div>}

      <div className="al-list">
        {byDay.map(d => (
          <div key={d.day} className="al-day">
            <div className="al-day-head">{d.day}</div>
            {d.groups.map(g => <Group key={g.key} g={g} />)}
          </div>
        ))}
        {!loading && !rows.length && !error && (
          <div className="al-empty">No changes recorded yet. Changes are logged from when the activity log was switched on.</div>
        )}
        {!loading && rows.length > 0 && !groups.length && <div className="al-empty">Nothing matches these filters.</div>}
        {loading && <div className="crew-db-loading">Loading…</div>}
        {!loading && hasMore && (
          <button className="pm-btn pm-btn--ghost al-load-more" onClick={() => load(rows.at(-1).id)}>Load older changes</button>
        )}
      </div>
    </div>
  )
}
