/**
 * generatePreCallSummary
 *
 * Produces a copy-pastable pre-call summary string, e.g.
 * "5x Grips - 30min Pre-call; 4x ADs - 1hr Pre-call; Jane Smith (Camera) - 07:00"
 *
 * Inclusion rules:
 *   • Department: preCallMins > 0 → group all members without individual overrides
 *   • Individual: has a call time override explicitly set → list by name
 *   • Everyone else (dept preCallMins=0, no override) → omitted
 *
 * @param {object} opts
 *   dayId            – selected day UUID (may be null)
 *   depts            – string[] sorted dept names
 *   groupMap         – { [deptName]: member[] }
 *   getDeptSetting   – (dayId, dept) => { preCallMins, derigMins }
 *   getMemberOverride– (dayId, memberId) => { callTime, wrapTime } | null
 *   generalCall      – "HH:MM" or null
 *
 * @returns {string}
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

export function generatePreCallSummary({
  dayId, depts, groupMap,
  getDeptSetting, getMemberOverride,
  generalCall,
}) {
  if (!dayId || !depts?.length) return ''

  // Sort depts by preCallMins descending (largest pre-call first)
  const sorted = [...depts].sort((a, b) => {
    const pa = getDeptSetting(dayId, a).preCallMins ?? 0
    const pb = getDeptSetting(dayId, b).preCallMins ?? 0
    return pb - pa
  })

  const deptParts   = []
  const indivParts  = []

  for (const dept of sorted) {
    const setting     = getDeptSetting(dayId, dept)
    const preCallMins = setting.preCallMins ?? 0
    const members     = groupMap[dept] ?? []

    const withOverride    = members.filter(m => getMemberOverride(dayId, m.id)?.callTime)
    const withoutOverride = members.filter(m => !getMemberOverride(dayId, m.id)?.callTime)

    // Dept-level pre-call group
    if (preCallMins > 0 && withoutOverride.length > 0) {
      deptParts.push(`${withoutOverride.length}x ${dept} - ${fmtMins(preCallMins)} Pre-call`)
    }

    // Individual overrides — listed by name
    for (const m of withOverride) {
      const callTime = getMemberOverride(dayId, m.id)?.callTime
      if (!callTime) continue
      indivParts.push(`${m.name} (${dept}) - ${callTime}`)
    }
  }

  return [...deptParts, ...indivParts].join('; ')
}
