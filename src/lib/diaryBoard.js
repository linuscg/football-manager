// ─── Diary board parsing ─────────────────────────────────────────────────────
// Turns the diary sheet's week grid and the travel / accommodation logs (as
// returned by the diary-board edge function) into what the TV board shows.
//
// Diary grid layout (one block per week):
//   header row:   [ , "PREP -3", "Mon 23 Nov", "Tue 24 Nov", … "Sun 29 Nov"]
//   next row:     [ , week note, <Mon cell>, <Tue cell>, …]   ← meetings / notes
//   further rows: [ , "Travel & Accommodation" | "", <cells>…] ← travel / logistics
// A cell holds entries separated by a blank line; an entry's first line usually
// starts with a time: "09:30–10:30 — Weekly HOD meeting".

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const DAY_HEADER = /^(mon|tue|wed|thu|fri|sat|sun)\w*\s+(\d{1,2})\s+([a-z]{3})/i

const pad = n => String(n).padStart(2, '0')
export const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export function addDaysIso(iso, n) {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d)
}

// "Mon 23 Nov" → ISO, picking the year that lands closest to today
function headerToIso(text, today) {
  const m = String(text ?? '').trim().match(DAY_HEADER)
  if (!m) return null
  const mon = MONTHS[m[3].toLowerCase()]
  if (mon == null) return null
  const t = new Date(today + 'T00:00:00')
  let best = null
  for (const y of [t.getFullYear() - 1, t.getFullYear(), t.getFullYear() + 1]) {
    const d = new Date(y, mon, Number(m[2]))
    if (!best || Math.abs(d - t) < Math.abs(best - t)) best = d
  }
  return isoOf(best)
}

const toMin = s => { const m = String(s).match(/(\d{1,2})[:.](\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
const URL_RE = /https?:\/\/\S+/g

// ── Initials key ("AJ — Abi Jarvis   |   AB — Abir Mohammad   | …") ─────────
// Read from any cell holding several "XX — Name" pairs; used to expand people
// lists ("BW / HBA / BR") into full names.
export function parseInitialsKey(grid) {
  const key = {}
  for (const row of grid ?? []) {
    for (const cell of row ?? []) {
      const s = String(cell ?? '')
      const pairs = [...s.matchAll(/(?:^|\||\n)\s*([A-Z]{2,4})\s+[—–-]\s+([^|\n]+?)\s*(?=\||\n|$)/g)]
      if (pairs.length < 4) continue
      for (const [, ini, name] of pairs) key[ini] = name.trim()
    }
  }
  return key
}

// "BW / HBA / BR" or "Art / Set Dec / TC" → full names. Only list items that
// are exactly a known set of initials are expanded ("SFX", "UK" are left alone).
function expandPeopleLine(line, key) {
  if (!key || !Object.keys(key).length) return line
  return line.split(/(\s*(?:\/|,|&|\+|\|)\s*)/).map(part => key[part.trim()] ?? part).join('')
}
// "BW — Unavailable", "VB arrives UK", "AM — New script issued"
function expandLeading(text, key) {
  const m = text.match(/^([A-Z]{2,4})(\b.*)$/)
  return m && key?.[m[1]] ? key[m[1]] + m[2] : text
}

// ── Colour key ("Black — Meeting   Green — Recce   Red — Fitting …") ───────
// Each category in the key is written in its own colour; diary entries are
// coloured to match. Colours come from the diary-board function as per-cell
// runs: [[startIndex, '#rrggbb'], …] (the first, startIndex -1, is the cell's
// default text colour).
const COLOUR_WORDS = /^(black|green|red|blue|orange|purple|teal|brown|slate|burgundy|grey|gray|yellow|pink|navy|maroon|gold|olive|cyan|magenta|violet|lime|white|silver)$/i

export function colourAt(runs, index) {
  if (!runs?.length) return null
  let col = runs[0][1]
  for (const [start, c] of runs) {
    if (start < 0) continue
    if (start <= index) col = c ?? runs[0][1]
    else break
  }
  return col
}

export function parseColourKey(grid, colours) {
  for (let r = 0; r < Math.min((grid ?? []).length, 12); r++) {
    for (let c = 0; c < (grid[r] ?? []).length; c++) {
      const text = String(grid[r][c] ?? '')
      const re = /([A-Za-z]+)\s+[—–-]\s+([A-Za-z][A-Za-z ]*?)(?=\s{2,}|\n|$)/g
      const key = []
      for (const m of text.matchAll(re)) {
        if (!COLOUR_WORDS.test(m[1])) continue
        key.push({ label: m[2].trim(), hex: colourAt(colours?.[r]?.[c], m.index) ?? '#222222' })
      }
      if (key.length >= 4) return key
    }
  }
  return []
}

const rgb = h => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16))
function nearestCategory(hex, key) {
  if (!hex || !key?.length) return null
  const [r, g, b] = rgb(hex)
  let best = null, bestD = Infinity
  for (const k of key) {
    const [r2, g2, b2] = rgb(k.hex)
    const d = Math.hypot(r - r2, g - g2, b - b2)
    if (d < bestD) { bestD = d; best = k }
  }
  return bestD <= 60 ? best : null
}

// One diary entry (a blank-line-separated block of a cell)
function parseEntry(block, key, category = null) {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) return null
  let first = lines[0]
  let start = null, end = null, tbc = false, approx = null

  const tm = first.match(/^(\d{1,2}[:.]\d{2})\s*(?:(?:-|–|—|to)\s*(\d{1,2}[:.]\d{2}))?\s*(onwards)?\s*(?:UK\b)?\s*(TBC\b)?\s*(?:[-–—:|]\s*)?(.*)$/i)
  if (tm) {
    start = toMin(tm[1]); end = tm[2] ? toMin(tm[2]) : null
    if (tm[4]) tbc = true
    first = tm[5].trim()
    if (tm[3]) first = `${first} (onwards)`.trim()
  } else {
    const tb = first.match(/^(?:time\s+)?TBC\s*[-–—:]\s*(.*)$/i)
    if (tb) { tbc = true; first = tb[1].trim() }
    else {
      const ap = first.match(/^(morning|lunchtime|afternoon|evening)\s*[-–—]\s*(.*)$/i)
      if (ap) { approx = ap[1]; first = ap[2].trim() }
    }
  }
  const rest = lines.slice(1)
  if (!first && rest.length) first = rest.shift()

  // Location ("@ 3 Mills Studios"), call platform, and remaining detail lines
  let location = ''
  const details = []
  for (const l of rest) {
    if (/^@/.test(l) && !location) { location = l.replace(/^@\s*/, '').replace(URL_RE, '').replace(/\s*[—–-]\s*$/, '').trim(); continue }
    const clean = l.replace(URL_RE, '').replace(/\s*[—–-]\s*$/, '').trim()
    if (clean) details.push(expandPeopleLine(clean, key))
  }
  const text = lines.join(' ')
  const status = /\b(cancel+ed|postponed)\b/i.test(text) ? 'cancelled' : null
  return {
    title: expandLeading(expandPeopleLine(first.replace(URL_RE, '').replace(/\s*[—–-]\s*$/, '').trim(), key), key),
    category,   // { label, hex } from the diary's colour key, or null
    unavailable: /unavailable/i.test(category?.label ?? '') || /\b(unavailable|wfh|not available)\b/i.test(first),
    start, end, tbc, approx, location, details, status,
    timed: start != null,
    raw: block.trim(),
  }
}

