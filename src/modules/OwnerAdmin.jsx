import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member' }
const ROLE_COLORS = {
  owner:  { bg: '#fef3c7', color: '#92400e' },
  admin:  { bg: '#ede9fe', color: '#5b21b6' },
  member: { bg: '#f0fdf4', color: '#166534' },
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── Owner Admin — app-owner-only, cross-production user & project management ──
export default function OwnerAdmin({ session }) {
  const [data,    setData]    = useState(null)   // { users, productions, memberships, invites }
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // Search / sort
  const [search, setSearch]   = useState('')
  const [sortBy, setSortBy]   = useState('name')      // name | email | projects | lastSeen
  const [filterProd, setFilterProd] = useState('all') // production id or 'all'

  // Assign-to-project inline form — userId being assigned
  const [assigning,   setAssigning]   = useState(null)
  const [assignProd,  setAssignProd]  = useState('')
  const [assignRole,  setAssignRole]  = useState('member')

  // Invite new user form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteProd,  setInviteProd]  = useState('')
  const [inviteRole,  setInviteRole]  = useState('member')
  const [inviting,    setInviting]    = useState(false)
  const [inviteResult, setInviteResult] = useState(null) // { ok, message }

  const [actionError, setActionError] = useState(null)

  const load = useCallback(async () => {
    const { data: d, error: err } = await supabase.rpc('owner_admin_data')
    if (err) { setError(err.message); setLoading(false); return }
    setData(d)
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const productions = data?.productions ?? []
  const prodById = useMemo(
    () => Object.fromEntries(productions.map(p => [p.id, p])),
    [productions]
  )

  // memberships grouped per user
  const membershipsByUser = useMemo(() => {
    const map = {}
    for (const m of data?.memberships ?? []) {
      ;(map[m.user_id] ??= []).push(m)
    }
    return map
  }, [data])

  const users = useMemo(() => {
    let rows = (data?.users ?? []).map(u => ({
      ...u,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || '—',
      memberships: membershipsByUser[u.id] ?? [],
    }))

    if (filterProd !== 'all') {
      rows = rows.filter(u => u.memberships.some(m => m.production_id === filterProd))
    }

    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(u =>
        u.name.toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        u.memberships.some(m => (prodById[m.production_id]?.name ?? '').toLowerCase().includes(q))
      )
    }

    const cmp = {
      name:     (a, b) => a.name.localeCompare(b.name),
      email:    (a, b) => (a.email ?? '').localeCompare(b.email ?? ''),
      projects: (a, b) => b.memberships.length - a.memberships.length,
      lastSeen: (a, b) => (b.last_sign_in_at ?? '').localeCompare(a.last_sign_in_at ?? ''),
    }[sortBy]
    return [...rows].sort(cmp)
  }, [data, membershipsByUser, prodById, search, sortBy, filterProd])

  const invites = useMemo(() => {
    let rows = data?.invites ?? []
    if (filterProd !== 'all') rows = rows.filter(i => i.production_id === filterProd)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(i =>
        i.email.toLowerCase().includes(q) ||
        (prodById[i.production_id]?.name ?? '').toLowerCase().includes(q)
      )
    }
    return rows
  }, [data, filterProd, search, prodById])

  // ── Actions ──────────────────────────────────────────────────────────────────
  async function run(fn) {
    setActionError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setActionError(err.message ?? String(err))
    }
  }

  const removeMember = (userId, prodId, label) => run(async () => {
    if (!window.confirm(`Remove ${label} from this project?`)) return
    const { error: err } = await supabase.rpc('owner_admin_remove_member', { p_user: userId, p_prod: prodId })
    if (err) throw err
  })

  const setMember = (userId, prodId, role) => run(async () => {
    const { error: err } = await supabase.rpc('owner_admin_set_member', { p_user: userId, p_prod: prodId, p_role: role })
    if (err) throw err
  })

  const setProductionDisabled = (prodId, disabled) => run(async () => {
    if (disabled && !window.confirm(`Disable "${prodById[prodId]?.name ?? 'this project'}"? It will disappear for everyone except you.`)) return
    const { error: err } = await supabase.rpc('owner_admin_set_production_disabled', { p_prod: prodId, p_disabled: disabled })
    if (err) throw err
  })

  const deleteInvite = (inviteId, label) => run(async () => {
    if (!window.confirm(`Revoke the invite for ${label}?`)) return
    const { error: err } = await supabase.rpc('owner_admin_delete_invite', { p_invite: inviteId })
    if (err) throw err
  })

  async function handleAssign(userId) {
    if (!assignProd) return
    await setMember(userId, assignProd, assignRole)
    setAssigning(null)
    setAssignProd('')
    setAssignRole('member')
  }

  async function handleInvite(e) {
    e.preventDefault()
    if (!inviteEmail.trim() || !inviteProd) return
    setInviting(true)
    setInviteResult(null)
    const { data: res, error: err } = await supabase.functions.invoke('send-invite', {
      body: { email: inviteEmail.trim().toLowerCase(), productionId: inviteProd, role: inviteRole },
    })
    let message = null
    if (err) {
      try { message = (await err.context?.json())?.error } catch { /* not json */ }
      message ??= err.message
    } else if (res?.error) {
      message = res.error
    }
    if (message) {
      setInviteResult({ ok: false, message })
    } else {
      setInviteResult({ ok: true, message: `Invite sent to ${inviteEmail.trim()}.` })
      setInviteEmail('')
      load()
    }
    setInviting(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) return <div className="admin-page"><p className="admin-loading">Loading…</p></div>
  if (error) {
    return (
      <div className="admin-page">
        <div className="admin-send-result admin-send-result--err">{error}</div>
      </div>
    )
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1 className="admin-title">Owner Admin</h1>
        <p className="admin-subtitle">
          Every user and project across the app. Only you can see this page.
        </p>
      </div>

      {actionError && (
        <div className="admin-send-result admin-send-result--err" style={{ marginBottom: 12 }}>
          {actionError}
        </div>
      )}

      {/* ── Invite new user ──────────────────────────────────────────────────── */}
      <div className="admin-section">
        <h2 className="admin-section-title">Add a User</h2>
        <form className="admin-invite-form" onSubmit={handleInvite}>
          <input
            className="admin-invite-input"
            type="email"
            placeholder="email@example.com"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            required
          />
          <select
            className="admin-invite-role"
            value={inviteProd}
            onChange={e => setInviteProd(e.target.value)}
            required
          >
            <option value="">Project…</option>
            {productions.map(p => (
              <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>
            ))}
          </select>
          <select
            className="admin-invite-role"
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value)}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button className="admin-invite-btn" type="submit" disabled={inviting}>
            {inviting ? 'Sending…' : 'Send Invite'}
          </button>
        </form>
        {inviteResult && (
          <div className={`admin-send-result admin-send-result--${inviteResult.ok ? 'ok' : 'err'}`}>
            {inviteResult.message}
          </div>
        )}
      </div>

      <div className="admin-divider" />

      {/* ── Users ─────────────────────────────────────────────────────────────── */}
      <div className="admin-section">
        <h2 className="admin-section-title">Users ({users.length})</h2>

        <div className="owner-admin-toolbar">
          <input
            className="admin-invite-input owner-admin-search"
            type="search"
            placeholder="Search by name, email or project…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className="admin-invite-role"
            value={filterProd}
            onChange={e => setFilterProd(e.target.value)}
            title="Filter by project"
          >
            <option value="all">All projects</option>
            {productions.map(p => (
              <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>
            ))}
          </select>
          <select
            className="admin-invite-role"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            title="Sort"
          >
            <option value="name">Sort: Name</option>
            <option value="email">Sort: Email</option>
            <option value="projects">Sort: # Projects</option>
            <option value="lastSeen">Sort: Last seen</option>
          </select>
        </div>

        <div className="admin-member-list">
          {users.map(u => {
            const isSelf = u.id === session.user.id
            return (
              <div key={u.id} className="admin-member-block">
                <div className="admin-member-row owner-admin-row">
                  <div className="admin-member-avatar">
                    {u.first_name?.[0]?.toUpperCase() ?? u.email?.[0]?.toUpperCase() ?? '?'}
                    {u.last_name?.[0]?.toUpperCase() ?? ''}
                  </div>
                  <div className="admin-member-info">
                    <div className="admin-member-name">
                      {u.name}
                      <span className="admin-member-email">{u.email}</span>
                      {u.is_owner && (
                        <span className="admin-role-badge" style={{ background: '#fef3c7', color: '#92400e' }}>
                          App Owner
                        </span>
                      )}
                      {isSelf && <span className="admin-member-you">You</span>}
                    </div>
                    <div className="owner-admin-meta">
                      Last seen {fmtDate(u.last_sign_in_at)} · Joined {fmtDate(u.created_at)}
                    </div>
                    <div className="owner-admin-projects">
                      {u.memberships.length === 0 && (
                        <span className="owner-admin-noproj">No projects</span>
                      )}
                      {u.memberships.map(m => {
                        const prod = prodById[m.production_id]
                        const rc = ROLE_COLORS[m.role] ?? ROLE_COLORS.member
                        return (
                          <span
                            key={m.production_id}
                            className={`owner-admin-chip${prod?.disabled ? ' is-disabled' : ''}`}
                          >
                            <span className="owner-admin-chip-name">{prod?.name ?? '?'}</span>
                            <select
                              className="owner-admin-chip-role"
                              value={m.role}
                              style={{ background: rc.bg, color: rc.color }}
                              onChange={e => setMember(u.id, m.production_id, e.target.value)}
                              title="Change role on this project"
                            >
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                              <option value="owner">Owner</option>
                            </select>
                            <button
                              className="owner-admin-chip-x"
                              onClick={() => removeMember(u.id, m.production_id, isSelf ? 'YOURSELF' : (u.name !== '—' ? u.name : u.email))}
                              title="Remove from this project"
                            >✕</button>
                          </span>
                        )
                      })}
                      {assigning === u.id ? (
                        <span className="owner-admin-assign">
                          <select
                            className="admin-invite-role"
                            value={assignProd}
                            onChange={e => setAssignProd(e.target.value)}
                          >
                            <option value="">Project…</option>
                            {productions
                              .filter(p => !u.memberships.some(m => m.production_id === p.id))
                              .map(p => (
                                <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>
                              ))}
                          </select>
                          <select
                            className="admin-invite-role"
                            value={assignRole}
                            onChange={e => setAssignRole(e.target.value)}
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                            <option value="owner">Owner</option>
                          </select>
                          <button className="admin-confirm-yes" onClick={() => handleAssign(u.id)}>Add</button>
                          <button className="admin-confirm-no" onClick={() => setAssigning(null)}>Cancel</button>
                        </span>
                      ) : (
                        <button
                          className="owner-admin-addproj"
                          onClick={() => { setAssigning(u.id); setAssignProd(''); setAssignRole('member') }}
                        >
                          + Assign project
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="admin-divider" />

      {/* ── Pending invites ───────────────────────────────────────────────────── */}
      <div className="admin-section">
        <h2 className="admin-section-title">Pending Invites ({invites.length})</h2>
        {invites.length === 0 ? (
          <p className="admin-empty">No pending invites.</p>
        ) : (
          <div className="admin-member-list">
            {invites.map(i => (
              <div key={i.id} className="admin-member-row">
                <div className="admin-member-info">
                  <div className="admin-member-name">
                    {i.email}
                    <span className="admin-member-email">
                      {prodById[i.production_id]?.name ?? '?'} · {ROLE_LABELS[i.role] ?? i.role} · expires {fmtDate(i.expires_at)}
                    </span>
                  </div>
                </div>
                <button
                  className="admin-member-remove"
                  onClick={() => deleteInvite(i.id, i.email)}
                  title="Revoke invite"
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="admin-divider" />

      {/* ── Projects ──────────────────────────────────────────────────────────── */}
      <div className="admin-section">
        <h2 className="admin-section-title">Projects ({productions.length})</h2>
        <div className="admin-member-list">
          {productions.map(p => {
            const memberCount = (data?.memberships ?? []).filter(m => m.production_id === p.id).length
            return (
              <div key={p.id} className={`admin-member-row${p.disabled ? ' owner-admin-prod-disabled' : ''}`}>
                <div className="admin-member-info">
                  <div className="admin-member-name">
                    {p.name || 'Untitled'}
                    {p.disabled && (
                      <span className="admin-role-badge" style={{ background: '#fee2e2', color: '#991b1b' }}>
                        Disabled
                      </span>
                    )}
                    <span className="admin-member-email">{memberCount} member{memberCount === 1 ? '' : 's'}</span>
                  </div>
                </div>
                <button
                  className={p.disabled ? 'admin-confirm-yes' : 'admin-member-remove owner-admin-disable-btn'}
                  onClick={() => setProductionDisabled(p.id, !p.disabled)}
                  title={p.disabled ? 'Re-enable this project' : 'Disable this project (hidden from non-owners)'}
                >
                  {p.disabled ? 'Enable' : 'Disable'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
