import { useState, useEffect } from 'react'
import { useScheduleStore }  from './store/useScheduleStore'
import { useAuthStore }      from './store/useAuthStore'
import { useProfileStore }   from './store/useProfileStore'
import Login                 from './modules/Login'
import AcceptInvite          from './modules/AcceptInvite'
import Schedule              from './modules/Schedule'
import CrewGantt             from './modules/CrewGantt'
import ProjectSetup          from './modules/ProjectSetup'
import CallSheet             from './modules/CallSheet'
import Budget                from './modules/Budget'
import FulltimeCrew          from './modules/FulltimeCrew'
import Backpage              from './modules/Backpage'
import Timesheets            from './modules/Timesheets'
import Catering              from './modules/Catering'
import CateringNumbers       from './modules/CateringNumbers'
import AccountPage           from './modules/AccountPage'
import ProjectListPage       from './modules/ProjectListPage'
import AdminPage             from './modules/AdminPage'

// ─── Top-level tab definitions ────────────────────────────────────────────────

const TOP_TABS = [
  { id: 'setup',      label: 'Project Setup'    },
  { id: 'fm',         label: 'Football Manager' },
  { id: 'crew-times', label: 'Crew Times'       },
  { id: 'catering',   label: 'Catering'         },
]

// ─── Project Setup nav ────────────────────────────────────────────────────────

const SETUP_NAV = [
  { id: 'setup-list',     num: '01', label: 'Project List' },
  { id: 'setup-main',     num: '02', label: 'Project Setup' },
  { id: 'setup-account',  num: '03', label: 'Account'       },
  { id: 'setup-settings', num: '04', label: 'Settings'      },
  { id: 'setup-admin',    num: '05', label: 'Admin'         },
]

const SETUP_MODULE_SUB = {
  'setup-list':     'All productions',
  'setup-main':     'Production setup',
  'setup-account':  'User account',
  'setup-settings': 'App settings',
  'setup-admin':    'Administration',
}

// ─── Football Manager nav ─────────────────────────────────────────────────────

const FM_NAV = [
  { id: 'schedule',  num: '01', label: 'Schedule'         },
  { id: 'crew',      num: '02', label: 'Crew & Equipment' },
  { id: 'callsheet', num: '03', label: 'Daily Info'       },
  { id: 'budget',    num: '04', label: 'Cost Tracking'    },
]

const FM_MODULE_SUB = {
  schedule:  'Shooting board',
  crew:      'Booking gantt',
  callsheet: 'Call sheet',
  budget:    'Cost tracking',
}

// ─── Catering nav ────────────────────────────────────────────────────────────

const CAT_NAV = [
  { id: 'cat-list',    num: '01', label: 'Catering List'    },
  { id: 'cat-numbers', num: '02', label: 'Catering Numbers' },
]

const CAT_MODULE_SUB = {
  'cat-list':    'Lunch collection',
  'cat-numbers': 'Daily meal counts',
}

// ─── Crew Times nav ───────────────────────────────────────────────────────────

const CT_NAV = [
  { id: 'ct-crew',       num: '01', label: 'Fulltime Crew' },
  { id: 'ct-backpage',   num: '02', label: 'Backpage'      },
  { id: 'ct-timesheets', num: '03', label: 'Timesheets'    },
]

const CT_MODULE_SUB = {
  'ct-crew':       'Full-time crew list',
  'ct-backpage':   'Daily back page',
  'ct-timesheets': 'Weekly timesheets',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayFull() {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function getInitialTopTab() {
  const saved = localStorage.getItem('fm_top_tab')
  if (saved && TOP_TABS.find(t => t.id === saved)) return saved
  return 'setup'
}

function getInitialFmModule() {
  const saved = localStorage.getItem('fm_current_module')
  if (saved && FM_NAV.find(n => n.id === saved)) return saved
  return 'schedule'
}

function getInitialSetupModule() {
  const saved = localStorage.getItem('fm_setup_module')
  if (saved && SETUP_NAV.find(n => n.id === saved)) return saved
  return 'setup-main'
}

function getInitialCtModule() {
  const saved = localStorage.getItem('fm_ct_module')
  if (saved && CT_NAV.find(n => n.id === saved)) return saved
  return 'ct-crew'
}

function getInitialCatModule() {
  const saved = localStorage.getItem('fm_cat_module')
  if (saved && CAT_NAV.find(n => n.id === saved)) return saved
  return 'cat-list'
}

// ─── Placeholder for unbuilt pages ───────────────────────────────────────────

function UnderConstruction({ label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ fontSize: 32, opacity: 0.25 }}>🚧</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{label}</div>
      <div style={{ fontSize: 12, color: '#9ca3af' }}>Under construction</div>
    </div>
  )
}

