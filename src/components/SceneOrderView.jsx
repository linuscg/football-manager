import { useMemo, useState, useEffect, useRef } from 'react'
import { dayLabel } from './CalendarView'
import { EXTRAS_CATEGORIES } from '../lib/extrasCategories'
import BreakdownImportModal from '../modules/BreakdownImportModal'

// Base columns + one per Additional Info category (Scene Order only)
const BASE_COLS = '96px 74px 180px 260px 96px 52px 58px 170px 108px 160px'
const EXTRA_COL_W = 190
const gridStyle = { gridTemplateColumns: `${BASE_COLS} repeat(${EXTRAS_CATEGORIES.length}, ${EXTRA_COL_W}px)` }

// ─── Scene-number parsing ─────────────────────────────────────────────────────
// "12"→{num:12,suffix:""}, "12A"→{num:12,suffix:"A"}, "92 pt 1 of 2"→{num:92,...}
// Non-numeric / blank → num:null (listed at the bottom as unnumbered).
function parseSceneNum(raw) {
  const s = (raw ?? '').trim()
  const m = s.match(/^(\d+)(.*)$/)
  if (!m) return { num: null, suffix: s }
  return { num: parseInt(m[1], 10), suffix: m[2].trim() }
}

const DAY_NIGHT = ['DAWN', 'MORNING', 'DAY', 'DUSK', 'EVENING', 'NIGHT', 'DFN']

