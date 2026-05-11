import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// ─── Module-level auth state ──────────────────────────────────────────────────
// Supabase fires PASSWORD_RECOVERY the instant createClient processes the URL —
// long before React renders. We must subscribe here, at import time, or we
// will always miss it.

let _session          = undefined   // undefined = not yet known
let _passwordRecovery = false
const _listeners      = new Set()

function _notify() {
  _listeners.forEach(fn => fn())
}

// Subscribe immediately — this is what catches PASSWORD_RECOVERY reliably
supabase.auth.onAuthStateChange((event, session) => {
  _session = session ?? null

  if (event === 'PASSWORD_RECOVERY') {
    _passwordRecovery = true
  } else if (event === 'USER_UPDATED' || event === 'SIGNED_OUT') {
    _passwordRecovery = false
  } else if (event === 'SIGNED_IN') {
    // Only a normal sign-in if we're not mid-recovery
    if (!_passwordRecovery) _passwordRecovery = false
  }

  _notify()
})

// Hydrate initial session (for already-logged-in users on a normal page load)
supabase.auth.getSession().then(({ data: { session } }) => {
  if (_session === undefined) {
    _session = session ?? null
    _notify()
  }
})

// ─── React hook ───────────────────────────────────────────────────────────────

export function useAuthStore() {
  const [, rerender] = useState(0)

  // Re-render whenever module-level state changes
  useEffect(() => {
    const fn = () => rerender(n => n + 1)
    _listeners.add(fn)
    // If state is already known, trigger immediately
    if (_session !== undefined) fn()
    return () => _listeners.delete(fn)
  }, [])

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

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

  return {
    session:          _session,
    passwordRecovery: _passwordRecovery,
    loading,
    error,
    signIn,
    signOut,
  }
}