// Split a cell into entries, keeping each block's offset so its text colour
// (→ key category) can be looked up from the cell's colour runs.
function splitCell(cell, key, runs, colourKey) {
  const text = String(cell ?? '')
  const out = []
  const sep = /\n\s*\n/g
  let start = 0, m
  const take = (from, to) => {
    const block = text.slice(from, to)
    const lead = block.length - block.trimStart().length
    const hex = colourAt(runs, from + lead)
    const e = parseEntry(block, key, nearestCategory(hex, colourKey))
    if (e && e.title) out.push(e)
  }
  while ((m = sep.exec(text))) { take(start, m.index); start = m.index + m[0].length }
  take(start, text.length)
  return out
}

// grid → { [iso]: { weekLabel, weekNote, entries: [...], logistics: [...] } }
export function parseDiaryGrid(grid, today, colours = null) {
  const days = {}
  const rows = grid ?? []
  const key = parseInitialsKey(rows)
  const colourKey = parseColourKey(rows, colours)
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? []
    const dates = row.map(c => headerToIso(c, today))
    if (dates.filter(Boolean).length < 3) continue   // not a week header
    const weekLabel = String(row[1] ?? '').trim()
    // Rows under the header until the next header / blank gap
    let k = 0
    for (let rr = r + 1; rr < rows.length; rr++) {
      const sub = rows[rr] ?? []
      if (sub.map(c => headerToIso(c, today)).filter(Boolean).length >= 3) break
      if (!sub.some(c => String(c ?? '').trim())) { if (k > 0) break; else continue }
      const label = String(sub[1] ?? '').trim()
      const isTravelRow = k > 0 || /travel|accom/i.test(label)
      dates.forEach((iso, c) => {
        if (!iso) return
        const d = (days[iso] ??= { weekLabel, weekNote: '', entries: [], logistics: [] })
        if (!isTravelRow && k === 0 && label && !/starts\s*\/\s*notes/i.test(label)) d.weekNote = label
        const items = splitCell(sub[c], key, colours?.[rr]?.[c], colourKey)
        if (isTravelRow) d.logistics.push(...items)
        else d.entries.push(...items)
      })
      k++
    }
  }
  return days
}

