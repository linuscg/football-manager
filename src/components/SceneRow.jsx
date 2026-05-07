export default function SceneRow({ scene, dayId, onUpdate, onDelete }) {
  function cycle(field) {
    if (field === 'intExt') {
      onUpdate(dayId, scene.id, 'intExt', scene.intExt === 'INT' ? 'EXT' : 'INT')
    } else {
      onUpdate(dayId, scene.id, 'dayNight', scene.dayNight === 'DAY' ? 'NIGHT' : 'DAY')
    }
  }

  return (
    <div className="scene-row">
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
        className={`scene-tag-btn ${scene.intExt.toLowerCase()}`}
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
        className={`scene-tag-btn ${scene.dayNight.toLowerCase()}`}
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

      {/* Delete */}
      <button
        className="btn-icon danger"
        onClick={() => onDelete(dayId, scene.id)}
        title="Remove scene"
      >
        ✕
      </button>
    </div>
  )
}
