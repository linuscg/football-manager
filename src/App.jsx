import { useScheduleStore } from './store/useScheduleStore'
import Schedule from './modules/Schedule'

export default function App() {
  const {
    loading,
    error,
    store,
    setProductionName,
    setPrepStartDate,
    addShootDay,
    deleteShootDay,
    updateShootDay,
    moveDayUp,
    moveDayDown,
    reorderDays,
    addScene,
    deleteScene,
    updateScene,
  } = useScheduleStore()

  const actions = {
    addShootDay,
    deleteShootDay,
    updateShootDay,
    moveDayUp,
    moveDayDown,
    reorderDays,
    addScene,
    deleteScene,
    updateScene,
  }

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'#9ca3af', fontSize:14 }}>
      Loading…
    </div>
  )

  if (error) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'#dc2626', fontSize:14, flexDirection:'column', gap:8 }}>
      <strong>Could not connect to database</strong>
      <span style={{ color:'#9ca3af' }}>{error}</span>
    </div>
  )

  return (
    <div className="app-shell">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-eyebrow">Production</div>
          <div className="sidebar-prod-name">{store.production.name}</div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-item active">
            <span className="nav-icon">≡</span> Schedule
          </div>
          <div className="nav-item disabled">
            <span className="nav-icon">▦</span> Crew &amp; Equipment
            <span className="nav-soon">Soon</span>
          </div>
          <div className="nav-item disabled">
            <span className="nav-icon">☰</span> Call Sheet Extract
            <span className="nav-soon">Soon</span>
          </div>
          <div className="nav-item disabled">
            <span className="nav-icon">$</span> Budget
            <span className="nav-soon">Soon</span>
          </div>
        </nav>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <div className="main-area">
        <header className="top-bar">
          <span className="top-bar-title">Schedule Entry</span>
        </header>

        <div className="content-area">
          <Schedule store={store} actions={actions} />
        </div>
      </div>
    </div>
  )
}
