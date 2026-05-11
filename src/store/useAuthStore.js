import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useAuthStore() {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    // Get current session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null)
    })

    // Listen for sign-in / sign-out
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return { session, loading, error, signIn, signOut }
}