function fmtShort(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function SceneOrderView({ shootDays, production, actions, castMembers = [] }) {
  const [bdOpen, setBdOpen] = useState(false)
  const [editing, setEditing] = useState(null)   // { day, scene, cat, rect }

  // sceneId → { category: [rows] } from each day's Additional Info
  const extrasByScene = useMemo(() => {
    const m = {}
    for (const d of shootDays) {
      for (const [cat, rows] of Object.entries(d.extras ?? {})) {
        for (const r of rows) {
          if (!r.sceneId) continue
          ;((m[r.sceneId] ??= {})[cat] ??= []).push(r)
        }
      }
    }
    for (const cats of Object.values(m)) for (const rows of Object.values(cats)) rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    return m
  }, [shootDays])
  const extrasCols = { byScene: extrasByScene, onEdit: (day, scene, cat, rect) => setEditing({ day, scene, cat, rect }) }
  const bdModal = bdOpen && (
    <BreakdownImportModal
      shootDays={shootDays}
      castMembers={castMembers}
      onApply={plan => actions.applyBreakdownImport(plan)}
      onClose={() => setBdOpen(false)}
    />
  )
  const omitted = useMemo(
    () => new Set((production.omittedScenes ?? []).map(String)),
    [production.omittedScenes]
  )

  // Day options for the "Scheduled" dropdown, in schedule order.
  const dayOptions = useMemo(() => buildDayOptions(shootDays), [shootDays])

  // All scenes with their day, sorted into script order; plus gap rows.
  const { rows, unnumbered } = useMemo(() => {
    const numbered = []
    const unnumbered = []
    for (const day of shootDays) {
      for (const sc of day.scenes ?? []) {
        const parsed = parseSceneNum(sc.sceneNumber)
        const entry = { scene: sc, day, ...parsed }
        if (parsed.num == null) unnumbered.push(entry)
        else numbered.push(entry)
      }
    }
    numbered.sort((a, b) => a.num - b.num || a.suffix.localeCompare(b.suffix, undefined, { numeric: true }))

    // Interleave gap rows for missing consecutive numbers 1..max.
    const have = new Set(numbered.map(e => e.num))
    const max = numbered.length ? numbered[numbered.length - 1].num : 0
    const rows = []
    let i = 0
    for (let n = 1; n <= max; n++) {
      if (have.has(n)) {
        while (i < numbered.length && numbered[i].num === n) rows.push({ kind: 'scene', ...numbered[i++] })
      } else {
        rows.push({ kind: 'gap', num: n })
      }
    }
    return { rows, unnumbered }
  }, [shootDays])

  function setOmitted(num, isOmitted) {
    const key = String(num)
    const list = (production.omittedScenes ?? []).map(String).filter(v => v !== key)
    if (isOmitted) list.push(key)
    actions.updateProduction('omittedScenes', list)
  }

  function upd(day, scene, field) {
    return e => actions.updateScene(day.id, scene.id, field, e.target.value)
  }

  // Duplicates: same scene number appearing more than once; "hard" duplicate
  // when the descriptions also match (likely a true double entry).
  const numCounts = {}
  const numDescCounts = {}
  for (const r of rows) {
    if (r.kind !== 'scene') continue
    const num = String(r.scene.sceneNumber ?? '').trim()
    if (!num) continue
    numCounts[num] = (numCounts[num] ?? 0) + 1
    const nd = `${num}|${String(r.scene.description ?? '').trim().toLowerCase()}`
    numDescCounts[nd] = (numDescCounts[nd] ?? 0) + 1
  }
  const dupInfo = r => {
    const num = String(r.scene.sceneNumber ?? '').trim()
    if (!num || (numCounts[num] ?? 0) < 2) return null
    const nd = `${num}|${String(r.scene.description ?? '').trim().toLowerCase()}`
    return (numDescCounts[nd] ?? 0) >= 2 ? 'hard' : 'soft'
  }
  const dupCount = rows.filter(r => r.kind === 'scene' && dupInfo(r) === 'hard').length

  const missingCount = rows.filter(r => r.kind === 'gap' && !omitted.has(String(r.num))).length
  const omittedCount = rows.filter(r => r.kind === 'gap' && omitted.has(String(r.num))).length

  if (rows.length === 0 && unnumbered.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🎬</div>
        <div className="empty-state-text">No scenes yet.</div>
        <div className="empty-state-sub">Add scenes to shoot days, import a schedule PDF, or upload a breakdown.</div>
        <button className="pm-btn pm-btn--ghost" style={{ marginTop: 12 }} onClick={() => setBdOpen(true)}>↑ Upload breakdown</button>
        {bdModal}
      </div>
    )
  }

  return (
    <div className="sceneorder-root">
      <div className="sceneorder-summary">
        <button className="pm-btn pm-btn--ghost pm-btn--sm sceneorder-bd-btn" onClick={() => setBdOpen(true)}
          title="Upload a Movie Magic breakdown PDF — fills each scene's Additional Info">↑ Upload breakdown</button>
        <span><strong>{rows.filter(r => r.kind === 'scene').length + unnumbered.length}</strong> scenes</span>
        {missingCount > 0 && <span className="sceneorder-summary-missing"><strong>{missingCount}</strong> missing</span>}
        {dupCount > 0 && <span className="sceneorder-summary-missing"><strong>{dupCount}</strong> duplicated</span>}
        {omittedCount > 0 && <span className="sceneorder-summary-omitted"><strong>{omittedCount}</strong> omitted</span>}
      </div>

      <div className="sceneorder-table sceneorder-table--wide">
        <div className="sceneorder-row sceneorder-row--head" style={gridStyle}>
          <span>#</span>
          <span>Int/Ext</span>
          <span>Set</span>
          <span>Description</span>
          <span>D/N</span>
          <span>SD</span>
          <span>Pgs</span>
          <span>Scheduled</span>
          <span>Date</span>
          <span>Day location</span>
          {EXTRAS_CATEGORIES.map(c => <span key={c.key}>{c.label}</span>)}
        </div>

        {rows.map(r => r.kind === 'gap' ? (
          <div
            key={`gap-${r.num}`}
            style={gridStyle}
            className={`sceneorder-row sceneorder-row--gap${omitted.has(String(r.num)) ? ' is-omitted' : ' is-missing'}`}
          >
            <span className="sceneorder-gap-num">{r.num}</span>
            <span className="sceneorder-gap-note" style={{ gridColumn: 'span 7' }}>
              {omitted.has(String(r.num))
                ? 'Omitted from script'
                : 'No scene with this number — missing, or omitted from the script?'}
            </span>
            <select
              className="sceneorder-select sceneorder-gap-select"
              style={{ gridColumn: 'span 2' }}
              value={omitted.has(String(r.num)) ? 'omitted' : 'missing'}
              onChange={e => setOmitted(r.num, e.target.value === 'omitted')}
            >
              <option value="missing">⚠ Missing</option>
              <option value="omitted">Omitted</option>
            </select>
          </div>
        ) : (
          <SceneRow
            key={r.scene.id}
            r={r}
            dayOptions={dayOptions}
            upd={upd}
            actions={actions}
            extrasCols={extrasCols}
          />
        ))}

        {unnumbered.length > 0 && (
          <>
            <div className="sceneorder-section">Unnumbered scenes</div>
            {unnumbered.map(r => (
              <SceneRow key={r.scene.id} r={r} dayOptions={dayOptions} upd={upd} actions={actions} dup={dupInfo(r)} extrasCols={extrasCols} />
            ))}
          </>
        )}
      </div>
      {editing && (
        <ExtrasEditor
          key={`${editing.scene.id}-${editing.cat.key}`}
          editing={editing}
          rows={extrasByScene[editing.scene.id]?.[editing.cat.key] ?? []}
          actions={actions}
          onClose={() => setEditing(null)}
        />
      )}
      {bdModal}
    </div>
  )
}

