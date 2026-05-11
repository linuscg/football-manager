import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login({ onSignIn, loading, error, onBack }) {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')

  // Reset-password state
  const [showReset,   setShowReset]   = useState(false)
  const [resetEmail,  setResetEmail]  = useState('')
  const [resetBusy,   setResetBusy]   = useState(false)
  const [resetResult, setResetResult] = useState(null) // { ok, message }

  function handleSubmit(e) {
    e.preventDefault()
    onSignIn(email, password)
  }

  async function handleReset(e) {
    e.preventDefault()
    setResetBusy(true)
    setResetResult(null)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      resetEmail.trim().toLowerCase(),
      { redirectTo: `${window.location.origin}/` },
    )
    if (resetError) {
      setResetResult({ ok: false, message: resetError.message })
    } else {
      setResetResult({ ok: true, message: 'Check your inbox for a password reset link.' })
    }
    setResetBusy(false)
  }

  // ── Reset password view ───────────────────────────────────────────────────
  if (showReset) {
    return (
      <div className="login-wrap">
        <div className="login-card">

          <div className="login-logo">
            <img src="/favicon.svg" alt="FM" className="login-logo-img" />
          </div>

          <h1 className="login-title">Reset password</h1>
          <p className="login-sub">
            Enter your email and we'll send you a reset link.
          </p>

          <form className="login-form" onSubmit={handleReset}>
            <div className="login-field">
              <label className="login-label">Email</label>
              <input
                className="login-input"
                type="email"
                value={resetEmail}
                onChange={e => setResetEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                required
              />
            </div>

            {resetResult && (
              <div className={resetResult.ok ? 'login-success' : 'login-error'}>
                {resetResult.message}
              </div>
            )}

            {!resetResult?.ok && (
              <button className="login-btn" type="submit" disabled={resetBusy}>
                {resetBusy ? 'Sending…' : 'Send reset link'}
              </button>
            )}

            <button
              type="button"
              className="login-btn"
              style={{ background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb', marginTop: 8 }}
              onClick={() => { setShowReset(false); setResetResult(null) }}
            >
              ← Back to sign in
            </button>
          </form>

        </div>
      </div>
    )
  }

  // ── Sign-in view ──────────────────────────────────────────────────────────
  return (
    <div className="login-wrap">
      <div className="login-card">

        <div className="login-logo">
          <img src="/favicon.svg" alt="FM" className="login-logo-img" />
        </div>

        <h1 className="login-title">Football Manager</h1>
        <p className="login-sub">Sign in to continue</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label className="login-label">Email</label>
            <input
              className="login-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              required
            />
          </div>

          <div className="login-field">
            <label className="login-label">
              Password
              <button
                type="button"
                className="login-forgot"
                onClick={() => { setResetEmail(email); setShowReset(true) }}
              >
                Forgot password?
              </button>
            </label>
            <input
              className="login-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="login-error">{error}</div>
          )}

          <button
            className="login-btn"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          {onBack && (
            <button
              type="button"
              className="login-btn"
              style={{ background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb', marginTop: 8 }}
              onClick={onBack}
            >
              ← Back
            </button>
          )}
        </form>

      </div>
    </div>
  )
}
