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

  function navigate(id) {
    setCurrentModule(id)
    localStorage.setItem('fm_current_module', id)
  }

  const {
    loading, error, store,
    updateProduction,
    generateShootDays,
    addShootDay, deleteShootDay, updateShootDay,
    moveDayUp, moveDayDown, reorderDays,
    addScene, deleteScene, updateScene,
  } = useScheduleStore()

  const scheduleActions = {
    addShootDay, deleteShootDay, updateShootDay,
    moveDayUp, moveDayDown, reorderDays,
    addScene, deleteScene, updateScene,
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

  const isGantt      = currentModule === 'crew'
  const isCallsheet  = currentModule === 'callsheet'

  return (
    <div className="app-shell">

      {/* ── Sidebar ───────────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-eyebrow">Production</div>
          <div className="sidebar-prod-name">{store.production.name}</div>
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
              onUpdate={updateProduction}
              onGenerate={generateShootDays}
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
            <CallSheet store={store} />
          )}

          {currentModule === 'budget' && (
            <Budget store={store} />
          )}

        </div>
      </div>
    </div>
  )
}
