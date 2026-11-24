// ─── Movie Magic breakdown import ────────────────────────────────────────────
// Reads a Movie Magic "Breakdown" report PDF (one block per scene: header line
// "Scene 12  INT  SET NAME  SD 3  Night  4/8", a description, then bold
// department headings with items under them, in one or two columns) and turns
// it into a plan for useScheduleStore.applyBreakdownImport.
//
// The report is parsed deterministically from text positions + bold fonts
// (no AI): pdf.js gives every text run with its x/y and font name.

import { EXTRAS_CATEGORIES } from './extrasCategories'

// ── 1. PDF → positioned text runs (browser only) ────────────────────────────
export async function extractPdfItems(file) {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const out = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    await page.getOperatorList()           // loads fonts so their real names resolve
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue
      let fontName = ''
      try { fontName = page.commonObjs.get(it.fontName)?.name ?? '' } catch { /* font not loaded */ }
      out.push({
        page: p, x: it.transform[4], y: vp.height - it.transform[5],
        end: it.transform[4] + (it.width ?? 0),
        pageHeight: vp.height, bold: /bold|black|heavy/i.test(fontName), str: it.str.trim(),
      })
    }
  }
  return out
}

// ── 2. Text runs → scenes ────────────────────────────────────────────────────
// Department headings sit in up to three columns: x≈25 (items ≈50),
// x≈171/195 (items ≈196–220) and x≈391 (items ≈416).
const colOf = x => (x < 130 ? 0 : x < 380 ? 1 : 2)

function mapDayNight(s) {
  const v = String(s ?? '').trim().toUpperCase()
  if (!v) return 'DAY'
  if (v === 'DFN' || v.startsWith('DAY FOR')) return 'DFN'
  if (v.startsWith('DAWN')) return 'DAWN'
  if (v.startsWith('MORN')) return 'MORNING'
  if (v.startsWith('DUSK')) return 'DUSK'
  if (v.startsWith('EVEN')) return 'EVENING'
  if (v.startsWith('NIGHT')) return 'NIGHT'
  return 'DAY'
}