// ─── Additional Info cells ───────────────────────────────────────────────────
const saText = r => `${r.doodId ? `#${r.doodId} ` : ''}${r.saName || r.description || 'SAs'}${r.totalNumber != null && r.totalNumber !== 1 ? ` ×${r.totalNumber}` : ''}`
const rowText = (cat, r) => (cat === 'extras' ? saText(r) : r.description ?? '')

function ExtrasCell({ day, scene, cat, rows, onEdit }) {
  const lines = rows.map(r => rowText(cat.key, r)).filter(t => t.trim())
  return (
    <button
      type="button"
      className={`sceneorder-xcell${lines.length ? '' : ' is-empty'}`}
      title={lines.length ? lines.join('\n') : `Add ${cat.label}`}
      onClick={e => onEdit(day, scene, cat, e.currentTarget.getBoundingClientRect())}
    >
      {lines.length ? lines.map((t, i) => <span key={i} className="sceneorder-xitem">{t}</span>) : <span className="sceneorder-xadd">+</span>}
    </button>
  )
}

// Popover editor: one item per line. SAs take "Name ×N" (or "Name (N)").
function ExtrasEditor({ editing, rows, actions, onClose }) {
  const { day, scene, cat, rect } = editing
  const isSa = cat.key === 'extras'
  const [text, setText] = useState(() => rows.map(r => rowText(cat.key, r)).join('\n'))
  const ref = useRef(null)
  const latest = useRef(null)
  latest.current = { text, rows }

  function commit() {
    const { text: t, rows: rs } = latest.current
    const lines = t.split('\n').map(l => l.trim()).filter(Boolean)
    const parse = (l, r) => {
      if (!isSa) return { description: l }
      // "#104 Subway commuters ×30" — #ID links the group (same people, counted once a day)
      const idm = l.match(/^#(\S+)\s*(.*)$/)
      const doodId = idm ? idm[1] : null
      const rest = idm ? idm[2] : l
      const m = rest.match(/^(.*?)\s*(?:[×x]\s*(\d+)|\((\d+)\))\s*$/i)
      const base = m ? { saName: m[1].trim(), totalNumber: parseInt(m[2] ?? m[3], 10) } : { saName: rest.trim(), totalNumber: 1 }
      const linkKey = doodId ? `dood-${doodId}` : (r?.linkKey?.startsWith('dood-') ? null : r?.linkKey ?? null)
      return { ...base, doodId, linkKey }
    }
    lines.forEach((l, i) => {
      const r = rs[i]
      const f = parse(l, r)
      if (!r) { actions.addSceneExtra(day.id, scene.id, cat.key, f); return }
      if (rowText(cat.key, r) === l) return
      for (const [k, v] of Object.entries(f)) if ((r[k] ?? null) !== (v ?? null)) actions.updateDayExtra(day.id, r.id, k, v)
      // Edited by hand → no longer a breakdown item, so a re-upload keeps it
      if (r.source) actions.updateDayExtra(day.id, r.id, 'source', null)
    })
    for (const r of rs.slice(lines.length)) actions.deleteDayExtra(day.id, r.id)
  }

  useEffect(() => {
    ref.current?.focus()
    function onDown(e) { if (!e.target.closest?.('.sceneorder-xeditor')) { commit(); onClose() } }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const W = 300
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - W - 8))
  const below = rect.bottom + 4
  const top = below + 220 > window.innerHeight ? Math.max(8, rect.top - 224) : below
  return (
    <div className="sceneorder-xeditor" style={{ position: 'fixed', left, top, width: W }}>
      <div className="sceneorder-xeditor-head">Sc {scene.sceneNumber || '—'} · {cat.label}</div>
      <textarea
        ref={ref}
        className="sceneorder-xeditor-text"
        value={text}
        rows={7}
        placeholder={isSa ? 'One per line — e.g. #104 Commuters ×20' : 'One item per line'}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') { onClose() }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { commit(); onClose() }
        }}
      />
      <div className="sceneorder-xeditor-foot">
        <span>{isSa ? '#ID Name ×count' : 'One per line'} · ⌘↵ save · Esc cancel</span>
        <button className="pm-btn pm-btn--primary pm-btn--sm" onClick={() => { commit(); onClose() }}>Save</button>
      </div>
    </div>
  )
}

