import { useMemo } from 'react'
import { useFulltimeCrewStore } from './useFulltimeCrewStore'
import { useHodsStore }         from './useHodsStore'

/**
 * Returns a unified, sorted crew list combining HODs and fulltime crew members.
 * HODs are mapped to the same shape as fulltime crew members (role = title, isHod = true).
 * Within each department HODs appear first, then regular members alphabetically.
 */
export function useFullCrewList() {
  const { members, loading: membersLoading } = useFulltimeCrewStore()
  const { hods,    loading: hodsLoading }    = useHodsStore()

  const allMembers = useMemo(() => {
    function deptPriority(dept) {
      const d = (dept || '').toLowerCase().trim()
      if (d === 'director' || d === 'directors') return 0
      if (d === 'producer' || d === 'producers') return 1
      if (d === 'production') return 2
      return 3
    }

    const mappedHods = hods.map(h => ({
      id:         h.id,
      name:       h.name,
      role:       h.title,       // HOD title maps to role
      department: h.department,
      phone:      h.phone,
      email:      h.email,
      startDate:  h.startDate,
      endDate:    h.endDate,
      sortOrder:  h.sortOrder,
      level:      h.level ?? 1,
      isHod:      true,
    }))

    // Sort: by department priority, then alpha by dept name within priority group,
    // then by level (1 first), then name alphabetically
    return [...mappedHods, ...members].sort((a, b) => {
      const pa = deptPriority(a.department)
      const pb = deptPriority(b.department)
      if (pa !== pb) return pa - pb
      const deptA = (a.department || '').toLowerCase()
      const deptB = (b.department || '').toLowerCase()
      if (deptA !== deptB) return deptA.localeCompare(deptB)
      const la = a.level ?? (a.isHod ? 1 : 5)
      const lb = b.level ?? (b.isHod ? 1 : 5)
      if (la !== lb) return la - lb
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
    })
  }, [hods, members])

  return {
    members: allMembers,
    loading: membersLoading || hodsLoading,
  }
}
