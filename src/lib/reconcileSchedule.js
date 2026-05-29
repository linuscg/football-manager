// ─── AI Schedule import reconciliation ───────────────────────────────────────
// Takes the parsed Gemini `result` and the current store snapshot, and produces
// a *plan*: both machine-applyable commit lists (consumed by the store's
// `applyScheduleImport`) and a human-readable preview (consumed by the modal).
//
// Guiding principles:
//   • Never auto-delete. Days/scenes the PDF doesn't mention are *flagged* for
//     the user to optionally remove (dayIdsToDelete / sceneIdsToDelete stay empty
//     by default — the UI fills them only when the user opts in).
//   • Match conservatively: main days by day number (then date), scenes by number.

// Map a parsed day `type` → store dayCategory / flags.
function dayTypeToCategory(type) {
  switch (type) {
    case 'prep':     return { dayCategory: 'prep',     isNonShootDay: true,  dayLabel: '' }
    case 'splinter': return { dayCategory: 'splinter', isNonShootDay: false, dayLabel: '' }
    case 'rest':     return { dayCategory: 'main',     isNonShootDay: true,  dayLabel: 'REST' }
    case 'unscheduled': return { dayCategory: 'unscheduled', isNonShootDay: true, dayLabel: 'UNSCHEDULED' }
    case 'main':
    default:         return { dayCategory: 'main',     isNonShootDay: false, dayLabel: '' }
  }
}

// Build the description for a scene, prepending the dance-sequence tag if present.
function buildSceneDescription(parsedScene) {
  const desc = parsedScene.description ?? ''
  const dance = (parsedScene.danceSequence ?? '').trim()
  return dance ? `(${dance}) ${desc}` : desc
}

// Resolve a parsed scene's castNumbers → store cast member UUIDs.
function resolveCastIds(castNumbers, castNumberToId) {
  return (castNumbers ?? [])
    .map(n => castNumberToId[String(n).trim()])
    .filter(Boolean)
}

// Compare a parsed scene against an existing store scene; return the list of
// field names that differ (empty = unchanged).
function diffScene(parsed, existing, resolvedCastIds) {
  const changes = []
  const pIntExt = parsed.intExt ?? 'INT'
  const pLoc    = parsed.setName ?? ''
  const pDN     = parsed.dayNight ?? 'DAY'
  const pDesc   = buildSceneDescription(parsed)
  const pPages  = parsed.pages ?? ''
  const pStory  = parsed.storyDay ?? ''

  if (pIntExt !== (existing.intExt ?? 'INT'))       changes.push('intExt')
  if (pLoc !== (existing.location ?? ''))           changes.push('location')
  if (pDN !== (existing.dayNight ?? 'DAY'))         changes.push('dayNight')
  if (pDesc !== (existing.description ?? ''))       changes.push('description')
  if (pPages !== (existing.pages ?? ''))            changes.push('pages')
  if (pStory !== (existing.storyDay ?? ''))         changes.push('storyDay')

  const existingCast = [...(existing.castMemberIds ?? [])].sort()
  const newCast      = [...resolvedCastIds].sort()
  if (existingCast.length !== newCast.length ||
      existingCast.some((id, i) => id !== newCast[i])) {
    changes.push('cast')
  }
  return changes
}

// Strip any stray "End of Day ..." banner lines the parser may have dropped
// into notes, plus blank lines.
function cleanNotes(notes) {
  return String(notes ?? '')
    .split('\n')
    .filter(line => line.trim() && !/end\s+of\s+day/i.test(line))
    .join('\n')
}

// Merge parsed days that share the same main dayNumber (the AI sometimes splits
// one shoot day into two with the same "Day N"). Scenes and notes are combined,
// preserving order. Only merges type 'main' days with a non-null dayNumber.
function mergeDuplicateDays(days) {
  const out = []
  const mainByNumber = new Map()  // dayNumber → index in out
  for (const d of (days ?? [])) {
    const key = d.type === 'main' && d.dayNumber != null ? d.dayNumber : null
    if (key != null && mainByNumber.has(key)) {
      const tgt = out[mainByNumber.get(key)]
      tgt.scenes = [...(tgt.scenes ?? []), ...(d.scenes ?? [])]
      tgt.notes  = [tgt.notes, d.notes].filter(Boolean).join('\n')
      if (!tgt.date && d.date) tgt.date = d.date
      if (!tgt.location && d.location) tgt.location = d.location
    } else {
      const copy = { ...d, scenes: [...(d.scenes ?? [])] }
      if (key != null) mainByNumber.set(key, out.length)
      out.push(copy)
    }
  }
  return out
}

