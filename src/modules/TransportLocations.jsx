import { useState } from 'react'
import { useTransportStore } from '../store/useTransportStore'

function Cell({ value, onCommit, placeholder }) {
  const [v, setV] = useState(value ?? '')
  return (
    <input
      className="crew-db-input"
      value={v}
      placeholder={placeholder}
      onChange={e => setV(e.target.value)}
      onBlur={() => { if (v !== (value ?? '')) onCommit(v) }}
    />
  )
}

export default function TransportLocations() {
  const store = useTransportStore()
  const { locations, log, loading } = store
  const [search, setSearch] = useState('')

  const usage = {}
  for (const r of log) {
    for (const f of [r.fromLocation, r.toLocation]) {
      const k = (f ?? '').trim().toLowerCase()
      if (k) usage[k] = (usage[k] ?? 0) + 1
    }
  }

  const filtered = search.trim()
    ? locations.filter(l => l.name.toLowerCase().includes(search.toLowerCase()))
    : locations

  return (
    <div className="pm-module">
      <div className="pm-module-head">
        <div>
          <div className="pm-eyebrow">Transport</div>
          <h1 className="pm-h1">Location Database</h1>
          <div className="pm-h1-sub">{locations.length} location{locations.length === 1 ? '' : 's'} — every From/To typed into the log is remembered here</div>
        </div>
        <div className="pm-module-head-actions">
          <input className="crew-db-search" type="search" placeholder="Search locations…" value={search} onChange={e => setSearch(e.target.value)} />
          <button className="pm-btn pm-btn--primary" onClick={() => store.addLocation('')}>+ Add location</button>
        </div>
      </div>

      {loading ? <div className="crew-db-loading">Loading…</div> : (
        <div className="crew-db-table-wrap">
          <table className="crew-db-table">
            <thead>
              <tr>
                <th className="crew-db-th crew-db-th--name">Location / address</th>
                <th className="crew-db-th">Notes</th>
                <th className="crew-db-th" style={{ width: 70 }}>Trips</th>
                <th className="crew-db-th" style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id} className="crew-db-row">
                  <td className="crew-db-cell crew-db-cell--name"><Cell key={`n${l.id}${l.name}`} value={l.name} placeholder="Address…" onCommit={v => store.updateLocation(l.id, 'name', v)} /></td>
                  <td className="crew-db-cell"><Cell key={`no${l.id}${l.notes}`} value={l.notes} placeholder="Notes (gate code, parking…)" onCommit={v => store.updateLocation(l.id, 'notes', v)} /></td>
                  <td className="crew-db-cell" style={{ color: '#6b7280' }}>{usage[l.name.trim().toLowerCase()] ?? 0}</td>
                  <td className="crew-db-cell">
                    <button className="pm-icon-btn danger" title="Delete location" onClick={() => { if (window.confirm('Delete this location?')) store.deleteLocation(l.id) }}>✕</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td className="crew-db-cell" colSpan={4} style={{ color: '#9ca3af' }}>No locations yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
