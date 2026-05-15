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
      isHod:      true,
    }))

    // Sort: by department, then HODs first, then by name
    return [...mappedHods, ...members].sort((a, b) => {
      const deptA = (a.department || '').toLowerCase()
      const deptB = (b.department || '').toLowerCase()
      if (deptA !== deptB) return deptA.localeCompare(deptB)
      if (a.isHod !== b.isHod) return a.isHod ? -1 : 1
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
    })
  }, [hods, members])

  return {
    members: allMembers,
    loading: membersLoading || hodsLoading,
  }
}
