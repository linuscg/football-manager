import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  PERMISSION_TABS, FEATURE_FLAGS, ROLE_GATED_MODULES,
  normalizePermissions, cleanPermissions, roleAllowsModule,
} from '../lib/permissionRegistry'

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member' }
const ROLE_COLORS = {
  owner:  { bg: '#fef3c7', color: '#92400e' },
  admin:  { bg: '#ede9fe', color: '#5b21b6' },
  member: { bg: '#f0fdf4', color: '#166534' },
}

// ─── Per-member UI permissions panel ──────────────────────────────────────────
// Checkboxes mean "can see" — everything checked by default. Unchecking stores a
// denial on production_members.permissions (deniedTabs / deniedModules /
// denyCrewRates), so an empty permissions object = full visibility.
function PermissionsPanel({ perms, role, onChange }) {
  const deniedTabs    = new Set(perms.deniedTabs)
  const deniedModules = new Set(perms.deniedModules)

  function emit(next) {
    onChange(normalizePermissions(cleanPermissions(next)))
  }

  function toggleTab(tabId) {
    const next = new Set(deniedTabs)
    if (next.has(tabId)) next.delete(tabId)
    else next.add(tabId)
    emit({ ...perms, deniedTabs: [...next] })
  }

  function toggleModule(moduleId) {
    const next = new Set(deniedModules)
    if (next.has(moduleId)) next.delete(moduleId)
    else next.add(moduleId)
    emit({ ...perms, deniedModules: [...next] })
  }

  function toggleFlag(flagId) {
    emit({ ...perms, [flagId]: !perms[flagId] })
  }

  return (
    <div className="admin-perms-panel" onClick={e => e.stopPropagation()}>
      <div className="admin-perms-caption">
        Visibility — unchecked tabs and modules are hidden from this user.
        Greyed items are controlled by their role ({ROLE_LABELS[role] ?? role}); change the role to change those.
      </div>
      <div className="admin-perms-grid">
        {PERMISSION_TABS.map(tab => {
          const tabVisible = !deniedTabs.has(tab.id)
          return (
            <div key={tab.id} className="admin-perms-tab">
              <label className="admin-perms-tab-head">
                <input
                  type="checkbox"
                  checked={tabVisible}
                  onChange={() => toggleTab(tab.id)}
                />
                <span>{tab.label}</span>
              </label>
              <div className={`admin-perms-modules${tabVisible ? '' : ' is-disabled'}`}>
                {tab.modules.map(m => {
                  // Modules the member's role blocks outright (e.g. User
                  // Management for non-admins) show locked, not grantable.
                  const roleBlocked = !roleAllowsModule(role, m.id)
                  return (
                    <label
                      key={m.id}
                      className={`admin-perms-module${roleBlocked ? ' is-role-locked' : ''}`}
                      title={roleBlocked ? `Granted by role — ${ROLE_GATED_MODULES[m.id].label.toLowerCase()}` : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={roleBlocked ? false : !deniedModules.has(m.id)}
                        disabled={!tabVisible || roleBlocked}
                        onChange={() => toggleModule(m.id)}
                      />
                      <span>{m.label}</span>
                      {roleBlocked && (
                        <span className="admin-perms-rolelock">
                          {ROLE_GATED_MODULES[m.id].label}
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className="admin-perms-flags">
        {FEATURE_FLAGS.map(f => (
          <label key={f.id} className="admin-perms-flag" title={f.hint}>
            <input
              type="checkbox"
              checked={!perms[f.id]}
              onChange={() => toggleFlag(f.id)}
            />
            <span>{f.label}</span>
            <span className="admin-perms-hint">{f.hint}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

export default function AdminPage({ currentProductionId, productionName, session, memberRole }) {
  const canAdmin = memberRole === 'owner' || memberRole === 'admin'

  const [members,    setMembers]    = useState([])
  const [invites,    setInvites]    = useState([])
  const [dataLoading, setDataLoading] = useState(true)

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole,  setInviteRole]  = useState('member')
  const [sending,     setSending]     = useState(false)
  const [sendResult,  setSendResult]  = useState(null) // { ok, message }

  // Inline remove confirmation — stores the userId being confirmed
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [removeError,   setRemoveError]   = useState(null)

  // Permissions accordion — userId of the expanded member (one at a time)
  const [expandedMember, setExpandedMember] = useState(null)
  const [permsError,     setPermsError]     = useState(null)

  // ── Fetch members + pending invites ─────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!currentProductionId) return
    setDataLoading(true)

    // Members
    const { data: memberRows } = await supabase
      .from('production_members')
      .select('user_id, role, permissions')
      .eq('production_id', currentProductionId)

    // Profiles + auth emails (via admin-only RPC) for those users
    const userIds = (memberRows ?? []).map(m => m.user_id)
    let profileMap = {}
    let emailMap   = {}
    if (userIds.length > 0) {
      const [{ data: profileRows }, { data: emailRows }] = await Promise.all([
        supabase.from('profiles').select('id, first_name, last_name').in('id', userIds),
        supabase.rpc('get_member_emails', { prod_id: currentProductionId }),
      ])
      ;(profileRows ?? []).forEach(p => { profileMap[p.id] = p })
      ;(emailRows ?? []).forEach(r => { emailMap[r.user_id] = r.email })
    }

    setMembers(
      (memberRows ?? []).map(m => ({
        ...m,
        profile: profileMap[m.user_id] ?? null,
        email:   emailMap[m.user_id] ?? null,
      }))
    )

    // Pending invites for this production
    const { data: inviteRows } = await supabase
      .from('invites')
      .select('id, email, role, expires_at, accepted, created_at')
      .eq('production_id', currentProductionId)
      .order('created_at', { ascending: false })

    setInvites(inviteRows ?? [])
    setDataLoading(false)
  }, [currentProductionId])

  useEffect(() => { loadData() }, [loadData])

  // The generic invoke error hides the function's real message — read it from
  // the response body in error.context when present.
  async function fnErrorMessage(error, fallback) {
    try {
      const body = await error?.context?.json()
      if (body?.error) return body.error
    } catch { /* body not JSON or already consumed */ }
    return error?.message ?? fallback
  }

  // ── Send invite ──────────────────────────────────────────────────────────────
  async function handleSendInvite(e) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setSending(true)
    setSendResult(null)

    const { data, error } = await supabase.functions.invoke('send-invite', {
      body: {
        email:        inviteEmail.trim().toLowerCase(),
        productionId: currentProductionId,
        role:         inviteRole,
      },
    })

    if (error || data?.error) {
      const message = error
        ? await fnErrorMessage(error, 'Failed to send invite.')
        : data?.error ?? 'Failed to send invite.'
      setSendResult({ ok: false, message })
    } else {
      setSendResult({ ok: true, message: `Invite sent to ${inviteEmail.trim()}.` })
      setInviteEmail('')
      setInviteRole('member')
      setTimeout(() => setSendResult(null), 4000)
      loadData()
    }
    setSending(false)
  }

  // ── Cancel invite ────────────────────────────────────────────────────────────
  async function handleCancelInvite(inviteId) {
    await supabase.from('invites').delete().eq('id', inviteId)
    loadData()
  }

  // ── Resend invite ─────────────────────────────────────────────────────────────
  const [resending, setResending] = useState({}) // inviteId → bool
  const [resendResult, setResendResult] = useState({}) // inviteId → { ok, message }

  async function handleResendInvite(inv) {
    setResending(r => ({ ...r, [inv.id]: true }))
    setResendResult(r => ({ ...r, [inv.id]: null }))

    // Delete the old invite row first so a fresh one gets created
    await supabase.from('invites').delete().eq('id', inv.id)

    const { data, error } = await supabase.functions.invoke('send-invite', {
      body: {
        email:        inv.email,
        productionId: currentProductionId,
        role:         inv.role,
      },
    })

    if (error || data?.error) {
      const message = error
        ? await fnErrorMessage(error, 'Failed to resend.')
        : data?.error ?? 'Failed to resend.'
      setResendResult(r => ({ ...r, [inv.id]: { ok: false, message } }))
      setResending(r => ({ ...r, [inv.id]: false }))
      // Reload so the deleted row comes back if it still exists
      loadData()
    } else {
      setResendResult(r => ({ ...r, [inv.id]: { ok: true, message: 'Resent!' } }))
      setResending(r => ({ ...r, [inv.id]: false }))
      loadData()
      setTimeout(() => setResendResult(r => ({ ...r, [inv.id]: null })), 3000)
    }
  }

  // ── Remove member ────────────────────────────────────────────────────────────
  async function handleRemoveMember(userId) {
    setRemoveError(null)
    const { error } = await supabase
      .from('production_members')
      .delete()
      .eq('production_id', currentProductionId)
      .eq('user_id', userId)
    if (error) {
      setRemoveError(`Delete failed: ${error.message} (code: ${error.code})`)
      setConfirmRemove(null)
      return
    }
    setConfirmRemove(null)
    loadData()
  }

  // ── Save member permissions (optimistic, immediate on toggle) ────────────────
  async function handleChangePermissions(userId, nextPerms) {
    setPermsError(null)
    // Optimistic local update
    setMembers(ms => ms.map(m =>
      m.user_id === userId ? { ...m, permissions: cleanPermissions(nextPerms) } : m
    ))
    const { error } = await supabase
      .from('production_members')
      .update({ permissions: cleanPermissions(nextPerms) })
      .eq('production_id', currentProductionId)
      .eq('user_id', userId)
    if (error) {
      setPermsError(`Could not save permissions: ${error.message}`)
      loadData()
    }
  }

  // ── Change member role ───────────────────────────────────────────────────────
  async function handleChangeRole(userId, currentRole, newRole) {
    if (currentRole === 'owner') return
    await supabase
      .from('production_members')
      .update({ role: newRole })
      .eq('production_id', currentProductionId)
      .eq('user_id', userId)
    loadData()
  }

  if (!canAdmin) {
    return (
      <div className="admin-no-access">
        <div style={{ fontSize: 32, opacity: 0.2, marginBottom: 8 }}>🔒</div>
        <div className="admin-no-access-title">Access restricted</div>
        <div className="admin-no-access-sub">Only owners and admins can manage team members.</div>
      </div>
    )
  }

  return (
    <div className="admin-wrap">

      {/* ── Invite form ────────────────────────────────────────────────────── */}
      <div className="admin-section">
        <h2 className="admin-section-title">Invite Someone</h2>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: '#f0f7ff', border: '1px solid #bfdbfe',
          borderRadius: 8, padding: '8px 14px', marginBottom: 12,
        }}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>Inviting to:</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>
            {productionName || 'Untitled Production'}
          </span>
        </div>
        <p className="admin-section-sub">
          They'll receive an email to set up their account and join this production.
        </p>

        <form className="admin-invite-form" onSubmit={handleSendInvite}>
          <input
            className="admin-invite-input"
            type="email"
            value={inviteEmail}
            onChange={e => { setInviteEmail(e.target.value); setSendResult(null) }}
            placeholder="colleague@example.com"
            required
          />
          <select
            className="admin-invite-select"
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value)}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            className="admin-invite-btn"
            type="submit"
            disabled={sending}
          >
            {sending ? 'Sending…' : 'Send invite'}
          </button>
        </form>

        {sendResult && (
          <div className={`admin-send-result${sendResult.ok ? '' : ' admin-send-result--err'}`}>
            {sendResult.message}
          </div>
        )}
      </div>

      <div className="admin-divider" />

      {/* ── Current members ─────────────────────────────────────────────────── */}
      <div className="admin-section">
        <h2 className="admin-section-title">Team Members</h2>

        {removeError && (
          <div className="admin-send-result admin-send-result--err" style={{ marginBottom: 12 }}>
            {removeError}
          </div>
        )}
        {permsError && (
          <div className="admin-send-result admin-send-result--err" style={{ marginBottom: 12 }}>
            {permsError}
          </div>
        )}

        {dataLoading ? (
          <p className="admin-loading">Loading…</p>
        ) : members.length === 0 ? (
          <p className="admin-empty">No members found.</p>
        ) : (
          <div className="admin-member-list">
            {members.filter(m => m.role !== 'owner' || memberRole === 'owner').map(m => {
              const roleStyle = ROLE_COLORS[m.role] ?? ROLE_COLORS.member
              const fullName = m.profile
                ? [m.profile.first_name, m.profile.last_name].filter(Boolean).join(' ')
                : '—'
              const isSelf = m.user_id === session.user.id
              const isOwner = m.role === 'owner'
              const isExpanded = expandedMember === m.user_id
              return (
                <div key={m.user_id} className="admin-member-block">
                <div className="admin-member-row">
                  <div className="admin-member-avatar">
                    {m.profile?.first_name?.[0]?.toUpperCase() ?? '?'}
                    {m.profile?.last_name?.[0]?.toUpperCase() ?? ''}
                  </div>
                  <div className="admin-member-info">
                    <button
                      type="button"
                      className="admin-member-name admin-member-name--btn"
                      onClick={() => setExpandedMember(x => (x === m.user_id ? null : m.user_id))}
                      title="Click to edit what this user can see"
                    >
                      <span className={`admin-member-chev${isExpanded ? ' open' : ''}`}>▸</span>
                      {fullName}
                      {m.email && <span className="admin-member-email">{m.email}</span>}
                      {isSelf && <span className="admin-member-you">You</span>}
                    </button>
                  </div>
                  <div className="admin-member-role">
                    {isOwner || isSelf ? (
                      <span
                        className="admin-role-badge"
                        style={{ background: roleStyle.bg, color: roleStyle.color }}
                      >
                        {ROLE_LABELS[m.role] ?? m.role}
                      </span>
                    ) : (
                      <select
                        className="admin-role-select"
                        value={m.role}
                        onChange={e => handleChangeRole(m.user_id, m.role, e.target.value)}
                        style={{ background: roleStyle.bg, color: roleStyle.color }}
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                  </div>
                  {!isOwner && !isSelf && (
                    confirmRemove === m.user_id ? (
                      <div className="admin-confirm-remove">
                        <span className="admin-confirm-label">Remove?</span>
                        <button
                          className="admin-confirm-yes"
                          onClick={() => handleRemoveMember(m.user_id)}
                        >
                          Yes
                        </button>
                        <button
                          className="admin-confirm-no"
                          onClick={() => setConfirmRemove(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="admin-member-remove"
                        onClick={() => setConfirmRemove(m.user_id)}
                        title="Remove from production"
                      >
                        ✕
                      </button>
                    )
                  )}
                </div>

                {/* ── Inline permissions panel (accordion) ──────────────────── */}
                {isExpanded && (
                  isOwner ? (
                    <div className="admin-perms-owner-note">
                      Owners always see everything.
                    </div>
                  ) : (
                    <PermissionsPanel
                      perms={normalizePermissions(m.permissions)}
                      role={m.role}
                      onChange={next => handleChangePermissions(m.user_id, next)}
                    />
                  )
                )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="admin-divider" />

      {/* ── Pending invites ──────────────────────────────────────────────────── */}
      <div className="admin-section">
        <h2 className="admin-section-title">Pending Invites</h2>

        {dataLoading ? (
          <p className="admin-loading">Loading…</p>
        ) : invites.filter(i => !i.accepted).length === 0 ? (
          <p className="admin-empty">No pending invites.</p>
        ) : (
          <div className="admin-invite-list">
            {invites.filter(i => !i.accepted).map(inv => {
              const roleStyle = ROLE_COLORS[inv.role] ?? ROLE_COLORS.member
              const expires   = new Date(inv.expires_at)
              const expired   = expires < new Date()
              const isBusy    = !!resending[inv.id]
              const result    = resendResult[inv.id]
              return (
                <div key={inv.id} className={`admin-invite-row${expired ? ' admin-invite-row--expired' : ''}`}>
                  <div className="admin-invite-email">{inv.email}</div>
                  <span
                    className="admin-role-badge"
                    style={{ background: roleStyle.bg, color: roleStyle.color }}
                  >
                    {ROLE_LABELS[inv.role] ?? inv.role}
                  </span>
                  <span className={`admin-invite-status${expired ? ' admin-invite-status--exp' : ''}`}>
                    {expired ? 'Expired' : `Expires ${expires.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`}
                  </span>
                  {result && (
                    <span style={{ fontSize: 12, color: result.ok ? '#16a34a' : '#dc2626' }}>
                      {result.message}
                    </span>
                  )}
                  <button
                    className="admin-invite-resend"
                    onClick={() => handleResendInvite(inv)}
                    disabled={isBusy}
                    title="Resend invite"
                  >
                    {isBusy ? '…' : '↩ Resend'}
                  </button>
                  <button
                    className="admin-member-remove"
                    onClick={() => handleCancelInvite(inv.id)}
                    title="Cancel invite"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
