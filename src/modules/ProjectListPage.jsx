import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member' }
const ROLE_COLORS = {
  owner:  { bg: '#fef3c7', color: '#92400e' },
  admin:  { bg: '#ede9fe', color: '#5b21b6' },
  member: { bg: '#f0fdf4', color: '#166534' },
}

async function fetchMembers(productionId) {
  const { data: memberRows } = await supabase
    .from('production_members')
    .select('user_id, role')
    .eq('production_id', productionId)

  if (!memberRows?.length) return []

  const { data: profileRows } = await supabase
    .from('profiles')
    .select('id, first_name, last_name')
    .in('id', memberRows.map(m => m.user_id))

  const profileMap = {}
  ;(profileRows ?? []).forEach(p => { profileMap[p.id] = p })

  return memberRows
    .map(m => ({ ...m, profile: profileMap[m.user_id] ?? null }))
    .sort((a, b) => {
      const order = { owner: 0, admin: 1, member: 2 }
      return (order[a.role] ?? 9) - (order[b.role] ?? 9)
    })
}

export default function ProjectListPage({
  productions,
  currentProductionId,
  onSwitch,
  onCreate,
  onDelete,
  memberRole,
  userId,
}) {
  const [memberships,  setMemberships]  = useState([])
  const [expandedId,   setExpandedId]   = useState(null)
  const [membersCache, setMembersCache] = useState({})
  const [loadingId,    setLoadingId]    = useState(null)

  // Delete confirmation: { prodId, stage: 1 | 2 } | null
  const [deleteState,  setDeleteState]  = useState(null)
  const [deleting,     setDeleting]     = useState(false)

  useEffect(() => {
    if (!userId) return
    supabase
      .from('production_members')
      .select('production_id, role')
      .eq('user_id', userId)
      .then(({ data }) => setMemberships(data ?? []))
  }, [userId])

  async function handleToggle(prodId) {
    if (expandedId === prodId) {
      setExpandedId(null)
      setDeleteState(null)
      return
    }
    setExpandedId(prodId)
    setDeleteState(null)
    if (!membersCache[prodId]) {
      setLoadingId(prodId)
      const members = await fetchMembers(prodId)
      setMembersCache(prev => ({ ...prev, [prodId]: members }))
      setLoadingId(null)
    }
  }

  async function handleDelete(prod) {
    setDeleting(true)
    await onDelete(prod.id)
    setDeleteState(null)
    setDeleting(false)
  }

  const rows = memberships
    .map(m => {
      const prod = productions.find(p => p.id === m.production_id)
      return prod ? { ...prod, role: m.role } : null
    })
    .filter(Boolean)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  const canCreate  = memberRole === 'owner' || memberRole === 'admin'
  const isOwner    = memberRole === 'owner'
  const canDelete  = isOwner && productions.length > 1

  return (
    <div className="projlist-wrap">
      <div className="projlist-header">
        <div>
          <h2 className="projlist-title">Your Productions</h2>
          <p className="projlist-sub">Click a production to see its team.</p>
        </div>
        {canCreate && (
          <button className="projlist-new-btn" onClick={onCreate}>
            + New production
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="projlist-empty">
          <div style={{ fontSize: 32, opacity: 0.2, marginBottom: 8 }}>🎬</div>
          <div className="projlist-empty-title">No productions yet</div>
          <div className="projlist-empty-sub">
            {canCreate
              ? 'Create your first production to get started.'
              : "You haven't been added to any productions yet."}
          </div>
        </div>
      ) : (
        <div className="projlist-list">
          {rows.map(prod => {
            const isCurrent  = prod.id === currentProductionId
            const isExpanded = expandedId === prod.id
            const roleStyle  = ROLE_COLORS[prod.role] ?? ROLE_COLORS.member
            const allMembers = membersCache[prod.id] ?? []
            const isLoading  = loadingId === prod.id

            const admins  = allMembers.filter(m => m.role === 'admin')
            const members = allMembers.filter(m => m.role === 'member')
            const hasAny  = admins.length > 0 || members.length > 0

            const cachedAndLoaded = !!membersCache[prod.id]
            const summaryParts = []
            if (cachedAndLoaded) {
              if (admins.length)  summaryParts.push(`${admins.length} admin${admins.length !== 1 ? 's' : ''}`)
              if (members.length) summaryParts.push(`${members.length} member${members.length !== 1 ? 's' : ''}`)
            }

            const delStage = deleteState?.prodId === prod.id ? deleteState.stage : 0

            return (
              <div
                key={prod.id}
                className={`projlist-card${isCurrent ? ' projlist-card--active' : ''}${isExpanded ? ' projlist-card--open' : ''}`}
              >
                {/* ── Row header ── */}
                <div className="projlist-row" onClick={() => handleToggle(prod.id)}>
                  <div className="projlist-row-l">
                    <div className="projlist-row-name">
                      {prod.name || 'Untitled production'}
                      {isCurrent && <span className="projlist-current-badge">Current</span>}
                    </div>
                    <div className="projlist-row-meta-wrap">
                      {prod.director && (
                        <span className="projlist-row-meta">Dir. {prod.director}</span>
                      )}
                      {summaryParts.length > 0 && (
                        <span className="projlist-row-team-count">
                          {summaryParts.join(' · ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="projlist-row-r">
                    <span
                      className="projlist-role-badge"
                      style={{ background: roleStyle.bg, color: roleStyle.color }}
                    >
                      {ROLE_LABELS[prod.role] ?? prod.role}
                    </span>
                    {!isCurrent && (
                      <button
                        className="projlist-switch-btn"
                        onClick={e => { e.stopPropagation(); onSwitch(prod.id) }}
                      >
                        Switch →
                      </button>
                    )}
                    <span className="projlist-chevron">{isExpanded ? '▴' : '▾'}</span>
                  </div>
                </div>

                {/* ── Expanded panel ── */}
                {isExpanded && (
                  <>
                    {/* Members */}
                    <div className="projlist-members">
                      {isLoading ? (
                        <div className="projlist-members-loading">Loading team…</div>
                      ) : !hasAny ? (
                        <div className="projlist-members-empty">No team members assigned yet.</div>
                      ) : (
                        <>
                          {admins.length > 0 && (
                            <div className="projlist-member-group">
                              <div className="projlist-member-group-label">Admins</div>
                              {admins.map(m => <MemberRow key={m.user_id} m={m} />)}
                            </div>
                          )}
                          {members.length > 0 && (
                            <div className="projlist-member-group">
                              <div className="projlist-member-group-label">Members</div>
                              {members.map(m => <MemberRow key={m.user_id} m={m} />)}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* ── Danger zone (owner only, not last production) ── */}
                    {canDelete && (
                      <div className="projlist-danger">

                        {/* Stage 0 — idle */}
                        {delStage === 0 && (
                          <button
                            className="projlist-danger-btn"
                            onClick={e => { e.stopPropagation(); setDeleteState({ prodId: prod.id, stage: 1 }) }}
                          >
                            Delete production
                          </button>
                        )}

                        {/* Stage 1 — first confirmation */}
                        {delStage === 1 && (
                          <div className="projlist-danger-confirm projlist-danger-confirm--1" onClick={e => e.stopPropagation()}>
                            <div className="projlist-danger-icon">⚠️</div>
                            <div className="projlist-danger-text">
                              <strong>Delete "{prod.name || 'this production'}"?</strong>
                              <span>All schedules, cast, scenes and data will be permanently removed.</span>
                            </div>
                            <div className="projlist-danger-actions">
                              <button
                                className="projlist-danger-confirm-btn"
                                onClick={() => setDeleteState({ prodId: prod.id, stage: 2 })}
                              >
                                Yes, I'm sure
                              </button>
                              <button
                                className="projlist-danger-cancel-btn"
                                onClick={() => setDeleteState(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Stage 2 — final confirmation */}
                        {delStage === 2 && (
                          <div className="projlist-danger-confirm projlist-danger-confirm--2" onClick={e => e.stopPropagation()}>
                            <div className="projlist-danger-icon">🚨</div>
                            <div className="projlist-danger-text">
                              <strong>This cannot be undone. Ever.</strong>
                              <span>"{prod.name || 'This production'}" and every piece of data inside it will be gone forever. Are you absolutely certain?</span>
                            </div>
                            <div className="projlist-danger-actions">
                              <button
                                className="projlist-danger-final-btn"
                                onClick={() => handleDelete(prod)}
                                disabled={deleting}
                              >
                                {deleting ? 'Deleting…' : 'Delete forever'}
                              </button>
                              <button
                                className="projlist-danger-cancel-btn"
                                onClick={() => setDeleteState(null)}
                              >
                                Go back
                              </button>
                            </div>
                          </div>
                        )}

                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MemberRow({ m }) {
  const rs        = ROLE_COLORS[m.role] ?? ROLE_COLORS.member
  const firstName = m.profile?.first_name ?? ''
  const lastName  = m.profile?.last_name  ?? ''
  const fullName  = [firstName, lastName].filter(Boolean).join(' ') || '—'
  const initials  = ((firstName[0] ?? '') + (lastName[0] ?? '')).toUpperCase() || '?'

  return (
    <div className="projlist-member-row">
      <div className="projlist-member-avatar">{initials}</div>
      <div className="projlist-member-name">{fullName}</div>
      <span
        className="projlist-role-badge"
        style={{ background: rs.bg, color: rs.color }}
      >
        {ROLE_LABELS[m.role] ?? m.role}
      </span>
    </div>
  )
}
