import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId } from '../lib/productionContext'
import { parseDiaryGrid, splitDay, buildTravel, isoOf, addDaysIso } from '../lib/diaryBoard'

// ─── Diary board — a TV / large-monitor view of the day ──────────────────────
// Pulls the production diary + travel/accom log Google Sheets via the
// diary-board edge function every few minutes. Meetings grey out as they
// finish; the list keeps the current / next meeting in view.

const REFRESH_MS = 5 * 60 * 1000
const TRAVEL_DAYS = 14

const fmtHM = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const dayName = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const relDay = (iso, today) => iso === today ? 'Today' : iso === addDaysIso(today, 1) ? 'Tomorrow' : dayName(iso)

function useNow(intervalMs) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

// Slowly scrolls an overflowing panel down, pauses, jumps back to the top —
// so a wall-mounted screen eventually shows everything.
function useAutoScroll(ref, deps) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let waitUntil = Date.now() + 6000
    const t = setInterval(() => {
      if (el.scrollHeight <= el.clientHeight + 4) { el.scrollTop = 0; return }
      if (Date.now() < waitUntil) return
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
        waitUntil = Date.now() + 6000
        setTimeout(() => { el.scrollTo({ top: 0, behavior: 'smooth' }) }, 5000)
        return
      }
      el.scrollTop += 1
    }, 50)
    return () => clearInterval(t)
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}

