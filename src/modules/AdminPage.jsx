import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member' }
const ROLE_COLORS = {
  owner:  { bg: '#fef3c7', color: '#92400e' },
  admin:  { bg: '#ede9fe', color: '#5b21b6' },
  member: { bg: '#f0fdf4', color: '#166534' },
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

  // ── Fetch members + pending invites ─────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!currentProductionId) return
    setDataLoading(true)

    // Members
    const { data: memberRows } = await supabase
      .from('production_members')
      .select('user_id, role')
      .eq('production_id', currentProductionId)

    // Profiles for those users
    const userIds = (memberRows ?? []).map(m => m.user_id)
    let profileMap = {}
    if (userIds.length > 0) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', userIds)
      ;(profileRows ?? []).forEach(p => { profileMap[p.id] = p })
    }

    setMembers(
      (memberRows ?? []).map(m => ({
        ...m,
        profile: profileMap[m.user_id] ?? null,
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
      setSendResult({ ok: false, message: error?.message ?? data?.error ?? 'Failed to send invite.' })
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
              return (
                <div key={m.user_id} className="admin-member-row">
                  <div className="admin-member-avatar">
                    {m.profile?.first_name?.[0]?.toUpperCase() ?? '?'}
                    {m.profile?.last_name?.[0]?.toUpperCase() ?? ''}
                  </div>
                  <div className="admin-member-info">
                    <span className="admin-member-name">
                      {fullName}
                      {isSelf && <span className="admin-member-you">You</span>}
                    </span>
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
              const expires  = new Date(inv.expires_at)
              const expired  = expires < new Date()
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
