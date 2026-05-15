import { useState, useEffect, useMemo } from 'react'
import { useDprStore } from '../store/useDprStore'
import {
  formatDate, shortDate, todayISO, pickInitialDay, LS_KEY,
  parsePages, formatPages,
} from './DPR'

// ─── Reusable inputs ──────────────────────────────────────────────────────────

function TextCell({ value, onCommit, type = 'text', placeholder }) {
  const [local, setLocal] = useState(value ?? '')
  useEffect(() => { setLocal(value ?? '') }, [value])
  return (
    <input
      type={type}
      value={local ?? ''}
      placeholder={placeholder ?? ''}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        if (String(value ?? '') !== String(local ?? '')) {
          onCommit(type === 'number' ? (local === '' ? 0 : Number(local)) : local)
        }
      }}
    />
  )
}

function TextareaCell({ value, onCommit, rows = 3 }) {
  const [local, setLocal] = useState(value ?? '')
  useEffect(() => { setLocal(value ?? '') }, [value])
  return (
    <textarea
      rows={rows}
      value={local ?? ''}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if ((value ?? '') !== local) onCommit(local) }}
    />
  )
}

// ─── Day picker (same UX as DPR) ──────────────────────────────────────────────

function DayPicker({ mainDays, value, onChange }) {
  const idx = mainDays.findIndex(d => d.id === value)
  const goPrev  = () => { if (idx > 0) onChange(mainDays[idx - 1].id) }
  const goNext  = () => { if (idx >= 0 && idx < mainDays.length - 1) onChange(mainDays[idx + 1].id) }
  const goToday = () => {
    const today = todayISO()
    const todayDay = mainDays.find(d => d.date === today)
    if (todayDay) { onChange(todayDay.id); return }
    const past = [...mainDays].filter(d => d.date && d.date <= today).sort((a, b) => b.date.localeCompare(a.date))[0]
    if (past) onChange(past.id)
    else if (mainDays.length) onChange(mainDays[0].id)
  }
  return (
    <div className="dpr-day-picker" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Shoot Day</span>
      <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={goPrev}  disabled={idx <= 0} title="Previous day">◀</button>
      <select
        className="dpr-day-select"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      >
        {mainDays.map(d => (
          <option key={d.id} value={d.id}>
            Day {d.dayNumber ?? '—'} · {shortDate(d.date)}{d.location ? ` · ${d.location}` : ''}
          </option>
        ))}
      </select>
      <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={goNext} disabled={idx < 0 || idx >= mainDays.length - 1} title="Next day">▶</button>
      <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={goToday} title="Jump to today">Today</button>
    </div>
  )
}

// ─── Main module ──────────────────────────────────────────────────────────────

