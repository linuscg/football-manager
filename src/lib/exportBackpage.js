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
    addDeptBg: 'EDE9FE',
    addDeptFg: '3B0764',
    hdrBg:     '1A2741',
    addHdrBg:  '4C1D95',
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

  // ── Dept sort — Producers → Directors → Production → A-Z ────────────────
  //   Strips the " - Additional" suffix before comparing priority.
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

  // ── Sheet state ──────────────────────────────────────────────────────────
  const aoa     = []
  const cellSty = {}
  const merges  = []
  const rowHts  = {}

  const R = () => aoa.length - 1

  function addRow(vals, hpt) {
    aoa.push(vals)
    if (hpt != null) rowHts[R()] = hpt
  }

  function sty(r, c, s) { cellSty[addr(r, c)] = s }

  function addr(r, c) {
    return String.fromCharCode(65 + c) + (r + 1)
  }

  function merge(r1, c1, r2, c2) {
    merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } })
  }

  // ── Build flat item list for a dept array (already sorted) ───────────────
  function buildItems(deptArray) {
    const items = []
    for (const dept of deptArray) {
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

  // Distribute items into 3 roughly equal columns, breaking only on dept boundaries.
  // Priority depts are at the top of the list, so they naturally land in the
  // left column and the rest fill left → middle → right.
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

  // Render a 3-column data block into the sheet
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
              font:      c === base
                ? { bold: true, sz: 9, color: { rgb: deptFg }, name: 'Calibri' }
                : { sz: 9 },
              fill:      { patternType: 'solid', fgColor: { rgb: deptBg } },
              border:    thinBorder(C.border),
              alignment: { vertical: 'center' },
            })
          }
          merge(ri, base, ri, base + 1)
        } else {
          const ex       = (item?.excluded ?? false) || (item?.status && item.status !== 'work')
          const isNA     = item?.status === 'N/A'
          const fillRgb  = ex ? 'F3F4F6' : C.white

          for (let c = base; c < base + 4; c++) {
            const isTime = (c === base + 2 || c === base + 3)
            const baseSz = c === base + 1 ? 8.5 : 9

            sty(ri, c, {
              font: ex
                ? { sz: baseSz, italic: true, strike: isNA, color: { rgb: 'AAAAAA' }, name: 'Calibri' }
                : c === base     ? { sz: 9,   color: { rgb: '111827' }, name: 'Calibri' }
                : c === base + 1 ? { sz: 8.5, color: { rgb: '4B5563' }, name: 'Calibri' }
                : c === base + 2 ? { bold: true, sz: 9, color: { rgb: '111827' }, name: 'Calibri' }
                :                  { sz: 9, color: { rgb: '4B5563' }, name: 'Calibri' },
              fill:      { patternType: 'solid', fgColor: { rgb: fillRgb } },
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
    addRow(
      ['NAME', 'POSITION', 'IN', 'OUT', 'NAME', 'POSITION', 'IN', 'OUT', 'NAME', 'POSITION', 'IN', 'OUT'],
      19,
    )
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

  addRow(new Array(12).fill(''), 14) // top padding

  // Row 1: BACK PAGE  |  PRODUCTION NAME
  const dateStr = day.date
    ? new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : ''
  addRow(['BACK PAGE', '', '', '', '', '', (production.name || '').toUpperCase(), '', '', '', '', ''], 32)
  sty(R(), 0, { font: { bold: true, sz: 20, color: { rgb: C.dark }, name: 'Calibri' }, alignment: { vertical: 'center' } })
  sty(R(), 6, { font: { bold: true, sz: 11, color: { rgb: C.dark }, name: 'Calibri' }, alignment: { horizontal: 'right', vertical: 'center' } })
  merge(R(), 0, R(), 5); merge(R(), 6, R(), 11)

  // Row 2: date  |  shoot day label
  const sdLabel = day.dayCategory === 'main'
    ? `Shoot Day  ${day.dayNumber ?? '—'}   ·   MAIN UNIT`
    : (day.dayCategory || 'Day').toUpperCase()
  addRow([dateStr, '', '', '', '', '', sdLabel, '', '', '', '', ''], 16)
  sty(R(), 0, { font: { sz: 9, color: { rgb: C.gray }, name: 'Calibri' }, alignment: { vertical: 'center' } })
  sty(R(), 6, { font: { bold: true, sz: 10, color: { rgb: C.dark }, name: 'Calibri' }, alignment: { horizontal: 'right', vertical: 'center' } })
  merge(R(), 0, R(), 5); merge(R(), 6, R(), 11)

  // Row 3: location  |  General Call
  const locText  = day.locations?.[0] || day.unitBase || ''
  const callText = day.generalCall ? `General Call:  ${day.generalCall}` : 'No general call set'
  addRow([locText, '', '', '', '', '', callText, '', '', '', '', ''], 16)
  sty(R(), 0, { font: { sz: 9, color: { rgb: C.gray }, name: 'Calibri' }, alignment: { vertical: 'center' } })
  sty(R(), 6, { font: { bold: true, sz: 13, color: { rgb: C.accent }, name: 'Calibri' }, alignment: { horizontal: 'right', vertical: 'center' } })
  merge(R(), 0, R(), 5); merge(R(), 6, R(), 11)

  // Thin spacer
  addRow(new Array(12).fill(''), 6)

  // CREW section label
  addRow(['CREW', '', '', '', '', '', '', '', '', '', '', ''], 12)
  sty(R(), 0, { font: { bold: true, sz: 7, color: { rgb: C.muted }, name: 'Calibri' } })
  merge(R(), 0, R(), 11)

  // Fulltime column headers
  renderColHeader(C.hdrBg)

  // ── Fulltime crew data (sorted) ───────────────────────────────────────────
  const ftItems = buildItems(sortDeptArray(depts))
  if (ftItems.length > 0) {
    renderDataBlock(distribute3(ftItems), C.deptBg, C.deptFg)
  }

  // ── Additional crew section (sorted) ─────────────────────────────────────
  const hasAdd = addDepts.length > 0 && addDepts.some(d => d.members.length > 0)
  if (hasAdd) {
    addRow(new Array(12).fill(''), 8)  // spacer

    addRow(['ADDITIONAL CREW', '', '', '', '', '', '', '', '', '', '', ''], 12)
    sty(R(), 0, { font: { bold: true, sz: 7, color: { rgb: C.muted }, name: 'Calibri' } })
    merge(R(), 0, R(), 11)

    renderColHeader(C.addHdrBg)

    const addItems = buildItems(sortDeptArray(addDepts))
    renderDataBlock(distribute3(addItems), C.addDeptBg, C.addDeptFg)
  }

  // ── Assemble worksheet ───────────────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  for (const [ref, style] of Object.entries(cellSty)) {
    if (!ws[ref]) ws[ref] = { v: '', t: 's' }
    ws[ref].s = style
  }

  ws['!merges'] = merges

  // Column widths — balanced for A4 landscape; fitToWidth below handles scaling
  ws['!cols'] = [
    { wch: 26 }, { wch: 22 }, { wch: 7 }, { wch: 7 },
    { wch: 26 }, { wch: 22 }, { wch: 7 }, { wch: 7 },
    { wch: 26 }, { wch: 22 }, { wch: 7 }, { wch: 7 },
  ]

  ws['!rows'] = aoa.map((_, i) => ({ hpt: rowHts[i] ?? 15.5 }))

  // A4 landscape, fit content to 1 page wide (Excel auto-scales height)
  ws['!pageSetup'] = {
    paperSize:   9,           // A4
    orientation: 'landscape',
    fitToPage:   true,
    fitToWidth:  1,
    fitToHeight: 0,           // unlimited height — 1-2 pages tall
  }
  ws['!margins'] = {
    left: 0.35, right: 0.35,
    top:  0.35, bottom: 0.35,
    header: 0,  footer: 0,
  }

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
