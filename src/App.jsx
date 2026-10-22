import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { roleAllowsModule } from './lib/permissionRegistry'
import { useScheduleStore }  from './store/useScheduleStore'
import { useAuthStore }      from './store/useAuthStore'
import { useProfileStore }   from './store/useProfileStore'
import LandingPage           from './modules/LandingPage'
import Login                 from './modules/Login'
import RequestInvite         from './modules/RequestInvite'
import AcceptInvite          from './modules/AcceptInvite'
import SetNewPassword        from './modules/SetNewPassword'
import InviteRequestsPage    from './modules/InviteRequestsPage'
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
import OwnerAdmin            from './modules/OwnerAdmin'
import HotelList             from './modules/HotelList'
import CrewHotels            from './modules/CrewHotels'
import WeeklyTMO             from './modules/WeeklyTMO'
import TravelTimes           from './modules/TravelTimes'
import CrewDatabase          from './modules/CrewDatabase'
import NewStarters           from './modules/NewStarters'
import DPR                   from './modules/DPR'
import WrapReport            from './modules/WrapReport'

// ─── Top-level tab definitions ────────────────────────────────────────────────

const TOP_TABS = [
  { id: 'setup',      label: 'Admin'            },
  { id: 'fm',         label: 'Football Manager' },
  { id: 'crew-times', label: 'Crew'             },
  { id: 'catering',   label: 'Catering'         },
  { id: 'accomm',     label: 'Accommodation'    },
  { id: 'dpr',        label: 'DPR'              },
]

// ─── Project Setup nav ────────────────────────────────────────────────────────

const SETUP_NAV = [
  { id: 'setup-list',     num: '01', label: 'Project List'    },
  { id: 'setup-main',     num: '02', label: 'Project Setup'   },
  { id: 'setup-account',  num: '03', label: 'Account'         },
  { id: 'setup-settings', num: '04', label: 'Settings'        },
  { id: 'setup-admin',    num: '05', label: 'User Management' },
  { id: 'setup-requests', num: '06', label: 'Invite Requests' },
  { id: 'setup-owner',    num: '07', label: 'Owner Admin'     },
]

const SETUP_MODULE_SUB = {
  'setup-list':     'All productions',
  'setup-main':     'Production setup',
  'setup-account':  'User account',
  'setup-settings': 'App settings',
  'setup-admin':    'User management',
  'setup-requests': 'Invite requests',
  'setup-owner':    'All users & projects',
}

// ─── Football Manager nav ─────────────────────────────────────────────────────

const FM_NAV = [
  { id: 'schedule',  num: '01', label: 'Schedule'         },
  { id: 'crew',      num: '02', label: 'Equipment'        },
  { id: 'callsheet', num: '03', label: 'Daily Info'       },
  { id: 'budget',    num: '04', label: 'Cost Tracking'    },
  { id: 'crew-db',   num: '05', label: 'Crew Database'    },
]

const FM_MODULE_SUB = {
  schedule:  'Shooting board',
  crew:      'Equipment booking gantt',
  callsheet: 'Call sheet',
  budget:    'Cost tracking',
  'crew-db': 'Cross-production people roster',
}

// ─── Accommodation nav ────────────────────────────────────────────────────────

const ACCOMM_NAV = [
  { id: 'accomm-hotels',  num: '01', label: 'Hotel List'          },
  { id: 'accomm-crew',    num: '02', label: 'Accommodation Log'    },
  { id: 'accomm-tmo',     num: '03', label: 'Weekly TMO'          },
  { id: 'accomm-travel',  num: '04', label: 'Travel Times'        },
]

const ACCOMM_MODULE_SUB = {
  'accomm-hotels': 'Hotel list',
  'accomm-crew':   'Accommodation log — stays & nights',
  'accomm-tmo':    'Weekly TMO',
  'accomm-travel': 'Hotel → location travel times',
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
  { id: 'ct-tracker',    num: '02', label: 'Crew Tracker'  },
  { id: 'ct-backpage',   num: '03', label: 'Backpage'      },
  { id: 'ct-timesheets', num: '04', label: 'Timesheets'    },
  { id: 'ct-starters',   num: '05', label: 'New Starters'  },
]

