import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function SetNewPassword() {
  const [password,        setPassword]        = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [submitting,      setSubmitting]      = useState(false)
  const [error,           setError]           = useState(null)
  const [done,            setDone]            = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== passwordConfirm) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setSubmitting(false)
      return
    }

    setDone(true)
    // Give a moment to see the success message, then reload cleanly
    // (reloading clears the recovery hash from the URL)
    setTimeout(() => window.location.replace('/'), 1500)
  }

  if (done) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
          <div className="login-logo">
            <img src="/favicon.svg" alt="FM" className="login-logo-img" />
          </div>
          <div style={{ fontSize: 36, margin: '16px 0 12px' }}>✅</div>
          <h1 className="login-title" style={{ fontSize: 20 }}>Password updated!</h1>
          <p className="login-sub">Taking you to the app…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="login-wrap">
      <div className="login-card">

        <div className="login-logo">
          <img src="/favicon.svg" alt="FM" className="login-logo-img" />
        </div>

        <h1 className="login-title">Set a new password</h1>
        <p className="login-sub">Choose a strong password to secure your account.</p>

        <form className="login-form" onSubmit={handleSubmit}>

          <div className="login-field">
            <label className="login-label">New password</label>
            <input
              className="login-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              autoFocus
              required
            />
          </div>

          <div className="login-field">
            <label className="login-label">Confirm new password</label>
            <input
              className="login-input"
              type="password"
              value={passwordConfirm}
              onChange={e => setPasswordConfirm(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button
            className="login-btn"
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Saving…' : 'Save new password'}
          </button>

        </form>
      </div>
    </div>
  )
}
