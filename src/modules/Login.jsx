import { useState } from 'react'

export default function Login({ onSignIn, loading, error }) {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    onSignIn(email, password)
  }

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
            <label className="login-label">Password</label>
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
        </form>

      </div>
    </div>
  )
}