export default function WrapReport({ productionName, shootDays }) {
  const { dprs, loading, ensureDpr, updateDpr } = useDprStore()

  const mainDays = useMemo(
    () => shootDays.filter(d => d.dayCategory === 'main' && !d.isNonShootDay),
    [shootDays]
  )

  const [selectedDayId, setSelectedDayId] = useState(() => pickInitialDay(shootDays))

  useEffect(() => {
    if (selectedDayId && !shootDays.find(d => d.id === selectedDayId)) {
      setSelectedDayId(pickInitialDay(shootDays))
    } else if (!selectedDayId && shootDays.length) {
      setSelectedDayId(pickInitialDay(shootDays))
    }
  }, [shootDays, selectedDayId])

  useEffect(() => {
    if (selectedDayId) localStorage.setItem(LS_KEY, selectedDayId)
  }, [selectedDayId])

  const selectedDay = useMemo(
    () => shootDays.find(d => d.id === selectedDayId) ?? null,
    [shootDays, selectedDayId]
  )

  const dpr = useMemo(
    () => (selectedDayId ? dprs.find(d => d.shootDayId === selectedDayId) ?? null : null),
    [dprs, selectedDayId]
  )

  // Auto-create the DPR row if it doesn't exist yet; rely on DPR.jsx for richer prefill.
  useEffect(() => {
    if (!selectedDayId || loading) return
    if (!dprs.find(d => d.shootDayId === selectedDayId)) {
      ensureDpr(selectedDayId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDayId, loading, dprs.length])

  // ── Pages Shot (calculated from scene rows with status 'shot' or 'part') ──
  const pagesShot = useMemo(() => {
    if (!dpr) return 0
    const rows = (dpr.scenes ?? []).filter(s => !s.removed && (s.status === 'shot' || s.status === 'part'))
    return rows.reduce((sum, s) => sum + parsePages(s.pages), 0)
  }, [dpr])

  // ── All-days "scheduled but not shot" rollup ──
  const allDaysNotShot = useMemo(() => {
    const rows = []
    for (const d of dprs) {
      const text = String(d.scheduledNotShot ?? '').trim()
      if (!text) continue
      const day = shootDays.find(sd => sd.id === d.shootDayId)
      if (!day) continue
      rows.push({
        dprId: d.id,
        dayNumber: day.dayNumber ?? '—',
        date: day.date,
        scheduledNotShot: text,
      })
    }
    rows.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    return rows
  }, [dprs, shootDays])

  if (!shootDays.length || !mainDays.length) {
    return (
      <div className="wrap-rep-wrap">
        <div style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: 40, textAlign: 'center', color: '#6b7280',
        }}>
          No shoot days available. Add some on the Schedule page first.
        </div>
      </div>
    )
  }

  if (loading || !dpr || !selectedDay) {
    return (
      <div className="wrap-rep-wrap">
        <div className="wrap-rep-top">
          <DayPicker mainDays={mainDays} value={selectedDayId} onChange={setSelectedDayId} />
        </div>
        <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading…</div>
      </div>
    )
  }

  function handleExportPdf() {
    const html = renderWrapHtml({ productionName, dpr, selectedDay, pagesShot })
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print() }, 500)
  }

  async function handleExportExcel() {
    const XLSX = await import('xlsx-js-style')
    const wb = XLSX.utils.book_new()
    const data = []
    data.push(['WRAP REPORT', productionName || ''])
    data.push([])
    data.push(['Shoot Day', `Day ${selectedDay.dayNumber ?? ''}`])
    data.push(['Date', formatDate(selectedDay.date)])
    data.push(['Unit Call', dpr.unitCall])
    data.push(['First Turnover', dpr.firstShotAm])
    data.push(['Lunch', `${dpr.lunchStart ?? ''} – ${dpr.lunchEnd ?? ''}`])
    data.push(['First Turnover After Lunch', dpr.firstShotAfter])
    data.push(['Camera Wrap', dpr.actualWrap])
    data.push(['Total Setups', dpr.setUpsToday])
    data.push(['Pages Shot', formatPages(pagesShot)])
    data.push(['Scenes Scheduled', dpr.scenesScheduled])
    data.push(['Scenes Completed', dpr.scenesShot])
    data.push(['Scenes Part Completed', dpr.partComplete])
    data.push(['Scenes Scheduled Not Shot', dpr.scheduledNotShot])
    data.push(['Scenes Shot Not Scheduled', dpr.shotNotScheduled])
    data.push(['Notes', dpr.notes])
    data.push([])
    data.push(['Scenes Scheduled But Not Shot — All Days'])
    data.push(['Day', 'Date', 'Scenes Not Shot'])
    for (const row of allDaysNotShot) {
      data.push([`Day ${row.dayNumber}`, formatDate(row.date), row.scheduledNotShot])
    }
    const ws = XLSX.utils.aoa_to_sheet(data)
    XLSX.utils.book_append_sheet(wb, ws, 'Wrap Report')
    const fname = `Wrap Report - ${productionName || 'Production'} - Day ${selectedDay.dayNumber ?? ''}.xlsx`
    XLSX.writeFile(wb, fname)
  }

  function commit(field, value) { updateDpr(dpr.id, field, value) }

  return (
    <div className="wrap-rep-wrap">
      <div className="wrap-rep-top">
        <DayPicker mainDays={mainDays} value={selectedDayId} onChange={setSelectedDayId} />
        <div className="dpr-export-btns">
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={handleExportPdf}>↓ Export PDF</button>
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={handleExportExcel}>↓ Export Excel</button>
        </div>
      </div>

      <div className="wrap-rep-title">WRAP REPORT</div>

      <table className="wrap-rep-table">
        <tbody>
          <tr>
            <td className="label">Shoot Day</td>
            <td className="value">SHOOT DAY {selectedDay.dayNumber ?? ''}</td>
          </tr>
          <tr>
            <td className="label">Date</td>
            <td className="value">{formatDate(selectedDay.date)}</td>
          </tr>
          <tr>
            <td className="label">Unit Call</td>
            <td className="value"><TextCell value={dpr.unitCall} onCommit={v => commit('unitCall', v)} placeholder="HH:MM" /></td>
          </tr>
          <tr>
            <td className="label">First Turnover</td>
            <td className="value"><TextCell value={dpr.firstShotAm} onCommit={v => commit('firstShotAm', v)} placeholder="HH:MM" /></td>
          </tr>
          <tr>
            <td className="label">Lunch</td>
            <td className="value">
              <div className="wrap-rep-lunch">
                <TextCell value={dpr.lunchStart} onCommit={v => commit('lunchStart', v)} placeholder="HH:MM" />
                <span style={{ color: '#9ca3af' }}>–</span>
                <TextCell value={dpr.lunchEnd}   onCommit={v => commit('lunchEnd', v)}   placeholder="HH:MM" />
              </div>
            </td>
          </tr>
          <tr>
            <td className="label">First Turnover After Lunch</td>
            <td className="value"><TextCell value={dpr.firstShotAfter} onCommit={v => commit('firstShotAfter', v)} placeholder="HH:MM" /></td>
          </tr>
          <tr>
            <td className="label">Camera Wrap</td>
            <td className="value"><TextCell value={dpr.actualWrap} onCommit={v => commit('actualWrap', v)} placeholder="HH:MM" /></td>
          </tr>
          <tr className="section-break">
            <td className="label">Total Setups</td>
            <td className="value"><TextCell type="number" value={dpr.setUpsToday} onCommit={v => commit('setUpsToday', Number(v) || 0)} /></td>
          </tr>
          <tr>
            <td className="label">Pages Shot</td>
            <td className="value" style={{ fontWeight: 600 }}>{formatPages(pagesShot)}</td>
          </tr>
          <tr>
            <td className="label">Scenes Scheduled</td>
            <td className="value"><TextCell value={dpr.scenesScheduled} onCommit={v => commit('scenesScheduled', v)} /></td>
          </tr>
          <tr>
            <td className="label">Scenes Completed</td>
            <td className="value"><TextCell value={dpr.scenesShot} onCommit={v => commit('scenesShot', v)} /></td>
          </tr>
          <tr>
            <td className="label">Scenes Part Completed</td>
            <td className="value"><TextCell value={dpr.partComplete} onCommit={v => commit('partComplete', v)} /></td>
          </tr>
          <tr>
            <td className="label">Scenes Scheduled Not Shot</td>
            <td className="value"><TextCell value={dpr.scheduledNotShot} onCommit={v => commit('scheduledNotShot', v)} /></td>
          </tr>
          <tr>
            <td className="label">Scenes Shot Not Scheduled</td>
            <td className="value"><TextCell value={dpr.shotNotScheduled} onCommit={v => commit('shotNotScheduled', v)} /></td>
          </tr>
          <tr>
            <td className="label">Notes</td>
            <td className="value"><TextareaCell value={dpr.notes} onCommit={v => commit('notes', v)} rows={3} /></td>
          </tr>
        </tbody>
      </table>

      <div className="wrap-rep-panel">
        <div className="wrap-rep-panel-title">Scenes Scheduled But Not Shot — All Days</div>
        {allDaysNotShot.length === 0 ? (
          <div className="wrap-rep-panel-empty">All scheduled scenes have been shot.</div>
        ) : (
          <table className="dpr-table">
            <thead>
              <tr><th>Day</th><th>Date</th><th>Scenes Not Shot</th></tr>
            </thead>
            <tbody>
              {allDaysNotShot.map(row => (
                <tr key={row.dprId}>
                  <td>Day {row.dayNumber}</td>
                  <td>{formatDate(row.date)}</td>
                  <td>{row.scheduledNotShot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── PDF (print-window) renderer ──────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderWrapHtml({ productionName, dpr, selectedDay, pagesShot }) {
  const rows = [
    ['Shoot Day',                   `SHOOT DAY ${selectedDay.dayNumber ?? ''}`],
    ['Date',                        formatDate(selectedDay.date)],
    ['Unit Call',                   dpr.unitCall],
    ['First Turnover',              dpr.firstShotAm],
    ['Lunch',                       `${dpr.lunchStart ?? ''} – ${dpr.lunchEnd ?? ''}`],
    ['First Turnover After Lunch',  dpr.firstShotAfter],
    ['Camera Wrap',                 dpr.actualWrap],
    ['Total Setups',                dpr.setUpsToday],
    ['Pages Shot',                  formatPages(pagesShot)],
    ['Scenes Scheduled',            dpr.scenesScheduled],
    ['Scenes Completed',            dpr.scenesShot],
    ['Scenes Part Completed',       dpr.partComplete],
    ['Scenes Scheduled Not Shot',   dpr.scheduledNotShot],
    ['Scenes Shot Not Scheduled',   dpr.shotNotScheduled],
    ['Notes',                       dpr.notes],
  ]
  const bodyRows = rows.map(([l, v]) =>
    `<tr><td class="lbl">${esc(l)}</td><td class="val">${esc(v)}</td></tr>`
  ).join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<title>Wrap Report — ${esc(productionName)} — Day ${esc(selectedDay.dayNumber)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #111; padding: 32px; font-size: 12px; }
  h1 { font-size: 20px; text-align: center; letter-spacing: 0.08em; margin-bottom: 18px; }
  .prod { text-align: center; font-size: 13px; color: #444; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; border: 1px solid #d1d5db; }
  tr { border-bottom: 1px solid #e5e7eb; }
  td { padding: 8px 12px; font-size: 12px; vertical-align: middle; }
  td.lbl { font-weight: 700; text-transform: uppercase; width: 45%; background: #fafafa; }
  @media print { @page { margin: 14mm; size: A4; } body { padding: 0; } }
</style></head>
<body>
  <h1>WRAP REPORT</h1>
  <div class="prod">${esc(productionName)}</div>
  <table><tbody>${bodyRows}</tbody></table>
</body></html>`
}
