import { useState, useRef, useEffect } from 'react'

export default function SceneRow({ scene, dayId, onUpdate, onDelete, castMembers = [], onUpdateSceneCast, production }) {
  const [castOpen, setCastOpen] = useState(false)
  const dropdownRef = useRef(null)

  const DAY_NIGHT_CYCLE = ['MORNING', 'DAY', 'DUSK', 'EVENING', 'NIGHT']

  function cycle(field) {
    if (field === 'intExt') {
      onUpdate(dayId, scene.id, 'intExt', scene.intExt === 'INT' ? 'EXT' : 'INT')
    } else {
      const cur = (scene.dayNight || 'DAY').toUpperCase()
      const idx = DAY_NIGHT_CYCLE.indexOf(cur)
      const next = DAY_NIGHT_CYCLE[(idx + 1) % DAY_NIGHT_CYCLE.length]
      onUpdate(dayId, scene.id, 'dayNight', next)
    }
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!castOpen) return
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setCastOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [castOpen])

  const selectedIds = scene.castMemberIds ?? []
  const selectedCast = castMembers.filter(c => selectedIds.includes(c.id))

  function toggleCastMember(id) {
    const current = scene.castMemberIds ?? []
    const next = current.includes(id)
      ? current.filter(x => x !== id)
      : [...current, id]
    onUpdateSceneCast(dayId, scene.id, next)
  }

  const isTv = production?.format === 'tv' && (production?.episodeCount ?? 0) > 0
  return (
    <div className={`scene-row${isTv ? ' scene-row--tv' : ''}`}>
      {/* Scene number */}
      <input
        className="scene-input"
        type="text"
        value={scene.sceneNumber}
        placeholder="Sc #"
        onChange={e => onUpdate(dayId, scene.id, 'sceneNumber', e.target.value)}
      />

      {/* INT / EXT toggle */}
      <button
        className={`pm-sc-tag pm-sc-tag--${scene.intExt.toLowerCase()}`}
        onClick={() => cycle('intExt')}
        title="Click to toggle INT / EXT"
      >
        {scene.intExt}
      </button>

      {/* Location description */}
      <input
        className="scene-input"
        type="text"
        value={scene.location}
        placeholder="Location description"
        onChange={e => onUpdate(dayId, scene.id, 'location', e.target.value)}
      />

      {/* DAY / NIGHT toggle */}
      <button
        className={`pm-sc-tag pm-sc-tag--${scene.dayNight.toLowerCase()}`}
        onClick={() => cycle('dayNight')}
        title="Click to toggle DAY / NIGHT"
      >
        {scene.dayNight}
      </button>

      {/* Brief description */}
      <input
        className="scene-input"
        type="text"
        value={scene.description}
        placeholder="Brief description"
        onChange={e => onUpdate(dayId, scene.id, 'description', e.target.value)}
      />

      {/* Pages */}
      <input
        className="scene-input"
        type="text"
        value={scene.pages}
        placeholder="Pages"
        style={{ textAlign: 'center' }}
        onChange={e => onUpdate(dayId, scene.id, 'pages', e.target.value)}
      />

      {/* Episode selector — only in TV mode */}
      {production?.format === 'tv' && production?.episodeCount > 0 && (
        <select
          className="scene-input"
          value={scene.episodeNumber ?? ''}
          onChange={e => {
            const n = parseInt(e.target.value, 10)
            onUpdate(dayId, scene.id, 'episodeNumber', isNaN(n) ? null : n)
          }}
          style={{ width: 64, flexShrink: 0 }}
          title="Episode"
        >
          <option value="">Ep</option>
          {Array.from({ length: production.episodeCount }, (_, i) => i + 1).map(n => (
            <option key={n} value={n}>Ep {n}</option>
          ))}
        </select>
      )}

      {/* Cast selector */}
      <div className="cast-cell" ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          className="cast-summary-btn"
          onClick={() => setCastOpen(o => !o)}
          title={selectedCast.length > 0
            ? selectedCast.map(c => [c.castNumber ? `[${c.castNumber}]` : null, c.name].filter(Boolean).join(' ')).join(', ')
            : 'Assign cast'}
        >
          {selectedCast.length > 0
            ? selectedCast
                .slice().sort((a, b) => (a.castNumber ?? 999) - (b.castNumber ?? 999))
                .map(c => c.castNumber != null ? String(c.castNumber) : (c.name || '?'))
                .join(', ')
            : <span style={{ color: '#d1d5db' }}>Cast</span>}
        </button>
        {castOpen && (
          <div className="cast-dropdown">
            {castMembers.length === 0 ? (
              <div className="cast-dropdown-empty">No cast added yet — add in Project Setup</div>
            ) : (
              castMembers.map(c => (
                <label key={c.id} className="cast-dropdown-item">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(c.id)}
                    onChange={() => toggleCastMember(c.id)}
                  />
                  {c.castNumber != null && (
                    <span className="cast-dropdown-num">{c.castNumber}</span>
                  )}
                  <span className="cast-dropdown-name">{c.name || '(unnamed)'}</span>
                  {c.role && <span className="cast-dropdown-role">{c.role}</span>}
                </label>
              ))
            )}
          </div>
        )}
      </div>

      {/* Delete */}
      <button
        className="pm-icon-btn danger"
        onClick={() => onDelete(dayId, scene.id)}
        title="Remove scene"
      >
        ✕
      </button>
    </div>
  )
}
