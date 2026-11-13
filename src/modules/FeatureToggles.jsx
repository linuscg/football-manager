import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// ─── Owner-only feature toggles ───────────────────────────────────────────────
// Per-production function switches stored in production.feature_flags (jsonb).
// Convention: a feature is ON unless its key is present and false, so existing
// productions need no backfill. The page is only reachable by the app owner
// (profiles.is_owner — gated in App.jsx nav).

const TOGGLES = [
  {
    key:   'dealMemoSend',
    label: 'Deal memo sending',
    hint:  'The Memo / Send buttons on New Starters. Off hides them for everyone on that production.',
  },
]

export default function FeatureToggles() {
  const [prods,  setProds]  = useState(null)
  const [error,  setError]  = useState(null)

  async function load() {
    const { data, error: err } = await supabase
      .from('production')
      .select('id, name, feature_flags')
      .order('name')
    if (err) { setError(err.message); return }
    setProds(data ?? [])
  }

  useEffect(() => { load() }, [])

  async function toggle(prod, key) {
    const flags   = prod.feature_flags ?? {}
    const enabled = flags[key] !== false
    const next    = { ...flags, [key]: !enabled ? true : false }
    // Keep the jsonb tidy: an enabled feature needs no key at all.
    if (next[key] === true) delete next[key]
    setProds(ps => ps.map(p => p.id === prod.id ? { ...p, feature_flags: next } : p))
    const { error: err } = await supabase
      .from('production')
      .update({ feature_flags: next })
      .eq('id', prod.id)
    if (err) { setError(err.message); load() }
  }

  return (
    <div className="pm-module">
      <div className="pm-module-head">
        <div>
          <div className="pm-eyebrow">Owner only</div>
          <h1 className="pm-h1">Feature Toggles</h1>
          <div className="pm-h1-sub">
            Turn functions on or off per production — changes apply to everyone on that production immediately.
          </div>
        </div>
      </div>

      {error && <div className="admin-send-result admin-send-result--err">{error}</div>}
      {!prods && !error && <div className="crew-db-loading">Loading…</div>}

      {prods && (
        <div className="crew-db-table-wrap">
          <table className="crew-db-table">
            <thead>
              <tr>
                <th className="crew-db-th crew-db-th--name">Production</th>
                {TOGGLES.map(t => (
                  <th key={t.key} className="crew-db-th" title={t.hint}>{t.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {prods.map(prod => (
                <tr key={prod.id} className="crew-db-row">
                  <td className="crew-db-cell crew-db-cell--name" style={{ fontWeight: 600 }}>
                    {prod.name}
                  </td>
                  {TOGGLES.map(t => {
                    const enabled = (prod.feature_flags ?? {})[t.key] !== false
                    return (
                      <td key={t.key} className="crew-db-cell" style={{ textAlign: 'center' }}>
                        <label className="feat-toggle" title={t.hint}>
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={() => toggle(prod, t.key)}
                          />
                          <span className={`feat-toggle-state${enabled ? ' is-on' : ''}`}>
                            {enabled ? 'On' : 'Off'}
                          </span>
                        </label>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
