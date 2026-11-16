import { useState, useMemo } from 'react'
import { TRANSPORT_TYPES, useTransportStore } from '../store/useTransportStore'

const fmtCost = v => (v == null || v === '' ? '' : Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

// Local-state text cell, commits on blur; onCommitExtra runs after a non-empty
// commit (used to remember drivers/locations into their databases).
function Cell({ value, onCommit, onCommitExtra, type = 'text', listId, placeholder, className = '' }) {
  const [v, setV] = useState(value ?? '')
  return (
    <input
      className={`tr-input ${className}`}
      type={type}
      value={v}
      list={listId}
      placeholder={placeholder}
      onChange={e => setV(e.target.value)}
      onBlur={() => {
        if (v !== (value ?? '')) {
          onCommit(v)
          if (v.trim()) onCommitExtra?.(v)
        }
      }}
    />
  )
}

function LogRow({ row, actions }) {
  const u = field => value => actions.updateLogRow(row.id, field, value)
  return (
    <tr className="tr-row">
      <td className="tr-td">
        <select className="tr-input tr-select" value={row.type} onChange={e => actions.updateLogRow(row.id, 'type', e.target.value)}>
          {TRANSPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className="tr-td"><Cell key={`d${row.id}${row.date}`} value={row.date} type="date" onCommit={u('date')} /></td>
      <td className="tr-td"><Cell key={`t${row.id}${row.time}`} value={row.time} placeholder="09:00" onCommit={u('time')} /></td>
      <td className="tr-td tr-td--wide"><Cell key={`de${row.id}${row.description}`} value={row.description} placeholder="Description" onCommit={u('description')} /></td>
      <td className="tr-td tr-td--wide"><Cell key={`f${row.id}${row.fromLocation}`} value={row.fromLocation} listId="tr-locations" placeholder="From" onCommit={u('fromLocation')} onCommitExtra={actions.rememberLocation} /></td>
      <td className="tr-td tr-td--wide"><Cell key={`to${row.id}${row.toLocation}`} value={row.toLocation} listId="tr-locations" placeholder="To" onCommit={u('toLocation')} onCommitExtra={actions.rememberLocation} /></td>
      <td className="tr-td"><Cell key={`dr${row.id}${row.driver}`} value={row.driver} listId="tr-drivers" placeholder="Driver" onCommit={u('driver')} onCommitExtra={actions.rememberDriver} /></td>
      <td className="tr-td"><Cell key={`s${row.id}${row.supplier}`} value={row.supplier} listId="tr-suppliers" placeholder="Supplier" onCommit={u('supplier')} /></td>
      <td className="tr-td"><Cell key={`p${row.id}${row.po}`} value={row.po} placeholder="PO" onCommit={u('po')} /></td>
      <td className="tr-td tr-td--cost">
        <Cell
          key={`c${row.id}${row.cost}`}
          value={row.cost == null ? '' : String(row.cost)}
          type="number"
          placeholder="0.00"
          className="tr-num"
          onCommit={v => actions.updateLogRow(row.id, 'cost', v === '' ? null : parseFloat(v))}
        />
      </td>
      <td className="tr-td tr-td--actions">
        <button className="pm-icon-btn" title="Copy row" onClick={() => actions.copyLogRow(row.id)}>⧉</button>
        <button
          className="pm-icon-btn danger"
          title="Delete row"
          onClick={() => { if (window.confirm('Delete this trip?')) actions.deleteLogRow(row.id) }}
        >✕</button>
      </td>
    </tr>
  )
}

export default function TransportLog() {
  const store = useTransportStore()
  const { log, drivers, locations, loading } = store
  const [filterType, setFilterType] = useState('')

  const rows = useMemo(
    () => (filterType ? log.filter(r => r.type === filterType) : log),
    [log, filterType]
  )

  const totals = useMemo(() => {
    const byType = {}
    let total = 0
    for (const r of log) {
      const c = Number(r.cost)
      if (!Number.isFinite(c)) continue
      byType[r.type] = (byType[r.type] ?? 0) + c
      total += c
    }
    return { byType, total }
  }, [log])

  const supplierSuggestions = useMemo(
    () => [...new Set(log.map(r => r.supplier.trim()).filter(Boolean))].sort(),
    [log]
  )

  return (
    <div className="pm-module">
      <div className="pm-module-head">
        <div>
          <div className="pm-eyebrow">Transport</div>
          <h1 className="pm-h1">Transport Log</h1>
          <div className="pm-h1-sub">{log.length} trip{log.length === 1 ? '' : 's'} · £{fmtCost(totals.total) || '0.00'} total</div>
        </div>
        <div className="pm-module-head-actions">
          <select className="tr-filter" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">All types</option>
            {TRANSPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="pm-btn pm-btn--primary" onClick={() => store.addLogRow()}>+ Add trip</button>
        </div>
      </div>

      {/* Totals by type (these feed Cost Tracking) */}
      <div className="tr-totals">
        {TRANSPORT_TYPES.map(t => (
          <div key={t} className="tr-total-card">
            <div className="tr-total-label">{t}</div>
            <div className="tr-total-value">£{fmtCost(totals.byType[t] ?? 0)}</div>
          </div>
        ))}
      </div>

      <datalist id="tr-locations">{locations.map(l => <option key={l.id} value={l.name} />)}</datalist>
      <datalist id="tr-drivers">{drivers.map(d => <option key={d.id} value={d.name} />)}</datalist>
      <datalist id="tr-suppliers">{supplierSuggestions.map(s => <option key={s} value={s} />)}</datalist>

      {loading ? <div className="crew-db-loading">Loading…</div> : (
        <div className="crew-db-table-wrap">
          <table className="crew-db-table tr-table">
            <thead>
              <tr>
                <th className="crew-db-th">Type</th>
                <th className="crew-db-th">Date</th>
                <th className="crew-db-th">Time</th>
                <th className="crew-db-th">Description</th>
                <th className="crew-db-th">From</th>
                <th className="crew-db-th">To</th>
                <th className="crew-db-th">Driver</th>
                <th className="crew-db-th">Supplier</th>
                <th className="crew-db-th">PO</th>
                <th className="crew-db-th">Cost</th>
                <th className="crew-db-th" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => <LogRow key={row.id} row={row} actions={store} />)}
              {rows.length === 0 && (
                <tr key="empty"><td className="crew-db-cell" colSpan={11} style={{ color: '#9ca3af' }}>
                  No trips yet — add one, and From/To/Driver fields will start autofilling from the databases as they grow.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
