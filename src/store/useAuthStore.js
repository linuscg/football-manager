import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useAuthStore() {
  const [session,          setSession]          = useState(undefined) // undefined = still loading
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [loading,          setLoading]          = useState(false)
  const [error,            setError]            = useState(null)

  useEffect(() => {
    // Get current session on mount — but don't override a recovery state
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null)
    })

    // Listen for auth events — intercept PASSWORD_RECOVERY so we can
    // show the "set new password" screen instead of the main app
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
      } else if (event === 'USER_UPDATED') {
        // Password was successfully updated — clear recovery mode and carry on
        setPasswordRecovery(false)
      } else {
        setPasswordRecovery(false)
      }
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

  return { session, passwordRecovery, loading, error, signIn, signOut }
}
