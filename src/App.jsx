import { useScheduleStore } from './store/useScheduleStore'
import Schedule from './modules/Schedule'

export default function App() {
  const {
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