export function parseBreakdownItems(items) {
  // Group runs into visual lines (same page, |dy| ≤ 2)
  const sorted = [...items].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
  const lines = []
  for (const it of sorted) {
    const last = lines[lines.length - 1]
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= 2) last.runs.push(it)
    else lines.push({ page: it.page, y: it.y, pageHeight: it.pageHeight, runs: [it] })
  }
  for (const l of lines) l.runs.sort((a, b) => a.x - b.x)

  const scenes = []
  let cur = null
  for (const line of lines) {
    // Page header ("Breakdown <Title>") and footer ("Printed on… / Page N")
    if (line.y < 60 || line.y > line.pageHeight - 40) continue
    const first = line.runs[0]
    if (first.str === 'Scene' && first.x < 50) {
      const at = (lo, hi) => line.runs.filter(r => r.x >= lo && r.x < hi).map(r => r.str).join(' ').trim()
      const sdRun = at(455, 505)
      cur = {
        sceneNumber: at(45, 100),
        intExt: /EXT/i.test(at(100, 130)) ? 'EXT' : 'INT',
        setName: at(130, 455),
        storyDay: sdRun.replace(/^SD\s*/i, '').trim(),
        dayNight: mapDayNight(at(505, 550)),
        dayNightRaw: at(505, 550),
        pages: at(550, 9999),
        descLines: [],
        depts: [],           // [{ heading, items: [] }] in reading order
        cast: [],            // [{ number, name }]
        _head: [null, null, null], // current dept per column
      }
      scenes.push(cur)
      continue
    }
    if (!cur) continue

    // Split the line into its two columns
    for (const col of [0, 1, 2]) {
      const runs = line.runs.filter(r => colOf(r.x) === col)
      if (!runs.length) continue
      // Description: plain text at the set-name indent, before any heading
      if (col === 1 && !cur._head.some(Boolean) && !runs[0].bold && runs[0].x < 165) {
        cur.descLines.push(runs.map(r => r.str).join(' '))
        continue
      }
      if (runs[0].bold) {
        const dept = { heading: runs.map(r => r.str).join(' '), items: [] }
        cur.depts.push(dept)
        cur._head[col] = dept
        continue
      }
      const dept = cur._head[col]
      if (!dept) continue
      const lineEnd = Math.max(...runs.map(r => r.end ?? r.x))
      let num = null
      let text = runs.map(r => r.str).join(' ')
      const m = text.match(/^(\d+[a-z]*)\.\s*(.*)$/i)
      if (m) { num = m[1]; text = m[2] }
      const prev = dept.items[dept.items.length - 1]
      // Wrapped continuation: previous ends with a joiner, or this starts lower-case
      // The far-left column is narrow (~140pt): a line running to its edge wraps.
      // The far-left column is narrow (~140pt) and wraps without any marker.
      // A line is a continuation when the previous one ran to the edge AND
      // this one looks like a tail: short, or the previous ended mid-phrase.
      const prevFull = col === 0 && prev != null && (prev.end ?? 0) >= 160 && (
        lineEnd < 125 || text.split(' ').length <= 2 ||
        /\b(a|an|the|of|in|into|onto|with|by|at|to|and|from|off|for|his|her|their)$/i.test(prev.text))
      if (prev && num == null && (prevFull || /[-,&/]$/.test(prev.text) || /^[a-z]/.test(text))) {
        prev.text = `${prev.text} ${text}`.replace(/\s+/g, ' ')
        prev.end = lineEnd
        continue
      }
      dept.items.push({ num, text, end: lineEnd })
    }
  }

  for (const s of scenes) {
    s.description = s.descLines.join(' ').replace(/\s+/g, ' ').trim()
    const castDept = s.depts.find(d => /^cast/i.test(d.heading))
    s.cast = (castDept?.items ?? []).filter(i => i.num).map(i => ({ number: i.num, name: i.text }))
    s.depts = s.depts.filter(d => d !== castDept)
    delete s.descLines; delete s._head
  }
  return scenes
}

// ── 3. Department heading → Additional Info category ─────────────────────────
// `primary` headings land without a prefix; anything else mapped to the same
// category keeps its heading as a prefix ("Set Dressing: Body bags").
const DEPT_RULES = [
  { re: /^background|^extras|^supporting/i,           cat: 'extras',   primary: true },
  { re: /^stunt/i,                                     cat: 'stunts',   primary: /^stunts$/i },
  { re: /^visual effects|^vfx/i,                       cat: 'vfx',      primary: /^visual effects$|^vfx$/i },
  { re: /^special effects|^mechanical effects|^sfx/i, cat: 'sfx',      primary: /^special effects$|^sfx$/i },
  { re: /^props?$/i,                                   cat: 'props',    primary: true },
  { re: /^wardrobe|^costume/i,                         cat: 'wardrobe', primary: true },
  { re: /^make ?up|^hair|^mufx|prosthetic/i,           cat: 'makeup',   primary: /^make ?up/i },
  { re: /^art dep|^set dress|^av screen|^greenery|^graphics/i, cat: 'art', primary: /^art dep/i },
  { re: /vehicle/i,                                    cat: 'vehicles', primary: true },
  { re: /armou?r|weapon/i,                             cat: 'weapons',  primary: /^weapons$/i },
  { re: /animal|livestock|wrangler/i,                  cat: 'animals',  primary: /^animals$/i },
  { re: /^additional lab|^security/i,                  cat: 'labour',   primary: /^additional lab/i },
  { re: /^notes?$/i,                                   cat: 'notes',    primary: true },
]

export function deptToCategory(heading) {
  const rule = DEPT_RULES.find(r => r.re.test(heading.trim()))
  if (!rule) return { cat: 'other', prefix: heading.trim() }
  const isPrimary = rule.primary === true || (rule.primary instanceof RegExp && rule.primary.test(heading.trim()))
  return { cat: rule.cat, prefix: isPrimary ? '' : heading.trim() }
}

