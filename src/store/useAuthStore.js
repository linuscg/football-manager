import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Detect a recovery link immediately from the URL hash before React even renders.
// Supabase embeds type=recovery in the hash for password-reset links, e.g.
// https://app.com/#access_token=...&type=recovery
function isRecoveryUrl() {
  return window.location.hash.includes('type=recovery')
}

export function useAuthStore() {
  const [session,          setSession]          = useState(undefined)
  // Initialise from the URL hash so we never miss the event even if it fires
  // before our onAuthStateChange subscription is ready
  const [passwordRecovery, setPasswordRecovery] = useState(isRecoveryUrl)
  const [loading,          setLoading]          = useState(false)
  const [error,            setError]            = useState(null)

  useEffect(() => {
    // Subscribe to auth state changes FIRST — before calling getSession —
    // so we don't miss the PASSWORD_RECOVERY event that Supabase fires while
    // processing the URL hash token.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
      } else if (event === 'USER_UPDATED') {
        setPasswordRecovery(false)
      } else if (event === 'SIGNED_IN') {
        // Only clear recovery if we're doing a normal sign-in (not via a recovery URL)
        if (!isRecoveryUrl()) setPasswordRecovery(false)
      } else {
        setPasswordRecovery(false)
      }
      setSession(session ?? null)
    })

    // Now get the current session — if there's a recovery token in the URL
    // Supabase will process it here and the event above will fire
    supabase.auth.getSession().then(({ data: { session } }) => {
      // Only update session if passwordRecovery wasn't already detected
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
