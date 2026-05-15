import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { useDprStore } from '../store/useDprStore'
import { useHodsStore } from '../store/useHodsStore'
import { useCrewStore } from '../store/useCrewStore'
import { useCateringStore } from '../store/useCateringStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LS_KEY = 'fm_dpr_selected_day'

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch { return iso }
}

function shortDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short',
    })
  } catch { return iso }
}

function todayISO() {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}

function pickInitialDay(shootDays) {
  const saved = localStorage.getItem(LS_KEY)
  if (saved && shootDays.find(d => d.id === saved)) return saved
  const main = shootDays.filter(d => d.dayCategory === 'main' && !d.isNonShootDay)
  if (!main.length) return null
  const today = todayISO()
  const todayDay = main.find(d => d.date === today)
  if (todayDay) return todayDay.id
  // Most recent by date <= today; else first
  const sorted = [...main].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  const past = sorted.filter(d => d.date && d.date <= today)
  if (past.length) return past[past.length - 1].id
  return sorted[0].id
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function parseTime(str) {
  if (!str) return 0
  const parts = String(str).split(':').map(n => parseInt(n, 10) || 0)
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2]
  if (parts.length === 2) return parts[0]*60 + parts[1]
  return 0
}

function formatSeconds(s) {
  if (!s) return ''
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
}

function sumTimeStrings(a, b) {
  const sa = parseTime(a), sb = parseTime(b)
  if (!sa && !sb) return ''
  return formatSeconds(sa + sb)
}

function findLunchLocation(locations) {
  if (!Array.isArray(locations)) return ''
  const re = /lunch|catering|crew\s*meal|meal/i
  for (const loc of locations) {
    if (typeof loc === 'string') {
      if (re.test(loc)) return loc
    } else if (loc && typeof loc === 'object') {
      const candidates = [loc.name, loc.label, loc.description, loc.address, loc.type, loc.role]
      for (const c of candidates) {
        if (typeof c === 'string' && re.test(c)) {
          return loc.address || loc.name || loc.label || c
        }
      }
    }
  }
  return ''
}

// ─── Reusable diff-aware field ────────────────────────────────────────────────

function FieldWithDiff({ label, value, sourceValue, onCommit, placeholder, type = 'text' }) {
  const [local, setLocal] = useState(value ?? '')
  useEffect(() => { setLocal(value ?? '') }, [value])
  const cur = String(local ?? '')
  const src = sourceValue == null ? null : String(sourceValue)
  const isDiff = src != null && cur.trim() !== '' && cur !== src
  return (
    <div className="dpr-field">
      {label && <span className="dpr-field-label">{label}</span>}
      <input
        type={type}
        value={local}
        placeholder={placeholder ?? ''}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => { if (String(value ?? '') !== local) onCommit(local) }}
      />
      {isDiff && (
        <span className="dpr-diff-warning" title={`Differs from schedule: "${src}"`}>⚠</span>
      )}
    </div>
  )
}

function PlainField({ label, value, onCommit, placeholder, type = 'text' }) {
  const [local, setLocal] = useState(value ?? '')
  useEffect(() => { setLocal(value ?? '') }, [value])
  return (
    <div className="dpr-field">
      {label && <span className="dpr-field-label">{label}</span>}
      <input
        type={type}
        value={local}
        placeholder={placeholder ?? ''}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => { if (String(value ?? '') !== String(local)) onCommit(type === 'number' ? (local === '' ? 0 : Number(local)) : local) }}
      />
    </div>
  )
}

function TextareaField({ label, value, onCommit, placeholder, rows = 3 }) {
  const [local, setLocal] = useState(value ?? '')
  useEffect(() => { setLocal(value ?? '') }, [value])
  return (
    <div className="dpr-field">
      {label && <span className="dpr-field-label">{label}</span>}
      <textarea
        rows={rows}
        value={local}
        placeholder={placeholder ?? ''}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => { if ((value ?? '') !== local) onCommit(local) }}
      />
    </div>
  )
}

function CheckField({ label, value, onCommit }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151' }}>
      <input type="checkbox" checked={!!value} onChange={e => onCommit(e.target.checked)} />
      {label}
    </label>
  )
}

// ─── Inline cell input (table) ────────────────────────────────────────────────

function CellInput({ value, onCommit, placeholder, type = 'text' }) {
  const [local, setLocal] = useState(value ?? '')
  useEffect(() => { setLocal(value ?? '') }, [value])
  return (
    <input
      type={type}
      value={local}
      placeholder={placeholder ?? ''}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (String(value ?? '') !== String(local)) onCommit(local) }}
    />
  )
}

