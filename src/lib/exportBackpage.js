/**
 * exportBackpageXLSX — generates a professional crew backpage Excel file.
 * Uses xlsx-js-style (browser-native, no Node.js dependencies).
 *
 * @param {object} opts
 *   production  – { name }
 *   day         – { date, dayNumber, dayCategory, generalCall, locations, unitBase }
 *   depts       – [{ name, members: [{ name, role, callTime, wrapTime }] }]
 *   addDepts    – same shape, rendered as a separate "Additional Crew" section
 */
export async function exportBackpageXLSX({ production, day, depts, addDepts = [] }) {
  const XLSX = (await import('xlsx-js-style')).default

  // ── Colour palette (6-char RGB, no alpha) ───────────────────────────────
  const C = {
    dark:      '1A2741',
    accent:    '2563EB',
    deptBg:    'E2E8F0',
    deptFg:    '1E293B',
    addDeptBg: 'EDE9FE',   // soft violet tint for additional crew dept rows
    addDeptFg: '3B0764',
    hdrBg:     '1A2741',
    addHdrBg:  '4C1D95',   // deeper violet for additional crew column header
    white:     'FFFFFF',
    border:    'D1D5DB',
    hdrBdr:    '0F1C31',
    gray:      '6B7280',
    muted:     '9CA3AF',
  }

  const TIME_COLS = new Set([2, 3, 6, 7, 10, 11])

  function thinBorder(col) {
    const s = { style: 'thin', color: { rgb: col } }
    return { top: s, left: s, bottom: s, right: s }
  }

  // ── Sheet state ──────────────────────────────────────────────────────────
  const aoa      = []   // rows of cell values
  const cellSty  = {}   // 'A1' → style object
  const merges   = []   // {s:{r,c}, e:{r,c}}
  const rowHts   = {}   // rowIndex → hpt

  const R = () => aoa.length - 1

  function addRow(vals, hpt) {
    aoa.push(vals)
    if (hpt != null) rowHts[R()] = hpt
  }

  function sty(r, c, s) {
    cellSty[addr(r, c)] = s
  }

  function addr(r, c) {
    return String.fromCharCode(65 + c) + (r + 1)
  }

  function merge(r1, c1, r2, c2) {
    merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } })
  }

  // ── Build flat item list for a dept array ────────────────────────────────
  function buildItems(deptArray) {
    const items = []
    for (const dept of deptArray) {
      items.push({ type: 'dept', name: dept.name })
      for (const m of dept.members) {
        items.push({ type: 'crew', name: m.name || '', role: m.role || '', call: m.callTime || '', wrap: m.wrapTime || '' })
      }
    }
    return items
  }

  // Distribute items into 3 roughly equal columns, only breaking on dept boundaries
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

  // Render a 3-column data block (dept headers + crew rows) into the sheet
  function renderDataBlock(cols3, deptBg, deptFg) {
    const maxRows = Math.max(cols3[0].length, cols3[1].length, cols3[2].length)
    for (let r = 0; r < maxRows; r++) {
      const vals = []
      for (let g = 0; g < 3; g++) {
        const item = cols3[g][r]
        if (!item)                     vals.push('', '', '', '')
        else if (item.type === 'dept') vals.push(item.name.toUpperCase(), '', '', '')
        else                           vals.push(item.name, item.role, item.call, item.wrap)
      }
      addRow(vals, 15.5)
      const ri = R()

      for (let g = 0; g < 3; g++) {
        const item = cols3[g][r]
        const base = g * 4

        if (item?.type === 'dept') {
          for (let c = base; c < base + 4; c++) {
            sty(ri, c, {
              font:      c === base ? { bold: true, sz: 9, color: { rgb: deptFg }, name: 'Calibri' } : { sz: 9 },
              fill:      { patternType: 'solid', fgColor: { rgb: deptBg } },
              border:    thinBorder(C.border),
              alignment: { vertical: 'center' },
            })
          }
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
  }

  // Render a column-header row (NAME | POSITION | IN | OUT × 3)
  function renderColHeader(hdrBg) {
    addRow(['NAME', 'POSITION', 'IN', 'OUT', 'NAME', 'POSITION', 'IN', 'OUT', 'NAME', 'POSITION', 'IN', 'OUT'], 19)
    const ri = R()
    for (let c = 0; c < 12; c++) {
      sty(ri, c, {
        font:      { bold: true, sz: 9, color: { rgb: 'FFFFFF' }, name: 'Calibri' },
        fill:      { patternType: 'solid', fgColor: { rgb: hdrBg } },
        alignment: { horizontal: TIME_COLS.has(c) ? 'center' : 'left', vertical: 'center' },
        border:    thinBorder(C.hdrBdr),
      })
    }
  }

  // ── Header rows ──────────────────────────────────────────────────────────

  // Row 0: top padding
  addRow(new Array(12).fill(''), 18)

  // Row 1: BACK PAGE  |  PRODUCTION NAME
  const dateStr = day.date
    ? new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : ''
  addRow(['BACK PAGE', '', '', '', '', '', (production.name || '').toUpperCase(), '', '', '', '', ''], 34)
  sty(R(), 0, { font: { bold: true, sz: 22, color: { rgb: C.dark }, name: 'Calibri' }, alignment: { vertical: 'center' } })
  sty(R(), 6, { font: { bold: true, sz: 12, color: { rgb: C.dark }, name: 'Calibri' }, alignment: { horizontal: 'right', vertical: 'center' } })
  merge(R(), 0, R(), 5); merge(R(), 6, R(), 11)

  // Row 2: date  |  shoot day label
  const sdLabel = day.dayCategory === 'main'
    ? `Shoot Day  ${day.dayNumber ?? '—'}   ·   MAIN UNIT`
    : (day.dayCategory || 'Day').toUpperCase()
  addRow([dateStr, '', '', '', '', '', sdLabel, '', '', '', '', ''], 18)
  sty(R(), 0, { font: { sz: 10, color: { rgb: C.gray }, name: 'Calibri' }, alignment: { vertical: 'center' } })
  sty(R(), 6, { font: { bold: true, sz: 11, color: { rgb: C.dark }, name: 'Calibri' }, alignment: { horizontal: 'right', vertical: 'center' } })
  merge(R(), 0, R(), 5); merge(R(), 6, R(), 11)

  // Row 3: location  |  General Call
  const locText  = day.locations?.[0] || day.unitBase || ''
  const callText = day.generalCall ? `General Call:  ${day.generalCall}` : 'No general call set'
  addRow([locText, '', '', '', '', '', callText, '', '', '', '', ''], 18)
  sty(R(), 0, { font: { sz: 10, color: { rgb: C.gray }, name: 'Calibri' }, alignment: { vertical: 'center' } })
  sty(R(), 6, { font: { bold: true, sz: 14, color: { rgb: C.accent }, name: 'Calibri' }, alignment: { horizontal: 'right', vertical: 'center' } })
  merge(R(), 0, R(), 5); merge(R(), 6, R(), 11)

  // Row 4: thin spacer
  addRow(new Array(12).fill(''), 8)

  // Row 5: CREW label
  addRow(['CREW', '', '', '', '', '', '', '', '', '', '', ''], 14)
  sty(R(), 0, { font: { bold: true, sz: 8, color: { rgb: C.muted }, name: 'Calibri' } })
  merge(R(), 0, R(), 11)

  // Row 6: fulltime column headers
  renderColHeader(C.hdrBg)

  // ── Fulltime crew data rows ───────────────────────────────────────────────
  const ftItems = buildItems(depts)
  if (ftItems.length > 0) {
    renderDataBlock(distribute3(ftItems), C.deptBg, C.deptFg)
  }

  // ── Additional crew section ───────────────────────────────────────────────
  const hasAdd = addDepts.length > 0 && addDepts.some(d => d.members.length > 0)
  if (hasAdd) {
    // Spacer
    addRow(new Array(12).fill(''), 10)

    // "ADDITIONAL CREW" section label
    addRow(['ADDITIONAL CREW', '', '', '', '', '', '', '', '', '', '', ''], 14)
    sty(R(), 0, { font: { bold: true, sz: 8, color: { rgb: C.muted }, name: 'Calibri' } })
    merge(R(), 0, R(), 11)

    // Additional crew column headers (different shade)
    renderColHeader(C.addHdrBg)

    // Additional crew data rows
    const addItems = buildItems(addDepts)
    renderDataBlock(distribute3(addItems), C.addDeptBg, C.addDeptFg)
  }

  // ── Assemble worksheet ───────────────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(aoa)

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

  ws['!rows'] = aoa.map((_, i) => ({ hpt: rowHts[i] ?? 18 }))

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