const CT_MODULE_SUB = {
  'ct-crew':       'Full-time crew list',
  'ct-tracker':    'Full-time & additional crew gantt',
  'ct-backpage':   'Daily back page',
  'ct-timesheets': 'Weekly timesheets',
  'ct-starters':   'Weekly new starter onboarding',
}

// ─── DPR nav ──────────────────────────────────────────────────────────────────

const DPR_NAV = [
  { id: 'dpr-main', num: '01', label: 'DPR'         },
  { id: 'dpr-wrap', num: '02', label: 'Wrap Report' },
]

const DPR_MODULE_SUB = {
  'dpr-main': 'Daily Production Report',
  'dpr-wrap': 'Wrap Report',
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

function getInitialDprModule() {
  const saved = localStorage.getItem('fm_dpr_module')
  if (saved && DPR_NAV.find(n => n.id === saved)) return saved
  return 'dpr-main'
}

function getInitialAccommModule() {
  const saved = localStorage.getItem('fm_accomm_module')
  if (saved && ACCOMM_NAV.find(n => n.id === saved)) return saved
  return 'accomm-hotels'
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
  const { session, passwordRecovery, loading: authLoading, error: authError, signIn, signOut } = useAuthStore()
  const [unauthView, setUnauthView] = useState('landing')

  // Detect invite token in URL (?invite=TOKEN)
  const inviteToken = new URLSearchParams(window.location.search).get('invite')

  // The magic-link redirect can drop the ?invite= param, leaving the user
  // signed in but never shown the accept screen. Fall back to any pending
  // invite matching their email (RLS lets them read their own invites).
  const [pendingInviteToken, setPendingInviteToken] = useState(null)
  useEffect(() => {
    if (!session?.user?.email || inviteToken) return
    let cancelled = false
    async function checkPendingInvite() {
      const { data: invs } = await supabase
        .from('invites')
        .select('token, production_id')
        .eq('email', session.user.email.toLowerCase())
        .eq('accepted', false)
        .gte('expires_at', new Date().toISOString())
      if (!invs?.length) return
      const { data: mems } = await supabase
        .from('production_members')
        .select('production_id')
        .eq('user_id', session.user.id)
      const memberOf = new Set((mems ?? []).map(m => m.production_id))
      const inv = invs.find(i => !memberOf.has(i.production_id))
      if (inv && !cancelled) setPendingInviteToken(inv.token)
    }
    checkPendingInvite()
    return () => { cancelled = true }
  }, [session, inviteToken])

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

  // Password-reset link was clicked — show "set new password" screen
  // (must come before the invite check so the recovery flow is never skipped)
  if (session && passwordRecovery) {
    return <SetNewPassword />
  }

  // If there's a valid invite token and the user is authenticated (via magic link), show accept flow
  if ((inviteToken || pendingInviteToken) && session) {
    return <AcceptInvite token={inviteToken ?? pendingInviteToken} session={session} />
  }

  if (session === null) {
    if (unauthView === 'request-invite') {
      return <RequestInvite onBack={() => setUnauthView('landing')} />
    }
    if (unauthView === 'login') {
      return (
        <Login
          onSignIn={signIn}
          loading={authLoading}
          error={authError}
          onBack={() => setUnauthView('landing')}
        />
      )
    }
    return (
      <LandingPage
        onLogin={() => setUnauthView('login')}
        onRequestInvite={() => setUnauthView('request-invite')}
      />
    )
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
  const [dprModule,    setDprModule]    = useState(getInitialDprModule)
  const [accommModule, setAccommModule] = useState(getInitialAccommModule)
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

  function navigateDpr(id) {
    setDprModule(id)
    localStorage.setItem('fm_dpr_module', id)
  }

  function navigateAccomm(id) {
    setAccommModule(id)
    localStorage.setItem('fm_accomm_module', id)
  }

  const {
    loading: schedLoading, error, store,
    productions, currentProductionId,
    createProduction, deleteProduction, switchProduction,
    updateProduction,
    generateShootDays,
    addShootDay, deleteShootDay, deleteAllShootDays, updateShootDay,
    addPrepDay, addSplinterDay,
    moveDayUp, moveDayDown, reorderDays,
    executeScheduleMove, resequenceDayNumbers,
    addScene, deleteScene, updateScene,
    updateSceneCast,
    addDayExtra, deleteDayExtra, updateDayExtra,
    addCastMember, deleteCastMember, updateCastMember, reorderCastMembers, importCastMembers,
    applyScheduleImport, applyCastListImport,
  } = useScheduleStore()

  const { profile, memberRole, permissions, updateProfile } = useProfileStore(
    session.user.id,
    currentProductionId,
  )

  // ── Per-user UI permissions (stored as denials; owners bypass) ──────────────
  const isOwner       = memberRole === 'owner'
  const deniedTabs    = new Set(isOwner ? [] : permissions.deniedTabs)
  const deniedModules = new Set(isOwner ? [] : permissions.deniedModules)
  const canViewRates  = isOwner || !permissions.denyCrewRates

  // Hide role-gated nav (User Management, Invite Requests) — shared with the
  // Admin permissions panel via the registry. Owner Admin is gated on the
  // app-wide owner flag (profiles.is_owner), not the per-production role.
  const visibleSetupNav = SETUP_NAV.filter(n => {
    if (n.id === 'setup-owner') return profile?.is_owner === true
    return roleAllowsModule(memberRole, n.id)
  })

  // Disabled projects are hidden from everyone except the app owner.
  const isAppOwner = profile?.is_owner === true
  const visibleProductions = isAppOwner ? productions : productions.filter(p => !p.disabled)

  // If the current production was disabled under a non-owner, move them to a
  // visible one.
  useEffect(() => {
    if (isAppOwner || productions.length === 0) return
    const current = productions.find(p => p.id === currentProductionId)
    if (current?.disabled && visibleProductions.length > 0) {
      switchProduction(visibleProductions[0].id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAppOwner, productions, currentProductionId])

  const allowedTopTabs   = TOP_TABS.filter(t => !deniedTabs.has(t.id))
  const allowedSetupNav  = visibleSetupNav.filter(n => !deniedModules.has(n.id))
  const allowedFmNav     = FM_NAV.filter(n => !deniedModules.has(n.id))
  const allowedCtNav     = CT_NAV.filter(n => !deniedModules.has(n.id))
  const allowedCatNav    = CAT_NAV.filter(n => !deniedModules.has(n.id))
  const allowedAccommNav = ACCOMM_NAV.filter(n => !deniedModules.has(n.id))
  const allowedDprNav    = DPR_NAV.filter(n => !deniedModules.has(n.id))

  // Never-stuck guarantee: if everything is denied, the Account page stays reachable.
  const effTopTabs  = allowedTopTabs.length > 0
    ? allowedTopTabs
    : [TOP_TABS.find(t => t.id === 'setup')]
  const effSetupNav = allowedSetupNav.length > 0
    ? allowedSetupNav
    : SETUP_NAV.filter(n => n.id === 'setup-account')

  const navByTab = {
    setup:        effSetupNav,
    fm:           allowedFmNav,
    'crew-times': allowedCtNav,
    catering:     allowedCatNav,
    accomm:       allowedAccommNav,
    dpr:          allowedDprNav,
  }
  const moduleStateByTab = {
    setup:        setupModule,
    fm:           fmModule,
    'crew-times': ctModule,
    catering:     catModule,
    accomm:       accommModule,
    dpr:          dprModule,
  }

  // Effective tab/module used for rendering — never points at a denied target,
  // even on the first render after load / production switch.
  const effTopTab = effTopTabs.some(t => t.id === topTab) ? topTab : effTopTabs[0].id
  const effNav    = navByTab[effTopTab] ?? []
  const effModule = effNav.some(n => n.id === moduleStateByTab[effTopTab])
    ? moduleStateByTab[effTopTab]
    : (effNav[0]?.id ?? null)

  // Sync persisted state back to the effective (allowed) values — covers stale
  // localStorage and permission changes on production switches.
  useEffect(() => {
    if (effTopTab !== topTab) navigateTopTab(effTopTab)
    if (effModule && effModule !== moduleStateByTab[effTopTab]) {
      if (effTopTab === 'setup')      navigateSetup(effModule)
      if (effTopTab === 'fm')         navigateFm(effModule)
      if (effTopTab === 'crew-times') navigateCt(effModule)
      if (effTopTab === 'catering')   navigateCat(effModule)
      if (effTopTab === 'accomm')     navigateAccomm(effModule)
      if (effTopTab === 'dpr')        navigateDpr(effModule)
    }
  })

  // Initials: prefer name from profile, fall back to email
  const initials = profile?.first_name && profile?.last_name
    ? (profile.first_name[0] + profile.last_name[0]).toUpperCase()
    : (session.user.email || 'U').slice(0, 2).toUpperCase()

  const loading = schedLoading

  const scheduleActions = {
    addShootDay, deleteShootDay, updateShootDay,
    addPrepDay, addSplinterDay,
    moveDayUp, moveDayDown, reorderDays,
    executeScheduleMove, resequenceDayNumbers,
    addScene, deleteScene, updateScene,
    updateSceneCast,
    addDayExtra, deleteDayExtra, updateDayExtra,
    applyScheduleImport,
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

  const isGantt     = (effTopTab === 'fm' && effModule === 'crew') ||
                      (effTopTab === 'crew-times' && effModule === 'ct-tracker')
  const isCallsheet = effTopTab === 'fm' && effModule === 'callsheet'

  const activeNav    = effNav
  const activeModule = effModule

  function handleNavClick(id) {
    if (effTopTab === 'setup')      navigateSetup(id)
    if (effTopTab === 'fm')         navigateFm(id)
    if (effTopTab === 'crew-times') navigateCt(id)
    if (effTopTab === 'catering')   navigateCat(id)
    if (effTopTab === 'dpr')        navigateDpr(id)
    if (effTopTab === 'accomm')     navigateAccomm(id)
  }

  const topbarEyebrow = (() => {
    if (effTopTab === 'setup')      return SETUP_NAV.find(n => n.id === effModule)?.label ?? ''
    if (effTopTab === 'fm')         return FM_NAV.find(n => n.id === effModule)?.label ?? ''
    if (effTopTab === 'crew-times') return CT_NAV.find(n => n.id === effModule)?.label ?? ''
    if (effTopTab === 'catering')   return CAT_NAV.find(n => n.id === effModule)?.label ?? 'Catering'
    if (effTopTab === 'accomm')     return ACCOMM_NAV.find(n => n.id === effModule)?.label ?? 'Accommodation'
    if (effTopTab === 'dpr')        return DPR_NAV.find(n => n.id === effModule)?.label ?? 'DPR'
    return ''
  })()

  const topbarSub = (() => {
    if (effTopTab === 'setup') return SETUP_MODULE_SUB[effModule] ?? ''
    if (effTopTab === 'fm') {
      const base = FM_MODULE_SUB[effModule] ?? ''
      return effModule === 'schedule' && store.shootDays.length > 0
        ? `${base} · ${store.shootDays.length} days`
        : base
    }
    if (effTopTab === 'crew-times') return CT_MODULE_SUB[effModule] ?? ''
    if (effTopTab === 'catering')   return CAT_MODULE_SUB[effModule] ?? ''
    if (effTopTab === 'accomm')     return ACCOMM_MODULE_SUB[effModule] ?? ''
    if (effTopTab === 'dpr')        return DPR_MODULE_SUB[effModule] ?? ''
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
          {effTopTabs.map(tab => (
            <button
              key={tab.id}
              className={`pm-tab-btn${effTopTab === tab.id ? ' is-active' : ''}`}
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
                {visibleProductions.map(p => (
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
                      {p.disabled && ' (disabled)'}
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
            {effTopTab === 'setup' && effModule === 'setup-list' && (
              <ProjectListPage
                productions={visibleProductions}
                currentProductionId={currentProductionId}
                onSwitch={id => { switchProduction(id); setProdMenuOpen(false) }}
                onCreate={handleCreateProduction}
                onDelete={deleteProduction}
                memberRole={memberRole}
                userId={session.user.id}
              />
            )}
            {effTopTab === 'setup' && effModule === 'setup-main' && (
              <ProjectSetup
                production={store.production}
                shootDays={store.shootDays}
                castMembers={store.castMembers}
                onUpdate={updateProduction}
                onGenerate={generateShootDays}
                onDeleteAllShootDays={deleteAllShootDays}
                onAddCastMember={addCastMember}
                onDeleteCastMember={deleteCastMember}
                onUpdateCastMember={updateCastMember}
                onReorderCastMembers={reorderCastMembers}
                onImportCastMembers={importCastMembers}
                onApplyCastListImport={applyCastListImport}
              />
            )}
            {effTopTab === 'setup' && effModule === 'setup-account' && (
              <AccountPage
                session={session}
                profile={profile}
                onUpdateProfile={updateProfile}
              />
            )}
            {effTopTab === 'setup' && effModule === 'setup-admin' && (
              <AdminPage
                currentProductionId={currentProductionId}
                productionName={store.production.name}
                session={session}
                memberRole={memberRole}
              />
            )}
            {effTopTab === 'setup' && effModule === 'setup-settings' && (
              <UnderConstruction label="Settings" />
            )}
            {effTopTab === 'setup' && effModule === 'setup-owner' && (
              <OwnerAdmin session={session} />
            )}
            {effTopTab === 'setup' && effModule === 'setup-requests' && (
              <InviteRequestsPage
                productions={productions}
                currentProductionId={currentProductionId}
                memberRole={memberRole}
              />
            )}

            {/* ── Football Manager tab ──────────────────────────────────────── */}
            {effTopTab === 'fm' && effModule === 'schedule' && (
              <Schedule store={store} actions={scheduleActions} />
            )}
            {effTopTab === 'fm' && effModule === 'crew' && (
              <CrewGantt production={store.production} shootDays={store.shootDays} mode="equipment" onUpdateProduction={updateProduction} canViewRates={canViewRates} />
            )}
            {effTopTab === 'fm' && effModule === 'callsheet' && (
              <CallSheet store={store} castMembers={store.castMembers} />
            )}
            {effTopTab === 'fm' && effModule === 'budget' && (
              <Budget store={store} onUpdate={updateProduction} />
            )}
            {effTopTab === 'fm' && effModule === 'crew-db' && (
              <CrewDatabase />
            )}

            {/* ── Crew Times tab ────────────────────────────────────────────── */}
            {effTopTab === 'crew-times' && effModule === 'ct-crew' && (
              <FulltimeCrew productionName={store.production.name} />
            )}
            {effTopTab === 'crew-times' && effModule === 'ct-tracker' && (
              <CrewGantt production={store.production} shootDays={store.shootDays} mode="crew" onUpdateProduction={updateProduction} canViewRates={canViewRates} />
            )}
            {effTopTab === 'crew-times' && effModule === 'ct-backpage' && (
              <Backpage store={store} />
            )}
            {effTopTab === 'crew-times' && effModule === 'ct-timesheets' && (
              <Timesheets store={store} />
            )}
            {effTopTab === 'crew-times' && effModule === 'ct-starters' && (
              <NewStarters />
            )}

            {/* ── Catering tab ──────────────────────────────────────────────── */}
            {effTopTab === 'catering' && effModule === 'cat-list' && (
              <Catering store={store} />
            )}
            {effTopTab === 'catering' && effModule === 'cat-numbers' && (
              <CateringNumbers store={store} />
            )}

            {/* ── Accommodation tab ─────────────────────────────────────────── */}
            {effTopTab === 'accomm' && effModule === 'accomm-hotels' && (
              <HotelList />
            )}
            {effTopTab === 'accomm' && effModule === 'accomm-crew' && (
              <CrewHotels
                production={store.production}
                shootDays={store.shootDays}
                castMembers={store.castMembers}
              />
            )}
            {effTopTab === 'accomm' && effModule === 'accomm-tmo' && (
              <WeeklyTMO
                production={store.production}
                castMembers={store.castMembers}
              />
            )}
            {effTopTab === 'accomm' && effModule === 'accomm-travel' && (
              <TravelTimes shootDays={store.shootDays} />
            )}

            {/* ── DPR tab ───────────────────────────────────────────────────── */}
            {effTopTab === 'dpr' && effModule === 'dpr-main' && (
              <DPR
                productionName={store.production.name}
                shootDays={store.shootDays}
                castMembers={store.castMembers}
              />
            )}
            {effTopTab === 'dpr' && effModule === 'dpr-wrap' && (
              <WrapReport
                productionName={store.production.name}
                shootDays={store.shootDays}
              />
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