function Clock() {
  const now = useNow(1000)
  return (
    <div className="db-clock">
      <div className="db-time">
        {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        <span className="db-secs">{String(now.getSeconds()).padStart(2, '0')}</span>
      </div>
      <div className="db-date">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
    </div>
  )
}

// ── Meetings timeline ────────────────────────────────────────────────────────
function meetingState(m, nowMin) {
  if (m.status === 'cancelled') return 'cancelled'
  if (m.start == null) return 'tbc'
  const end = m.end ?? m.start + 60
  if (nowMin >= end) return 'past'
  if (nowMin >= m.start) return 'now'
  return 'upcoming'
}

function Meetings({ meetings, nowMin }) {
  const listRef = useRef(null)
  const states = meetings.map(m => meetingState(m, nowMin))
  const focusIdx = states.findIndex(s => s === 'now' || s === 'upcoming' || s === 'tbc')
  const nextIdx = states.findIndex(s => s === 'upcoming')

  // Keep the current / next meeting near the top, one finished one above it
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const items = el.querySelectorAll('.db-meet')
    const target = items[Math.max(0, (focusIdx < 0 ? items.length - 1 : focusIdx) - 1)]
    if (target) el.scrollTo({ top: target.offsetTop - el.offsetTop - 8, behavior: 'smooth' })
  }, [focusIdx, meetings.length])

  if (!meetings.length) return <div className="db-empty">No meetings in the diary today</div>
  return (
    <div className="db-meet-list" ref={listRef}>
      {meetings.map((m, i) => {
        const st = states[i]
        const end = m.end ?? (m.start != null ? m.start + 60 : null)
        const pct = st === 'now' && end ? Math.min(100, Math.round(((nowMin - m.start) / (end - m.start)) * 100)) : 0
        const mins = st === 'upcoming' ? m.start - nowMin : null
        return (
          <div key={i} className={`db-meet db-meet--${st}${m.unavailable ? ' is-unavail' : ''}`}>
            <div className="db-meet-time">
              {m.start != null ? fmtHM(m.start) : (m.approx || 'TBC')}
              {m.end != null && <span className="db-meet-end">– {fmtHM(m.end)}</span>}
              {m.tbc && m.start != null && <span className="db-tag">TBC</span>}
            </div>
            <div className="db-meet-body">
              <div className="db-meet-title">
                {m.title}
                {st === 'now' && <span className="db-pill db-pill--now">Now</span>}
                {i === nextIdx && mins != null && (
                  <span className="db-pill db-pill--next">{mins < 60 ? `in ${mins} min` : `in ${Math.floor(mins / 60)}h ${mins % 60}m`}</span>
                )}
                {st === 'cancelled' && <span className="db-pill db-pill--off">Cancelled</span>}
              </div>
              {st !== 'past' && (m.location || m.details.length > 0) && (
                <div className="db-meet-meta">
                  {m.location && <div className="db-meet-loc">📍 {m.location}</div>}
                  {m.details.slice(0, 2).map((d, j) => <div key={j} className="db-meet-detail">{d}</div>)}
                </div>
              )}
              {st === 'now' && <div className="db-progress"><span style={{ width: `${pct}%` }} /></div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Travel, grouped by person ────────────────────────────────────────────────
const KIND = {
  flight:   { icon: '✈', label: 'Flight' },
  train:    { icon: '🚆', label: 'Train' },
  checkin:  { icon: '🏨', label: 'Check-in' },
  checkout: { icon: '🧳', label: 'Check-out' },
}

function TravelEvent({ e, today }) {
  const isToday = e.date === today
  const k = KIND[e.kind]
  return (
    <div className={`db-trv-ev${isToday ? ' is-today' : ''}`}>
      <span className="db-trv-icon">{k.icon}</span>
      <span className="db-trv-when">{relDay(e.date, today)}</span>
      {(e.kind === 'flight' || e.kind === 'train') ? (
        <span className="db-trv-what">
          <strong>{e.from || '?'} → {e.to || '?'}</strong>
          {e.title && <span className="db-trv-num">{e.title}</span>}
          <span className="db-trv-times">
            {e.time && `dep ${e.time}`}{e.arrive && ` · arr ${e.arrive}`}
            {e.arriveDate && e.arriveDate !== e.date && ` (${dayName(e.arriveDate)})`}
          </span>
        </span>
      ) : (
        <span className="db-trv-what"><strong>{k.label}</strong> <span className="db-trv-place">{e.title}</span></span>
      )}
    </div>
  )
}

// ── Settings (owner / admin) ─────────────────────────────────────────────────
function SheetSettings({ production, onUpdate, serviceAccount, onClose }) {
  const [diary, setDiary] = useState(production.diarySheetUrl ?? '')
  const [travel, setTravel] = useState(production.travelSheetUrl ?? '')
  return (
    <div className="db-settings" onClick={e => e.stopPropagation()}>
      <div className="db-settings-title">Diary board sheets</div>
      <label>Production diary (Google Sheet link)
        <input value={diary} onChange={e => setDiary(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
      </label>
      <label>Travel &amp; accommodation log (Google Sheet link)
        <input value={travel} onChange={e => setTravel(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
      </label>
      <div className="db-settings-note">
        Share both sheets (Viewer) with {serviceAccount ? <strong>{serviceAccount}</strong> : 'the app’s Google service account (the same one the crew sheet uses)'}.
      </div>
      <div className="db-settings-foot">
        <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={onClose}>Cancel</button>
        <button className="pm-btn pm-btn--primary pm-btn--sm" onClick={() => {
          if (diary.trim() !== (production.diarySheetUrl ?? '')) onUpdate('diarySheetUrl', diary.trim())
          if (travel.trim() !== (production.travelSheetUrl ?? '')) onUpdate('travelSheetUrl', travel.trim())
          onClose(true)
        }}>Save</button>
      </div>
    </div>
  )
}

// ── Board ────────────────────────────────────────────────────────────────────
export default function DiaryBoard({ production, onUpdateProduction, canEdit }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const rootRef = useRef(null)
  const travelRef = useRef(null)
  const notesRef = useRef(null)
  const now = useNow(30 * 1000)
  const today = isoOf(now)
  const nowMin = now.getHours() * 60 + now.getMinutes()

  // Crew starts + additional equipment on/off-hires (from the app, not the sheets)
  const [hires, setHires] = useState([])
  const loadHires = useCallback(async () => {
    const productionId = getCurrentProductionId()
    if (!productionId) return
    const t = isoOf(new Date()), t1 = addDaysIso(t, 1)
    const { data: rows, error: err } = await supabase.from('resources')
      .select('id, type, name, role, department, category, vendor, hire_start_date, hire_end_date, equip_class, crew_class')
      .eq('production_id', productionId)
      .or(`hire_start_date.in.(${t},${t1}),hire_end_date.in.(${t},${t1})`)
    if (err) { console.error('[diary] hires', err); return }
    setHires(rows ?? [])
  }, [])

  const load = useCallback(async () => {
    const productionId = getCurrentProductionId()
    if (!productionId) return
    loadHires()
    try {
      const { data: res, error: err } = await supabase.functions.invoke('diary-board', { body: { productionId } })
      if (err || res?.error) {
        let detail = res?.error ?? null
        if (!detail && err?.context?.json) { try { detail = (await err.context.json())?.error } catch { /* ignore */ } }
        throw new Error(detail ?? err?.message ?? 'Could not load the diary')
      }
      setData(res); setError(null)
    } catch (e) {
      setError(e.message)   // keep showing the last good data
    } finally {
      setLoading(false)
    }
  }, [loadHires])

  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load, production.diarySheetUrl, production.travelSheetUrl])

  // Re-parse when the data or the day changes
  const days = useMemo(() => (data?.diary ? parseDiaryGrid(data.diary, today) : {}), [data, today])
  const todayDay = days[today]
  const { meetings, notes } = useMemo(() => splitDay(todayDay), [todayDay])
  const tomorrowIso = addDaysIso(today, 1)
  const tomorrow = useMemo(() => splitDay(days[tomorrowIso]), [days, tomorrowIso])
  const travel = useMemo(() => buildTravel(data?.travel ?? [], data?.accom ?? [], today, TRAVEL_DAYS), [data, today])

  // Crew starting + additional equipment going on / off hire, today & tomorrow
  const startsHires = useMemo(() => {
    const out = { today: { starts: [], on: [], off: [] }, tomorrow: { starts: [], on: [], off: [] } }
    for (const r of hires) {
      for (const [when, iso] of [['today', today], ['tomorrow', tomorrowIso]]) {
        if (r.type === 'crew' && r.hire_start_date === iso) out[when].starts.push(r)
        if (r.type === 'equipment' && r.equip_class === 'additional') {
          if (r.hire_start_date === iso) out[when].on.push(r)
          if (r.hire_end_date === iso) out[when].off.push(r)
        }
      }
    }
    for (const g of Object.values(out)) for (const l of Object.values(g)) l.sort((a, b) => String(a.department || a.category).localeCompare(String(b.department || b.category)) || a.name.localeCompare(b.name))
    return out
  }, [hires, today, tomorrowIso])
  const hiresRef = useRef(null)
  useAutoScroll(hiresRef, [hires.length])

  useAutoScroll(travelRef, [travel.length])
  useAutoScroll(notesRef, [notes.length, todayDay?.logistics?.length, hires.length])

  function fullscreen() {
    const el = rootRef.current
    if (!document.fullscreenElement) el?.requestFullscreen?.()
    else document.exitFullscreen?.()
  }

  const remaining = meetings.filter(m => meetingState(m, nowMin) !== 'past' && m.status !== 'cancelled').length
  const notConfigured = data && data.configured === false

  return (
    <div className="db-root" ref={rootRef}>
      <header className="db-head">
        <div className="db-head-l">
          <div className="db-eyebrow">{production.name || 'Production'} · Production Diary</div>
          <div className="db-week">
            {todayDay?.weekLabel && <span className="db-week-chip">{todayDay.weekLabel}</span>}
            {todayDay?.weekNote && <span className="db-week-note">{todayDay.weekNote}</span>}
          </div>
        </div>
        <Clock />
        <div className="db-tools">
          {canEdit && <button className="db-tool" title="Sheet links" onClick={() => setShowSettings(s => !s)}>⚙</button>}
          <button className="db-tool" title="Refresh now" onClick={load}>⟳</button>
          <button className="db-tool" title="Full screen" onClick={fullscreen}>⤢</button>
        </div>
        {showSettings && (
          <SheetSettings
            production={production}
            onUpdate={onUpdateProduction}
            serviceAccount={data?.serviceAccount}
            onClose={saved => { setShowSettings(false); if (saved) setTimeout(load, 800) }}
          />
        )}
      </header>

      {notConfigured ? (
        <div className="db-setup">
          <div className="db-setup-title">Link the diary sheets to get started</div>
          <div className="db-setup-sub">
            {canEdit ? 'Click ⚙ above and paste the production diary and travel log Google Sheet links.' : 'Ask a production admin to link the diary and travel log sheets.'}
          </div>
        </div>
      ) : (
        <main className="db-grid">
          <section className="db-panel db-panel--meet">
            <div className="db-panel-head">
              <span>Today’s meetings</span>
              <span className="db-panel-count">{remaining} to go</span>
            </div>
            {loading && !data ? <div className="db-empty">Loading…</div> : <Meetings meetings={meetings} nowMin={nowMin} />}
          </section>

          <section className="db-panel db-panel--travel">
            <div className="db-panel-head">
              <span>Travel &amp; accommodation</span>
              <span className="db-panel-count">next {TRAVEL_DAYS} days</span>
            </div>
            <div className="db-scroll" ref={travelRef}>
              {travel.length === 0 && <div className="db-empty db-empty--sm">Nothing booked in the next {TRAVEL_DAYS} days</div>}
              {travel.map(p => (
                <div key={p.key} className={`db-person${p.events.some(e => e.date === today) ? ' is-today' : ''}`}>
                  <div className="db-person-head">
                    <span className="db-person-name">{p.name}</span>
                    {p.role && <span className="db-person-role">{p.role}</span>}
                  </div>
                  {p.events.map((e, i) => <TravelEvent key={i} e={e} today={today} />)}
                </div>
              ))}
            </div>
          </section>

          <section className="db-panel db-panel--notes">
            <div className="db-panel-head"><span>Also today</span></div>
            <div className="db-scroll" ref={notesRef}>
              {notes.length === 0 && !(todayDay?.logistics?.length) && !startsHires.today.on.length && !startsHires.today.off.length && <div className="db-empty db-empty--sm">Nothing else noted</div>}
              {[['on', '⬆ Equipment on hire'], ['off', '⬇ Equipment off hire']].map(([k, label]) => startsHires.today[k].length > 0 && (
                <div key={k} className={`db-note db-hires-group--${k}`}>
                  <div className="db-hires-label">{label}</div>
                  {startsHires.today[k].map(r => (
                    <div key={r.id} className="db-hires-row">
                      <strong>{r.name}</strong>
                      <span>{[r.category, r.vendor].filter(Boolean).join(' · ')}</span>
                    </div>
                  ))}
                </div>
              ))}
              {notes.map((n, i) => (
                <div key={`n${i}`} className={`db-note${n.unavailable ? ' is-unavail' : ''}`}>
                  <div className="db-note-title">{n.title}</div>
                  {n.details.slice(0, 2).map((d, j) => <div key={j} className="db-note-detail">{d}</div>)}
                </div>
              ))}
              {(todayDay?.logistics ?? []).map((n, i) => (
                <div key={`l${i}`} className="db-note db-note--logi">
                  <div className="db-note-title">
                    {n.start != null && <span className="db-note-time">{fmtHM(n.start)}{n.tbc ? ' TBC' : ''}</span>}
                    {n.title}
                  </div>
                  {n.details.slice(0, 2).map((d, j) => <div key={j} className="db-note-detail">{d}</div>)}
                </div>
              ))}
            </div>
          </section>

          <section className="db-panel db-panel--hires">
            <div className="db-panel-head"><span>New starts</span></div>
            <div className="db-scroll" ref={hiresRef}>
              {['today', 'tomorrow'].map(when => {
                const list = startsHires[when].starts
                if (when === 'tomorrow' && !list.length) return null
                return (
                  <div key={when} className={`db-hires-day${when === 'tomorrow' ? ' is-tmrw' : ''}`}>
                    {when === 'tomorrow' && <div className="db-hires-when">Tomorrow</div>}
                    {when === 'today' && !list.length && <div className="db-empty db-empty--sm">No one starting today</div>}
                    {list.map(r => (
                      <div key={r.id} className="db-hires-row">
                        <strong>{r.name}</strong>
                        <span>{[r.role, r.department].filter(Boolean).join(' · ')}</span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="db-panel db-panel--tomorrow">
            <div className="db-panel-head">
              <span>Tomorrow</span>
              <span className="db-panel-count">{dayName(tomorrowIso)}</span>
            </div>
            <div className="db-tmrw">
              {tomorrow.meetings.length === 0 && tomorrow.notes.length === 0 && !startsHires.tomorrow.on.length && !startsHires.tomorrow.off.length && <div className="db-empty db-empty--sm">Nothing in the diary yet</div>}
              {tomorrow.meetings.slice(0, 6).map((m, i) => (
                <div key={i} className="db-tmrw-row">
                  <span className="db-tmrw-time">{m.start != null ? fmtHM(m.start) : (m.approx || 'TBC')}</span>
                  <span className="db-tmrw-title">{m.title}</span>
                </div>
              ))}
              {tomorrow.meetings.length > 6 && <div className="db-tmrw-more">+ {tomorrow.meetings.length - 6} more</div>}
              {[['on', '⬆'], ['off', '⬇']].flatMap(([k, icon]) => startsHires.tomorrow[k].map(r => (
                <div key={k + r.id} className={`db-tmrw-row db-hires-group--${k}`}>
                  <span className="db-tmrw-time db-hires-label">{icon} {k === 'on' ? 'On' : 'Off'}</span>
                  <span className="db-tmrw-title">{r.name}</span>
                </div>
              )))}
            </div>
          </section>
        </main>
      )}

      <footer className="db-foot">
        {error
          ? <span className="db-foot-err">⚠ {error}</span>
          : data?.errors?.length ? <span className="db-foot-err">⚠ {data.errors.join(' · ')}</span>
          : <span>Live from the production diary &amp; travel log</span>}
        {data?.fetchedAt && <span>Updated {new Date(data.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · refreshes every 5 min</span>}
      </footer>
    </div>
  )
}