function CellSelect({ value, options, onCommit }) {
  return (
    <select value={value ?? ''} onChange={e => onCommit(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// ─── Main module ──────────────────────────────────────────────────────────────

export default function DPR({ productionName, shootDays, castMembers }) {
  const { dprs, loading, ensureDpr, updateDpr } = useDprStore()
  const { hods } = useHodsStore()
  const { resources, bookings } = useCrewStore()
  const { records: cateringRecords } = useCateringStore()
  const prefilledRef = useRef(new Set())

  const mainDays = useMemo(
    () => shootDays.filter(d => d.dayCategory === 'main' && !d.isNonShootDay),
    [shootDays]
  )

  const [selectedDayId, setSelectedDayId] = useState(() => pickInitialDay(shootDays))

  // Re-pick if selection becomes invalid (e.g., after switching production)
  useEffect(() => {
    if (selectedDayId && !shootDays.find(d => d.id === selectedDayId)) {
      setSelectedDayId(pickInitialDay(shootDays))
    } else if (!selectedDayId && shootDays.length) {
      setSelectedDayId(pickInitialDay(shootDays))
    }
  }, [shootDays, selectedDayId])

  useEffect(() => {
    if (selectedDayId) localStorage.setItem(LS_KEY, selectedDayId)
  }, [selectedDayId])

  const selectedDay = useMemo(
    () => shootDays.find(d => d.id === selectedDayId) ?? null,
    [shootDays, selectedDayId]
  )

  const dpr = useMemo(
    () => (selectedDayId ? dprs.find(d => d.shootDayId === selectedDayId) ?? null : null),
    [dprs, selectedDayId]
  )

  // Auto-create dpr_day row on first selection, then auto-pull/prefill.
  useEffect(() => {
    if (!selectedDayId || loading) return
    const day = shootDays.find(d => d.id === selectedDayId)
    if (!day) return

    let cancelled = false
    ;(async () => {
      const existing = dprs.find(d => d.shootDayId === selectedDayId)
      const dprRow = existing ?? await ensureDpr(selectedDayId)
      if (cancelled || !dprRow) return

      const dprId = dprRow.id
      const isFirstPrefill = !prefilledRef.current.has(dprId)

      // ── Auto-pull scenes ──
      if ((dprRow.scenes?.length ?? 0) === 0 && (day.scenes?.length ?? 0) > 0) {
        const items = (day.scenes ?? []).map(sc => {
          const castList = (sc.castMemberIds ?? [])
            .map(id => castMembers?.find(c => c.id === id))
            .filter(Boolean)
            .map(c => c.castNumber ?? c.name)
            .join(', ')
          return {
            id: newId(),
            source_id: sc.id,
            removed: false,
            source: {
              sceneNumber: sc.sceneNumber, dayNight: sc.dayNight, intExt: sc.intExt,
              description: sc.description, pages: sc.pages, location: sc.location, castList,
            },
            scene_number: sc.sceneNumber, day_night: sc.dayNight, int_ext: sc.intExt,
            description: sc.description, pages: sc.pages, location: sc.location,
            cast_list: castList, status: 'scheduled', is_pickup: false,
          }
        })
        updateDpr(dprId, 'scenes', items)
      }

      // ── Auto-pull cast ──
      const idsInUse = new Set()
      for (const sc of day.scenes ?? []) for (const id of sc.castMemberIds ?? []) idsInUse.add(id)
      if ((dprRow.castMembers?.length ?? 0) === 0 && idsInUse.size > 0) {
        const items = [...idsInUse].map(id => {
          const c = castMembers?.find(x => x.id === id) ?? null
          const source = {
            number: c?.castNumber ?? '', character: c?.role ?? '', cast: c?.name ?? '',
          }
          return {
            id: newId(), source_id: id, removed: false, source,
            number: source.number, character: source.character, cast: source.cast,
            status: '', pickup: '', arrive: '', call: '', ndb: '',
            hmu_costume: '', set_time: '', lunch_range: '',
            wrap: '', depart: '', drop_off: '', total_hours: '',
          }
        })
        updateDpr(dprId, 'castMembers', items)
      }

      // ── Auto-fill scalar fields from schedule ──
      if (!String(dprRow.unitCall ?? '').trim() && day.generalCall) {
        updateDpr(dprId, 'unitCall', day.generalCall)
      }
      if (!String(dprRow.unitBaseAddress ?? '').trim() && day.unitBase) {
        updateDpr(dprId, 'unitBaseAddress', day.unitBase)
      }
      if (!String(dprRow.lunchLocation ?? '').trim()) {
        const lunch = findLunchLocation(day.locations)
        if (lunch) updateDpr(dprId, 'lunchLocation', lunch)
      }

      // ── Catering auto-fill ──
      const dayCatering = cateringRecords.filter(r => r.dayId === selectedDayId)
      const cateringEst = dayCatering.length
      const cateringAct = dayCatering.filter(r => r.collected === true).length
      if ((!dprRow.cateringEstimated || dprRow.cateringEstimated === 0) && cateringEst > 0) {
        updateDpr(dprId, 'cateringEstimated', cateringEst)
      }
      if ((!dprRow.cateringActual || dprRow.cateringActual === 0) && cateringAct > 0) {
        updateDpr(dprId, 'cateringActual', cateringAct)
      }

      // ── Previous-values prefill (only on first observation for this DPR id) ──
      if (isFirstPrefill) {
        prefilledRef.current.add(dprId)
        const dayIdx = mainDays.findIndex(d => d.id === selectedDayId)
        const prior = dayIdx > 0
          ? dprs.find(d => d.shootDayId === mainDays[dayIdx - 1].id)
          : null
        if (
          prior &&
          (dprRow.setUpsPrevious ?? 0) === 0 &&
          (dprRow.soundPrevious ?? 0) === 0 &&
          (dprRow.videoPrevious ?? 0) === 0
        ) {
          updateDpr(dprId, 'setUpsPrevious', (Number(prior.setUpsToday) || 0) + (Number(prior.setUpsPrevious) || 0))
          updateDpr(dprId, 'soundPrevious', (Number(prior.soundToday) || 0) + (Number(prior.soundPrevious) || 0))
          updateDpr(dprId, 'videoPrevious', (Number(prior.videoToday) || 0) + (Number(prior.videoPrevious) || 0))
          if (prior.timingsToday) updateDpr(dprId, 'timingsPrevious', prior.timingsToday)

          const combineScriptMin = (prev, today) => {
            if (!prev && !today) return ''
            const hasColon = (String(prev).includes(':') || String(today).includes(':'))
            if (hasColon) {
              const sum = sumTimeStrings(prev, today)
              if (sum) return sum
            }
            const np = parseFloat(prev), nt = parseFloat(today)
            if (!isNaN(np) || !isNaN(nt)) return String((isNaN(np) ? 0 : np) + (isNaN(nt) ? 0 : nt))
            return today || prev || ''
          }
          const newScriptMinPrevEst = combineScriptMin(prior.scriptMinPrevEst, prior.scriptMinTodayEst)
          if (newScriptMinPrevEst) updateDpr(dprId, 'scriptMinPrevEst', newScriptMinPrevEst)
          const newScriptMinPrevAct = combineScriptMin(prior.scriptMinPrevAct, prior.scriptMinTodayAct)
          if (newScriptMinPrevAct) updateDpr(dprId, 'scriptMinPrevAct', newScriptMinPrevAct)

          const priorCam = prior.camInventory ?? {}
          const nextCam = { ...(dprRow.camInventory ?? {}) }
          for (const k of ['a', 'b', 't', 'c']) {
            const prev = Number(priorCam[`${k}_prev`]) || 0
            const today = Number(priorCam[`${k}_today`]) || 0
            if (prev + today > 0) nextCam[`${k}_prev`] = prev + today
          }
          if (Object.keys(nextCam).length) updateDpr(dprId, 'camInventory', nextCam)

          const priorSa = prior.saCountsCosts ?? {}
          const nextSa = { ...(dprRow.saCountsCosts ?? {}) }
          const prevCount = (Number(priorSa.prev_count) || 0) + (Number(priorSa.today_count) || 0)
          const prevCost = (Number(priorSa.prev_cost) || 0) + (Number(priorSa.today_cost) || 0)
          if (prevCount > 0) nextSa.prev_count = prevCount
          if (prevCost > 0) nextSa.prev_cost = prevCost
          if (prevCount > 0 || prevCost > 0) updateDpr(dprId, 'saCountsCosts', nextSa)
        }
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDayId, loading, dprs.length])

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!shootDays.length || !mainDays.length) {
    return (
      <div className="dpr-wrap">
        <div className="dpr-top">
          <div style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>Daily Production Report</div>
        </div>
        <div style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: 40, textAlign: 'center', color: '#6b7280',
        }}>
          No shoot days available. Add some on the Schedule page first.
        </div>
      </div>
    )
  }

  if (loading || !dpr || !selectedDay) {
    return (
      <div className="dpr-wrap">
        <div className="dpr-top">
          <DayPicker mainDays={mainDays} value={selectedDayId} onChange={setSelectedDayId} />
        </div>
        <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading…</div>
      </div>
    )
  }

  // ── Department lookups ───────────────────────────────────────────────────
  const directorHod  = hods.find(h => /director/i.test(h.department))
  const producerHods = hods.filter(h => /producer/i.test(h.department))

  // ── Cast lookup ──────────────────────────────────────────────────────────
  function castMemberById(id) {
    return castMembers?.find(c => c.id === id) ?? null
  }

  // ── Pull scenes from schedule ────────────────────────────────────────────
  function pullScenesFromSchedule() {
    const dayScenes = selectedDay.scenes ?? []
    const items = dayScenes.map(sc => {
      const castList = (sc.castMemberIds ?? [])
        .map(id => castMemberById(id))
        .filter(Boolean)
        .map(c => c.castNumber ?? c.name)
        .join(', ')
      return {
        id: newId(),
        source_id: sc.id,
        removed: false,
        source: {
          sceneNumber: sc.sceneNumber,
          dayNight: sc.dayNight,
          intExt: sc.intExt,
          description: sc.description,
          pages: sc.pages,
          location: sc.location,
          castList,
        },
        scene_number: sc.sceneNumber,
        day_night: sc.dayNight,
        int_ext: sc.intExt,
        description: sc.description,
        pages: sc.pages,
        location: sc.location,
        cast_list: castList,
        status: 'scheduled',
        is_pickup: false,
      }
    })
    updateDpr(dpr.id, 'scenes', items)
  }

  function pullCastFromSchedule() {
    const idsInUse = new Set()
    for (const sc of selectedDay.scenes ?? []) {
      for (const id of sc.castMemberIds ?? []) idsInUse.add(id)
    }
    const items = [...idsInUse].map(id => {
      const c = castMemberById(id)
      const source = {
        number: c?.castNumber ?? '',
        character: c?.role ?? '',
        cast: c?.name ?? '',
      }
      return {
        id: newId(),
        source_id: id,
        removed: false,
        source,
        number: source.number,
        character: source.character,
        cast: source.cast,
        status: '',
        pickup: '', arrive: '', call: '', ndb: '',
        hmu_costume: '', set_time: '', lunch_range: '',
        wrap: '', depart: '', drop_off: '', total_hours: '',
      }
    })
    updateDpr(dpr.id, 'castMembers', items)
  }

  // ── Array updaters ──────────────────────────────────────────────────────
  function updateArr(field, items) { updateDpr(dpr.id, field, items) }

  function updateRow(field, rowId, patch) {
    const arr = (dpr[field] ?? []).map(r => r.id === rowId ? { ...r, ...patch } : r)
    updateArr(field, arr)
  }

  function removeRow(field, rowId) {
    const arr = dpr[field] ?? []
    const row = arr.find(r => r.id === rowId)
    if (!row) return
    // If manually added (no source_id), delete entirely; else toggle removed
    if (!row.source_id) {
      updateArr(field, arr.filter(r => r.id !== rowId))
    } else {
      updateArr(field, arr.map(r => r.id === rowId ? { ...r, removed: !r.removed } : r))
    }
  }

  function addRow(field, template) {
    const arr = dpr[field] ?? []
    updateArr(field, [...arr, { id: newId(), source_id: null, removed: false, ...template }])
  }

  // ── Camera inventory updater ────────────────────────────────────────────
  function updateCam(key, value) {
    const next = { ...(dpr.camInventory ?? {}), [key]: value }
    updateDpr(dpr.id, 'camInventory', next)
  }

  // ── SA counts/costs updater ─────────────────────────────────────────────
  function updateSa(key, value) {
    const next = { ...(dpr.saCountsCosts ?? {}), [key]: value }
    updateDpr(dpr.id, 'saCountsCosts', next)
  }

  // ── Export PDF ──────────────────────────────────────────────────────────
  function handleExportPdf() {
    const html = renderDprHtml({ productionName, dpr, selectedDay, directorHod, producerHods })
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print() }, 500)
  }

  // ── Export Excel ────────────────────────────────────────────────────────
  async function handleExportExcel() {
    const XLSX = await import('xlsx-js-style')
    const wb = XLSX.utils.book_new()
    const data = []
    data.push([productionName || '', '', '', '', 'Date:', formatDate(selectedDay.date)])
    data.push(['', '', '', '', 'PR #:', selectedDay.dayNumber ?? '', 'of', dpr.prTotal ?? ''])
    data.push(['Unit:', dpr.unit, '', '', 'Country:', dpr.country])
    data.push([])
    data.push(['Timings'])
    data.push(['Breakfast', dpr.breakfast, 'Unit Call', dpr.unitCall, 'First Shot AM', dpr.firstShotAm])
    data.push(['Lunch Start', dpr.lunchStart, 'Lunch End', dpr.lunchEnd, 'First Shot After', dpr.firstShotAfter])
    data.push(['Est Wrap', dpr.estWrap, 'Actual Wrap', dpr.actualWrap, 'Total Hours', dpr.totalHours])
    data.push([
      'Split Day', dpr.splitDay ? 'Y' : 'N',
      'Night Work', dpr.nightWork ? 'Y' : 'N',
      '6th Day', dpr.sixthDay ? 'Y' : 'N',
      'Bank Holiday', dpr.bankHoliday ? 'Y' : 'N',
    ])
    data.push([])
    data.push(['Locations'])
    data.push(['Tech Base', dpr.techBaseAddress])
    data.push(['Unit Base', dpr.unitBaseAddress])
    data.push(['Lunch Location', dpr.lunchLocation])
    data.push([])
    data.push(['Scenes'])
    data.push(['Scene', 'D/N', 'INT/EXT', 'Set Description', 'Cast', 'Pages', 'Location', 'Status'])
    for (const s of (dpr.scenes ?? []).filter(s => !s.removed)) {
      data.push([s.scene_number, s.day_night, s.int_ext, s.description, s.cast_list, s.pages, s.location, s.status])
    }
    data.push([])
    data.push(['Scene Summary'])
    data.push(['Scheduled', dpr.scenesScheduled, 'Shot', dpr.scenesShot, 'Part Complete', dpr.partComplete])
    data.push(['Scheduled not shot', dpr.scheduledNotShot, 'Shot not scheduled', dpr.shotNotScheduled, 'Day Complete', dpr.dayComplete])
    if (dpr.sceneSummaryNotes) data.push(['Notes', dpr.sceneSummaryNotes])
    data.push([])
    data.push(['Cast'])
    data.push(['#', 'Character', 'Cast', 'Status', 'Pickup', 'Arrive', 'Call', 'NDB', 'H/M/U Cos', 'Set', 'Lunch', 'Wrap', 'Depart', 'Drop Off', 'Total'])
    for (const c of (dpr.castMembers ?? []).filter(c => !c.removed)) {
      data.push([c.number, c.character, c.cast, c.status, c.pickup, c.arrive, c.call, c.ndb, c.hmu_costume, c.set_time, c.lunch_range, c.wrap, c.depart, c.drop_off, c.total_hours])
    }
    data.push([])
    data.push(['Costume Fittings / Makeup Tests'])
    data.push(['#', 'Character', 'Cast', 'Status', 'Pickup', 'Arrive', 'Call', 'H/M/U Cos', 'Set', 'Lunch', 'Wrap', 'Depart', 'Drop Off', 'Total'])
    for (const f of (dpr.fittings ?? []).filter(f => !f.removed)) {
      data.push([f.number, f.character, f.cast, f.status, f.pickup, f.arrive, f.call, f.hmu_costume, f.set_time, f.lunch_range, f.wrap, f.depart, f.drop_off, f.total_hours])
    }
    data.push([])
    data.push(['Supporting Artists'])
    data.push(['#', 'Character', 'Agency/Direct'])
    for (const sa of (dpr.supportingArts ?? []).filter(s => !s.removed)) {
      data.push([sa.number, sa.character, sa.agency_direct])
    }
    const sa = dpr.saCountsCosts ?? {}
    data.push(['Prev Count', sa.prev_count ?? '', 'Today Count', sa.today_count ?? '', 'Prev Cost', sa.prev_cost ?? '', 'Today Cost', sa.today_cost ?? ''])
    data.push([])
    data.push(["Children's Hours"])
    data.push(['#', 'Character', 'Cast', 'Start', 'Wrap', 'Total'])
    for (const ch of (dpr.childrensHours ?? []).filter(c => !c.removed)) {
      data.push([ch.number, ch.character, ch.cast, ch.start, ch.wrap, ch.total_hours])
    }
    data.push([])
    data.push(['Script Stats'])
    data.push(['Set-ups Previous', dpr.setUpsPrevious, 'Set-ups Today', dpr.setUpsToday])
    const ci = dpr.camInventory ?? {}
    data.push(['Camera', 'Previous', 'Today', 'Rolls'])
    data.push(['A Cam', ci.a_prev ?? '', ci.a_today ?? '', ci.a_rolls ?? ''])
    data.push(['B Cam', ci.b_prev ?? '', ci.b_today ?? '', ci.b_rolls ?? ''])
    data.push(['T Cam', ci.t_prev ?? '', ci.t_today ?? '', ci.t_rolls ?? ''])
    data.push(['C Cam', ci.c_prev ?? '', ci.c_today ?? '', ci.c_rolls ?? ''])
    data.push(['Sound Prev', dpr.soundPrevious, 'Sound Today', dpr.soundToday, 'Card Numbers', dpr.soundCardNumbers])
    data.push(['Video Prev (TB)', dpr.videoPrevious, 'Video Today (TB)', dpr.videoToday])
    data.push(['Timings Prev', dpr.timingsPrevious, 'Timings Today', dpr.timingsToday])
    data.push(['Catering Est', dpr.cateringEstimated, 'Catering Actual', dpr.cateringActual])
    data.push(['Script Min Prev Est', dpr.scriptMinPrevEst, 'Script Min Prev Act', dpr.scriptMinPrevAct])
    data.push(['Script Min Today Est', dpr.scriptMinTodayEst, 'Script Min Today Act', dpr.scriptMinTodayAct])
    data.push([])
    if (dpr.additionalCrew)       data.push(['Additional Crew', dpr.additionalCrew])
    if (dpr.additionalEquipment)  data.push(['Additional Equipment', dpr.additionalEquipment])
    if (dpr.additionalFacilities) data.push(['Additional Facilities', dpr.additionalFacilities])
    if (dpr.otTocNotes)           data.push(['OT / TOC / Early Calls', dpr.otTocNotes])
    if (dpr.vfxSfxNotes)          data.push(['VFX / SFX / Specialists', dpr.vfxSfxNotes])
    if (dpr.hsMedicalNotes)       data.push(['H&S / Medical / Minors', dpr.hsMedicalNotes])
    if (dpr.notes)                data.push(['Notes', dpr.notes])

    const ws = XLSX.utils.aoa_to_sheet(data)
    XLSX.utils.book_append_sheet(wb, ws, 'DPR')
    const fname = `DPR - ${productionName || 'Production'} - Day ${selectedDay.dayNumber ?? ''}.xlsx`
    XLSX.writeFile(wb, fname)
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const statusOptions = [
    { value: '', label: '—' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'shot', label: 'Shot' },
    { value: 'part', label: 'Part Complete' },
    { value: 'not_shot', label: 'Not Shot' },
  ]

  return (
    <div className="dpr-wrap">
      <div className="dpr-top">
        <DayPicker mainDays={mainDays} value={selectedDayId} onChange={setSelectedDayId} />
        <div className="dpr-export-btns">
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={handleExportPdf}>↓ Export PDF</button>
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={handleExportExcel}>↓ Export Excel</button>
        </div>
      </div>

      {/* Header strip */}
      <div className="dpr-section">
        <div className="dpr-section-title">Header</div>
        <div className="dpr-grid dpr-grid-4">
          <div className="dpr-field">
            <span className="dpr-field-label">Production</span>
            <input value={productionName ?? ''} readOnly style={{ background: '#f9fafb' }} />
          </div>
          <div className="dpr-field">
            <span className="dpr-field-label">Date</span>
            <input value={formatDate(selectedDay.date)} readOnly style={{ background: '#f9fafb' }} />
          </div>
          <div className="dpr-field">
            <span className="dpr-field-label">Day #</span>
            <input value={selectedDay.dayNumber ?? ''} readOnly style={{ background: '#f9fafb' }} />
          </div>
          <PlainField
            label={`PR Total`}
            type="number"
            value={dpr.prTotal ?? ''}
            onCommit={v => updateDpr(dpr.id, 'prTotal', v === '' ? null : Number(v))}
          />
          <PlainField label="Unit" value={dpr.unit} onCommit={v => updateDpr(dpr.id, 'unit', v)} />
          <PlainField label="Country" value={dpr.country} onCommit={v => updateDpr(dpr.id, 'country', v)} />
          <div className="dpr-field">
            <span className="dpr-field-label">Director</span>
            <input value={directorHod?.name ?? ''} readOnly style={{ background: '#f9fafb' }} />
          </div>
          <div className="dpr-field">
            <span className="dpr-field-label">Producer(s)</span>
            <input value={producerHods.map(p => p.name).filter(Boolean).join(', ')} readOnly style={{ background: '#f9fafb' }} />
          </div>
        </div>
      </div>

      {/* Timings */}
      <div className="dpr-section">
        <div className="dpr-section-title">Timings</div>
        <div className="dpr-grid dpr-grid-4">
          <PlainField label="Breakfast" value={dpr.breakfast} onCommit={v => updateDpr(dpr.id, 'breakfast', v)} placeholder="HH:MM" />
          <FieldWithDiff
            label="Unit Call"
            value={dpr.unitCall}
            sourceValue={selectedDay.generalCall || null}
            onCommit={v => updateDpr(dpr.id, 'unitCall', v)}
            placeholder="HH:MM"
          />
          <PlainField label="First Shot AM" value={dpr.firstShotAm} onCommit={v => updateDpr(dpr.id, 'firstShotAm', v)} placeholder="HH:MM" />
          <PlainField label="Lunch Start" value={dpr.lunchStart} onCommit={v => updateDpr(dpr.id, 'lunchStart', v)} placeholder="HH:MM" />
          <PlainField label="Lunch End" value={dpr.lunchEnd} onCommit={v => updateDpr(dpr.id, 'lunchEnd', v)} placeholder="HH:MM" />
          <PlainField label="First Shot After" value={dpr.firstShotAfter} onCommit={v => updateDpr(dpr.id, 'firstShotAfter', v)} placeholder="HH:MM" />
          <PlainField label="Est Wrap" value={dpr.estWrap} onCommit={v => updateDpr(dpr.id, 'estWrap', v)} placeholder="HH:MM" />
          <PlainField label="Actual Wrap" value={dpr.actualWrap} onCommit={v => updateDpr(dpr.id, 'actualWrap', v)} placeholder="HH:MM" />
          <PlainField label="Total Hours" value={dpr.totalHours} onCommit={v => updateDpr(dpr.id, 'totalHours', v)} placeholder="HH:MM" />
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap' }}>
          <CheckField label="Split Day"    value={dpr.splitDay}    onCommit={v => updateDpr(dpr.id, 'splitDay', v)} />
          <CheckField label="Night Work"   value={dpr.nightWork}   onCommit={v => updateDpr(dpr.id, 'nightWork', v)} />
          <CheckField label="6th Day"      value={dpr.sixthDay}    onCommit={v => updateDpr(dpr.id, 'sixthDay', v)} />
          <CheckField label="Bank Holiday" value={dpr.bankHoliday} onCommit={v => updateDpr(dpr.id, 'bankHoliday', v)} />
        </div>
      </div>

      {/* Locations */}
      <div className="dpr-section">
        <div className="dpr-section-title">Locations</div>
        <div className="dpr-grid dpr-grid-3">
          <TextareaField label="Tech Base Address" value={dpr.techBaseAddress} onCommit={v => updateDpr(dpr.id, 'techBaseAddress', v)} />
          <div className="dpr-field">
            <span className="dpr-field-label">Unit Base Address</span>
            <textarea
              rows={3}
              value={dpr.unitBaseAddress}
              onChange={e => updateDpr(dpr.id, 'unitBaseAddress', e.target.value)}
            />
            {selectedDay.unitBase &&
              String(dpr.unitBaseAddress ?? '').trim() !== '' &&
              String(dpr.unitBaseAddress) !== String(selectedDay.unitBase) && (
                <span className="dpr-diff-warning" title={`Differs from schedule: "${selectedDay.unitBase}"`} style={{ top: 26 }}>⚠</span>
              )}
          </div>
          <TextareaField label="Lunch Location" value={dpr.lunchLocation} onCommit={v => updateDpr(dpr.id, 'lunchLocation', v)} />
        </div>
      </div>

      {/* Scenes */}
      <div className="dpr-section">
        <div className="dpr-section-title">Scenes</div>
        {(dpr.scenes ?? []).length === 0 && selectedDay.scenes?.length > 0 && (
          <button className="dpr-add-btn" onClick={pullScenesFromSchedule}>↻ Pull {selectedDay.scenes.length} scene(s) from schedule</button>
        )}
        <table className="dpr-table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>Scene</th>
              <th style={{ width: 50 }}>D/N</th>
              <th style={{ width: 70 }}>INT/EXT</th>
              <th>Set Description</th>
              <th style={{ width: 140 }}>Cast</th>
              <th style={{ width: 60 }}>Pages</th>
              <th style={{ width: 160 }}>Location</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {(dpr.scenes ?? []).map(s => {
              const diffs = sceneDiffs(s)
              return (
                <tr key={s.id} className={s.removed ? 'dpr-row--removed' : ''}>
                  <td><CellInput value={s.scene_number} onCommit={v => updateRow('scenes', s.id, { scene_number: v })} /></td>
                  <td><CellInput value={s.day_night} onCommit={v => updateRow('scenes', s.id, { day_night: v })} /></td>
                  <td><CellInput value={s.int_ext} onCommit={v => updateRow('scenes', s.id, { int_ext: v })} /></td>
                  <td><CellInput value={s.description} onCommit={v => updateRow('scenes', s.id, { description: v })} /></td>
                  <td><CellInput value={s.cast_list} onCommit={v => updateRow('scenes', s.id, { cast_list: v })} /></td>
                  <td><CellInput value={s.pages} onCommit={v => updateRow('scenes', s.id, { pages: v })} /></td>
                  <td><CellInput value={s.location} onCommit={v => updateRow('scenes', s.id, { location: v })} /></td>
                  <td>
                    <CellSelect
                      value={s.status}
                      options={statusOptions}
                      onCommit={v => updateRow('scenes', s.id, { status: v })}
                    />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!s.source_id && <span className="dpr-badge dpr-badge--added">ADDED</span>}
                    {s.removed && <span className="dpr-badge dpr-badge--removed">REMOVED</span>}
                    {!s.removed && diffs.length > 0 && (
                      <span className="dpr-badge dpr-badge--diff" title={`Differs: ${diffs.join(', ')}`}>⚠</span>
                    )}
                    <button className="dpr-remove-btn" onClick={() => removeRow('scenes', s.id)} title={s.removed ? 'Restore' : 'Remove'}>
                      {s.removed ? '↺' : '✕'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <button
          className="dpr-add-btn"
          onClick={() => addRow('scenes', {
            scene_number: '', day_night: '', int_ext: '', description: '',
            cast_list: '', pages: '', location: '', status: '', is_pickup: false,
            source: null,
          })}
        >+ Add Scene</button>
      </div>

      {/* Scene Summary */}
      <div className="dpr-section">
        <div className="dpr-section-title">Scene Summary</div>
        <div className="dpr-grid dpr-grid-3">
          <PlainField label="Scenes Scheduled"     value={dpr.scenesScheduled}    onCommit={v => updateDpr(dpr.id, 'scenesScheduled', v)} />
          <PlainField label="Scenes Shot"          value={dpr.scenesShot}         onCommit={v => updateDpr(dpr.id, 'scenesShot', v)} />
          <PlainField label="Part Complete"        value={dpr.partComplete}       onCommit={v => updateDpr(dpr.id, 'partComplete', v)} />
          <PlainField label="Scheduled Not Shot"   value={dpr.scheduledNotShot}   onCommit={v => updateDpr(dpr.id, 'scheduledNotShot', v)} />
          <PlainField label="Shot Not Scheduled"   value={dpr.shotNotScheduled}   onCommit={v => updateDpr(dpr.id, 'shotNotScheduled', v)} />
          <PlainField label="Day Complete (Y/N)"   value={dpr.dayComplete}        onCommit={v => updateDpr(dpr.id, 'dayComplete', v)} />
        </div>
        <div style={{ marginTop: 12 }}>
          <TextareaField label="Notes" value={dpr.sceneSummaryNotes} onCommit={v => updateDpr(dpr.id, 'sceneSummaryNotes', v)} />
        </div>
      </div>

      {/* Script Stats */}
      <div className="dpr-section">
        <div className="dpr-section-title">Script Stats</div>
        <div className="dpr-grid dpr-grid-4">
          <PlainField label="Set-ups Previous" type="number" value={dpr.setUpsPrevious} onCommit={v => updateDpr(dpr.id, 'setUpsPrevious', Number(v) || 0)} />
          <PlainField label="Set-ups Today"    type="number" value={dpr.setUpsToday}    onCommit={v => updateDpr(dpr.id, 'setUpsToday', Number(v) || 0)} />
          <PlainField label="Sound Previous"   type="number" value={dpr.soundPrevious}  onCommit={v => updateDpr(dpr.id, 'soundPrevious', Number(v) || 0)} />
          <PlainField label="Sound Today"      type="number" value={dpr.soundToday}     onCommit={v => updateDpr(dpr.id, 'soundToday', Number(v) || 0)} />
          <PlainField label="Sound Card Numbers" value={dpr.soundCardNumbers} onCommit={v => updateDpr(dpr.id, 'soundCardNumbers', v)} />
          <PlainField label="Video Prev (TB)"  type="number" value={dpr.videoPrevious}  onCommit={v => updateDpr(dpr.id, 'videoPrevious', Number(v) || 0)} />
          <PlainField label="Video Today (TB)" type="number" value={dpr.videoToday}     onCommit={v => updateDpr(dpr.id, 'videoToday', Number(v) || 0)} />
          <PlainField label="Catering Estimated" type="number" value={dpr.cateringEstimated} onCommit={v => updateDpr(dpr.id, 'cateringEstimated', Number(v) || 0)} />
          <PlainField label="Catering Actual"    type="number" value={dpr.cateringActual}    onCommit={v => updateDpr(dpr.id, 'cateringActual', Number(v) || 0)} />
          <PlainField label="Timings Previous" value={dpr.timingsPrevious} onCommit={v => updateDpr(dpr.id, 'timingsPrevious', v)} />
          <PlainField label="Timings Today"    value={dpr.timingsToday}    onCommit={v => updateDpr(dpr.id, 'timingsToday', v)} />
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="dpr-field-label" style={{ marginBottom: 6 }}>Camera Inventory</div>
          <table className="dpr-table">
            <thead>
              <tr><th>Camera</th><th>Previous</th><th>Today</th><th>Rolls</th></tr>
            </thead>
            <tbody>
              {[['a','A Cam'],['b','B Cam'],['t','T Cam'],['c','C Cam']].map(([k, lbl]) => (
                <tr key={k}>
                  <td>{lbl}</td>
                  <td><CellInput type="number" value={dpr.camInventory?.[`${k}_prev`] ?? ''} onCommit={v => updateCam(`${k}_prev`, v === '' ? '' : Number(v))} /></td>
                  <td><CellInput type="number" value={dpr.camInventory?.[`${k}_today`] ?? ''} onCommit={v => updateCam(`${k}_today`, v === '' ? '' : Number(v))} /></td>
                  <td><CellInput value={dpr.camInventory?.[`${k}_rolls`] ?? ''} onCommit={v => updateCam(`${k}_rolls`, v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="dpr-grid dpr-grid-4" style={{ marginTop: 16 }}>
          <PlainField label="Script Min Prev Est"  value={dpr.scriptMinPrevEst}  onCommit={v => updateDpr(dpr.id, 'scriptMinPrevEst', v)} />
          <PlainField label="Script Min Prev Act"  value={dpr.scriptMinPrevAct}  onCommit={v => updateDpr(dpr.id, 'scriptMinPrevAct', v)} />
          <PlainField label="Script Min Today Est" value={dpr.scriptMinTodayEst} onCommit={v => updateDpr(dpr.id, 'scriptMinTodayEst', v)} />
          <PlainField label="Script Min Today Act" value={dpr.scriptMinTodayAct} onCommit={v => updateDpr(dpr.id, 'scriptMinTodayAct', v)} />
        </div>
      </div>

      {/* Cast */}
      <div className="dpr-section">
        <div className="dpr-section-title">Cast Weekly & Day Players</div>
        {(dpr.castMembers ?? []).length === 0 && (selectedDay.scenes?.some(s => (s.castMemberIds ?? []).length > 0)) && (
          <button className="dpr-add-btn" onClick={pullCastFromSchedule}>↻ Pull cast from schedule</button>
        )}
        <table className="dpr-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Character</th>
              <th>Cast</th>
              <th style={{ width: 80 }}>Status</th>
              <th>Pickup</th><th>Arrive</th><th>Call</th><th>NDB</th>
              <th>H/M/U Cos</th><th>Set</th><th>Lunch</th><th>Wrap</th>
              <th>Depart</th><th>Drop Off</th><th>Total</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {(dpr.castMembers ?? []).map(c => {
              const diffs = castDiffs(c)
              return (
                <tr key={c.id} className={c.removed ? 'dpr-row--removed' : ''}>
                  <td><CellInput value={c.number} onCommit={v => updateRow('castMembers', c.id, { number: v })} /></td>
                  <td><CellInput value={c.character} onCommit={v => updateRow('castMembers', c.id, { character: v })} /></td>
                  <td><CellInput value={c.cast} onCommit={v => updateRow('castMembers', c.id, { cast: v })} /></td>
                  <td><CellInput value={c.status} onCommit={v => updateRow('castMembers', c.id, { status: v })} /></td>
                  <td><CellInput value={c.pickup} onCommit={v => updateRow('castMembers', c.id, { pickup: v })} /></td>
                  <td><CellInput value={c.arrive} onCommit={v => updateRow('castMembers', c.id, { arrive: v })} /></td>
                  <td><CellInput value={c.call} onCommit={v => updateRow('castMembers', c.id, { call: v })} /></td>
                  <td><CellInput value={c.ndb} onCommit={v => updateRow('castMembers', c.id, { ndb: v })} /></td>
                  <td><CellInput value={c.hmu_costume} onCommit={v => updateRow('castMembers', c.id, { hmu_costume: v })} /></td>
                  <td><CellInput value={c.set_time} onCommit={v => updateRow('castMembers', c.id, { set_time: v })} /></td>
                  <td><CellInput value={c.lunch_range} onCommit={v => updateRow('castMembers', c.id, { lunch_range: v })} /></td>
                  <td><CellInput value={c.wrap} onCommit={v => updateRow('castMembers', c.id, { wrap: v })} /></td>
                  <td><CellInput value={c.depart} onCommit={v => updateRow('castMembers', c.id, { depart: v })} /></td>
                  <td><CellInput value={c.drop_off} onCommit={v => updateRow('castMembers', c.id, { drop_off: v })} /></td>
                  <td><CellInput value={c.total_hours} onCommit={v => updateRow('castMembers', c.id, { total_hours: v })} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!c.source_id && <span className="dpr-badge dpr-badge--added">ADDED</span>}
                    {c.removed && <span className="dpr-badge dpr-badge--removed">REMOVED</span>}
                    {!c.removed && diffs.length > 0 && (
                      <span className="dpr-badge dpr-badge--diff" title={`Differs: ${diffs.join(', ')}`}>⚠</span>
                    )}
                    <button className="dpr-remove-btn" onClick={() => removeRow('castMembers', c.id)}>{c.removed ? '↺' : '✕'}</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <button
          className="dpr-add-btn"
          onClick={() => addRow('castMembers', {
            number: '', character: '', cast: '', status: '',
            pickup: '', arrive: '', call: '', ndb: '',
            hmu_costume: '', set_time: '', lunch_range: '',
            wrap: '', depart: '', drop_off: '', total_hours: '',
            source: null,
          })}
        >+ Add Cast</button>
      </div>

      {/* Costume Fittings */}
      <div className="dpr-section">
        <div className="dpr-section-title">Costume Fittings / Makeup Tests</div>
        <table className="dpr-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Character</th><th>Cast</th><th style={{ width: 80 }}>Status</th>
              <th>Pickup</th><th>Arrive</th><th>Call</th>
              <th>H/M/U Cos</th><th>Set</th><th>Lunch</th><th>Wrap</th>
              <th>Depart</th><th>Drop Off</th><th>Total</th>
              <th style={{ width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {(dpr.fittings ?? []).map(f => (
              <tr key={f.id} className={f.removed ? 'dpr-row--removed' : ''}>
                <td><CellInput value={f.number} onCommit={v => updateRow('fittings', f.id, { number: v })} /></td>
                <td><CellInput value={f.character} onCommit={v => updateRow('fittings', f.id, { character: v })} /></td>
                <td><CellInput value={f.cast} onCommit={v => updateRow('fittings', f.id, { cast: v })} /></td>
                <td><CellInput value={f.status} onCommit={v => updateRow('fittings', f.id, { status: v })} /></td>
                <td><CellInput value={f.pickup} onCommit={v => updateRow('fittings', f.id, { pickup: v })} /></td>
                <td><CellInput value={f.arrive} onCommit={v => updateRow('fittings', f.id, { arrive: v })} /></td>
                <td><CellInput value={f.call} onCommit={v => updateRow('fittings', f.id, { call: v })} /></td>
                <td><CellInput value={f.hmu_costume} onCommit={v => updateRow('fittings', f.id, { hmu_costume: v })} /></td>
                <td><CellInput value={f.set_time} onCommit={v => updateRow('fittings', f.id, { set_time: v })} /></td>
                <td><CellInput value={f.lunch_range} onCommit={v => updateRow('fittings', f.id, { lunch_range: v })} /></td>
                <td><CellInput value={f.wrap} onCommit={v => updateRow('fittings', f.id, { wrap: v })} /></td>
                <td><CellInput value={f.depart} onCommit={v => updateRow('fittings', f.id, { depart: v })} /></td>
                <td><CellInput value={f.drop_off} onCommit={v => updateRow('fittings', f.id, { drop_off: v })} /></td>
                <td><CellInput value={f.total_hours} onCommit={v => updateRow('fittings', f.id, { total_hours: v })} /></td>
                <td><button className="dpr-remove-btn" onClick={() => removeRow('fittings', f.id)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="dpr-add-btn"
          onClick={() => addRow('fittings', {
            number: '', character: '', cast: '', status: '',
            pickup: '', arrive: '', call: '',
            hmu_costume: '', set_time: '', lunch_range: '',
            wrap: '', depart: '', drop_off: '', total_hours: '',
          })}
        >+ Add Fitting</button>
      </div>

      {/* Supporting Artists */}
      <div className="dpr-section">
        <div className="dpr-section-title">Supporting Artists</div>
        <table className="dpr-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th>Character / Description</th>
              <th style={{ width: 140 }}>Agency / Direct</th>
              <th style={{ width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {(dpr.supportingArts ?? []).map(sa => (
              <tr key={sa.id} className={sa.removed ? 'dpr-row--removed' : ''}>
                <td><CellInput value={sa.number} onCommit={v => updateRow('supportingArts', sa.id, { number: v })} /></td>
                <td><CellInput value={sa.character} onCommit={v => updateRow('supportingArts', sa.id, { character: v })} /></td>
                <td><CellInput value={sa.agency_direct} onCommit={v => updateRow('supportingArts', sa.id, { agency_direct: v })} /></td>
                <td><button className="dpr-remove-btn" onClick={() => removeRow('supportingArts', sa.id)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="dpr-add-btn"
          onClick={() => addRow('supportingArts', { number: '', character: '', agency_direct: '' })}
        >+ Add SA</button>
        <div className="dpr-grid dpr-grid-4" style={{ marginTop: 12 }}>
          <PlainField label="Prev Count"  type="number" value={dpr.saCountsCosts?.prev_count ?? ''}  onCommit={v => updateSa('prev_count', v === '' ? '' : Number(v))} />
          <PlainField label="Today Count" type="number" value={dpr.saCountsCosts?.today_count ?? ''} onCommit={v => updateSa('today_count', v === '' ? '' : Number(v))} />
          <PlainField label="Prev Cost"   type="number" value={dpr.saCountsCosts?.prev_cost ?? ''}   onCommit={v => updateSa('prev_cost', v === '' ? '' : Number(v))} />
          <PlainField label="Today Cost"  type="number" value={dpr.saCountsCosts?.today_cost ?? ''}  onCommit={v => updateSa('today_cost', v === '' ? '' : Number(v))} />
        </div>
      </div>

      {/* Children's Hours */}
      <div className="dpr-section">
        <div className="dpr-section-title">Children's Hours</div>
        <table className="dpr-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th>Character</th><th>Cast</th>
              <th>Start</th><th>Wrap</th><th>Total</th>
              <th style={{ width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {(dpr.childrensHours ?? []).map(ch => (
              <tr key={ch.id} className={ch.removed ? 'dpr-row--removed' : ''}>
                <td><CellInput value={ch.number} onCommit={v => updateRow('childrensHours', ch.id, { number: v })} /></td>
                <td><CellInput value={ch.character} onCommit={v => updateRow('childrensHours', ch.id, { character: v })} /></td>
                <td><CellInput value={ch.cast} onCommit={v => updateRow('childrensHours', ch.id, { cast: v })} /></td>
                <td><CellInput value={ch.start} onCommit={v => updateRow('childrensHours', ch.id, { start: v })} /></td>
                <td><CellInput value={ch.wrap} onCommit={v => updateRow('childrensHours', ch.id, { wrap: v })} /></td>
                <td><CellInput value={ch.total_hours} onCommit={v => updateRow('childrensHours', ch.id, { total_hours: v })} /></td>
                <td><button className="dpr-remove-btn" onClick={() => removeRow('childrensHours', ch.id)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="dpr-add-btn"
          onClick={() => addRow('childrensHours', { number: '', character: '', cast: '', start: '', wrap: '', total_hours: '' })}
        >+ Add Child</button>
        <div style={{ marginTop: 12 }}>
          <TextareaField label="Tutor Notes" value={dpr.notes && dpr.notes.startsWith('TUTOR:') ? dpr.notes.slice(6).trim() : ''} onCommit={() => {}} placeholder="(use Notes section below)" />
        </div>
      </div>

      {/* Booked from Gantt */}
      {(() => {
        const dayBookings = bookings.filter(b => b.date === selectedDay.date && b.status !== 'cancelled')
        const bookedResourceIds = new Set(dayBookings.map(b => b.resourceId))
        const bookedResources = resources.filter(r => bookedResourceIds.has(r.id))
        const bookedCrew = bookedResources.filter(r => r.type === 'crew')
        const bookedEquipment = bookedResources.filter(r => r.type === 'equipment')
        return (
          <div className="dpr-section">
            <div className="dpr-section-title">Booked from Gantt</div>
            <div className="dpr-grid dpr-grid-2">
              <div>
                <div className="dpr-field-label" style={{ marginBottom: 6 }}>Additional Crew</div>
                {bookedCrew.length === 0 ? (
                  <div style={{ color: '#9ca3af', fontSize: 12 }}>No additional crew booked from the Gantt for this day.</div>
                ) : (
                  <table className="dpr-table">
                    <thead>
                      <tr><th>Name</th><th>Role</th><th>Department</th><th>Phone</th></tr>
                    </thead>
                    <tbody>
                      {bookedCrew.map(r => (
                        <tr key={r.id}>
                          <td>{r.name}</td>
                          <td>{r.role}</td>
                          <td>{r.department}</td>
                          <td>{r.contactPhone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <div className="dpr-field-label" style={{ marginBottom: 6 }}>Additional Equipment</div>
                {bookedEquipment.length === 0 ? (
                  <div style={{ color: '#9ca3af', fontSize: 12 }}>No additional equipment booked from the Gantt for this day.</div>
                ) : (
                  <table className="dpr-table">
                    <thead>
                      <tr><th>Name</th><th>Category/Department</th><th>Notes</th></tr>
                    </thead>
                    <tbody>
                      {bookedEquipment.map(r => (
                        <tr key={r.id}>
                          <td>{r.name}</td>
                          <td>{r.category || r.department}</td>
                          <td>{r.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Additional crew / equipment / facilities */}
      <div className="dpr-section">
        <div className="dpr-section-title">Additional Crew / Equipment / Facilities</div>
        <div className="dpr-grid dpr-grid-3">
          <TextareaField label="Additional Crew"        value={dpr.additionalCrew}       onCommit={v => updateDpr(dpr.id, 'additionalCrew', v)} rows={5} />
          <TextareaField label="Additional Equipment"   value={dpr.additionalEquipment}  onCommit={v => updateDpr(dpr.id, 'additionalEquipment', v)} rows={5} />
          <TextareaField label="Additional Facilities"  value={dpr.additionalFacilities} onCommit={v => updateDpr(dpr.id, 'additionalFacilities', v)} rows={5} />
        </div>
      </div>

      {/* OT / TOC / Early Calls */}
      <div className="dpr-section">
        <div className="dpr-section-title">OT / TOC / Early Calls</div>
        <TextareaField value={dpr.otTocNotes} onCommit={v => updateDpr(dpr.id, 'otTocNotes', v)} rows={4} />
      </div>

      {/* VFX / SFX */}
      <div className="dpr-section">
        <div className="dpr-section-title">VFX / SFX / Specialists</div>
        <TextareaField value={dpr.vfxSfxNotes} onCommit={v => updateDpr(dpr.id, 'vfxSfxNotes', v)} rows={4} />
      </div>

      {/* H&S */}
      <div className="dpr-section">
        <div className="dpr-section-title">H&S / Medical / Minors / Insurance / Set Visitors</div>
        <TextareaField value={dpr.hsMedicalNotes} onCommit={v => updateDpr(dpr.id, 'hsMedicalNotes', v)} rows={4} />
      </div>

      {/* Notes */}
      <div className="dpr-section">
        <div className="dpr-section-title">Notes</div>
        <TextareaField value={dpr.notes} onCommit={v => updateDpr(dpr.id, 'notes', v)} rows={4} />
      </div>
    </div>
  )
}

// ─── Day picker ───────────────────────────────────────────────────────────────

function DayPicker({ mainDays, value, onChange }) {
  const idx = mainDays.findIndex(d => d.id === value)
  const goPrev  = () => { if (idx > 0) onChange(mainDays[idx - 1].id) }
  const goNext  = () => { if (idx >= 0 && idx < mainDays.length - 1) onChange(mainDays[idx + 1].id) }
  const goToday = () => {
    const today = todayISO()
    const todayDay = mainDays.find(d => d.date === today)
    if (todayDay) { onChange(todayDay.id); return }
    const past = [...mainDays].filter(d => d.date && d.date <= today).sort((a, b) => b.date.localeCompare(a.date))[0]
    if (past) onChange(past.id)
    else if (mainDays.length) onChange(mainDays[0].id)
  }
  return (
    <div className="dpr-day-picker" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Shoot Day</span>
      <button
        className="pm-btn pm-btn--ghost pm-btn--sm"
        onClick={goPrev}
        disabled={idx <= 0}
        title="Previous day"
      >◀</button>
      <select
        className="dpr-day-select"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      >
        {mainDays.map(d => (
          <option key={d.id} value={d.id}>
            Day {d.dayNumber ?? '—'} · {shortDate(d.date)}{d.location ? ` · ${d.location}` : ''}
          </option>
        ))}
      </select>
      <button
        className="pm-btn pm-btn--ghost pm-btn--sm"
        onClick={goNext}
        disabled={idx < 0 || idx >= mainDays.length - 1}
        title="Next day"
      >▶</button>
      <button
        className="pm-btn pm-btn--ghost pm-btn--sm"
        onClick={goToday}
        title="Jump to today"
      >Today</button>
    </div>
  )
}

// ─── Diff helpers ─────────────────────────────────────────────────────────────

function sceneDiffs(s) {
  if (!s.source) return []
  const out = []
  const cmp = (a, b) => String(a ?? '') !== String(b ?? '')
  if (cmp(s.scene_number, s.source.sceneNumber)) out.push('scene #')
  if (cmp(s.day_night, s.source.dayNight)) out.push('D/N')
  if (cmp(s.int_ext, s.source.intExt)) out.push('INT/EXT')
  if (cmp(s.description, s.source.description)) out.push('description')
  if (cmp(s.pages, s.source.pages)) out.push('pages')
  if (cmp(s.location, s.source.location)) out.push('location')
  if (cmp(s.cast_list, s.source.castList)) out.push('cast')
  return out
}

function castDiffs(c) {
  if (!c.source) return []
  const out = []
  const cmp = (a, b) => String(a ?? '') !== String(b ?? '')
  if (cmp(c.number, c.source.number)) out.push('#')
  if (cmp(c.character, c.source.character)) out.push('character')
  if (cmp(c.cast, c.source.cast)) out.push('cast')
  return out
}

// ─── PDF (print-window) renderer ──────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderDprHtml({ productionName, dpr, selectedDay, directorHod, producerHods }) {
  const scenes = (dpr.scenes ?? []).filter(s => !s.removed)
  const cast   = (dpr.castMembers ?? []).filter(c => !c.removed)
  const fits   = (dpr.fittings ?? []).filter(f => !f.removed)
  const sas    = (dpr.supportingArts ?? []).filter(s => !s.removed)
  const kids   = (dpr.childrensHours ?? []).filter(c => !c.removed)

  const sceneRows = scenes.map(s => `
    <tr>
      <td>${esc(s.scene_number)}</td><td>${esc(s.day_night)}</td><td>${esc(s.int_ext)}</td>
      <td>${esc(s.description)}</td><td>${esc(s.cast_list)}</td>
      <td>${esc(s.pages)}</td><td>${esc(s.location)}</td><td>${esc(s.status)}</td>
    </tr>`).join('')

  const castRows = cast.map(c => `
    <tr>
      <td>${esc(c.number)}</td><td>${esc(c.character)}</td><td>${esc(c.cast)}</td>
      <td>${esc(c.status)}</td><td>${esc(c.pickup)}</td><td>${esc(c.arrive)}</td>
      <td>${esc(c.call)}</td><td>${esc(c.ndb)}</td><td>${esc(c.hmu_costume)}</td>
      <td>${esc(c.set_time)}</td><td>${esc(c.lunch_range)}</td><td>${esc(c.wrap)}</td>
      <td>${esc(c.depart)}</td><td>${esc(c.drop_off)}</td><td>${esc(c.total_hours)}</td>
    </tr>`).join('')

  const fitRows = fits.map(f => `
    <tr>
      <td>${esc(f.number)}</td><td>${esc(f.character)}</td><td>${esc(f.cast)}</td>
      <td>${esc(f.status)}</td><td>${esc(f.pickup)}</td><td>${esc(f.arrive)}</td>
      <td>${esc(f.call)}</td><td>${esc(f.hmu_costume)}</td>
      <td>${esc(f.set_time)}</td><td>${esc(f.lunch_range)}</td><td>${esc(f.wrap)}</td>
      <td>${esc(f.depart)}</td><td>${esc(f.drop_off)}</td><td>${esc(f.total_hours)}</td>
    </tr>`).join('')

  const saRows = sas.map(s => `
    <tr><td>${esc(s.number)}</td><td>${esc(s.character)}</td><td>${esc(s.agency_direct)}</td></tr>
  `).join('')

  const kidRows = kids.map(k => `
    <tr>
      <td>${esc(k.number)}</td><td>${esc(k.character)}</td><td>${esc(k.cast)}</td>
      <td>${esc(k.start)}</td><td>${esc(k.wrap)}</td><td>${esc(k.total_hours)}</td>
    </tr>
  `).join('')

  const ci = dpr.camInventory ?? {}
  const sa = dpr.saCountsCosts ?? {}

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<title>DPR — ${esc(productionName)} — Day ${esc(selectedDay.dayNumber)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #111; padding: 24px; font-size: 11px; }
  h1 { font-size: 18px; }
  .header { display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
  .header .meta { text-align: right; font-size: 11px; color: #444; }
  .sec { margin-top: 16px; }
  .sec-title { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 6px; }
  .grid { display: grid; gap: 4px 12px; }
  .grid-4 { grid-template-columns: repeat(4, 1fr); }
  .grid-3 { grid-template-columns: repeat(3, 1fr); }
  .lbl { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 0.06em; }
  .val { font-size: 11px; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { padding: 3px 5px; border-bottom: 1px solid #eee; font-size: 10px; vertical-align: top; text-align: left; }
  th { background: #f5f5f5; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #666; }
  .checks { display: flex; gap: 14px; margin-top: 6px; font-size: 10px; color: #444; }
  @media print { @page { margin: 12mm; size: A4 landscape; } body { padding: 0; } }
</style></head>
<body>
  <div class="header">
    <div>
      <h1>${esc(productionName)}</h1>
      <div style="font-size: 11px; color: #444; margin-top: 4px;">Daily Production Report · ${esc(dpr.unit || 'Main Unit')}</div>
    </div>
    <div class="meta">
      <div><strong>${esc(formatDate(selectedDay.date))}</strong></div>
      <div>PR #${esc(selectedDay.dayNumber)}${dpr.prTotal ? ` of ${esc(dpr.prTotal)}` : ''}</div>
      ${directorHod ? `<div>Director: ${esc(directorHod.name)}</div>` : ''}
      ${producerHods.length ? `<div>Producer: ${esc(producerHods.map(p => p.name).join(', '))}</div>` : ''}
    </div>
  </div>

  <div class="sec">
    <div class="sec-title">Timings</div>
    <div class="grid grid-4">
      <div><div class="lbl">Breakfast</div><div class="val">${esc(dpr.breakfast)}</div></div>
      <div><div class="lbl">Unit Call</div><div class="val">${esc(dpr.unitCall)}</div></div>
      <div><div class="lbl">First Shot AM</div><div class="val">${esc(dpr.firstShotAm)}</div></div>
      <div><div class="lbl">Lunch</div><div class="val">${esc(dpr.lunchStart)} – ${esc(dpr.lunchEnd)}</div></div>
      <div><div class="lbl">First Shot After</div><div class="val">${esc(dpr.firstShotAfter)}</div></div>
      <div><div class="lbl">Est Wrap</div><div class="val">${esc(dpr.estWrap)}</div></div>
      <div><div class="lbl">Actual Wrap</div><div class="val">${esc(dpr.actualWrap)}</div></div>
      <div><div class="lbl">Total Hours</div><div class="val">${esc(dpr.totalHours)}</div></div>
    </div>
    <div class="checks">
      <span>${dpr.splitDay ? '☑' : '☐'} Split Day</span>
      <span>${dpr.nightWork ? '☑' : '☐'} Night Work</span>
      <span>${dpr.sixthDay ? '☑' : '☐'} 6th Day</span>
      <span>${dpr.bankHoliday ? '☑' : '☐'} Bank Holiday</span>
    </div>
  </div>

  <div class="sec">
    <div class="sec-title">Locations</div>
    <div class="grid grid-3">
      <div><div class="lbl">Tech Base</div><div class="val">${esc(dpr.techBaseAddress)}</div></div>
      <div><div class="lbl">Unit Base</div><div class="val">${esc(dpr.unitBaseAddress)}</div></div>
      <div><div class="lbl">Lunch</div><div class="val">${esc(dpr.lunchLocation)}</div></div>
    </div>
  </div>

  ${scenes.length ? `
  <div class="sec">
    <div class="sec-title">Scenes</div>
    <table>
      <thead><tr><th>Scene</th><th>D/N</th><th>INT/EXT</th><th>Description</th><th>Cast</th><th>Pages</th><th>Location</th><th>Status</th></tr></thead>
      <tbody>${sceneRows}</tbody>
    </table>
  </div>` : ''}

  <div class="sec">
    <div class="sec-title">Scene Summary</div>
    <div class="grid grid-3">
      <div><div class="lbl">Scheduled</div><div class="val">${esc(dpr.scenesScheduled)}</div></div>
      <div><div class="lbl">Shot</div><div class="val">${esc(dpr.scenesShot)}</div></div>
      <div><div class="lbl">Part Complete</div><div class="val">${esc(dpr.partComplete)}</div></div>
      <div><div class="lbl">Scheduled Not Shot</div><div class="val">${esc(dpr.scheduledNotShot)}</div></div>
      <div><div class="lbl">Shot Not Scheduled</div><div class="val">${esc(dpr.shotNotScheduled)}</div></div>
      <div><div class="lbl">Day Complete</div><div class="val">${esc(dpr.dayComplete)}</div></div>
    </div>
    ${dpr.sceneSummaryNotes ? `<div style="margin-top:6px;font-size:10px;color:#444;">${esc(dpr.sceneSummaryNotes)}</div>` : ''}
  </div>

  <div class="sec">
    <div class="sec-title">Script Stats</div>
    <div class="grid grid-4">
      <div><div class="lbl">Set-ups Prev</div><div class="val">${esc(dpr.setUpsPrevious)}</div></div>
      <div><div class="lbl">Set-ups Today</div><div class="val">${esc(dpr.setUpsToday)}</div></div>
      <div><div class="lbl">Sound Prev</div><div class="val">${esc(dpr.soundPrevious)}</div></div>
      <div><div class="lbl">Sound Today</div><div class="val">${esc(dpr.soundToday)}</div></div>
      <div><div class="lbl">Video Prev (TB)</div><div class="val">${esc(dpr.videoPrevious)}</div></div>
      <div><div class="lbl">Video Today (TB)</div><div class="val">${esc(dpr.videoToday)}</div></div>
      <div><div class="lbl">Catering Est</div><div class="val">${esc(dpr.cateringEstimated)}</div></div>
      <div><div class="lbl">Catering Actual</div><div class="val">${esc(dpr.cateringActual)}</div></div>
    </div>
    <table style="margin-top:8px;">
      <thead><tr><th>Camera</th><th>Previous</th><th>Today</th><th>Rolls</th></tr></thead>
      <tbody>
        <tr><td>A</td><td>${esc(ci.a_prev)}</td><td>${esc(ci.a_today)}</td><td>${esc(ci.a_rolls)}</td></tr>
        <tr><td>B</td><td>${esc(ci.b_prev)}</td><td>${esc(ci.b_today)}</td><td>${esc(ci.b_rolls)}</td></tr>
        <tr><td>T</td><td>${esc(ci.t_prev)}</td><td>${esc(ci.t_today)}</td><td>${esc(ci.t_rolls)}</td></tr>
        <tr><td>C</td><td>${esc(ci.c_prev)}</td><td>${esc(ci.c_today)}</td><td>${esc(ci.c_rolls)}</td></tr>
      </tbody>
    </table>
  </div>

  ${cast.length ? `
  <div class="sec">
    <div class="sec-title">Cast Weekly & Day Players</div>
    <table>
      <thead><tr><th>#</th><th>Character</th><th>Cast</th><th>Status</th><th>Pickup</th><th>Arrive</th><th>Call</th><th>NDB</th><th>H/M/U Cos</th><th>Set</th><th>Lunch</th><th>Wrap</th><th>Depart</th><th>Drop Off</th><th>Total</th></tr></thead>
      <tbody>${castRows}</tbody>
    </table>
  </div>` : ''}

  ${fits.length ? `
  <div class="sec">
    <div class="sec-title">Costume Fittings / Makeup Tests</div>
    <table>
      <thead><tr><th>#</th><th>Character</th><th>Cast</th><th>Status</th><th>Pickup</th><th>Arrive</th><th>Call</th><th>H/M/U Cos</th><th>Set</th><th>Lunch</th><th>Wrap</th><th>Depart</th><th>Drop Off</th><th>Total</th></tr></thead>
      <tbody>${fitRows}</tbody>
    </table>
  </div>` : ''}

  ${sas.length ? `
  <div class="sec">
    <div class="sec-title">Supporting Artists</div>
    <table>
      <thead><tr><th>#</th><th>Character</th><th>Agency/Direct</th></tr></thead>
      <tbody>${saRows}</tbody>
    </table>
    <div class="grid grid-4" style="margin-top:6px;">
      <div><div class="lbl">Prev Count</div><div class="val">${esc(sa.prev_count)}</div></div>
      <div><div class="lbl">Today Count</div><div class="val">${esc(sa.today_count)}</div></div>
      <div><div class="lbl">Prev Cost</div><div class="val">${esc(sa.prev_cost)}</div></div>
      <div><div class="lbl">Today Cost</div><div class="val">${esc(sa.today_cost)}</div></div>
    </div>
  </div>` : ''}

  ${kids.length ? `
  <div class="sec">
    <div class="sec-title">Children's Hours</div>
    <table>
      <thead><tr><th>#</th><th>Character</th><th>Cast</th><th>Start</th><th>Wrap</th><th>Total</th></tr></thead>
      <tbody>${kidRows}</tbody>
    </table>
  </div>` : ''}

  ${dpr.additionalCrew       ? `<div class="sec"><div class="sec-title">Additional Crew</div><div style="font-size:10px;white-space:pre-wrap;">${esc(dpr.additionalCrew)}</div></div>` : ''}
  ${dpr.additionalEquipment  ? `<div class="sec"><div class="sec-title">Additional Equipment</div><div style="font-size:10px;white-space:pre-wrap;">${esc(dpr.additionalEquipment)}</div></div>` : ''}
  ${dpr.additionalFacilities ? `<div class="sec"><div class="sec-title">Additional Facilities</div><div style="font-size:10px;white-space:pre-wrap;">${esc(dpr.additionalFacilities)}</div></div>` : ''}
  ${dpr.otTocNotes           ? `<div class="sec"><div class="sec-title">OT / TOC / Early Calls</div><div style="font-size:10px;white-space:pre-wrap;">${esc(dpr.otTocNotes)}</div></div>` : ''}
  ${dpr.vfxSfxNotes          ? `<div class="sec"><div class="sec-title">VFX / SFX / Specialists</div><div style="font-size:10px;white-space:pre-wrap;">${esc(dpr.vfxSfxNotes)}</div></div>` : ''}
  ${dpr.hsMedicalNotes       ? `<div class="sec"><div class="sec-title">H&amp;S / Medical / Minors</div><div style="font-size:10px;white-space:pre-wrap;">${esc(dpr.hsMedicalNotes)}</div></div>` : ''}
  ${dpr.notes                ? `<div class="sec"><div class="sec-title">Notes</div><div style="font-size:10px;white-space:pre-wrap;">${esc(dpr.notes)}</div></div>` : ''}
</body></html>`
}
