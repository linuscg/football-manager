import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member' }
const ROLE_COLORS = {
  owner:  { bg: '#fef3c7', color: '#92400e' },
  admin:  { bg: '#ede9fe', color: '#5b21b6' },
  member: { bg: '#f0fdf4', color: '#166534' },
}

export default function ProjectListPage({
  productions,
  currentProductionId,
  onSwitch,
  onCreate,
  memberRole,
}) {
  // memberships: [{ production_id, role }]
  const [memberships, setMemberships] = useState([])

  useEffect(() => {
    supabase
      .from('production_members')
      .select('production_id, role')
      .then(({ data }) => setMemberships(data ?? []))
  }, [])

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
          <p className="projlist-sub">All productions you have access to.</p>
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
              : 'You haven\'t been added to any productions yet.'}
          </div>
        </div>
      ) : (
        <div className="projlist-list">
          {rows.map(prod => {
            const isCurrent = prod.id === currentProductionId
            const roleStyle = ROLE_COLORS[prod.role] ?? ROLE_COLORS.member
            return (
              <div
                key={prod.id}
                className={`projlist-row${isCurrent ? ' projlist-row--active' : ''}`}
                onClick={() => !isCurrent && onSwitch(prod.id)}
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
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
