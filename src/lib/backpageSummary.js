/**
 * generatePreCallSummary
 *
 * Produces a copy-pastable pre-call summary grouped by dept + role, e.g.
 * "3x Electrics: Electrician - 30min pre-call; 1x Production - Additional: Additional APOC - 43min pre-call"
 *
 * Inclusion rules:
 *   • Dept pre-call > 0 → group members by role, show count
 *   • Members with an individual call-time override → listed separately by role
 *   • Members with dept pre-call = 0 and no override → omitted
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
  dayId,
  depts       = [], groupMap    = {},
  addDepts    = [], addGroupMap = {},
  getDeptSetting, getMemberOverride,
  generalCall,
}) {
  if (!dayId) return ''

  // Collected entries: { preCallMins, text }
  const entries    = []
  const indivParts = []

  /**
   * Process one set of depts.
   * settingsKeyFn(deptName) → the key used for getDeptSetting (e.g. "Grips" or "Grips - Additional")
   * displayKeyFn(deptName)  → what to show before the colon (same as settingsKey here)
   */
  function processGroup(deptList, sourceMap, settingsKeyFn) {
    // Sort depts by preCallMins descending so the summary reads largest first
    const sorted = [...deptList].sort((a, b) => {
      const pa = getDeptSetting(dayId, settingsKeyFn(a)).preCallMins ?? 0
      const pb = getDeptSetting(dayId, settingsKeyFn(b)).preCallMins ?? 0
      return pb - pa
    })

    for (const dept of sorted) {
      const key         = settingsKeyFn(dept)
      const preCallMins = getDeptSetting(dayId, key).preCallMins ?? 0
      const members     = sourceMap[dept] ?? []

      // Individual call-time overrides — show separately by role
      const withOverride = members.filter(m => getMemberOverride(dayId, m.id)?.callTime)
      for (const m of withOverride) {
        const callTime = getMemberOverride(dayId, m.id)?.callTime
        if (!callTime) continue
        const role  = m.role?.trim() || key
        const label = `${key}: ${role}`
        indivParts.push(`${label} - ${callTime}`)
      }

      if (preCallMins <= 0) continue

      // Group remaining members by role — all roles for this dept become ONE entry
      const withoutOverride = members.filter(m => !getMemberOverride(dayId, m.id)?.callTime)
      const roleMap = {}
      for (const m of withoutOverride) {
        const role = m.role?.trim() || '(no role)'
        roleMap[role] = (roleMap[role] ?? 0) + 1
      }

      if (Object.keys(roleMap).length === 0) continue

      // e.g. "3x Electrician, 2x Best Boy"
      const rolePart = Object.entries(roleMap)
        .map(([role, count]) => `${count}x ${role}`)
        .join(', ')

      entries.push({
        preCallMins,
        text: `${key}: ${rolePart} - ${fmtMins(preCallMins)} pre-call`,
      })
    }
  }

  // Fulltime crew — settings key is just the dept name
  processGroup(depts,    groupMap,    d => d)
  // Additional crew — settings key has the "- Additional" suffix
  processGroup(addDepts, addGroupMap, d => `${d} - Additional`)

  // Sort entries by preCallMins descending (largest pre-call first)
  entries.sort((a, b) => b.preCallMins - a.preCallMins)

  const allParts = [...entries.map(e => e.text), ...indivParts]
  return allParts.join('; ')
}
