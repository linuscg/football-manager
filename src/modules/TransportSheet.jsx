import { useState, useMemo } from 'react'
import { TRANSPORT_TYPES, useTransportStore } from '../store/useTransportStore'

const SECTIONS = [
  { key: 'crew',    label: 'CREW' },
  { key: 'pickups', label: 'PICK UPS' },
  { key: 'returns', label: 'RETURNS' },
  { key: 'own',     label: 'OWN ARRANGEMENTS' },
]

const fmtLong = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long',
})

function Cell({ value, onCommit, listId, placeholder, multiline = false }) {
  const [v, setV] = useState(value ?? '')
  const common = {
    value: v,
    placeholder,
    onChange: e => setV(e.target.value),
    onBlur: () => { if (v !== (value ?? '')) onCommit(v) },
  }
  return multiline
    ? <textarea className="tr-input tr-sheet-area" rows={2} {...common} />
    : <input className="tr-input" list={listId} {...common} />
}

export default function TransportSheet({ productionName }) {
  const store = useTransportStore()
  const { log, sheetRows, drivers, locations } = store
  const [date, setDate] = useState(() => {
    const saved = localStorage.getItem('fm_transport_sheet_day')
    return saved || new Date().toISOString().slice(0, 10)
  })
  function pickDate(d) { setDate(d); localStorage.setItem('fm_transport_sheet_day', d) }

  const dayRows = useMemo(
    () => sheetRows.filter(r => r.date === date).sort((a, b) => a.sortOrder - b.sortOrder),
    [sheetRows, date]
  )
  const dayLog = useMemo(() => log.filter(r => r.date === date), [log, date])

  // Day summary from the LOG (trips + cost per type)
  const summary = useMemo(() => {
    const byType = {}
    for (const r of dayLog) {
      byType[r.type] = byType[r.type] ?? { trips: 0, cost: 0 }
      byType[r.type].trips++
      if (Number.isFinite(Number(r.cost))) byType[r.type].cost += Number(r.cost)
    }
    return byType
  }, [dayLog])

  // Driver autofill: typing a known driver's name in the Driver/Contact cell
  // expands to "Name\nPhone\nReg" on commit.
  function expandDriver(value) {
    const d = drivers.find(x => x.name.trim().toLowerCase() === String(value).trim().toLowerCase())
    if (!d) return value
    return [d.name, d.phone, d.vehicleReg].filter(Boolean).join('\n')
  }

  function importFromLog() {
    const existingKeys = new Set(dayRows.map(r => `${r.description}|${r.fromLocation}|${r.toLocation}`))
    let added = 0
    for (const trip of dayLog) {
      const key = `${trip.description}|${trip.fromLocation}|${trip.toLocation}`
      if (existingKeys.has(key)) continue
      existingKeys.add(key)
      store.addSheetRow(date, 'pickups', {
        time: trip.time,
        description: trip.description || trip.type,
        fromLocation: trip.fromLocation,
        toLocation: trip.toLocation,
        driverContact: expandDriver(trip.driver),
      })
      added++
    }
    if (!added) window.alert(dayLog.length ? 'All of this day’s logged trips are already on the sheet.' : 'No trips logged for this day yet.')
  }

  // ── Export: print-window PDF modelled on the spreadsheet template ──────────
  function exportPdf() {
    const esc = s => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>')
    const sectionRows = key => dayRows.filter(r => r.section === key)
    const body = SECTIONS.map(sec => {
      const rows = sectionRows(sec.key)
      if (!rows.length) return ''
      return `
        <tr class="sec"><td colspan="5">${sec.label}</td></tr>
        ${rows.map(r => `
          <tr>
            <td class="time">${esc(r.time)}</td>
            <td>${esc(r.description)}</td>
            <td>${esc(r.fromLocation)}</td>
            <td>${esc(r.toLocation)}</td>
            <td>${esc(r.driverContact)}</td>
          </tr>`).join('')}`
    }).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Transport Sheet — ${fmtLong(date)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #111; font-size: 11px; }
  h1 { font-size: 20px; letter-spacing: 0.18em; text-transform: uppercase; text-align: center; margin-top: 6px; }
  h2 { font-size: 14px; font-weight: 600; text-align: center; margin: 2px 0; }
  h3 { font-size: 12px; font-weight: 500; text-align: center; margin-bottom: 14px; color: #374151; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #111; color: #fff; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; padding: 6px 8px; text-align: left; }
  td { border: 1px solid #d1d5db; padding: 6px 8px; vertical-align: top; }
  td.time { white-space: nowrap; width: 72px; }
  tr.sec td { background: #e5e7eb; font-weight: 700; letter-spacing: 0.06em; font-size: 10.5px; border: 1px solid #d1d5db; }
</style></head><body>
  <h1>${esc(productionName || '')}</h1>
  <h2>Transport Sheet</h2>
  <h3>${esc(fmtLong(date))}</h3>
  <table>
    <thead><tr><th>Time</th><th>Description</th><th>From</th><th>To</th><th>Driver/Contact</th></tr></thead>
    <tbody>${body || '<tr><td colspan="5" style="color:#9ca3af">No rows for this day.</td></tr>'}</tbody>
  </table>
</body></html>`
    const w = window.open('', '_blank', 'width=900,height=700')
    w.document.write(html)
    w.document.close()
    w.addEventListener('load', () => w.print())
  }

  return (
    <div className="pm-module">
      <div className="pm-module-head">
        <div>
          <div className="pm-eyebrow">Transport</div>
          <h1 className="pm-h1">Transport Sheet</h1>
          <div className="pm-h1-sub">{fmtLong(date)}</div>
        </div>
        <div className="pm-module-head-actions">
          <input className="tr-input tr-date-pick" type="date" value={date} onChange={e => pickDate(e.target.value)} />
          <button className="pm-btn pm-btn--ghost" onClick={importFromLog} title="Add this day's logged trips to the sheet (skips ones already on it)">
            ⇊ Import day's log
          </button>
          <button className="pm-btn pm-btn--primary" onClick={exportPdf}>↓ Export sheet</button>
        </div>
      </div>

      {/* Day summary from the log */}
      {Object.keys(summary).length > 0 && (
        <div className="tr-totals">
          {TRANSPORT_TYPES.filter(t => summary[t]).map(t => (
            <div key={t} className="tr-total-card">
              <div className="tr-total-label">{t}</div>
              <div className="tr-total-value">
                {summary[t].trips} trip{summary[t].trips === 1 ? '' : 's'}
                {summary[t].cost > 0 && <span className="tr-total-sub"> · £{summary[t].cost.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <datalist id="tr-locations">{locations.map(l => <option key={l.id} value={l.name} />)}</datalist>

      {SECTIONS.map(sec => {
        const rows = dayRows.filter(r => r.section === sec.key)
        return (
          <div key={sec.key} className="tr-sheet-section">
            <div className="tr-sheet-section-head">
              {sec.label}
              <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={() => store.addSheetRow(date, sec.key)}>+ Row</button>
            </div>
            <table className="crew-db-table tr-table">
              <thead>
                <tr>
                  <th className="crew-db-th" style={{ width: 110 }}>Time</th>
                  <th className="crew-db-th">Description</th>
                  <th className="crew-db-th">From</th>
                  <th className="crew-db-th">To</th>
                  <th className="crew-db-th">Driver/Contact</th>
                  <th className="crew-db-th" style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="tr-row">
                    <td className="tr-td"><Cell key={`t${r.id}${r.time}`} value={r.time} placeholder="07:30" multiline onCommit={v => store.updateSheetRow(r.id, 'time', v)} /></td>
                    <td className="tr-td tr-td--wide"><Cell key={`d${r.id}${r.description}`} value={r.description} placeholder="#1. NAME / Crew pickup…" multiline onCommit={v => store.updateSheetRow(r.id, 'description', v)} /></td>
                    <td className="tr-td tr-td--wide"><Cell key={`f${r.id}${r.fromLocation}`} value={r.fromLocation} listId="tr-locations" placeholder="From" multiline onCommit={v => { store.updateSheetRow(r.id, 'fromLocation', v); if (v.trim()) store.rememberLocation(v) }} /></td>
                    <td className="tr-td tr-td--wide"><Cell key={`to${r.id}${r.toLocation}`} value={r.toLocation} listId="tr-locations" placeholder="To" multiline onCommit={v => { store.updateSheetRow(r.id, 'toLocation', v); if (v.trim()) store.rememberLocation(v) }} /></td>
                    <td className="tr-td tr-td--wide">
                      <Cell
                        key={`dc${r.id}${r.driverContact}`}
                        value={r.driverContact}
                        placeholder="Name / phone / reg"
                        multiline
                        onCommit={v => store.updateSheetRow(r.id, 'driverContact', expandDriver(v))}
                      />
                    </td>
                    <td className="tr-td tr-td--actions">
                      <button className="pm-icon-btn danger" title="Delete row" onClick={() => store.deleteSheetRow(r.id)}>✕</button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td className="crew-db-cell" colSpan={6} style={{ color: '#c4c4c4', fontSize: 12 }}>—</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
