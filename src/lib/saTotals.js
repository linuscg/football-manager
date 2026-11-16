// Supporting-artist totals with link-aware deduplication.
//
// SA rows live per SCENE (day_extras, category 'extras'). When the same group
// of people appears in several scenes on one day, their rows share a link_key
// and the day total must count them ONCE (at the largest headcount in the
// linked set) instead of summing every scene's row.

export function saRowsForDay(day) {
  const out = []
  for (const [cat, rows] of Object.entries(day?.extras ?? {})) {
    if (cat.toLowerCase() !== 'extras') continue
    out.push(...rows)
  }
  return out
}

// Deduped headcount for one day.
export function saDayTotal(day) {
  const rows = saRowsForDay(day)
  let total = 0
  const linkMax = new Map()   // linkKey → max headcount seen
  for (const r of rows) {
    const n = Number(r.totalNumber) || 0
    if (r.linkKey) linkMax.set(r.linkKey, Math.max(linkMax.get(r.linkKey) ?? 0, n))
    else total += n
  }
  for (const n of linkMax.values()) total += n
  return total
}

// Rows grouped for display: linked rows collapse into one entry carrying all
// their scene numbers; unlinked rows stay individual.
export function saDayGroups(day) {
  const rows = saRowsForDay(day)
  const byLink = new Map()
  const singles = []
  for (const r of rows) {
    if (r.linkKey) {
      if (!byLink.has(r.linkKey)) byLink.set(r.linkKey, [])
      byLink.get(r.linkKey).push(r)
    } else {
      singles.push({ rows: [r], linkKey: null })
    }
  }
  return [
    ...[...byLink.entries()].map(([linkKey, linked]) => ({ rows: linked, linkKey })),
    ...singles,
  ].map(g => ({
    ...g,
    name: g.rows.find(r => (r.saName ?? '').trim())?.saName?.trim()
      ?? g.rows.find(r => (r.description ?? '').trim())?.description?.trim()
      ?? 'Supporting artists',
    scenes: [...new Set(g.rows.map(r => String(r.scene ?? '').trim()).filter(Boolean))],
    total: Math.max(...g.rows.map(r => Number(r.totalNumber) || 0), 0),
    doodId: g.rows.find(r => r.doodId)?.doodId ?? null,
  }))
}
