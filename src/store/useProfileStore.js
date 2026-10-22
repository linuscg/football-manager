import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { EMPTY_PERMISSIONS, normalizePermissions } from '../lib/permissionRegistry'

/**
 * Loads the current user's profile (first/last name, is_owner),
 * their role in the given production, and their UI permissions
 * (production_members.permissions jsonb — stored as denials).
 */
export function useProfileStore(userId, productionId) {
  const [profile,     setProfile]     = useState(null)
  const [memberRole,  setMemberRole]  = useState(null)   // 'owner' | 'admin' | 'member' | null
  const [permissions, setPermissions] = useState(EMPTY_PERMISSIONS)
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    if (!userId) { setLoading(false); return }

    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        setProfile(data)
        setLoading(false)
      })
  }, [userId])

  useEffect(() => {
    if (!userId || !productionId) {
      setMemberRole(null)
      setPermissions(EMPTY_PERMISSIONS)
      return
    }

    supabase
      .from('production_members')
      .select('role, permissions')
      .eq('user_id', userId)
      .eq('production_id', productionId)
      .maybeSingle()
      .then(({ data }) => {
        setMemberRole(data?.role ?? null)
        setPermissions(normalizePermissions(data?.permissions))
      })
  }, [userId, productionId])

  async function updateProfile(updates) {
    const { data, error } = await supabase
      .from('profiles')
      .upsert({ id: userId, ...updates }, { onConflict: 'id' })
      .select()
      .single()
    if (!error && data) setProfile(data)
    return { error }
  }

  return { profile, memberRole, permissions, loading, updateProfile }
}