// Split a day's entries into meetings (timed / TBC) and notes (untimed info)
export function splitDay(day) {
  const meetings = [], notes = []
  for (const e of day?.entries ?? []) {
    if (e.timed || e.tbc || e.approx) meetings.push(e)
    else notes.push(e)
  }
  const approxMin = { morning: 9 * 60, lunchtime: 12 * 60 + 30, afternoon: 14 * 60, evening: 18 * 60 }
  const sortKey = e => e.start ?? (e.approx ? approxMin[e.approx.toLowerCase()] : 24 * 60)
  meetings.sort((a, b) => sortKey(a) - sortKey(b))
  return { meetings, notes }
}

// ── Travel & accommodation ───────────────────────────────────────────────────
// dd/mm/yyyy, dd-Mon-yy, dd Mon yyyy → ISO
export function parseLooseDate(s) {
  const t = String(s ?? '').trim()
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) { let y = Number(m[3]); if (y < 100) y += 2000; return `${y}-${pad(m[2])}-${pad(m[1])}` }
  m = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s](\d{2,4})$/)
  if (m && MONTHS[m[2].toLowerCase()] != null) { let y = Number(m[3]); if (y < 100) y += 2000; return `${y}-${pad(MONTHS[m[2].toLowerCase()] + 1)}-${pad(m[1])}` }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? t : null
}

// "Tracy Lee Rosenblum" and "Tracy Rosenblum" are the same person
export const personKey = name => {
  const w = String(name ?? '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(Boolean)
  return w.length > 1 ? `${w[0]} ${w[w.length - 1]}` : (w[0] ?? '')
}

const isRail = leg => !/^[A-Z0-9]{2}\s?\d{1,4}\b/.test(leg.number || '') && !/air|airline|delta|british|american|virgin|united/i.test(leg.carrier || '')

function legEvent(p, leg, kind) {
  const date = parseLooseDate(leg.date)
  if (!date) return null
  const from = leg.fromCode || leg.fromCity
  const to = leg.toCode || leg.toCity
  if (!from && !to && !leg.number) return null
  return {
    kind: isRail(leg) ? 'train' : 'flight', leg: kind, date,
    time: (leg.depart || '').trim(), sortMin: toMin(leg.depart) ?? 0,
    title: [leg.number, leg.carrier && !/open/i.test(leg.carrier) && !leg.number ? leg.carrier : ''].filter(Boolean).join(' '),
    from, fromCity: leg.fromCity, fromTerminal: leg.fromTerminal,
    to, toCity: leg.toCity, toTerminal: leg.toTerminal,
    arrive: (leg.arrive || '').trim(), arriveDate: parseLooseDate(leg.arriveDate),
    cls: leg.cls,
  }
}

// → [{ key, name, role, events:[…] }] for events within [today, today+days]
export function buildTravel(travel = [], accom = [], today, days = 14) {
  const until = addDaysIso(today, days)
  const people = new Map()
  const add = (name, role, ev) => {
    if (!ev || ev.date < today || ev.date > until) return
    const k = personKey(name)
    if (!k) return
    const p = people.get(k) ?? { key: k, name: name.trim(), role: role || '', events: [] }
    if (!p.role && role) p.role = role
    if (name.trim().length > p.name.length) p.name = name.trim()
    p.events.push(ev)
    people.set(k, p)
  }
  for (const t of travel) {
    add(t.name, t.role, legEvent(t, t.out || {}, 'out'))
    add(t.name, t.role, legEvent(t, t.ret || {}, 'return'))
  }
  for (const a of accom) {
    if (/^name$/i.test(a.name)) continue
    const inD = parseLooseDate(a.checkIn), outD = parseLooseDate(a.checkOut)
    const rawPlace = String(a.place ?? '').trim()
    const place = !rawPlace || /^tbc$/i.test(rawPlace) ? 'Accommodation TBC' : rawPlace
    if (inD) add(a.name, a.role, { kind: 'checkin', date: inD, sortMin: 15 * 60, title: place })
    if (outD) add(a.name, a.role, { kind: 'checkout', date: outD, sortMin: 11 * 60, title: place })
  }
  const list = [...people.values()]
  for (const p of list) p.events.sort((a, b) => a.date.localeCompare(b.date) || a.sortMin - b.sortMin)
  list.sort((a, b) => a.events[0].date.localeCompare(b.events[0].date) || a.events[0].sortMin - b.events[0].sortMin)
  return list
}
