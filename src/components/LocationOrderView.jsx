import { useMemo } from 'react'
import { SceneRow, buildDayOptions, parseSceneNum } from './SceneOrderView'

// Groups every scene by its set/location (the scene's own location field),
// alphabetically; within a group, scenes run in shoot order (date, then scene
// number). Rows are the same editable rows as the Scene Order view.
export default function LocationOrderView({ shootDays, actions }) {
  const dayOptions = useMemo(() => buildDayOptions(shootDays), [shootDays])

  const groups = useMemo(() => {
    const byLoc = new Map()
    for (const day of shootDays) {
      for (const sc of day.scenes ?? []) {
        const name = (sc.location ?? '').trim()
        const key = name.toUpperCase()
        if (!byLoc.has(key)) byLoc.set(key, { name: name || 'No set specified', entries: [] })
        byLoc.get(key).entries.push({ scene: sc, day, ...parseSceneNum(sc.sceneNumber) })
      }
    }
    const list = [...byLoc.values()]
    for (const g of list) {
      g.entries.sort((a, b) =>
        (a.day.date || '9999').localeCompare(b.day.date || '9999') ||
        (a.num ?? Infinity) - (b.num ?? Infinity) ||
        a.suffix.localeCompare(b.suffix, undefined, { numeric: true })
      )
      // The days this location shoots on, for the header
      const dates = [...new Set(g.entries.map(e => e.day.date).filter(Boolean))].sort()
      g.dates = dates
    }
    // Alphabetical; the blank-set group last
    list.sort((a, b) => {
      if (a.name === 'No set specified') return 1
      if (b.name === 'No set specified') return -1
      return a.name.localeCompare(b.name)
    })
    return list
  }, [shootDays])

  function upd(day, scene, field) {
    return e => actions.updateScene(day.id, scene.id, field, e.target.value)
  }

  if (groups.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📍</div>
        <div className="empty-state-text">No scenes yet.</div>
        <div className="empty-state-sub">Add scenes to shoot days, or import a schedule PDF.</div>
      </div>
    )
  }

  return (
    <div className="sceneorder-root">
      <div className="sceneorder-summary">
        <span><strong>{groups.length}</strong> locations</span>
        <span><strong>{groups.reduce((n, g) => n + g.entries.length, 0)}</strong> scenes</span>
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

        {groups.map(g => (
          <div key={g.name}>
            <div className="sceneorder-section sceneorder-section--loc">
              <span className="sceneorder-loc-name">{g.name}</span>
              <span className="sceneorder-loc-meta">
                {g.entries.length} scene{g.entries.length === 1 ? '' : 's'}
                {g.dates.length > 0 && ` · ${g.dates.length} day${g.dates.length === 1 ? '' : 's'}`}
              </span>
            </div>
            {g.entries.map(r => (
              <SceneRow key={r.scene.id} r={r} dayOptions={dayOptions} upd={upd} actions={actions} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
