/**
 * exportBackpagePDF — generates a PDF-ready HTML page that mirrors the
 * Excel backpage layout (3-column crew grid) and triggers the browser
 * print dialog. The user selects "Save as PDF" from the print dialog.
 *
 * Accepts the exact same arguments as exportBackpageXLSX so the caller
 * can share its data-building logic.
 *
 * @param {object} opts
 *   production  – { name }
 *   day         – { date, dayNumber, dayCategory, generalCall, locations, unitBase }
 *   depts       – [{ name, members: [{ name, role, callTime, wrapTime, excluded, status }] }]
 *   addDepts    – same shape, rendered as "Additional Crew" section
 */
export function exportBackpagePDF({ production, day, depts, addDepts = [] }) {

  // ── Helpers ────────────────────────────────────────────────────────────────

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // Dept sort — Producers → Directors → Production → A-Z (same as XLSX)
  function deptPriority(name) {
    const base = name.replace(/ - Additional$/i, '').trim().toLowerCase()
    if (/^producers?$/.test(base)) return 0
    if (/^directors?$/.test(base)) return 1
    if (base === 'production')     return 2
    return 3
  }

  function sortDeptArray(arr) {
    return [...arr].sort((a, b) => {
      const pa = deptPriority(a.name), pb = deptPriority(b.name)
      if (pa !== pb) return pa - pb
      return a.name.localeCompare(b.name)
    })
  }

  // Build flat item list for a dept array
  function buildItems(deptArray) {
    const items = []
    for (const dept of deptArray) {
      if (!dept.members.length) continue
      items.push({ type: 'dept', name: dept.name })
      for (const m of dept.members) {
        items.push({
          type:     'crew',
          name:     m.name     || '',
          role:     m.role     || '',
          call:     m.callTime || '',
          wrap:     m.wrapTime || '',
          excluded: m.excluded ?? false,
          status:   m.status   ?? 'work',
        })
      }
    }
    return items
  }

  // Split items into 3 roughly equal columns, breaking only on dept headers
  function distribute3(items) {
    const target = Math.ceil(items.length / 3)
    const cols   = [[], [], []]
    let colIdx = 0, count = 0
    for (let i = 0; i < items.length; i++) {
      if (colIdx < 2 && count >= target && items[i].type === 'dept') {
        colIdx++; count = 0
      }
      cols[colIdx].push(items[i])
      count++
    }
    return cols
  }

  // ── HTML row builders ──────────────────────────────────────────────────────

  function deptRow(name, isAdditional) {
    const cls = isAdditional ? 'dept-row dept-row--add' : 'dept-row'
    return `<tr class="${cls}">
      <td class="dept-cell" colspan="4">${esc(name.toUpperCase())}</td>
    </tr>`
  }

  function crewRow(item) {
    const dim    = item.excluded || (item.status && item.status !== 'work')
    const strike = item.status === 'N/A'
    const cls    = ['crew-row', dim ? 'crew-row--dim' : '', strike ? 'crew-row--strike' : ''].filter(Boolean).join(' ')
    const call   = dim ? esc(item.status) : esc(item.call)
    const wrap   = dim ? '' : esc(item.wrap)
    return `<tr class="${cls}">
      <td class="c-name">${esc(item.name)}</td>
      <td class="c-role">${esc(item.role)}</td>
      <td class="c-time">${call}</td>
      <td class="c-time">${wrap}</td>
    </tr>`
  }

  function emptyRow() {
    return `<tr class="crew-row"><td></td><td></td><td></td><td></td></tr>`
  }

  // Render 3 columns side by side as a single HTML table
  function renderGrid(cols3, isAdditional) {
    const maxRows = Math.max(cols3[0].length, cols3[1].length, cols3[2].length)
    const hdrCls  = isAdditional ? 'col-hdr col-hdr--add' : 'col-hdr'

    // Build one sub-table per column, then lay them out via a 3-col wrapper table
    const tables = cols3.map(items => {
      const rows = []
      for (let i = 0; i < maxRows; i++) {
        const item = items[i]
        if (!item)                     rows.push(emptyRow())
        else if (item.type === 'dept') rows.push(deptRow(item.name, isAdditional))
        else                           rows.push(crewRow(item))
      }
      return `
        <table class="col-table">
          <thead>
            <tr class="${hdrCls}">
              <th class="ch-name">NAME</th>
              <th class="ch-role">POSITION</th>
              <th class="ch-time">IN</th>
              <th class="ch-time">OUT</th>
            </tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>`
    })

    return `<div class="grid3">${tables.join('')}</div>`
  }

  // ── Date / day strings ─────────────────────────────────────────────────────

  const dateStr = day.date
    ? new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : ''

  const sdLabel = day.dayCategory === 'main'
    ? `Shoot Day ${day.dayNumber ?? '—'} · MAIN UNIT`
    : (day.dayCategory || 'Day').toUpperCase()

  const locText  = day.locations?.[0] || day.unitBase || ''
  const callText = day.generalCall ? `General Call: ${day.generalCall}` : ''

  const dlDate = day.date
    ? new Date(day.date + 'T00:00:00')
        .toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
        .replace(' ', '')
    : 'Day'
  const dlDay  = day.dayCategory === 'main' && day.dayNumber ? `D${day.dayNumber}-` : ''
  const dlCat  = day.dayCategory !== 'main' ? `${day.dayCategory ?? 'day'}-` : ''
  const filename = `Backpage-${dlDay}${dlCat}${dlDate}.pdf`

  // ── Section HTML ───────────────────────────────────────────────────────────

  const ftItems  = buildItems(sortDeptArray(depts))
  const ftGrid   = ftItems.length  ? renderGrid(distribute3(ftItems), false) : ''

  const hasAdd   = addDepts.length > 0 && addDepts.some(d => d.members.length > 0)
  const addItems = hasAdd ? buildItems(sortDeptArray(addDepts)) : []
  const addGrid  = hasAdd ? renderGrid(distribute3(addItems), true) : ''

  const addSection = hasAdd ? `
    <div class="section-label section-label--add">ADDITIONAL CREW</div>
    ${addGrid}
  ` : ''

  // ── Full HTML document ─────────────────────────────────────────────────────

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(filename)}</title>
<style>
  /* ── Reset ── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Page setup ── */
  @page {
    size: A4 landscape;
    margin: 12mm 10mm;
  }
  body {
    font-family: 'Calibri', 'Arial', sans-serif;
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
    align-items: flex-start;
    padding-bottom: 6pt;
    border-bottom: 2px solid #1A2741;
    margin-bottom: 6pt;
  }
  .doc-title {
    font-size: 20pt;
    font-weight: 700;
    color: #1A2741;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .doc-right {
    text-align: right;
  }
  .doc-prod {
    font-size: 10pt;
    font-weight: 700;
    color: #1A2741;
    text-transform: uppercase;
  }
  .doc-date {
    font-size: 8pt;
    color: #6B7280;
    margin-top: 2pt;
  }
  .doc-day {
    font-size: 9pt;
    font-weight: 700;
    color: #1A2741;
    margin-top: 1pt;
  }
  .doc-call {
    font-size: 11pt;
    font-weight: 700;
    color: #2563EB;
    margin-top: 2pt;
  }
  .doc-loc {
    font-size: 8pt;
    color: #6B7280;
    margin-top: 1pt;
  }

  /* ── Section label ── */
  .section-label {
    font-size: 6.5pt;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #9CA3AF;
    margin: 8pt 0 3pt;
  }
  .section-label--add {
    color: #7C3AED;
    margin-top: 10pt;
    padding-top: 8pt;
    border-top: 1px solid #DDD6FE;
  }

  /* ── 3-column grid ── */
  .grid3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 4pt;
  }

  /* ── Per-column table ── */
  .col-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  /* ── Column header row ── */
  .col-hdr th {
    background: #1A2741;
    color: #ffffff;
    font-size: 7pt;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 3pt 4pt;
    border: 0.5pt solid #0F1C31;
  }
  .col-hdr--add th {
    background: #4C1D95;
    border-color: #3B1278;
  }

  /* ── Column widths ── */
  .ch-name { width: 40%; text-align: left; }
  .ch-role { width: 30%; text-align: left; }
  .ch-time { width: 15%; text-align: center; }

  /* ── Dept header row ── */
  .dept-row td {
    background: #E2E8F0;
    color: #1E293B;
    font-size: 7pt;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 3pt 4pt;
    border: 0.5pt solid #D1D5DB;
  }
  .dept-row--add td {
    background: #EDE9FE;
    color: #3B0764;
  }

  /* ── Crew data row ── */
  .crew-row td {
    padding: 2.5pt 4pt;
    border: 0.5pt solid #D1D5DB;
    vertical-align: middle;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .c-name { font-size: 8pt; color: #111827; }
  .c-role { font-size: 7.5pt; color: #4B5563; }
  .c-time { font-size: 8pt; font-weight: 700; text-align: center; color: #111827; }

  .crew-row--dim td  { color: #AAAAAA !important; font-style: italic; background: #F3F4F6; }
  .crew-row--strike td { text-decoration: line-through; }

  /* ── Screen-only: print button bar ── */
  @media screen {
    body { padding: 16px; background: #f3f4f6; }
    .print-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
    }
    .print-btn {
      padding: 7px 18px;
      background: #2563EB;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    .print-btn:hover { background: #1d4ed8; }
    .print-hint {
      font-size: 12px;
      color: #6B7280;
    }
    .page { background: #fff; padding: 20px; box-shadow: 0 2px 12px rgba(0,0,0,.12); max-width: 297mm; margin: 0 auto; }
  }
  @media print {
    .print-bar { display: none; }
    body { padding: 0; background: #fff; }
    .page { box-shadow: none; padding: 0; }
  }
</style>
</head>
<body>

<div class="print-bar">
  <button class="print-btn" onclick="window.print()">🖨 Save as PDF / Print</button>
  <span class="print-hint">Choose "Save as PDF" in the print dialog · Layout: A4 Landscape</span>
</div>

<div class="page">

  <!-- Header -->
  <div class="doc-header">
    <div class="doc-title">BACK PAGE</div>
    <div class="doc-right">
      <div class="doc-prod">${esc(production.name || '')}</div>
      <div class="doc-date">${esc(dateStr)}</div>
      <div class="doc-day">${esc(sdLabel)}</div>
      ${callText ? `<div class="doc-call">${esc(callText)}</div>` : ''}
      ${locText  ? `<div class="doc-loc">${esc(locText)}</div>`  : ''}
    </div>
  </div>

  <!-- Crew -->
  ${ftGrid ? `<div class="section-label">CREW</div>${ftGrid}` : ''}

  <!-- Additional Crew -->
  ${addSection}

</div>

<script>
  // Auto-trigger print on load so clicking "Export PDF" in the app
  // immediately opens the save dialog without an extra click.
  window.addEventListener('load', () => window.print())
</script>
</body>
</html>`

  // ── Open in new window and print ──────────────────────────────────────────

  const win = window.open('', '_blank', 'width=1100,height=800')
  if (!win) {
    alert('Pop-up blocked — please allow pop-ups for this site and try again.')
    return
  }
  win.document.write(html)
  win.document.close()
}
