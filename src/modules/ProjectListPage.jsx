import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member' }
const ROLE_COLORS = {
  owner:  { bg: '#fef3c7', color: '#92400e' },
  admin:  { bg: '#ede9fe', color: '#5b21b6' },
  member: { bg: '#f0fdf4', color: '#166534' },
}

// Fetch members + profiles for a production, cache results
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
  memberRole,
}) {
  const [memberships,   setMemberships]   = useState([])
  const [expandedId,    setExpandedId]    = useState(null)
  const [membersCache,  setMembersCache]  = useState({})  // productionId → members[]
  const [loadingId,     setLoadingId]     = useState(null)

  useEffect(() => {
    supabase
      .from('production_members')
      .select('production_id, role')
      .then(({ data }) => setMemberships(data ?? []))
  }, [])

  // Toggle expand — lazy-load members on first open
  async function handleToggle(prodId) {
    if (expandedId === prodId) {
      setExpandedId(null)
      return
    }
    setExpandedId(prodId)
    if (!membersCache[prodId]) {
      setLoadingId(prodId)
      const members = await fetchMembers(prodId)
      setMembersCache(prev => ({ ...prev, [prodId]: members }))
      setLoadingId(null)
    }
  }

  // Build rows: join memberships with productions list
  const rows = memberships
    .map(m => {
      const prod = productions.find(p => p.id === m.production_id)
      return prod ? { ...prod, role: m.role } : null
    })
    .filter(Boolean)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  const canCreate = memberRole === 'owner' || memberRole === 'admin'

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
            const members    = membersCache[prod.id] ?? []
            const isLoading  = loadingId === prod.id

            return (
              <div
                key={prod.id}
                className={`projlist-card${isCurrent ? ' projlist-card--active' : ''}${isExpanded ? ' projlist-card--open' : ''}`}
              >
                {/* ── Row header ── */}
                <div
                  className="projlist-row"
                  onClick={() => handleToggle(prod.id)}
                >
                  <div className="projlist-row-l">
                    <div className="projlist-row-name">
                      {prod.name || 'Untitled production'}
                      {isCurrent && <span className="projlist-current-badge">Current</span>}
                    </div>
                    {prod.director && (
                      <div className="projlist-row-meta">Dir. {prod.director}</div>
                    )}
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

                {/* ── Expanded members panel ── */}
                {isExpanded && (
                  <div className="projlist-members">
                    {isLoading ? (
                      <div className="projlist-members-loading">Loading team…</div>
                    ) : members.length === 0 ? (
                      <div className="projlist-members-empty">No members found.</div>
                    ) : (
                      members.map(m => {
                        const rs = ROLE_COLORS[m.role] ?? ROLE_COLORS.member
                        const firstName = m.profile?.first_name ?? ''
                        const lastName  = m.profile?.last_name  ?? ''
                        const fullName  = [firstName, lastName].filter(Boolean).join(' ') || '—'
                        const initials  = (firstName[0] ?? '') + (lastName[0] ?? '')
                        return (
                          <div key={m.user_id} className="projlist-member-row">
                            <div className="projlist-member-avatar">
                              {initials.toUpperCase() || '?'}
                            </div>
                            <div className="projlist-member-name">{fullName}</div>
                            <span
                              className="projlist-role-badge"
                              style={{ background: rs.bg, color: rs.color }}
                            >
                              {ROLE_LABELS[m.role] ?? m.role}
                            </span>
                          </div>
                        )
                      })
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