export function buildDayOptions(shootDays) {
  const sorted = [...shootDays].sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date)
    if (a.date) return -1
    if (b.date) return 1
    return a.sortOrder - b.sortOrder
  })
  return sorted.map(d => ({
    id: d.id,
    label: `${dayLabel(d).split(' — ')[0]}${d.date ? ' · ' + fmtShort(d.date) : ''}`,
  }))
}

export { parseSceneNum, fmtShort }

export function SceneRow({ r, dayOptions, upd, actions, dup = null, extrasCols = null }) {
  const { scene, day } = r
  return (
    <div
      style={extrasCols ? gridStyle : undefined}
      className={`sceneorder-row${dup === 'hard' ? ' sceneorder-row--dup' : dup === 'soft' ? ' sceneorder-row--dupnum' : ''}`}
      title={dup === 'hard' ? 'Duplicate: this scene number AND description appear more than once'
           : dup === 'soft' ? 'This scene number appears more than once (different descriptions)' : undefined}
    >
      <input
        className="sceneorder-input sceneorder-input--num"
        value={scene.sceneNumber}
        placeholder="—"
        onChange={upd(day, scene, 'sceneNumber')}
      />
      <select className="sceneorder-select" value={scene.intExt} onChange={upd(day, scene, 'intExt')}>
        <option>INT</option><option>EXT</option>
      </select>
      <input
        className="sceneorder-input"
        value={scene.location ?? ''}
        placeholder="Set"
        onChange={upd(day, scene, 'location')}
      />
      <input
        className="sceneorder-input"
        value={scene.description ?? ''}
        placeholder="Description"
        onChange={upd(day, scene, 'description')}
      />
      <select className="sceneorder-select" value={scene.dayNight} onChange={upd(day, scene, 'dayNight')}>
        {DAY_NIGHT.map(v => <option key={v}>{v}</option>)}
      </select>
      <input
        className="sceneorder-input sceneorder-input--num"
        value={scene.storyDay ?? ''}
        placeholder="—"
        onChange={upd(day, scene, 'storyDay')}
      />
      <input
        className="sceneorder-input sceneorder-input--num"
        value={scene.pages ?? ''}
        placeholder="—"
        onChange={upd(day, scene, 'pages')}
      />
      <select
        className="sceneorder-select sceneorder-select--day"
        value={day.id}
        onChange={e => actions.moveSceneToDay(scene.id, day.id, e.target.value)}
      >
        {dayOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <span className="sceneorder-ro">{fmtShort(day.date) || '—'}</span>
      <span className="sceneorder-ro" title={day.location || ''}>{day.location || '—'}</span>
      {extrasCols && EXTRAS_CATEGORIES.map(c => (
        <ExtrasCell key={c.key} day={day} scene={scene} cat={c}
          rows={extrasCols.byScene[scene.id]?.[c.key] ?? []} onEdit={extrasCols.onEdit} />
      ))}
    </div>
  )
}