export function reconcileSchedule(parsed, existing) {
  const existingDays = existing.shootDays ?? []
  const existingCast = existing.castMembers ?? []

  // Pre-process: merge duplicate day numbers and scrub notes.
  parsed = {
    ...parsed,
    days: mergeDuplicateDays(parsed.days).map(d => ({ ...d, notes: cleanNotes(d.notes) })),
  }

  // Commit lists
  const castToInsert    = []
  const daysToInsert    = []
  const daysToUpdate    = []
  const scenesToInsert  = []
  const scenesToUpdate  = []
  const extrasToInsert  = []
  const dayIdsToDelete  = []   // default empty — UI opts in
  const sceneIdsToDelete = []  // default empty — UI opts in

  // Preview-only
  const daysUnmatched   = []
  const scenesUnmatched = []
  const preview         = []

  // ── Cast reconciliation ─────────────────────────────────────────────────────
  // castNumberToId: cast number string → cast member id (existing or new).
  const castNumberToId = {}
  for (const c of existingCast) {
    if (c.castNumber != null) castNumberToId[String(c.castNumber)] = c.id
  }

  let newCastCount = 0
  ;(parsed.cast ?? []).forEach((pc, i) => {
    const numKey = String(pc.number ?? '').trim()
    if (!numKey) return
    const match = existingCast.find(c => String(c.castNumber ?? '') === numKey)
    if (match) {
      // Found — we don't auto-rename cast; just keep the existing mapping.
      castNumberToId[numKey] = match.id
      return
    }
    // New cast member. Split a trailing parenthetical note off the name,
    // e.g. "SAM (Knock 2nd Cast / Hungarian)" → name "SAM", notes "Knock 2nd Cast / Hungarian".
    const rawName = (pc.character ?? '').trim()
    const m = rawName.match(/^(.*?)\s*\(([^)]*)\)\s*$/)
    const name  = m ? m[1].trim() : rawName
    const notes = m ? m[2].trim() : ''
    const id = crypto.randomUUID()
    castToInsert.push({
      id,
      name,
      role:       '',
      notes,
      castNumber: numKey,
      sortOrder:  existingCast.length + newCastCount,
    })
    castNumberToId[numKey] = id
    newCastCount++
  })

  // ── Day matching helpers ─────────────────────────────────────────────────────
  // Existing main days indexed for matching, and a set tracking which existing
  // days got matched (so we can flag the leftovers).
  const existingMainDays = existingDays.filter(d => d.dayCategory === 'main')
  const matchedExistingIds = new Set()

  // Compute the append baseline for new sort orders / day numbers.
  let nextSortOrder = existingDays.length
    ? Math.max(...existingDays.map(d => d.sortOrder ?? 0)) + 1
    : 0
  const existingMainShooting = existingMainDays.filter(d => !d.isNonShootDay)
  let nextMainDayNumber = existingMainShooting.length
    ? Math.max(...existingMainShooting.map(d => d.dayNumber ?? 0)) + 1
    : 1

  function findExistingMainMatch(pDay) {
    // Primary: match by day number.
    if (pDay.dayNumber != null) {
      const byNum = existingMainDays.find(
        d => !matchedExistingIds.has(d.id) && d.dayNumber === pDay.dayNumber
      )
      if (byNum) return byNum
    }
    // Fallback: match by date.
    if (pDay.date) {
      const byDate = existingMainDays.find(
        d => !matchedExistingIds.has(d.id) && d.date === pDay.date
      )
      if (byDate) return byDate
    }
    return null
  }

  // Push a Supporting-Artist extras row for a NEW scene that has an SA count.
  function pushSaRow(dayId, ps) {
    const saNum = parseInt(ps.saCount, 10)
    if (!isNaN(saNum) && saNum > 0) {
      extrasToInsert.push({
        id: crypto.randomUUID(),
        dayId,
        scene: ps.sceneNumber ?? '',
        saName: '',
        totalNumber: saNum,
        sortOrder: extrasToInsert.filter(x => x.dayId === dayId).length,
      })
    }
  }

  // ── Day + scene reconciliation ───────────────────────────────────────────────
  let summaryNewDays = 0, summaryChangedDays = 0, summaryNewScenes = 0, summaryChangedScenes = 0

  for (const pDay of (parsed.days ?? [])) {
    // Skip weekend rest days — only midweek rest days are meaningful.
    if (pDay.type === 'rest' && pDay.date) {
      const dow = new Date(pDay.date + 'T00:00:00').getDay() // 0 = Sun, 6 = Sat
      if (dow === 0 || dow === 6) continue
    }
    const { dayCategory, isNonShootDay, dayLabel } = dayTypeToCategory(pDay.type)
    const pLocation = pDay.location ?? ''

    // Only main (incl. rest, which is dayCategory main) days participate in
    // match/update against existing days. prep/splinter days are always inserted
    // fresh — they're hard to match reliably and rarely overlap.
    const matched = dayCategory === 'main' ? findExistingMainMatch(pDay) : null

    if (matched) {
      matchedExistingIds.add(matched.id)

      // Does the day itself differ?
      const dayChanges = []
      // Resolve dayNumber: prefer parsed if present, else keep existing.
      const newDayNumber = pDay.dayNumber != null ? pDay.dayNumber : matched.dayNumber
      if (pDay.date && pDay.date !== matched.date)         dayChanges.push('date')
      if (pLocation && pLocation !== (matched.location ?? '')) dayChanges.push('location')
      if ((pDay.notes ?? '') !== (matched.notes ?? ''))   dayChanges.push('notes')

      if (dayChanges.length) {
        daysToUpdate.push({
          id:        matched.id,
          dayNumber: newDayNumber,
          date:      pDay.date || matched.date,
          location:  pLocation || matched.location || '',
          notes:     pDay.notes ?? matched.notes ?? '',
          _label:    `Day ${matched.dayNumber ?? '?'}`,
        })
      }

      // Scene-level reconciliation against this matched existing day.
      const existingScenes = matched.scenes ?? []
      const matchedSceneNums = new Set()
      const previewScenes = []

      ;(pDay.scenes ?? []).forEach((ps, idx) => {
        const numKey = String(ps.sceneNumber ?? '').trim()
        const resolvedCast = resolveCastIds(ps.castNumbers, castNumberToId)
        const existScene = numKey
          ? existingScenes.find(s => String(s.sceneNumber ?? '') === numKey)
          : null

        if (existScene) {
          matchedSceneNums.add(String(existScene.sceneNumber ?? ''))
          const changes = diffScene(ps, existScene, resolvedCast)
          if (changes.length) {
            scenesToUpdate.push({
              id:            existScene.id,
              dayId:         matched.id,
              sceneNumber:   numKey,
              intExt:        ps.intExt ?? 'INT',
              location:      ps.setName ?? '',
              dayNight:      ps.dayNight ?? 'DAY',
              description:   buildSceneDescription(ps),
              pages:         ps.pages ?? '',
              storyDay:      ps.storyDay ?? '',
              castMemberIds: resolvedCast,
            })
            summaryChangedScenes++
          }
          previewScenes.push({
            status: changes.length ? 'changed' : 'unchanged',
            sceneNumber: numKey, intExt: ps.intExt ?? 'INT', setName: ps.setName ?? '',
            dayNight: ps.dayNight ?? 'DAY', pages: ps.pages ?? '',
            storyDay: ps.storyDay ?? '',
            description: ps.description ?? '', danceSequence: ps.danceSequence ?? '',
            castNumbers: ps.castNumbers ?? [], changes,
            // commit metadata for drag-drop rebuild
            sceneKey: crypto.randomUUID(),
            commitKind: 'update', existingId: existScene.id,
            location: ps.setName ?? '',
            commitDescription: buildSceneDescription(ps),
            castMemberIds: resolvedCast,
          })
        } else {
          // New scene on an existing day.
          const newSceneId = crypto.randomUUID()
          scenesToInsert.push({
            id:            newSceneId,
            dayId:         matched.id,
            sceneNumber:   numKey,
            intExt:        ps.intExt ?? 'INT',
            location:      ps.setName ?? '',
            dayNight:      ps.dayNight ?? 'DAY',
            description:   buildSceneDescription(ps),
            pages:         ps.pages ?? '',
            storyDay:      ps.storyDay ?? '',
            castMemberIds: resolvedCast,
            sortOrder:     idx,
          })
          pushSaRow(matched.id, ps)
          summaryNewScenes++
          previewScenes.push({
            status: 'new',
            sceneNumber: numKey, intExt: ps.intExt ?? 'INT', setName: ps.setName ?? '',
            dayNight: ps.dayNight ?? 'DAY', pages: ps.pages ?? '',
            storyDay: ps.storyDay ?? '',
            description: ps.description ?? '', danceSequence: ps.danceSequence ?? '',
            castNumbers: ps.castNumbers ?? [], changes: [],
            sceneKey: crypto.randomUUID(),
            commitKind: 'insert', existingId: newSceneId,
            location: ps.setName ?? '',
            commitDescription: buildSceneDescription(ps),
            castMemberIds: resolvedCast,
          })
        }
      })

      // Existing scenes on this day not present in the PDF → flag (no auto-delete).
      for (const es of existingScenes) {
        if (!matchedSceneNums.has(String(es.sceneNumber ?? ''))) {
          scenesUnmatched.push({
            id: es.id, dayId: matched.id, sceneNumber: es.sceneNumber ?? '',
            dayLabel: `Day ${matched.dayNumber ?? '?'}`,
          })
        }
      }

      const dayStatus = dayChanges.length || previewScenes.some(s => s.status !== 'unchanged')
        ? 'changed' : 'unchanged'
      if (dayStatus === 'changed') summaryChangedDays++

      preview.push({
        status: dayStatus,
        dayKey: matched.id, dayIsNew: false,
        dayNumber: newDayNumber, date: pDay.date || matched.date,
        location: pLocation || matched.location || '',
        dayCategory, weekLabel: pDay.weekLabel ?? '', notes: pDay.notes ?? '',
        scenes: previewScenes,
      })

    } else {
      // ── New day ────────────────────────────────────────────────────────────
      const dayId = crypto.randomUUID()
      const sortOrder = nextSortOrder++
      // Assign a day number: parsed value if given, else auto for main shooting days.
      let dayNumber = pDay.dayNumber ?? null
      if (dayCategory === 'main' && !isNonShootDay && dayNumber == null) {
        dayNumber = nextMainDayNumber++
      } else if (dayCategory === 'main' && !isNonShootDay && dayNumber != null) {
        nextMainDayNumber = Math.max(nextMainDayNumber, dayNumber + 1)
      } else if (isNonShootDay) {
        dayNumber = null
      }

      daysToInsert.push({
        id: dayId, dayNumber, date: pDay.date ?? '', location: pLocation,
        unitBase: '', isNonShootDay, notes: pDay.notes ?? '',
        sortOrder, dayCategory, dayLabel,
      })
      summaryNewDays++

      // All scenes for a new day → scenesToInsert referencing the new day id.
      const previewScenes = []
      ;(pDay.scenes ?? []).forEach((ps, idx) => {
        const resolvedCast = resolveCastIds(ps.castNumbers, castNumberToId)
        const newSceneId = crypto.randomUUID()
        const numKey = String(ps.sceneNumber ?? '').trim()
        scenesToInsert.push({
          id:            newSceneId,
          dayId,
          sceneNumber:   numKey,
          intExt:        ps.intExt ?? 'INT',
          location:      ps.setName ?? '',
          dayNight:      ps.dayNight ?? 'DAY',
          description:   buildSceneDescription(ps),
          pages:         ps.pages ?? '',
          storyDay:      ps.storyDay ?? '',
          castMemberIds: resolvedCast,
          sortOrder:     idx,
        })
        pushSaRow(dayId, ps)
        summaryNewScenes++
        previewScenes.push({
          status: 'new',
          sceneNumber: numKey,
          intExt: ps.intExt ?? 'INT', setName: ps.setName ?? '',
          dayNight: ps.dayNight ?? 'DAY', pages: ps.pages ?? '',
          storyDay: ps.storyDay ?? '',
          description: ps.description ?? '', danceSequence: ps.danceSequence ?? '',
          castNumbers: ps.castNumbers ?? [], changes: [],
          sceneKey: crypto.randomUUID(),
          commitKind: 'insert', existingId: newSceneId,
          location: ps.setName ?? '',
          commitDescription: buildSceneDescription(ps),
          castMemberIds: resolvedCast,
        })
      })

      preview.push({
        status: 'new',
        dayKey: dayId, dayIsNew: true,
        dayNumber, date: pDay.date ?? '', location: pLocation,
        dayCategory, weekLabel: pDay.weekLabel ?? '', notes: pDay.notes ?? '',
        scenes: previewScenes,
      })
    }
  }

  // ── Existing main days not matched by any parsed day → flag for review. ──────
  for (const ed of existingMainDays) {
    if (!matchedExistingIds.has(ed.id)) {
      daysUnmatched.push({
        id: ed.id, dayNumber: ed.dayNumber ?? null, date: ed.date ?? '',
        label: `Day ${ed.dayNumber ?? '?'}${ed.date ? ` · ${ed.date}` : ''}`,
      })
    }
  }

  return {
    // commit lists
    castToInsert, daysToInsert, daysToUpdate, scenesToInsert, scenesToUpdate,
    extrasToInsert,
    dayIdsToDelete, sceneIdsToDelete,
    // preview
    summary: {
      newDays:       summaryNewDays,
      changedDays:   summaryChangedDays,
      newScenes:     summaryNewScenes,
      changedScenes: summaryChangedScenes,
      newCast:       castToInsert.length,
    },
    daysUnmatched, scenesUnmatched, preview,
  }
}
