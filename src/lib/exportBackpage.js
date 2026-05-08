/**
 * exportBackpageXLSX — generates a professional crew backpage Excel file.
 * Uses xlsx-js-style (browser-native, no Node.js dependencies).
 *
 * @param {object} opts
 *   production  – { name }
 *   day         – { date, dayNumber, dayCategory, generalCall, locations, unitBase }
 *   depts       – [{ name, members: [{ name, role, callTime, wrapTime }] }]
 */
export async function exportBackpageXLSX({ production, day, depts }) {
  const XLSX = (await import('xlsx-js-style')).default

  // ── Colour palette (6-char RGB, no alpha) ───────────────────────────────
  const C = {
    dark:   '1A2741',
    accent: '2563EB',
    deptBg: 'E2E8F0',
    deptFg: '1E293B',
    hdrBg:  '1A2741',
    white:  'FFFFFF',
    border: 'D1D5DB',
    hdrBdr: '0F1C31',
    gray:   '6B7280',
    muted:  '9CA3AF',
  }

  function thinBorder(col) {
    const s = { style: 'thin', color: { rgb: col } }
    return { top: s, left: s, bottom: s, right: s }
  }

  // ── Build flat item list ─────────────────────────────────────────────────
  const items = []
  for (const dept of depts) {
    items.push({ type: 'dept', name: dept.name })
    for (const m of dept.members) {
      items.push({ type: 'crew', name: m.name || '', role: m.role || '', call: m.callTime || '', wrap: m.wrapTime || '' })
    }
  }

  // Distribute into 3 roughly equal columns, only breaking on dept boundaries
  const target = Math.ceil(items.length / 3)
  const cols3  = [[], [], []]
  let colIdx = 0, count = 0
  for (let i = 0; i < items.length; i++) {
    if (colIdx < 2 && count >= target && items[i].type === 'dept') {
      colIdx++; count = 0
    }
    cols3[colIdx].push(items[i])
    count++
  }
  const maxDataRows = Math.max(cols3[0].length, cols3[1].length, cols3[2].length)

  // ── Build sheet as array-of-arrays ──────────────────────────────────────
  const aoa     = []   // rows of cell values
  const cellSty = {}  // 'A1' → style object
  const merges  = []  // {s:{r,c}, e:{r,c}}

  const R = () => aoa.length - 1  // current row index (0-based)

  function addRow(vals) { aoa.push(vals) }
  function sty(r, c, s) { cellSty[addr(r, c)] = s }

  function addr(r, c) {
    // supports cols 0-25 (A-Z) — 12 cols is fine
    return String.fromCharCode(65 + c) + (r + 1)
  }

  function merge(r1, c1, r2, c2) {
    merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } })
  }

  // ── Header rows ──────────────────────────────────────────────────────────

  // Row 0: top padding
  addRow(new Array(12).fill(''))

  // Row 1: BACK PAGE  |  PRODUCTION NAME
  const dateStr = day.date
    ? new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : ''
  addRow(['BACK PAGE', '', '', '', '', '', (production.name || '').toUpperCase(), '', '', '', '', ''])
  sty(R(), 0, { font: { bold: true, sz: 22, color: { rgb: C.dark }, name: 'Calibri' }, alignment: { vertical: 'center' } })
  sty(R(), 6, { font: { bold: true, sz: 12, color: { rgb: C.dark }, name: 'Calibri' }, alignment: { horizontal: 'right', vertical: 'center' } })
  merge(R(), 0, R(), 5); merge(R(), 6, R(), 11)

  // Row 2: date  |  shoot day label
  const sdLabel = day.dayCategory === 'main'
    ? `Shoot Day  ${day.dayNumber ?? '—'}   ·   MAIN UNIT`
    : (day.dayCategory || 'Day').toUpperCase()
  addRow([dateStr, '', '', '', '', '', sdLabel, '', '', '', '', ''])
  sty(R(), 0, { font: { sz: 10, color: { rgb: C.gray }, name: 'Calibri' }, alignment: { vertical: 'center' } })
  sty(R(), 6, { font: { bold: true, sz: 11, color: { rgb: C.dark }, name: 'Calibri' }, alignment: { horizontal: 'right', vertical: 'center' } })
  merge(R(), 0, R(), 5); merge(R(), 6, R(), 11)

  // Row 3: location  |  General Call
  const locText  = day.locations?.[0] || day.unitBase || ''
  const callText = day.generalCall ? `General Call:  ${day.generalCall}` : 'No general call set'
  addRow([locText, '', '', '', '', '', callText, '', '', '', '', ''])
  sty(R(), 0, { font: { sz: 10, color: { rgb: C.gray }, name: 'Calibri' }, alignment: { vertical: 'center' } })
  sty(R(), 6, { font: { bold: true, sz: 14, color: { rgb: C.accent }, name: 'Calibri' }, alignment: { horizontal: 'right', vertical: 'center' } })
  merge(R(), 0, R(), 5); merge(R(), 6, R(), 11)

  // Row 4: thin spacer
  addRow(new Array(12).fill(''))

  // Row 5: CREW label
  addRow(['CREW', '', '', '', '', '', '', '', '', '', '', ''])
  sty(R(), 0, { font: { bold: true, sz: 8, color: { rgb: C.muted }, name: 'Calibri' } })
  merge(R(), 0, R(), 11)

  // Row 6: column headers
  addRow(['NAME', 'POSITION', 'IN', 'OUT', 'NAME', 'POSITION', 'IN', 'OUT', 'NAME', 'POSITION', 'IN', 'OUT'])
  const TIME_COLS = new Set([2, 3, 6, 7, 10, 11])
  for (let c = 0; c < 12; c++) {
    sty(R(), c, {
      font:      { bold: true, sz: 9, color: { rgb: 'FFFFFF' }, name: 'Calibri' },
      fill:      { patternType: 'solid', fgColor: { rgb: C.hdrBg } },
      alignment: { horizontal: TIME_COLS.has(c) ? 'center' : 'left', vertical: 'center' },
      border:    thinBorder(C.hdrBdr),
    })
  }

  // ── Data rows ────────────────────────────────────────────────────────────
  for (let r = 0; r < maxDataRows; r++) {
    const vals = []
    for (let g = 0; g < 3; g++) {
      const item = cols3[g][r]
      if (!item)                     vals.push('', '', '', '')
      else if (item.type === 'dept') vals.push(item.name.toUpperCase(), '', '', '')
      else                           vals.push(item.name, item.role, item.call, item.wrap)
    }
    addRow(vals)
    const ri = R()

    for (let g = 0; g < 3; g++) {
      const item = cols3[g][r]
      const base = g * 4

      if (item?.type === 'dept') {
        for (let c = base; c < base + 4; c++) {
          sty(ri, c, {
            font:   c === base ? { bold: true, sz: 9, color: { rgb: C.deptFg }, name: 'Calibri' } : { sz: 9 },
            fill:   { patternType: 'solid', fgColor: { rgb: C.deptBg } },
            border: thinBorder(C.border),
            alignment: { vertical: 'center' },
          })
        }
        // Merge dept name across name+position columns
        merge(ri, base, ri, base + 1)
      } else {
        for (let c = base; c < base + 4; c++) {
          const isTime = (c === base + 2 || c === base + 3)
          sty(ri, c, {
            font: c === base     ? { sz: 9,   color: { rgb: '111827' }, name: 'Calibri' }
                : c === base + 1 ? { sz: 8.5, color: { rgb: '4B5563' }, name: 'Calibri' }
                : c === base + 2 ? { bold: true, sz: 9, color: { rgb: '111827' }, name: 'Calibri' }
                :                  { sz: 9, color: { rgb: '4B5563' }, name: 'Calibri' },
            fill:      { patternType: 'solid', fgColor: { rgb: C.white } },
            border:    thinBorder(C.border),
            alignment: isTime
              ? { horizontal: 'center', vertical: 'center' }
              : { vertical: 'center' },
          })
        }
      }
    }
  }

  // ── Assemble worksheet ───────────────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Apply styles to cells
  for (const [ref, style] of Object.entries(cellSty)) {
    if (!ws[ref]) ws[ref] = { v: '', t: 's' }
    ws[ref].s = style
  }

  ws['!merges'] = merges

  ws['!cols'] = [
    { wch: 30 }, { wch: 34 }, { wch: 9 }, { wch: 9 },
    { wch: 30 }, { wch: 34 }, { wch: 9 }, { wch: 9 },
    { wch: 30 }, { wch: 34 }, { wch: 9 }, { wch: 9 },
  ]

  ws['!rows'] = aoa.map((_, i) => {
    if (i === 1) return { hpt: 34 }
    if (i === 6) return { hpt: 19 }
    if (i >= 7)  return { hpt: 15.5 }
    return { hpt: 18 }
  })

  // ── Write and download ───────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Back Page')

  const buf  = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')

  const dlDate = day.date
    ? new Date(day.date + 'T00:00:00')
        .toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
        .replace(' ', '')
    : 'Day'
  const dlDay = day.dayCategory === 'main' && day.dayNumber ? `D${day.dayNumber}-` : ''
  const dlCat = day.dayCategory !== 'main' ? `${day.dayCategory ?? 'day'}-` : ''

  a.href     = url
  a.download = `Backpage-${dlDay}${dlCat}${dlDate}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