// "New York commuters (50)" → { name: 'New York commuters', total: 50 }
function splitSaCount(text) {
  const m = text.match(/^(.*?)\s*\((\d+)\)\s*$/)
  return m ? { name: m[1].trim(), total: parseInt(m[2], 10) } : { name: text.trim(), total: 1 }
}

// ── 4. Scenes + store snapshot → plan & preview ─────────────────────────────
// "12 pt 1 of 2", "12 pt", "24 pt1", "49 cont" all share base "12"/"24"/"49"
const baseNum = n => String(n ?? '').trim().replace(/\s*(pt|cont)\b.*$|\s*pt\d.*$/i, '').trim().toUpperCase()
// Movie Magic truncates "12 pt 1 of 2" to a bare "12 pt"; "24 pt1" keeps its number
const isBarePart = n => /\spt$/i.test(String(n ?? '').trim())
const normSet = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
function setScore(a, b) {
  const A = normSet(a), B = normSet(b)
  if (!A || !B) return 0
  if (A === B) return 100
  if (A.includes(B) || B.includes(A)) return 60
  const ta = new Set(A.split(' ')), tb = B.split(' ')
  return tb.filter(t => ta.has(t)).length * 10
}

export function buildBreakdownPlan(parsedScenes, { shootDays, castMembers }) {
  const allScenes = []
  for (const d of shootDays) for (const sc of d.scenes ?? []) allScenes.push({ sc, day: d })
  const used = new Set()

  // Split parts: "1 pt" ×2 → "1 pt 1 of 2", "1 pt 2 of 2" for NEW scenes
  const partTotals = {}
  for (const p of parsedScenes) if (isBarePart(p.sceneNumber)) partTotals[baseNum(p.sceneNumber)] = (partTotals[baseNum(p.sceneNumber)] ?? 0) + 1
  const partSeen = {}

  // Cast: number → id, creating named placeholders for unknown numbers
  const castByNum = {}
  for (const c of castMembers ?? []) if (c.castNumber != null && c.castNumber !== '') castByNum[String(c.castNumber)] = c.id
  const castToInsert = []
  let castSort = Math.max(0, ...(castMembers ?? []).map(c => c.sortOrder ?? 0)) + 1
  function castId(number, name) {
    const k = String(number)
    if (castByNum[k]) return castByNum[k]
    // cast_number is free text, so doubles like "1st" / "20bd" are fine
    const id = crypto.randomUUID()
    castByNum[k] = id
    castToInsert.push({ id, castNumber: k, name: name ?? '', sortOrder: castSort++ })
    return id
  }

  // Unscheduled day for new scenes
  let unsched = shootDays.find(d => d.dayCategory === 'unscheduled')
  let dayToInsert = null
  function unschedDayId() {
    if (unsched) return unsched.id
    dayToInsert = { id: crypto.randomUUID(), sortOrder: Math.max(0, ...shootDays.map(d => d.sortOrder ?? 0)) + 1 }
    unsched = { id: dayToInsert.id, scenes: [] }
    return dayToInsert.id
  }
  let unschedSort = Math.max(-1, ...((unsched?.scenes ?? []).map(s => s.sortOrder ?? 0))) + 1

  // Hand-entered items already on a scene (source ≠ breakdown): the upload
  // never removes them and skips breakdown items with the same text.
  const itemKey = (cat, text) => `${cat}|${String(text ?? '').trim().toLowerCase()}`
  const handItems = {}   // sceneId → Set(itemKey)
  const placeholderSa = {}   // sceneId → [day_extras ids]
  const saPlaceholdersToDelete = []
  for (const d of shootDays) {
    for (const [cat, rows] of Object.entries(d.extras ?? {})) {
      for (const r of rows) {
        if (!r.sceneId || r.source === 'breakdown') continue
        const t = cat === 'extras' ? (r.saName || r.description) : r.description
        ;(handItems[r.sceneId] ??= new Set()).add(itemKey(cat, t))
        if (cat === 'extras' && r.doodId) handItems[r.sceneId].add(`dood|${r.doodId}`)
        // Unnamed SA count from the one-line schedule import ("SAs ×6"):
        // superseded by the breakdown's named, numbered groups
        if (cat === 'extras' && !String(r.saName ?? '').trim() && !String(r.description ?? '').trim() && !r.doodId) {
          (placeholderSa[r.sceneId] ??= []).push(r.id)
        }
      }
    }
  }
  let skippedDupes = 0

  const scenesToInsert = []
  const sceneUpdates = []
  const replaceSceneIds = []
  const extrasToInsert = []
  const preview = []
  const catCounts = {}
  let sort = Date.now()

  const dayLabelOf = d => d.dayCategory === 'unscheduled' ? 'Unscheduled'
    : d.dayNumber != null ? `Day ${d.dayNumber}` : (d.dayCategory ? d.dayCategory[0].toUpperCase() + d.dayCategory.slice(1) : 'Day')
  const score = (e, p) => setScore(e.sc.location, p.setName)
    + (String(e.sc.sceneNumber).trim().toUpperCase() === p.sceneNumber.toUpperCase() ? 200 : 0)
    + (e.day.dayCategory === 'unscheduled' ? 0 : 1)        // ties → a scheduled strip first

  // Phase 1 — pair each breakdown scene with one schedule strip
  const targets = parsedScenes.map(() => [])
  parsedScenes.forEach((p, i) => {
    const base = baseNum(p.sceneNumber)
    const cands = allScenes.filter(e => !used.has(e.sc.id) && base && baseNum(e.sc.sceneNumber) === base)
    if (!cands.length) return
    const best = cands.map(e => ({ e, s: score(e, p) })).sort((a, b) => b.s - a.s)[0].e
    // Several split parts compete for one base number: require a set match
    if (isBarePart(p.sceneNumber) && partTotals[base] > 1 && cands.length > 1 && setScore(best.sc.location, p.setName) === 0) return
    used.add(best.sc.id)
    targets[i].push(best)
  })
  // Phase 2 — the same scene can sit on several strips (split over days,
  // "49 cont", or also parked on Unscheduled): each gets the breakdown too.
  for (const e of allScenes) {
    if (used.has(e.sc.id)) continue
    const base = baseNum(e.sc.sceneNumber)
    if (!base) continue
    const ps = parsedScenes.map((p, i) => ({ p, i })).filter(x => baseNum(x.p.sceneNumber) === base)
    if (!ps.length) continue
    const best = ps.map(x => ({ ...x, s: score(e, x.p) })).sort((a, b) => b.s - a.s)[0]
    if (ps.length > 1 && setScore(e.sc.location, best.p.setName) === 0) continue
    used.add(e.sc.id)
    targets[best.i].push(e)
  }

  parsedScenes.forEach((p, i) => {
    const base = baseNum(p.sceneNumber)
    const isPart = isBarePart(p.sceneNumber)
    if (isPart) partSeen[base] = (partSeen[base] ?? 0) + 1
    const castIds = p.cast.map(c => castId(c.number, c.name)).filter(Boolean)

    let homes   // [{ sceneId, dayId, sceneNumber }]
    if (targets[i].length) {
      homes = targets[i].map(e => {
        replaceSceneIds.push(e.sc.id)
        // Fill blanks only — never overwrite what's been typed on the schedule
        const patch = {}
        if (!e.sc.location && p.setName) patch.location = p.setName
        if (!e.sc.description && p.description) patch.description = p.description
        if (!e.sc.storyDay && p.storyDay && p.storyDay !== '-') patch.story_day = p.storyDay
        if (!e.sc.pages && p.pages) patch.pages = p.pages
        if (!(e.sc.castMemberIds ?? []).length && castIds.length) patch.cast_member_ids = castIds
        if (Object.keys(patch).length) sceneUpdates.push({ id: e.sc.id, patch })
        return { sceneId: e.sc.id, dayId: e.day.id, sceneNumber: e.sc.sceneNumber, day: e.day }
      })
    } else {
      const sceneId = crypto.randomUUID()
      const dayId = unschedDayId()
      const sceneNumber = isPart && partTotals[base] > 1 ? `${base} pt ${partSeen[base]} of ${partTotals[base]}` : p.sceneNumber
      scenesToInsert.push({
        id: sceneId, dayId, sceneNumber, intExt: p.intExt, location: p.setName,
        dayNight: p.dayNight, description: p.description, pages: p.pages,
        storyDay: p.storyDay === '-' ? '' : p.storyDay, castMemberIds: castIds, sortOrder: unschedSort++,
      })
      homes = [{ sceneId, dayId, sceneNumber, day: null }]
    }

    const sceneCats = {}
    const hasSa = p.depts.some(d => deptToCategory(d.heading).cat === 'extras' && d.items.length)
    for (const h of homes) {
      if (hasSa && placeholderSa[h.sceneId]) saPlaceholdersToDelete.push(...placeholderSa[h.sceneId])
      for (const dept of p.depts) {
        const { cat: deptCat, prefix } = deptToCategory(dept.heading)
        for (const it of dept.items) {
          // Stand-ins are listed as background but are crew: own section, not counted as SAs
          const cat = deptCat === 'extras' && /\bstand[\s-]?ins?\b/i.test(it.text) ? 'standins' : deptCat
          const row = { id: crypto.randomUUID(), dayId: h.dayId, sceneId: h.sceneId, category: cat, sortOrder: sort++ }
          if (cat === 'extras') {
            const { name, total } = splitSaCount(it.text)
            // Movie Magic's background number = the DooD group number: link on
            // it so the same people count once per day across scenes & imports
            Object.assign(row, {
              saName: name, totalNumber: total, scene: h.sceneNumber, description: '',
              doodId: it.num ?? null, linkKey: it.num ? `dood-${it.num}` : null,
            })
            if (it.num && handItems[h.sceneId]?.has(`dood|${it.num}`)) {
              if (h === homes[0]) skippedDupes++
              continue
            }
          } else {
            row.description = prefix ? `${prefix}: ${it.text}` : it.text
          }
          if (handItems[h.sceneId]?.has(itemKey(cat, cat === 'extras' ? row.saName : row.description))) {
            if (h === homes[0]) skippedDupes++
            continue
          }
          extrasToInsert.push(row)
          if (h === homes[0]) {
            sceneCats[cat] = (sceneCats[cat] ?? 0) + 1
            catCounts[cat] = (catCounts[cat] ?? 0) + 1
          }
        }
      }
    }
    preview.push({
      key: `${i}`, status: targets[i].length ? 'matched' : 'new',
      sceneNumber: homes[0].sceneNumber, printed: p.sceneNumber, setName: p.setName,
      intExt: p.intExt, dayNight: p.dayNight, storyDay: p.storyDay, pages: p.pages,
      dayLabel: targets[i].length ? targets[i].map(e => dayLabelOf(e.day)).join(', ') : 'Unscheduled',
      strips: homes.length, cats: sceneCats, castCount: castIds.length,
    })
  })

  const notInBreakdown = allScenes.filter(e => !used.has(e.sc.id)).map(e => e.sc.sceneNumber).filter(Boolean)
  const catSummary = EXTRAS_CATEGORIES.filter(c => catCounts[c.key]).map(c => ({ ...c, count: catCounts[c.key] }))

  return {
    plan: { castToInsert, dayToInsert, scenesToInsert, sceneUpdates, replaceSceneIds, extrasToInsert, saPlaceholdersToDelete },
    preview,
    summary: {
      total: parsedScenes.length,
      matched: preview.filter(p => p.status === 'matched').length,
      strips: replaceSceneIds.length,
      added: scenesToInsert.length,
      newCast: castToInsert.length,
      items: extrasToInsert.length,
      skippedDupes,
      saGroups: new Set(extrasToInsert.filter(e => e.category === 'extras' && e.doodId).map(e => e.doodId)).size,
      saPlaceholders: saPlaceholdersToDelete.length,
      catSummary,
      notInBreakdown,
    },
  }
}
