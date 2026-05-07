import { useState } from 'react'
import { useScheduleStore } from './store/useScheduleStore'
import Schedule    from './modules/Schedule'
import CrewGantt   from './modules/CrewGantt'
import ProjectSetup from './modules/ProjectSetup'
import CallSheet   from './modules/CallSheet'
import Budget      from './modules/Budget'

const NAV = [
  { id: 'setup',     icon: '⚙',  label: 'Project Setup' },
  { id: 'schedule',  icon: '≡',  label: 'Schedule' },
  { id: 'crew',      icon: '▦',  label: 'Crew & Equipment' },
  { id: 'callsheet', icon: '☰',  label: 'Daily Info' },
  { id: 'budget',    icon: '$',  label: 'Cost Tracking' },
]

function getInitialModule() {
  const saved = localStorage.getItem('fm_current_module')
  if (saved && NAV.find(n => n.id === saved)) return saved
  return 'schedule'
}

export default function App() {
  const [currentModule, setCurrentModule] = useState(getInitialModule)
  const [prodMenuOpen,  setProdMenuOpen]  = useState(false)

  function navigate(id) {
    setCurrentModule(id)
    localStorage.setItem('fm_current_module', id)
  }

  const {
    loading, error, store,
    productions, currentProductionId,
    createProduction, deleteProduction, switchProduction,
    updateProduction,
    generateShootDays,
    addShootDay, deleteShootDay, updateShootDay,
    addPrepDay, addSplinterDay,
    moveDayUp, moveDayDown, reorderDays,
    addScene, deleteScene, updateScene,
    updateSceneCast,
    addDayExtra, deleteDayExtra, updateDayExtra,
    addCastMember, deleteCastMember, updateCastMember, reorderCastMembers,
  } = useScheduleStore()

  const scheduleActions = {
    addShootDay, deleteShootDay, updateShootDay,
    addPrepDay, addSplinterDay,
    moveDayUp, moveDayDown, reorderDays,
    addScene, deleteScene, updateScene,
    updateSceneCast,
    addDayExtra, deleteDayExtra, updateDayExtra,
  }

  if (loading) return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', color: '#9ca3af', fontSize: 14,
    }}>
      Loading…
    </div>
  )

  if (error) return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', color: '#dc2626', fontSize: 14,
      flexDirection: 'column', gap: 8,
    }}>
      <strong>Could not connect to database</strong>
      <span style={{ color: '#9ca3af' }}>{error}</span>
    </div>
  )

  const isGantt     = currentModule === 'crew'
  const isCallsheet = currentModule === 'callsheet'

  async function handleCreateProduction() {
    setProdMenuOpen(false)
    await createProduction()
    navigate('setup')
  }

  async function handleDeleteProduction(id) {
    if (productions.length <= 1) return
    const prod = productions.find(p => p.id === id)
    if (!window.confirm(`Delete "${prod?.name || 'this production'}"? This cannot be undone.`)) return
    setProdMenuOpen(false)
    await deleteProduction(id)
  }

  return (
    <div className="app-shell" onClick={() => setProdMenuOpen(false)}>

      {/* ── Sidebar ───────────────────────────────────────────────────────────── */}
      <aside className="sidebar">

        {/* Production switcher */}
        <div className="sidebar-logo" onClick={e => e.stopPropagation()}>
          <div className="sidebar-eyebrow">Production</div>
          <button
            className="sidebar-prod-btn"
            onClick={() => setProdMenuOpen(o => !o)}
            title="Switch production"
          >
            <span className="sidebar-prod-name">{store.production.name || 'Untitled'}</span>
            <span className="sidebar-prod-chevron">{prodMenuOpen ? '▴' : '▾'}</span>
          </button>

          {prodMenuOpen && (
            <div className="sidebar-prod-menu">
              {productions.map(p => (
                <div
                  key={p.id}
                  className={`sidebar-prod-option${p.id === currentProductionId ? ' active' : ''}`}
                >
                  <span
                    className="sidebar-prod-option-name"
                    onClick={() => { switchProduction(p.id); setProdMenuOpen(false) }}
                  >
                    {p.id === currentProductionId && <span className="sidebar-prod-tick">✓ </span>}
                    {p.name || 'Untitled'}
                  </span>
                  {productions.length > 1 && p.id !== currentProductionId && (
                    <button
                      className="sidebar-prod-del"
                      onClick={() => handleDeleteProduction(p.id)}
                      title="Delete production"
                    >✕</button>
                  )}
                </div>
              ))}
              <button
                className="sidebar-prod-new"
                onClick={handleCreateProduction}
              >+ New production</button>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {NAV.map(item => (
            <div
              key={item.id}
              className={[
                'nav-item',
                currentModule === item.id ? 'active' : '',
                item.soon ? 'disabled' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => !item.soon && navigate(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {item.soon && <span className="nav-soon">Soon</span>}
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────────────── */}
      <div className="main-area">
        <header className="top-bar">
          <span className="top-bar-title">
            {NAV.find(n => n.id === currentModule)?.label ?? ''}
          </span>
        </header>

        <div className={`content-area${isGantt ? ' content-area--gantt' : ''}${isCallsheet ? ' content-area--callsheet' : ''}`}>

          {currentModule === 'setup' && (
            <ProjectSetup
              production={store.production}
              shootDays={store.shootDays}
              castMembers={store.castMembers}
              onUpdate={updateProduction}
              onGenerate={generateShootDays}
              onAddCastMember={addCastMember}
              onDeleteCastMember={deleteCastMember}
              onUpdateCastMember={updateCastMember}
              onReorderCastMembers={reorderCastMembers}
            />
          )}

          {currentModule === 'schedule' && (
            <Schedule store={store} actions={scheduleActions} />
          )}

          {currentModule === 'crew' && (
            <CrewGantt
              production={store.production}
              shootDays={store.shootDays}
            />
          )}

          {currentModule === 'callsheet' && (
            <CallSheet store={store} castMembers={store.castMembers} />
          )}

          {currentModule === 'budget' && (
            <Budget store={store} onUpdate={updateProduction} />
          )}

        </div>
      </div>
    </div>
  )
}
