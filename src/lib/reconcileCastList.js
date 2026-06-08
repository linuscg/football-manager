// ─── AI Cast-list import reconciliation ───────────────────────────────────────
// Takes the parsed Gemini `result` ({ cast: [{ number, character, artist }] })
// and the current store cast members, and produces a *plan*: machine-applyable
// commit lists (consumed by the store's `applyCastListImport`) plus a
// human-readable preview (consumed by the modal).
//
// Matching: each parsed entry is matched to an existing cast member by
// castNumber (trimmed string compare). Matched entries that differ become
// updates; unmatched entries become inserts. We never blank out an existing
// value with an empty incoming one.
//
// Cast number handling: the DB `cast_number` column is an INTEGER (see
// addCastMember / CSV import, which both parseInt it). The cast list can carry
// values like "X26", which won't fit an int column — so each commit row carries
// BOTH `castNumber` (parsed integer or null, for the DB write) and
// `castNumberLabel` (the original string, for display).

// Parse the leading integer of a cast-number string. "26" → 26, "X26" → 26,
// "" / non-numeric → null.
function parseCastInt(raw) {
  const m = String(raw ?? '').match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

export function reconcileCastList(parsed, existingCast = []) {
  const castToInsert = []
  const castToUpdate = []
  const preview = []

  let newCast = 0
  let changedCast = 0
  let unchanged = 0

  const list = parsed?.cast ?? []

  for (const pc of list) {
    const numLabel  = String(pc.number ?? '').trim()
    const artist    = String(pc.artist ?? '').trim()
    const character = String(pc.character ?? '').trim()

    // Skip rows with no useful content.
    if (!character && !artist) continue

    const match = numLabel
      ? existingCast.find(c => String(c.castNumber ?? '').trim() === numLabel)
      : null

    if (match) {
      // Compare. Never blank out an existing value with an empty incoming one —
      // only treat a non-empty incoming value that differs as a change.
      const nameChanged = artist    && artist    !== (match.name ?? '')
      const roleChanged = character && character !== (match.role ?? '')

      if (nameChanged || roleChanged) {
        const newName = artist    || match.name || ''
        const newRole = character || match.role || ''
        castToUpdate.push({
          id:              match.id,
          name:            newName,
          role:            newRole,
          castNumber:      parseCastInt(numLabel),
          castNumberLabel: numLabel,
        })
        changedCast++
        preview.push({
          status:          'changed',
          castNumber:      numLabel,
          name:            newName,
          role:            newRole,
          oldName:         match.name ?? '',
          oldRole:         match.role ?? '',
        })
      } else {
        unchanged++
        preview.push({
          status:     'unchanged',
          castNumber: numLabel,
          name:       match.name ?? '',
          role:       match.role ?? '',
        })
      }
    } else {
      // New cast member.
      castToInsert.push({
        id:              crypto.randomUUID(),
        name:            artist,
        role:            character,
        notes:           '',
        castNumber:      parseCastInt(numLabel),
        castNumberLabel: numLabel,
        sortOrder:       existingCast.length + newCast,
      })
      newCast++
      preview.push({
        status:     'new',
        castNumber: numLabel,
        name:       artist,
        role:       character,
      })
    }
  }

  // Sort preview by cast number: numeric part ascending, non-numeric to the end
  // (sorted by string).
  preview.sort((a, b) => {
    const an = parseCastInt(a.castNumber)
    const bn = parseCastInt(b.castNumber)
    if (an != null && bn != null) return an - bn
    if (an != null) return -1
    if (bn != null) return 1
    return String(a.castNumber).localeCompare(String(b.castNumber))
  })

  return {
    castToInsert,
    castToUpdate,
    summary: { newCast, changedCast, unchanged },
    preview,
  }
}
