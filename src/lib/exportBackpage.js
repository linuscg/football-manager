/**
 * exportBackpageXLSX — generates a professional crew backpage Excel file.
 *
 * @param {object} opts
 *   production  – { name }
 *   day         – { date, dayNumber, dayCategory, generalCall, locations, unitBase }
 *   depts       – [{ name, members: [{ name, role, callTime, wrapTime }] }]
 */
export async function exportBackpageXLSX({ production, day, depts }) {
  // Dynamic import keeps ExcelJS out of the initial bundle
  const { default: ExcelJS } = await import('exceljs')

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Football Manager'
  wb.created = new Date()

  const ws = wb.addWorksheet('Back Page', {
    pageSetup: {
      paperSize:    9,           // A4
      orientation:  'landscape',
      fitToPage:    true,
      fitToWidth:   1,
      fitToHeight:  0,
    },
    views: [{ showGridLines: false }],
  })

  // ── Column widths (12 cols = 3 groups × NAME|POSITION|IN|OUT) ────────────
  ws.columns = [
    { width: 30 }, // A – Name 1
    { width: 34 }, // B – Position 1
    { width: 9  }, // C – IN 1
    { width: 9  }, // D – OUT 1
    { width: 30 }, // E – Name 2
    { width: 34 }, // F – Position 2
    { width: 9  }, // G – IN 2
    { width: 9  }, // H – OUT 2
    { width: 30 }, // I – Name 3
    { width: 34 }, // J – Position 3
    { width: 9  }, // K – IN 3
    { width: 9  }, // L – OUT 3
  ]

  // ── Colour palette (full ARGB) ───────────────────────────────────────────
  const C = {
    dark:    'FF1A2741',
    accent:  'FF2563EB',
    deptBg:  'FFE2E8F0',
    deptFg:  'FF1E293B',
    hdrBg:   'FF1A2741',
    white:   'FFFFFFFF',
    border:  'FFD1D5DB',
    gray:    'FF6B7280',
    muted:   'FF9CA3AF',
  }

  function thin(cell) {
    const s = { style: 'thin', color: { argb: C.border } }
    cell.border = { top: s, left: s, bottom: s, right: s }
  }
  function bgFill(cell, argb) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
  }

  // ── Header section (rows 1–6) ────────────────────────────────────────────

  // Row 1: top padding
  ws.addRow([]).height = 8

  // Row 2: BACK PAGE ←  →  PRODUCTION NAME
  const r2 = ws.addRow([])
  r2.height = 34
  ws.mergeCells('A2:F2')
  const bpCell = ws.getCell('A2')
  bpCell.value = 'BACK PAGE'
  bpCell.font  = { bold: true, size: 22, color: { argb: C.dark }, name: 'Calibri' }
  bpCell.alignment = { vertical: 'middle' }

  ws.mergeCells('G2:L2')
  const prodCell = ws.getCell('G2')
  prodCell.value = (production.name || '').toUpperCase()
  prodCell.font  = { bold: true, size: 12, color: { argb: C.dark }, name: 'Calibri' }
  prodCell.alignment = { horizontal: 'right', vertical: 'middle' }

  // Row 3: date  ←  →  Day label
  const r3 = ws.addRow([])
  r3.height = 18
  ws.mergeCells('A3:F3')
  const dateStr = day.date
    ? new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : ''
  const d3 = ws.getCell('A3')
  d3.value     = dateStr
  d3.font      = { size: 10, color: { argb: C.gray }, name: 'Calibri' }
  d3.alignment = { vertical: 'middle' }

  ws.mergeCells('G3:L3')
  const sdLabel = day.dayCategory === 'main'
    ? `Shoot Day  ${day.dayNumber ?? '—'}   ·   MAIN UNIT`
    : (day.dayCategory || 'Day').toUpperCase()
  const sd3 = ws.getCell('G3')
  sd3.value     = sdLabel
  sd3.font      = { bold: true, size: 11, color: { argb: C.dark }, name: 'Calibri' }
  sd3.alignment = { horizontal: 'right', vertical: 'middle' }

  // Row 4: location  ←  →  General Call
  const r4 = ws.addRow([])
  r4.height = 20
  ws.mergeCells('A4:F4')
  const loc4 = ws.getCell('A4')
  loc4.value     = day.locations?.[0] ? `📍 ${day.locations[0]}` : (day.unitBase ? `🚌 ${day.unitBase}` : '')
  loc4.font      = { size: 10, color: { argb: C.gray }, name: 'Calibri' }
  loc4.alignment = { vertical: 'middle' }

  ws.mergeCells('G4:L4')
  const gc4 = ws.getCell('G4')
  gc4.value     = day.generalCall ? `General Call:  ${day.generalCall}` : 'No general call set'
  gc4.font      = { bold: true, size: 14, color: { argb: C.accent }, name: 'Calibri' }
  gc4.alignment = { horizontal: 'right', vertical: 'middle' }

  // Row 5: thin divider line
  const r5 = ws.addRow([])
  r5.height = 12
  ws.mergeCells('A5:L5')
  ws.getCell('A5').border = {
    bottom: { style: 'thin', color: { argb: C.border } },
  }

  // Row 6: CREW label
  const r6 = ws.addRow([])
  r6.height = 14
  ws.mergeCells('A6:L6')
  const crewLabel = ws.getCell('A6')
  crewLabel.value     = 'CREW'
  crewLabel.font      = { bold: true, size: 8, color: { argb: C.muted }, name: 'Calibri' }
  crewLabel.alignment = { vertical: 'middle' }

  // ── Column header row (row 7) ────────────────────────────────────────────
  const hdrRow = ws.addRow([
    'NAME', 'POSITION', 'IN', 'OUT',
    'NAME', 'POSITION', 'IN', 'OUT',
    'NAME', 'POSITION', 'IN', 'OUT',
  ])
  hdrRow.height = 19
  const TIME_COLS = new Set([3, 4, 7, 8, 11, 12])
  hdrRow.eachCell((cell, col) => {
    bgFill(cell, C.hdrBg)
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
    cell.alignment = { vertical: 'middle', horizontal: TIME_COLS.has(col) ? 'center' : 'left' }
    cell.border = {
      top:    { style: 'thin', color: { argb: 'FF0F1C31' } },
      left:   { style: 'thin', color: { argb: 'FF0F1C31' } },
      bottom: { style: 'thin', color: { argb: 'FF0F1C31' } },
      right:  { style: 'thin', color: { argb: 'FF0F1C31' } },
    }
  })

  // ── Build flat item list ─────────────────────────────────────────────────
  const items = []
  for (const dept of depts) {
    items.push({ type: 'dept', name: dept.name })
    for (const m of dept.members) {
      items.push({
        type: 'crew',
        name: m.name || '',
        role: m.role || '',
        call: m.callTime || '',
        wrap: m.wrapTime || '',
      })
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

  // ── Render data rows ─────────────────────────────────────────────────────
  const maxRows = Math.max(cols3[0].length, cols3[1].length, cols3[2].length)

  for (let r = 0; r < maxRows; r++) {
    const vals = []
    for (let g = 0; g < 3; g++) {
      const item = cols3[g][r]
      if (!item)                     vals.push('', '', '', '')
      else if (item.type === 'dept') vals.push(item.name.toUpperCase(), '', '', '')
      else                           vals.push(item.name, item.role, item.call, item.wrap)
    }

    const dr = ws.addRow(vals)
    dr.height = 15.5

    for (let g = 0; g < 3; g++) {
      const item = cols3[g][r]
      const base = g * 4 + 1  // 1-indexed: group 0 → cols 1-4, group 1 → cols 5-8, group 2 → cols 9-12
      const [nC, rC, iC, oC] = [0, 1, 2, 3].map(i => dr.getCell(base + i))

      if (item?.type === 'dept') {
        ;[nC, rC, iC, oC].forEach(c => { bgFill(c, C.deptBg); thin(c) })
        nC.font = { bold: true, size: 9, color: { argb: C.deptFg }, name: 'Calibri' }
        nC.alignment = { vertical: 'middle' }
        // Merge Name + Position cells for dept header rows
        try {
          const rowNum = dr.number
          const colA = String.fromCharCode(64 + base)
          const colB = String.fromCharCode(64 + base + 1)
          ws.mergeCells(`${colA}${rowNum}:${colB}${rowNum}`)
        } catch (_) { /* ignore if already merged */ }
      } else {
        ;[nC, rC, iC, oC].forEach(c => { bgFill(c, C.white); thin(c) })
        if (item) {
          nC.font      = { size: 9, color: { argb: 'FF111827' }, name: 'Calibri' }
          nC.alignment = { vertical: 'middle', wrapText: false }
          rC.font      = { size: 8.5, color: { argb: 'FF4B5563' }, name: 'Calibri' }
          rC.alignment = { vertical: 'middle', wrapText: false }
          iC.font      = { bold: true, size: 9, color: { argb: 'FF111827' }, name: 'Calibri' }
          iC.alignment = { horizontal: 'center', vertical: 'middle' }
          oC.font      = { size: 9, color: { argb: 'FF4B5563' }, name: 'Calibri' }
          oC.alignment = { horizontal: 'center', vertical: 'middle' }
        }
      }
    }
  }

  // ── Generate buffer and trigger download ─────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer()
  const blob   = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')

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
