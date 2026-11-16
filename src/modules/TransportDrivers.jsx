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

export default function TransportDrivers() {
  const store = useTransportStore()
  const { drivers, loading } = store
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? drivers.filter(d =>
        [d.name, d.phone, d.vehicleReg, d.company].some(f => (f ?? '').toLowerCase().includes(search.toLowerCase())))
    : drivers

  return (
    <div className="pm-module">
      <div className="pm-module-head">
        <div>
          <div className="pm-eyebrow">Transport</div>
          <h1 className="pm-h1">Driver Database</h1>
          <div className="pm-h1-sub">{drivers.length} driver{drivers.length === 1 ? '' : 's'} — new names typed into the log are added here automatically</div>
        </div>
        <div className="pm-module-head-actions">
          <input className="crew-db-search" type="search" placeholder="Search drivers…" value={search} onChange={e => setSearch(e.target.value)} />
          <button className="pm-btn pm-btn--primary" onClick={() => store.addDriver()}>+ Add driver</button>
        </div>
      </div>

      {loading ? <div className="crew-db-loading">Loading…</div> : (
        <div className="crew-db-table-wrap">
          <table className="crew-db-table">
            <thead>
              <tr>
                <th className="crew-db-th crew-db-th--name">Name</th>
                <th className="crew-db-th">Phone</th>
                <th className="crew-db-th">Vehicle reg</th>
                <th className="crew-db-th">Company</th>
                <th className="crew-db-th">Notes</th>
                <th className="crew-db-th" style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.id} className="crew-db-row">
                  <td className="crew-db-cell crew-db-cell--name"><Cell key={`n${d.id}${d.name}`} value={d.name} placeholder="Name" onCommit={v => store.updateDriver(d.id, 'name', v)} /></td>
                  <td className="crew-db-cell"><Cell key={`p${d.id}${d.phone}`} value={d.phone} placeholder="07…" onCommit={v => store.updateDriver(d.id, 'phone', v)} /></td>
                  <td className="crew-db-cell"><Cell key={`r${d.id}${d.vehicleReg}`} value={d.vehicleReg} placeholder="Reg" onCommit={v => store.updateDriver(d.id, 'vehicleReg', v)} /></td>
                  <td className="crew-db-cell"><Cell key={`c${d.id}${d.company}`} value={d.company} placeholder="Company" onCommit={v => store.updateDriver(d.id, 'company', v)} /></td>
                  <td className="crew-db-cell"><Cell key={`no${d.id}${d.notes}`} value={d.notes} placeholder="Notes…" onCommit={v => store.updateDriver(d.id, 'notes', v)} /></td>
                  <td className="crew-db-cell">
                    <button className="pm-icon-btn danger" title="Delete driver" onClick={() => { if (window.confirm(`Delete "${d.name || 'this driver'}"?`)) store.deleteDriver(d.id) }}>✕</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td className="crew-db-cell" colSpan={6} style={{ color: '#9ca3af' }}>No drivers yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
