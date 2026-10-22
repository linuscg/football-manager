// ─── Shared CSV parser ────────────────────────────────────────────────────────
// Proper state machine: a quoted field may contain commas, doubled quotes ("")
// and NEWLINES — the old per-line parsers split on \n first, so a quoted
// multi-line field broke into two misaligned rows.
// Fields are trimmed and fully-blank rows dropped, matching the old behaviour.

export function parseCSV(text) {
  const src = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rows = []
  let row = [], cur = '', inQ = false

  const endField = () => { row.push(cur.trim()); cur = '' }
  const endRow   = () => { endField(); if (row.some(f => f !== '')) rows.push(row); row = [] }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++ }
        else inQ = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQ = true
    } else if (ch === ',') {
      endField()
    } else if (ch === '\n') {
      endRow()
    } else {
      cur += ch
    }
  }
  endRow()
  return rows
}