// ─── Auth shell (handles session check, renders login or the real app) ────────

export default function App() {
  const { session, loading: authLoading, error: authError, signIn, signOut } = useAuthStore()

  // Detect invite token in URL (?invite=TOKEN)
  const inviteToken = new URLSearchParams(window.location.search).get('invite')

  if (session === undefined) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', color: '#9ca3af', fontSize: 14,
      }}>
        Loading…
      </div>
    )
  }

  // If there's a valid invite token and the user is authenticated (via magic link), show accept flow
  if (inviteToken && session) {
    return <AcceptInvite token={inviteToken} session={session} />
  }

  if (session === null) {
    return <Login onSignIn={signIn} loading={authLoading} error={authError} />
  }

  return <AppShell session={session} signOut={signOut} />
}

// ─── AppShell (all hooks live here, only rendered when authenticated) ─────────

function AppShell({ session, signOut }) {
  const [topTab,       setTopTab]       = useState(getInitialTopTab)
  const [setupModule,  setSetupModule]  = useState(getInitialSetupModule)
  const [fmModule,     setFmModule]     = useState(getInitialFmModule)
  const [ctModule,     setCtModule]     = useState(getInitialCtModule)
  const [catModule,    setCatModule]    = useState(getInitialCatModule)
  const [prodMenuOpen, setProdMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  function navigateTopTab(id) {
    setTopTab(id)
    localStorage.setItem('fm_top_tab', id)
    setProdMenuOpen(false)
  }

  function navigateSetup(id) {
    setSetupModule(id)
    localStorage.setItem('fm_setup_module', id)
  }

  function navigateFm(id) {
    setFmModule(id)
    localStorage.setItem('fm_current_module', id)
  }

  function navigateCt(id) {
    setCtModule(id)
    localStorage.setItem('fm_ct_module', id)
  }

  function navigateCat(id) {
    setCatModule(id)
    localStorage.setItem('fm_cat_module', id)
  }

  const {
    loading: schedLoading, error, store,
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
    addCastMember, deleteCastMember, updateCastMember, reorderCastMembers, importCastMembers,
  } = useScheduleStore()

  const { profile, memberRole, updateProfile } = useProfileStore(
    session.user.id,
    currentProductionId,
  )

  // Initials: prefer name from profile, fall back to email
  const initials = profile?.first_name && profile?.last_name
    ? (profile.first_name[0] + profile.last_name[0]).toUpperCase()
    : (session.user.email || 'U').slice(0, 2).toUpperCase()

  const loading = schedLoading

  const scheduleActions = {
    addShootDay, deleteShootDay, updateShootDay,
    addPrepDay, addSplinterDay,
    moveDayUp, moveDayDown, reorderDays,
    addScene, deleteScene, updateScene,
    updateSceneCast,
    addDayExtra, deleteDayExtra, updateDayExtra,
  }

  useEffect(() => {
    document.title = store.production.name
      ? `Football Manager — ${store.production.name}`
      : 'Football Manager'
  }, [store.production.name])

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

  // ── Derived state ──────────────────────────────────────────────────────────

  const isGantt     = topTab === 'fm' && fmModule === 'crew'
  const isCallsheet = topTab === 'fm' && fmModule === 'callsheet'

  // Hide Admin nav item from plain members
  const visibleSetupNav = SETUP_NAV.filter(n =>
    n.id !== 'setup-admin' || memberRole === 'owner' || memberRole === 'admin'
  )

  const activeNav = topTab === 'setup'
    ? visibleSetupNav
    : topTab === 'fm'
      ? FM_NAV
      : topTab === 'crew-times'
        ? CT_NAV
        : topTab === 'catering'
          ? CAT_NAV
          : []

  const activeModule = topTab === 'setup'
    ? setupModule
    : topTab === 'fm'
      ? fmModule
      : topTab === 'crew-times'
        ? ctModule
        : catModule

  function handleNavClick(id) {
    if (topTab === 'setup')      navigateSetup(id)
    if (topTab === 'fm')         navigateFm(id)
    if (topTab === 'crew-times') navigateCt(id)
    if (topTab === 'catering')   navigateCat(id)
  }

  const topbarEyebrow = (() => {
    if (topTab === 'setup')      return SETUP_NAV.find(n => n.id === setupModule)?.label ?? ''
    if (topTab === 'fm')         return FM_NAV.find(n => n.id === fmModule)?.label ?? ''
    if (topTab === 'crew-times') return CT_NAV.find(n => n.id === ctModule)?.label ?? ''
    if (topTab === 'catering')   return CAT_NAV.find(n => n.id === catModule)?.label ?? 'Catering'
    return ''
  })()

  const topbarSub = (() => {
    if (topTab === 'setup') return SETUP_MODULE_SUB[setupModule] ?? ''
    if (topTab === 'fm') {
      const base = FM_MODULE_SUB[fmModule] ?? ''
      return fmModule === 'schedule' && store.shootDays.length > 0
        ? `${base} · ${store.shootDays.length} days`
        : base
    }
    if (topTab === 'crew-times') return CT_MODULE_SUB[ctModule] ?? ''
    if (topTab === 'catering')   return CAT_MODULE_SUB[catModule] ?? ''
    return ''
  })()

  // ── Production menu handlers ───────────────────────────────────────────────

  async function handleCreateProduction() {
    setProdMenuOpen(false)
    const newId = await createProduction()
    if (!newId) return   // creation failed — stay where we are
    navigateTopTab('setup')
    navigateSetup('setup-main')
  }

  async function handleDeleteProduction(id) {
    if (productions.length <= 1) return
    const prod = productions.find(p => p.id === id)
    if (!window.confirm(`Delete "${prod?.name || 'this production'}"? This cannot be undone.`)) return
    setProdMenuOpen(false)
    await deleteProduction(id)
  }

  return (
    <div className="pm-app" onClick={() => { setProdMenuOpen(false); setUserMenuOpen(false) }}>

      {/* ── Top tab bar ─────────────────────────────────────────────────────── */}
      <nav className="pm-tab-bar" onClick={e => e.stopPropagation()}>
        <div className="pm-tab-bar-brand">
          <img src="/favicon.svg" alt="FM" className="pm-tab-bar-logo" />
        </div>
        <div className="pm-tab-bar-tabs">
          {TOP_TABS.map(tab => (
            <button
              key={tab.id}
              className={`pm-tab-btn${topTab === tab.id ? ' is-active' : ''}`}
              onClick={() => navigateTopTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Shell (sidebar + main) ───────────────────────────────────────────── */}
      <div className="pm-shell">

        {/* ── Sidebar ───────────────────────────────────────────────────────── */}
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
                <button className="sidebar-prod-new" onClick={handleCreateProduction}>
                  + New production
                </button>
              </div>
            )}
          </div>

          {/* Nav — changes per top tab */}
          <nav className="pm-sidebar-nav">
            {activeNav.map(item => (
              <div
                key={item.id}
                className={[
                  'pm-nav-item',
                  activeModule === item.id ? 'is-active' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => handleNavClick(item.id)}
              >
                {activeModule === item.id && <span className="pm-nav-rule" />}
                <span className="pm-nav-icon">{item.num}</span>
                {item.label}
              </div>
            ))}
          </nav>

          {/* Footer */}
          <div className="pm-sidebar-foot">
            <div className="pm-stamp">
              <div className="pm-stamp-line">Alpha v 0.1</div>
              <div className="pm-stamp-date">{__BUILD_DATE__}</div>
            </div>
            <div className="pm-foot-meta">
              {store.shootDays.filter(d => d.dayCategory === 'main' && !d.isNonShootDay).length} shoot day{store.shootDays.filter(d => d.dayCategory === 'main' && !d.isNonShootDay).length !== 1 ? 's' : ''}
              {store.castMembers?.length > 0 && ` · Cast ${store.castMembers.length}`}
            </div>
          </div>
        </aside>

        {/* ── Main ──────────────────────────────────────────────────────────── */}
        <div className="pm-main">
          <header className="pm-topbar">
            <div className="pm-topbar-l">
              <span className="pm-topbar-eyebrow">{topbarEyebrow}</span>
              <span className="pm-topbar-sub">{topbarSub}</span>
            </div>
            <div className="pm-topbar-r">
              <span className="pm-topbar-rev">{todayFull()}</span>

              {/* User avatar + dropdown */}
              <div
                className="pm-user-wrap"
                onClick={e => { e.stopPropagation(); setUserMenuOpen(o => !o) }}
              >
                <button className="pm-topbar-user" title={session.user.email}>
                  {initials}
                </button>

                {userMenuOpen && (
                  <div className="pm-user-menu" onClick={e => e.stopPropagation()}>
                    {(profile?.first_name || profile?.last_name) && (
                      <div className="pm-user-menu-name">
                        {[profile.first_name, profile.last_name].filter(Boolean).join(' ')}
                      </div>
                    )}
                    <div className="pm-user-menu-email">{session.user.email}</div>
                    <div className="pm-user-menu-sep" />
                    <button
                      className="pm-user-menu-item"
                      onClick={() => {
                        navigateTopTab('setup')
                        navigateSetup('setup-account')
                        setUserMenuOpen(false)
                      }}
                    >
                      Account settings
                    </button>
                    <button
                      className="pm-user-menu-item pm-user-menu-item--danger"
                      onClick={signOut}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className={`pm-content${isGantt ? ' pm-content--gantt' : ''}${isCallsheet ? ' pm-content--cs' : ''}`}>

            {/* ── Project Setup tab ─────────────────────────────────────────── */}
            {topTab === 'setup' && setupModule === 'setup-list' && (
              <ProjectListPage
                productions={productions}
                currentProductionId={currentProductionId}
                onSwitch={id => { switchProduction(id); setProdMenuOpen(false) }}
                onCreate={handleCreateProduction}
                memberRole={memberRole}
              />
            )}
            {topTab === 'setup' && setupModule === 'setup-main' && (
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
                onImportCastMembers={importCastMembers}
              />
            )}
            {topTab === 'setup' && setupModule === 'setup-account' && (
              <AccountPage
                session={session}
                profile={profile}
                onUpdateProfile={updateProfile}
              />
            )}
            {topTab === 'setup' && setupModule === 'setup-admin' && (
              <AdminPage
                currentProductionId={currentProductionId}
                session={session}
                memberRole={memberRole}
              />
            )}
            {topTab === 'setup' && setupModule === 'setup-settings' && (
              <UnderConstruction label="Settings" />
            )}

            {/* ── Football Manager tab ──────────────────────────────────────── */}
            {topTab === 'fm' && fmModule === 'schedule' && (
              <Schedule store={store} actions={scheduleActions} />
            )}
            {topTab === 'fm' && fmModule === 'crew' && (
              <CrewGantt production={store.production} shootDays={store.shootDays} />
            )}
            {topTab === 'fm' && fmModule === 'callsheet' && (
              <CallSheet store={store} castMembers={store.castMembers} />
            )}
            {topTab === 'fm' && fmModule === 'budget' && (
              <Budget store={store} onUpdate={updateProduction} />
            )}

            {/* ── Crew Times tab ────────────────────────────────────────────── */}
            {topTab === 'crew-times' && ctModule === 'ct-crew' && (
              <FulltimeCrew />
            )}
            {topTab === 'crew-times' && ctModule === 'ct-backpage' && (
              <Backpage store={store} />
            )}
            {topTab === 'crew-times' && ctModule === 'ct-timesheets' && (
              <Timesheets store={store} />
            )}

            {/* ── Catering tab ──────────────────────────────────────────────── */}
            {topTab === 'catering' && catModule === 'cat-list' && (
              <Catering store={store} />
            )}
            {topTab === 'catering' && catModule === 'cat-numbers' && (
              <CateringNumbers store={store} />
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
