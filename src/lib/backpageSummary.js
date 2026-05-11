/**
 * generatePreCallSummary
 *
 * Groups ALL crew (including those with individual call-time overrides)
 * by department → role → effective pre-call minutes, e.g.
 *
 * "Production: 1x APOC - 43min pre-call, 1x APOC - 30min pre-call;
 *  Production - Additional: 1x APOC - 30min pre-call"
 *
 * Effective pre-call:
 *   • Individual call-time override → generalCall minus overrideTime (in mins)
 *   • No override                   → dept preCallMins setting
 *   • Either resolves to 0 or less  → member omitted
 *
 * @param {object} opts
 *   dayId            – selected day UUID
 *   depts            – string[] sorted fulltime dept names
 *   groupMap         – { [deptName]: member[] }
 *   addDepts         – string[] additional crew dept names  (optional)
 *   addGroupMap      – { [deptName]: resource[] }           (optional)
 *   getDeptSetting   – (dayId, settingsKey) => { preCallMins, derigMins }
 *   getMemberOverride– (dayId, memberId) => override | null
 *   generalCall      – "HH:MM" or null
 */

function fmtMins(mins) {
  const abs = Math.abs(mins)
  const h   = Math.floor(abs / 60)
  const m   = abs % 60
  const parts = []
  if (h) parts.push(`${h}hr`)
  if (m) parts.push(`${m}min`)
  return parts.join(' ')
}

// How many minutes before generalCall is overrideTime? Returns null if ≤ 0.
function preCallFromOverride(generalCall, overrideTime) {
  if (!generalCall || !overrideTime) return null
  const [gh, gm] = generalCall.split(':').map(Number)
  const [oh, om] = overrideTime.split(':').map(Number)
  const diff = (gh * 60 + gm) - (oh * 60 + om)
  return diff > 0 ? diff : null
}

export function generatePreCallSummary({
  dayId,
  depts       = [], groupMap    = {},
  addDepts    = [], addGroupMap = {},
  getDeptSetting, getMemberOverride,
  generalCall,
}) {
  if (!dayId) return ''

  // Collected dept entries: { maxPreCallMins, text }
  const entries = []

  function processGroup(deptList, sourceMap, settingsKeyFn) {
    // Sort depts by their dept-level preCallMins descending (rough ordering)
    const sorted = [...deptList].sort((a, b) => {
      const pa = getDeptSetting(dayId, settingsKeyFn(a)).preCallMins ?? 0
      const pb = getDeptSetting(dayId, settingsKeyFn(b)).preCallMins ?? 0
      return pb - pa
    })

    for (const dept of sorted) {
      const key         = settingsKeyFn(dept)
      const deptPreCall = getDeptSetting(dayId, key).preCallMins ?? 0
      const members     = sourceMap[dept] ?? []

      // Build groups keyed by "role|preCallMins"
      const groups = {}

      for (const m of members) {
        const override = getMemberOverride(dayId, m.id)
        if (override?.exclude) continue

        // Effective pre-call for this person
        const effectiveMins = override?.callTime
          ? preCallFromOverride(generalCall, override.callTime)
          : (deptPreCall > 0 ? deptPreCall : null)

        if (!effectiveMins) continue

        const role = m.role?.trim() || '(no role)'
        const gKey = `${role}|${effectiveMins}`
        if (!groups[gKey]) groups[gKey] = { role, preCallMins: effectiveMins, count: 0 }
        groups[gKey].count++
      }

      if (Object.keys(groups).length === 0) continue

      // Sort role-groups within this dept by pre-call descending
      const roleGroups = Object.values(groups)
        .sort((a, b) => b.preCallMins - a.preCallMins)

      const roleParts = roleGroups.map(g =>
        `${g.count}x ${g.role} - ${fmtMins(g.preCallMins)} pre-call`
      )

      const maxPreCall = roleGroups[0].preCallMins

      entries.push({
        maxPreCall,
        text: `${key}: ${roleParts.join(', ')}`,
      })
    }
  }

  // Fulltime crew (settings key = dept name)
  processGroup(depts,    groupMap,    d => d)
  // Additional crew (settings key has "- Additional" suffix)
  processGroup(addDepts, addGroupMap, d => `${d} - Additional`)

  // Sort all dept entries by their largest pre-call descending
  entries.sort((a, b) => b.maxPreCall - a.maxPreCall)

  return entries.map(e => e.text).join('; ')
}
