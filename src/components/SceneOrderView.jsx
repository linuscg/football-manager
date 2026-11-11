import { useMemo } from 'react'
import { dayLabel } from './CalendarView'

// ─── Scene-number parsing ─────────────────────────────────────────────────────
// "12"→{num:12,suffix:""}, "12A"→{num:12,suffix:"A"}, "92 pt 1 of 2"→{num:92,...}
// Non-numeric / blank → num:null (listed at the bottom as unnumbered).
function parseSceneNum(raw) {
  const s = (raw ?? '').trim()
  const m = s.match(/^(\d+)(.*)$/)
  if (!m) return { num: null, suffix: s }
  return { num: parseInt(m[1], 10), suffix: m[2].trim() }
}

const DAY_NIGHT = ['MORNING', 'DAY', 'DUSK', 'EVENING', 'NIGHT']

function fmtShort(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function SceneOrderView({ shootDays, production, actions }) {
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

  const missingCount = rows.filter(r => r.kind === 'gap' && !omitted.has(String(r.num))).length
  const omittedCount = rows.filter(r => r.kind === 'gap' && omitted.has(String(r.num))).length

  if (rows.length === 0 && unnumbered.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🎬</div>
        <div className="empty-state-text">No scenes yet.</div>
        <div className="empty-state-sub">Add scenes to shoot days, or import a schedule PDF.</div>
      </div>
    )
  }

  return (
    <div className="sceneorder-root">
      <div className="sceneorder-summary">
        <span><strong>{rows.filter(r => r.kind === 'scene').length + unnumbered.length}</strong> scenes</span>
        {missingCount > 0 && <span className="sceneorder-summary-missing"><strong>{missingCount}</strong> missing</span>}
        {omittedCount > 0 && <span className="sceneorder-summary-omitted"><strong>{omittedCount}</strong> omitted</span>}
      </div>

      <div className="sceneorder-table">
        <div className="sceneorder-row sceneorder-row--head">
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
        </div>

        {rows.map(r => r.kind === 'gap' ? (
          <div
            key={`gap-${r.num}`}
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
          />
        ))}

        {unnumbered.length > 0 && (
          <>
            <div className="sceneorder-section">Unnumbered scenes</div>
            {unnumbered.map(r => (
              <SceneRow key={r.scene.id} r={r} dayOptions={dayOptions} upd={upd} actions={actions} />
            ))}
          </>
        )}
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

export function SceneRow({ r, dayOptions, upd, actions }) {
  const { scene, day } = r
  return (
    <div className="sceneorder-row">
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
    </div>
  )
}
