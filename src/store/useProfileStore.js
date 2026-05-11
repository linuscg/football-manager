import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Loads the current user's profile (first/last name, is_owner)
 * and their role in the given production.
 */
export function useProfileStore(userId, productionId) {
  const [profile,     setProfile]     = useState(null)
  const [memberRole,  setMemberRole]  = useState(null)   // 'owner' | 'admin' | 'member' | null
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
    if (!userId || !productionId) { setMemberRole(null); return }

    supabase
      .from('production_members')
      .select('role')
      .eq('user_id', userId)
      .eq('production_id', productionId)
      .maybeSingle()
      .then(({ data }) => setMemberRole(data?.role ?? null))
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

  return { profile, memberRole, loading, updateProfile }
}
