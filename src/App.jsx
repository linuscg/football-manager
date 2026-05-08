import { useState, useEffect } from 'react'
import { useScheduleStore } from './store/useScheduleStore'
import Schedule    from './modules/Schedule'
import CrewGantt   from './modules/CrewGantt'
import ProjectSetup from './modules/ProjectSetup'
import CallSheet   from './modules/CallSheet'
import Budget      from './modules/Budget'

const NAV = [
  { id: 'setup',     num: '01', label: 'Project Setup' },
  { id: 'schedule',  num: '02', label: 'Schedule' },
  { id: 'crew',      num: '03', label: 'Crew & Equipment' },
  { id: 'callsheet', num: '04', label: 'Daily Info' },
  { id: 'budget',    num: '05', label: 'Cost Tracking' },
]

const MODULE_SUB = {
  setup:     'Production setup',
  schedule:  'Shooting board',
  crew:      'Booking gantt',
  callsheet: 'Call sheet',
  budget:    'Cost tracking',
}

function todayStamp() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd} / ${mm} / ${yy}`
}

function todayFull() {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

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

  useEffect(() => {
    document.title = store.production.name
      ? `Football Manager — ${store.production.name}`
      : 'Football Manager'
  }, [store.production.name])

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
    <div className="pm-shell" onClick={() => setProdMenuOpen(false)}>

      {/* ── Sidebar ───────────────────────────────────────────────────────────── */}
      <aside className="pm-sidebar">

        {/* Production switcher */}
        <div className="pm-sidebar-mast" onClick={e => e.stopPropagation()}>
          <div className="pm-sidebar-eyebrow">Production Office</div>
          <button
            className="pm-sidebar-prod"
            onClick={() => setProdMenuOpen(o => !o)}
            title="Switch production"
          >
            <span className="pm-sidebar-prod-name">{store.production.name || 'Untitled'}</span>
            <span className="pm-sidebar-prod-chev">{prodMenuOpen ? '▴' : '▾'}</span>
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

        <nav className="pm-sidebar-nav">
          {NAV.map(item => (
            <div
              key={item.id}
              className={[
                'pm-nav-item',
                currentModule === item.id ? 'is-active' : '',
                item.soon ? 'disabled' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => !item.soon && navigate(item.id)}
            >
              {currentModule === item.id && <span className="pm-nav-rule" />}
              <span className="pm-nav-icon">{item.num}</span>
              {item.label}
              {item.soon && <span className="nav-soon">Soon</span>}
            </div>
          ))}
        </nav>

        <div className="pm-sidebar-foot">
          <div className="pm-stamp">
            <div className="pm-stamp-line">Rev. {store.shootDays.length > 0 ? store.shootDays.length : '—'}</div>
            <div className="pm-stamp-date">{todayStamp()}</div>
          </div>
          <div className="pm-foot-meta">
            {store.shootDays.filter(d => d.dayCategory === 'main' && !d.isNonShootDay).length} shoot day{store.shootDays.filter(d => d.dayCategory === 'main' && !d.isNonShootDay).length !== 1 ? 's' : ''}
            {store.castMembers?.length > 0 && ` · Cast ${store.castMembers.length}`}
          </div>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────────────── */}
      <div className="pm-main">
        <header className="pm-topbar">
          <div className="pm-topbar-l">
            <span className="pm-topbar-eyebrow">
              {NAV.find(n => n.id === currentModule)?.label ?? ''}
            </span>
            <span className="pm-topbar-sub">
              {MODULE_SUB[currentModule] ?? ''}
              {currentModule === 'schedule' && store.shootDays.length > 0
                ? ` · ${store.shootDays.length} days`
                : ''}
            </span>
          </div>
          <div className="pm-topbar-r">
            <span className="pm-topbar-rev">{todayFull()}</span>
            <span className="pm-topbar-user">
              {(store.production.name || 'P').slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>

        <div className={`pm-content${isGantt ? ' pm-content--gantt' : ''}${isCallsheet ? ' pm-content--cs' : ''}`}>

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
