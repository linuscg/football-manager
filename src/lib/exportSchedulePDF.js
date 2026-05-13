/**
 * exportSchedulePDF — generates print-ready HTML pages for the schedule.
 *
 * Two modes:
 *   exportScheduleListPDF   — all shoot days expanded, grouped by date
 *   exportScheduleCalendarPDF — one calendar month per page, covering
 *                               prep-start → shoot-end
 */

// ─── Shared helpers ────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pad2(n) { return String(n).padStart(2, '0') }

function fmtDate(d) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function fmtDateShort(d) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtMonthYear(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function todayStr() {
  const t = new Date()
  return `${t.getFullYear()}-${pad2(t.getMonth()+1)}-${pad2(t.getDate())}`
}

const CAT_COLOR = {
  main:      '#2563eb',
  prep:      '#7c3aed',
  splinter:  '#0891b2',
  rehearsal: '#059669',
  other:     '#6b7280',
}
const CAT_BG = {
  main:      '#eff6ff',
  prep:      '#f5f3ff',
  splinter:  '#ecfeff',
  rehearsal: '#ecfdf5',
  other:     '#f9fafb',
}
const CAT_LABEL = {
  main:      (d) => `DAY ${pad2(d.dayNumber ?? '—')}`,
  prep:      (d) => `PREP${d.dayLabel ? ' ' + d.dayLabel : ''}`,
  splinter:  (d) => `SPLIT${d.dayLabel ? ' ' + d.dayLabel : ''}`,
  rehearsal: (d) => `REHR${d.dayLabel ? ' ' + d.dayLabel : ''}`,
  other:     (d) => `OTH${d.dayLabel ? ' ' + d.dayLabel : ''}`,
}
const CAT_FULL = {
  main:      'Main Unit',
  prep:      'Prep Day',
  splinter:  'Splinter Unit',
  rehearsal: 'Rehearsal',
  other:     'Other',
}

const EXTRAS_CATS = [
  { key: 'animals',  label: 'Animals' },
  { key: 'risk',     label: 'Risk Assessments' },
  { key: 'stunts',   label: 'Stunts' },
  { key: 'vfx',      label: 'VFX' },
  { key: 'extras',   label: 'Extras' },
  { key: 'other',    label: 'Other' },
  { key: 'visitors', label: 'Visitors' },
]

function openAndPrint(html) {
  const win = window.open('', '_blank', 'width=1200,height=900')
  if (!win) { alert('Pop-up blocked — please allow pop-ups for this site and try again.'); return }
  win.document.write(html)
  win.document.close()
}

// ─── LIST MODE ─────────────────────────────────────────────────────────────────

export function exportScheduleListPDF({ shootDays, production, castMembers = [] }) {

  // Sort days by date then sortOrder
  const sorted = [...shootDays].sort((a, b) => {
    if (!a.date && !b.date) return a.sortOrder - b.sortOrder
    if (!a.date) return 1
    if (!b.date) return -1
    return a.date < b.date ? -1 : a.date > b.date ? 1 : a.sortOrder - b.sortOrder
  })

  // Group by date (or "unscheduled")
  const groups = []
  const seenDates = []
  const byDate = {}
  for (const d of sorted) {
    const key = d.date || '__tbd__'
    if (!byDate[key]) { byDate[key] = []; seenDates.push(key) }
    byDate[key].push(d)
  }

  for (const key of seenDates) {
    const days = byDate[key]
    const main = days.filter(d => d.dayCategory !== 'prep').sort((a,b) => a.sortOrder - b.sortOrder)
    const prep = days.filter(d => d.dayCategory === 'prep').sort((a,b) => a.sortOrder - b.sortOrder)
    groups.push({ date: key, days: [...main, ...prep] })
  }

  // Cast lookup
  const castById = {}
  for (const c of castMembers) castById[c.id] = c

  function renderDayCard(day) {
    const cat   = day.dayCategory ?? 'main'
    const color = CAT_COLOR[cat] ?? CAT_COLOR.other
    const bg    = CAT_BG[cat]    ?? CAT_BG.other
    const tab   = (CAT_LABEL[cat] ?? CAT_LABEL.other)(day)
    const full  = CAT_FULL[cat]  ?? 'Other'
    const locs  = (day.locations ?? [day.location]).filter(Boolean)
    const scenes = day.scenes ?? []
    const hasScenes = scenes.length > 0

    // Extras
    const extraRows = EXTRAS_CATS
      .map(c => ({ ...c, items: (day.extras?.[c.key] ?? []).filter(i => i.description?.trim()) }))
      .filter(c => c.items.length > 0)

    // Scene cast names
    function castNames(castIds) {
      return (castIds ?? []).map(id => castById[id]?.name ?? id).join(', ')
    }

    return `
    <div class="day-card" style="--cat-color:${color}; --cat-bg:${bg};">
      <div class="day-card-header">
        <div class="day-tab">${esc(tab)}</div>
        <div class="day-header-body">
          <div class="day-header-row">
            <span class="day-type-badge">${esc(full)}</span>
            ${day.date ? `<span class="day-date">${esc(fmtDate(day.date))}</span>` : '<span class="day-tbd">Date TBD</span>'}
            ${day.generalCall ? `<span class="day-call">📞 ${esc(day.generalCall)}</span>` : ''}
          </div>
          ${locs.length ? `<div class="day-locs">${locs.map(l => `<span class="day-loc-pill">${esc(l)}</span>`).join('')}</div>` : ''}
          ${day.description ? `<div class="day-desc">${esc(day.description)}</div>` : ''}
          ${day.unitBase ? `<div class="day-unit-base"><strong>Unit Base:</strong> ${esc(day.unitBase)}</div>` : ''}
          ${day.notes ? `<div class="day-notes">${esc(day.notes)}</div>` : ''}
        </div>
      </div>

      ${hasScenes ? `
      <table class="scenes-table">
        <thead>
          <tr>
            <th class="sc-num">Sc#</th>
            <th class="sc-ie">I/E</th>
            <th class="sc-loc">Location</th>
            <th class="sc-dn">D/N</th>
            <th class="sc-desc">Description</th>
            <th class="sc-cast">Cast</th>
            <th class="sc-pages">Pgs</th>
          </tr>
        </thead>
        <tbody>
          ${scenes.map(s => `
          <tr>
            <td class="sc-num">${esc(s.sceneNumber)}</td>
            <td class="sc-ie">${esc(s.intExt)}</td>
            <td class="sc-loc">${esc(s.location)}</td>
            <td class="sc-dn">${esc(s.dayNight)}</td>
            <td class="sc-desc">${esc(s.description)}</td>
            <td class="sc-cast">${esc(castNames(s.castIds))}</td>
            <td class="sc-pages">${esc(s.pages)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="6" class="sc-total-label">Total pages</td>
            <td class="sc-pages sc-total">${calcTotalPages(scenes)}</td>
          </tr>
        </tfoot>
      </table>` : ''}

      ${extraRows.length ? `
      <div class="extras-row">
        ${extraRows.map(c => `
        <div class="extras-block">
          <div class="extras-cat">${esc(c.label)}</div>
          ${c.items.map(i => `<div class="extras-item">${esc(i.description)}</div>`).join('')}
        </div>`).join('')}
      </div>` : ''}
    </div>`
  }

  function calcTotalPages(scenes) {
    let total = 0
    for (const s of scenes) {
      const raw = String(s.pages ?? '').trim()
      if (!raw) continue
      if (raw.includes('/')) {
        const [n, d] = raw.split('/').map(Number)
        if (!isNaN(n) && !isNaN(d) && d > 0) total += n / d
      } else {
        const v = parseFloat(raw)
        if (!isNaN(v)) total += v
      }
    }
    if (total === 0) return '—'
    // Format as fraction if < 1, or round to 1 decimal
    const whole = Math.floor(total)
    const frac  = total - whole
    if (frac === 0) return String(whole)
    if (frac >= 0.875) return String(whole + 1)
    if (frac >= 0.625) return whole ? `${whole}⅞` : '⅞'
    if (frac >= 0.375) return whole ? `${whole}½` : '½'
    if (frac >= 0.125) return whole ? `${whole}¼` : '¼'
    return String(whole)
  }

  const totalMainDays = shootDays.filter(d => d.dayCategory === 'main' && d.date).length
  const totalScenes   = shootDays.reduce((s, d) => s + (d.scenes?.length ?? 0), 0)
  const hasUndated    = sorted.some(d => !d.date)

  const body = groups.map(({ date, days }) => {
    const isUndated = date === '__tbd__'
    return `
    <div class="date-group${isUndated ? ' date-group--tbd' : ''}">
      <div class="date-divider">
        ${isUndated
          ? '<span class="date-divider-label">Unscheduled — Date TBD</span>'
          : `<span class="date-divider-label">${esc(fmtDate(date))}</span>`}
      </div>
      ${days.map(renderDayCard).join('')}
    </div>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(production.name || 'Schedule')} — Shooting Schedule</title>
<style>
  @page {
    size: A4 portrait;
    margin: 12mm 10mm;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', 'Arial', sans-serif;
    font-size: 8.5pt;
    color: #111827;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Document header ── */
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding-bottom: 8pt;
    border-bottom: 2.5px solid #1e293b;
    margin-bottom: 14pt;
  }
  .doc-title { font-size: 18pt; font-weight: 800; color: #1e293b; letter-spacing: -0.02em; }
  .doc-sub   { font-size: 8pt; color: #64748b; margin-top: 2pt; }
  .doc-meta  { text-align: right; font-size: 7.5pt; color: #64748b; line-height: 1.6; }
  .doc-meta strong { color: #1e293b; }

  /* ── Date divider ── */
  .date-divider {
    display: flex;
    align-items: center;
    gap: 8pt;
    margin: 10pt 0 5pt;
  }
  .date-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #e2e8f0;
  }
  .date-divider-label {
    font-size: 8pt;
    font-weight: 700;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .date-group--tbd .date-divider-label { color: #94a3b8; }
  .date-group:first-child .date-divider { margin-top: 0; }

  /* ── Day card ── */
  .day-card {
    border-left: 4px solid var(--cat-color);
    background: #fff;
    border: 1px solid #e2e8f0;
    border-left: 4px solid var(--cat-color);
    border-radius: 4px;
    margin-bottom: 6pt;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .day-card-header {
    display: flex;
    align-items: stretch;
    background: var(--cat-bg);
    border-bottom: 1px solid #e2e8f0;
    padding: 0;
  }
  .day-tab {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    background: var(--cat-color);
    color: #fff;
    font-size: 7pt;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 6pt 4pt;
    min-width: 18pt;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .day-header-body {
    padding: 6pt 8pt;
    flex: 1;
  }
  .day-header-row {
    display: flex;
    align-items: center;
    gap: 8pt;
    flex-wrap: wrap;
    margin-bottom: 3pt;
  }
  .day-type-badge {
    font-size: 7pt;
    font-weight: 700;
    color: var(--cat-color);
    background: #fff;
    border: 1px solid var(--cat-color);
    border-radius: 3px;
    padding: 1pt 4pt;
    letter-spacing: 0.03em;
  }
  .day-date { font-size: 9pt; font-weight: 600; color: #1e293b; }
  .day-tbd  { font-size: 8pt; color: #94a3b8; font-style: italic; }
  .day-call { font-size: 8pt; font-weight: 600; color: #2563eb; margin-left: auto; }
  .day-locs { display: flex; gap: 4pt; flex-wrap: wrap; margin-top: 2pt; }
  .day-loc-pill {
    font-size: 7.5pt;
    background: #fff;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    padding: 0.5pt 5pt;
    color: #475569;
  }
  .day-desc, .day-unit-base, .day-notes {
    font-size: 7.5pt;
    color: #64748b;
    margin-top: 2pt;
  }
  .day-notes { font-style: italic; }

  /* ── Scenes table ── */
  .scenes-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 7.5pt;
  }
  .scenes-table th {
    background: #f8fafc;
    color: #64748b;
    font-weight: 700;
    font-size: 6.5pt;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 3pt 5pt;
    border-bottom: 1px solid #e2e8f0;
    text-align: left;
  }
  .scenes-table td {
    padding: 3pt 5pt;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: top;
    color: #1e293b;
  }
  .scenes-table tr:last-child td { border-bottom: none; }
  .scenes-table tfoot td {
    border-top: 1px solid #e2e8f0;
    border-bottom: none;
    background: #f8fafc;
    font-size: 7pt;
  }
  .sc-num   { width: 28pt; font-weight: 700; color: var(--cat-color); }
  .sc-ie    { width: 22pt; }
  .sc-loc   { width: 70pt; }
  .sc-dn    { width: 22pt; }
  .sc-desc  { }
  .sc-cast  { width: 90pt; color: #64748b; font-size: 7pt; }
  .sc-pages { width: 22pt; text-align: right; }
  .sc-total-label { text-align: right; color: #64748b; font-size: 7pt; padding-right: 5pt; }
  .sc-total { font-weight: 700; color: #1e293b; }

  /* ── Extras ── */
  .extras-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8pt;
    padding: 5pt 8pt;
    border-top: 1px solid #f1f5f9;
    background: #f8fafc;
  }
  .extras-block { }
  .extras-cat {
    font-size: 6.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #94a3b8;
    margin-bottom: 1pt;
  }
  .extras-item { font-size: 7.5pt; color: #475569; }

  /* ── Print bar (screen only) ── */
  @media screen {
    body { padding: 20px; background: #f1f5f9; }
    .doc-header { background: #fff; padding: 16px 20px 12px; border-radius: 8px 8px 0 0; border-bottom: 2px solid #1e293b; margin-bottom: 0; }
    .content-wrap { background: #fff; padding: 16px 20px 20px; border-radius: 0 0 8px 8px; max-width: 900px; margin: 0 auto; }
    .doc-header { max-width: 900px; margin: 0 auto; }
    .print-bar {
      position: fixed; top: 0; left: 0; right: 0;
      background: #1e293b; color: #fff;
      display: flex; align-items: center; gap: 12px;
      padding: 10px 20px; z-index: 9999;
      font-family: 'Helvetica Neue', Arial, sans-serif;
    }
    .print-btn {
      background: #2563eb; color: #fff; border: none;
      padding: 7px 16px; border-radius: 6px; font-size: 13px;
      font-weight: 600; cursor: pointer;
    }
    .print-btn:hover { background: #1d4ed8; }
    .print-hint { font-size: 12px; color: #94a3b8; }
    body { padding-top: 52px; }
  }
  @media print {
    .print-bar { display: none; }
    body { background: #fff; }
    .content-wrap { padding: 0; }
  }
</style>
</head>
<body>
<div class="print-bar">
  <button class="print-btn" onclick="window.print()">🖨 Save as PDF / Print</button>
  <span class="print-hint">Choose "Save as PDF" in the print dialog · A4 Portrait</span>
</div>
<div class="doc-header">
  <div>
    <div class="doc-title">${esc(production.name || 'Untitled Production')}</div>
    <div class="doc-sub">Shooting Schedule${production.shootStartDate && production.shootEndDate
      ? ` · Principal Photography ${fmtDateShort(production.shootStartDate)} → ${fmtDateShort(production.shootEndDate)}`
      : ''}</div>
  </div>
  <div class="doc-meta">
    <strong>${totalMainDays} shoot day${totalMainDays !== 1 ? 's' : ''}</strong> · ${totalScenes} scene${totalScenes !== 1 ? 's' : ''}<br>
    Printed ${fmtDateShort(todayStr())}
  </div>
</div>
<div class="content-wrap">
${body}
${hasUndated ? '' : ''}
</div>
<script>
  window.addEventListener('load', () => {
    setTimeout(() => window.print(), 400)
  })
<\/script>
</body>
</html>`

  openAndPrint(html)
}

// ─── CALENDAR MODE ─────────────────────────────────────────────────────────────

export function exportScheduleCalendarPDF({ shootDays, production }) {

  // Determine date range: prefer production dates, fall back to first/last shoot day
  function getRange() {
    const dated = shootDays.filter(d => d.date).map(d => d.date).sort()
    const fallbackStart = dated[0]
    const fallbackEnd   = dated[dated.length - 1]

    const start = production.prepStartDate  || production.shootStartDate || fallbackStart
    const end   = production.shootEndDate   || fallbackEnd

    if (!start || !end) return null
    return { start, end }
  }

  const range = getRange()
  if (!range) {
    alert('No dates found. Add shoot days or set production dates in Project Setup.')
    return
  }

  // Build list of months to render
  const months = []
  const startDt = new Date(range.start + 'T00:00:00')
  const endDt   = new Date(range.end   + 'T00:00:00')
  let cur = new Date(startDt.getFullYear(), startDt.getMonth(), 1)
  const endMonth = new Date(endDt.getFullYear(), endDt.getMonth(), 1)
  while (cur <= endMonth) {
    months.push({ year: cur.getFullYear(), month: cur.getMonth() })
    cur.setMonth(cur.getMonth() + 1)
  }

  // Build date → days map
  const byDate = {}
  for (const day of shootDays) {
    if (!day.date) continue
    if (!byDate[day.date]) byDate[day.date] = []
    byDate[day.date].push(day)
  }
  for (const key of Object.keys(byDate)) {
    const main = byDate[key].filter(d => d.dayCategory !== 'prep').sort((a,b) => a.sortOrder - b.sortOrder)
    const prep = byDate[key].filter(d => d.dayCategory === 'prep').sort((a,b) => a.sortOrder - b.sortOrder)
    byDate[key] = [...main, ...prep]
  }

  function buildGrid(year, month) {
    const firstDow = new Date(year, month, 1).getDay()
    const offset   = firstDow === 0 ? 6 : firstDow - 1
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < offset; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${year}-${pad2(month + 1)}-${pad2(d)}`)
    }
    while (cells.length % 7 !== 0) cells.push(null)
    const rows = []
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
    return rows
  }

  const today = todayStr()

  function renderStrip(day) {
    const cat   = day.dayCategory ?? 'main'
    const color = CAT_COLOR[cat] ?? CAT_COLOR.other
    const label = (CAT_LABEL[cat] ?? CAT_LABEL.other)(day)
    const locs  = (day.locations ?? [day.location]).filter(Boolean)
    const loc   = locs[0] || ''
    return `
    <div class="cal-strip" style="background:${color};">
      <span class="cal-strip-label">${esc(label)}${loc ? ` <span class="cal-strip-loc">— ${esc(loc)}</span>` : ''}</span>
      ${day.scenes?.length ? `<span class="cal-strip-scenes">Sc ${day.scenes.map(s=>s.sceneNumber).filter(Boolean).join(', ')}</span>` : ''}
    </div>`
  }

  function renderMonth(year, month) {
    const grid = buildGrid(year, month)
    const rows = grid.map(row => {
      const cells = row.map((dateStr, ci) => {
        const isWeekend = ci >= 5
        const isToday   = dateStr === today
        const inRange   = dateStr && dateStr >= range.start && dateStr <= range.end
        const outRange  = dateStr && !inRange
        const days      = dateStr ? (byDate[dateStr] ?? []) : []
        const dayNum    = dateStr ? parseInt(dateStr.slice(8)) : ''

        return `
        <td class="cal-cell${isWeekend ? ' weekend' : ''}${isToday ? ' today' : ''}${outRange ? ' out-range' : ''}">
          ${dateStr ? `
          <div class="cal-cell-num${isToday ? ' today-num' : ''}">${dayNum}</div>
          ${days.map(renderStrip).join('')}
          ` : ''}
        </td>`
      }).join('')
      return `<tr>${cells}</tr>`
    }).join('')

    return `
    <div class="month-page">
      <div class="month-header">
        <div class="month-title">${esc(fmtMonthYear(year, month))}</div>
        <div class="month-prod">${esc(production.name || 'Untitled Production')}</div>
      </div>
      <table class="cal-table">
        <thead>
          <tr>
            ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i) =>
              `<th class="cal-th${i >= 5 ? ' weekend' : ''}">${d}</th>`
            ).join('')}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="month-legend">
        ${Object.entries(CAT_COLOR).map(([cat, color]) =>
          `<span class="legend-item"><span class="legend-dot" style="background:${color}"></span>${CAT_FULL[cat]}</span>`
        ).join('')}
      </div>
    </div>`
  }

  const pages = months.map(({ year, month }) => renderMonth(year, month)).join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(production.name || 'Schedule')} — Calendar</title>
<style>
  @page {
    size: A4 landscape;
    margin: 8mm 8mm;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', 'Arial', sans-serif;
    font-size: 8pt;
    color: #111827;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Month page ── */
  .month-page {
    page-break-after: always;
    height: 190mm;
    display: flex;
    flex-direction: column;
  }
  .month-page:last-child { page-break-after: auto; }

  .month-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 2.5px solid #1e293b;
    padding-bottom: 5pt;
    margin-bottom: 6pt;
  }
  .month-title { font-size: 16pt; font-weight: 800; color: #1e293b; letter-spacing: -0.02em; }
  .month-prod  { font-size: 8pt; color: #64748b; }

  /* ── Calendar table ── */
  .cal-table {
    width: 100%;
    border-collapse: collapse;
    flex: 1;
    table-layout: fixed;
  }
  .cal-th {
    font-size: 7pt;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 3pt 4pt;
    text-align: left;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
  }
  .cal-th.weekend { color: #94a3b8; background: #f8fafc; }
  .cal-cell {
    vertical-align: top;
    border: 1px solid #e2e8f0;
    padding: 2pt 3pt;
    width: calc(100% / 7);
    min-height: 22mm;
  }
  .cal-cell.weekend   { background: #fafafa; }
  .cal-cell.today     { background: #eff6ff; border-color: #93c5fd; }
  .cal-cell.out-range { background: #f8fafc; opacity: 0.45; }
  .cal-cell-num {
    font-size: 8.5pt;
    font-weight: 600;
    color: #374151;
    margin-bottom: 2pt;
  }
  .today-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14pt;
    height: 14pt;
    background: #2563eb;
    color: #fff;
    border-radius: 50%;
    font-size: 7.5pt;
  }

  /* ── Day strips ── */
  .cal-strip {
    border-radius: 3px;
    padding: 1.5pt 4pt;
    margin-bottom: 2pt;
    color: #fff;
    font-size: 6.5pt;
    font-weight: 600;
    line-height: 1.3;
    page-break-inside: avoid;
  }
  .cal-strip-label { display: block; }
  .cal-strip-loc   { font-weight: 400; opacity: 0.85; }
  .cal-strip-scenes {
    display: block;
    font-size: 5.5pt;
    font-weight: 400;
    opacity: 0.8;
    margin-top: 1pt;
  }

  /* ── Legend ── */
  .month-legend {
    display: flex;
    gap: 12pt;
    margin-top: 5pt;
    padding-top: 4pt;
    border-top: 1px solid #e2e8f0;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 3pt;
    font-size: 6.5pt;
    color: #64748b;
  }
  .legend-dot {
    width: 7pt;
    height: 7pt;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* ── Print bar (screen only) ── */
  @media screen {
    body { padding: 20px; background: #f1f5f9; padding-top: 60px; }
    .month-page {
      background: #fff;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
      max-width: 1100px;
      margin-left: auto;
      margin-right: auto;
      height: auto;
    }
    .print-bar {
      position: fixed; top: 0; left: 0; right: 0;
      background: #1e293b; color: #fff;
      display: flex; align-items: center; gap: 12px;
      padding: 10px 20px; z-index: 9999;
      font-family: 'Helvetica Neue', Arial, sans-serif;
    }
    .print-btn {
      background: #2563eb; color: #fff; border: none;
      padding: 7px 16px; border-radius: 6px; font-size: 13px;
      font-weight: 600; cursor: pointer;
    }
    .print-btn:hover { background: #1d4ed8; }
    .print-hint { font-size: 12px; color: #94a3b8; }
  }
  @media print {
    .print-bar { display: none; }
    body { background: #fff; padding: 0; }
  }
</style>
</head>
<body>
<div class="print-bar">
  <button class="print-btn" onclick="window.print()">🖨 Save as PDF / Print</button>
  <span class="print-hint">Choose "Save as PDF" in the print dialog · A4 Landscape · ${months.length} page${months.length !== 1 ? 's' : ''}</span>
</div>
${pages}
<script>
  window.addEventListener('load', () => {
    setTimeout(() => window.print(), 400)
  })
<\/script>
</body>
</html>`

  openAndPrint(html)
}
