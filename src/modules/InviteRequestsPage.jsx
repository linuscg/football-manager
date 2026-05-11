import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const ROLE_COLORS = {
  admin:  { bg: '#ede9fe', color: '#5b21b6' },
  member: { bg: '#f0fdf4', color: '#166534' },
}

export default function InviteRequestsPage({ productions, currentProductionId, memberRole }) {
  const [requests,    setRequests]    = useState([])
  const [loading,     setLoading]     = useState(true)

  // Grant UI state — keyed by request id
  const [grantOpen,   setGrantOpen]   = useState({})   // id → bool
  const [grantProd,   setGrantProd]   = useState({})   // id → production_id
  const [grantRole,   setGrantRole]   = useState({})   // id → role
  const [grantBusy,   setGrantBusy]   = useState({})   // id → bool
  const [grantResult, setGrantResult] = useState({})   // id → { ok, message }

  const loadRequests = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('invite_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setRequests(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadRequests() }, [loadRequests])

  // ── Grant ──────────────────────────────────────────────────────────────────
  async function handleGrant(req) {
    const prodId = grantProd[req.id] || currentProductionId
    const role   = grantRole[req.id] || 'member'

    setGrantBusy(b => ({ ...b, [req.id]: true }))
    setGrantResult(r => ({ ...r, [req.id]: null }))

    // Call the same send-invite edge function
    const { data, error } = await supabase.functions.invoke('send-invite', {
      body: { email: req.email, productionId: prodId, role },
    })

    if (error || data?.error) {
      setGrantResult(r => ({
        ...r,
        [req.id]: { ok: false, message: error?.message ?? data?.error ?? 'Failed to send invite.' },
      }))
      setGrantBusy(b => ({ ...b, [req.id]: false }))
      return
    }

    // Mark request as granted
    await supabase
      .from('invite_requests')
      .update({ status: 'granted' })
      .eq('id', req.id)

    setRequests(rs => rs.filter(r => r.id !== req.id))
    setGrantBusy(b => ({ ...b, [req.id]: false }))
    setGrantOpen(o => ({ ...o, [req.id]: false }))
  }

  // ── Decline ────────────────────────────────────────────────────────────────
  async function handleDecline(id) {
    if (!window.confirm('Decline this invite request?')) return
    await supabase
      .from('invite_requests')
      .update({ status: 'declined' })
      .eq('id', id)
    setRequests(rs => rs.filter(r => r.id !== id))
  }

  if (memberRole !== 'owner') {
    return (
      <div className="admin-no-access">
        <div style={{ fontSize: 32, opacity: 0.2, marginBottom: 8 }}>🔒</div>
        <div className="admin-no-access-title">Access restricted</div>
        <div className="admin-no-access-sub">Only owners can manage invite requests.</div>
      </div>
    )
  }

  return (
    <div className="invreq-wrap">

      <div className="invreq-header">
        <h2 className="invreq-title">Invite Requests</h2>
        <p className="invreq-sub">
          People who requested access via the landing page. Grant them an invite or decline.
        </p>
      </div>

      {loading ? (
        <p className="admin-loading">Loading…</p>
      ) : requests.length === 0 ? (
        <div className="invreq-empty">
          <div style={{ fontSize: 32, opacity: 0.18, marginBottom: 8 }}>📭</div>
          <div className="invreq-empty-title">No pending requests</div>
          <div className="invreq-empty-sub">New requests will appear here.</div>
        </div>
      ) : (
        <div className="invreq-list">
          {requests.map(req => {
            const isOpen   = !!grantOpen[req.id]
            const busy     = !!grantBusy[req.id]
            const result   = grantResult[req.id]
            const prodId   = grantProd[req.id] || currentProductionId
            const role     = grantRole[req.id] || 'member'
            const roleStyle = ROLE_COLORS[role] ?? ROLE_COLORS.member
            const date     = new Date(req.created_at).toLocaleDateString('en-GB', {
              day: '2-digit', month: 'short', year: 'numeric',
            })

            return (
              <div key={req.id} className={`invreq-card${isOpen ? ' invreq-card--open' : ''}`}>

                {/* ── Row ── */}
                <div className="invreq-row">
                  <div className="invreq-avatar">
                    {(req.name?.[0] ?? '?').toUpperCase()}
                  </div>
                  <div className="invreq-info">
                    <div className="invreq-name">{req.name}</div>
                    <div className="invreq-email">{req.email}</div>
                  </div>
                  <div className="invreq-date">{date}</div>
                  <div className="invreq-actions">
                    <button
                      className="invreq-btn invreq-btn--grant"
                      onClick={() => setGrantOpen(o => ({ ...o, [req.id]: !o[req.id] }))}
                    >
                      {isOpen ? 'Cancel' : 'Grant ↓'}
                    </button>
                    <button
                      className="invreq-btn invreq-btn--decline"
                      onClick={() => handleDecline(req.id)}
                    >
                      Decline
                    </button>
                  </div>
                </div>

                {/* ── Grant panel ── */}
                {isOpen && (
                  <div className="invreq-grant-panel">
                    <div className="invreq-grant-row">
                      <div className="invreq-grant-field">
                        <label className="invreq-grant-label">Production</label>
                        <select
                          className="invreq-grant-select"
                          value={prodId}
                          onChange={e => setGrantProd(p => ({ ...p, [req.id]: e.target.value }))}
                        >
                          {productions.map(p => (
                            <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>
                          ))}
                        </select>
                      </div>
                      <div className="invreq-grant-field">
                        <label className="invreq-grant-label">Role</label>
                        <select
                          className="invreq-grant-select"
                          value={role}
                          onChange={e => setGrantRole(r => ({ ...r, [req.id]: e.target.value }))}
                          style={{ background: roleStyle.bg, color: roleStyle.color }}
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <button
                        className="invreq-btn invreq-btn--send"
                        onClick={() => handleGrant(req)}
                        disabled={busy}
                      >
                        {busy ? 'Sending…' : 'Send invite'}
                      </button>
                    </div>
                    {result && (
                      <div className={`invreq-result${result.ok ? '' : ' invreq-result--err'}`}>
                        {result.message}
                      </div>
                    )}
                  </div>
                )}

              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
