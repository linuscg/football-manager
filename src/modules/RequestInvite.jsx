import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function RequestInvite({ onBack }) {
  const [name,      setName]      = useState('')
  const [email,     setEmail]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error,     setError]     = useState(null)
  const [done,      setDone]      = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) { setError('Please enter your name.'); return }
    if (!email.trim()) { setError('Please enter your email address.'); return }

    setSubmitting(true)

    const { error: dbError } = await supabase
      .from('invite_requests')
      .insert({ name: name.trim(), email: email.trim().toLowerCase() })

    if (dbError) {
      setError(dbError.message || 'Something went wrong. Please try again.')
      setSubmitting(false)
      return
    }

    setDone(true)
    setSubmitting(false)
  }

  if (done) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
          <div className="login-logo">
            <img src="/favicon.svg" alt="FM" className="login-logo-img" />
          </div>
          <div style={{ fontSize: 36, margin: '16px 0 12px' }}>✉️</div>
          <h1 className="login-title" style={{ fontSize: 20 }}>Request received!</h1>
          <p className="login-sub" style={{ marginTop: 8 }}>
            We'll review your request and send you an invite soon.
          </p>
          <button
            className="login-btn"
            style={{ marginTop: 28 }}
            onClick={onBack}
          >
            Back to home
          </button>
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

        <h1 className="login-title">Request an Invite</h1>
        <p className="login-sub">
          Leave your details and we'll send you an invite when a spot opens up.
        </p>

        <form className="login-form" onSubmit={handleSubmit}>

          <div className="login-field">
            <label className="login-label">Your name</label>
            <input
              className="login-input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Jane Smith"
              autoFocus
              required
            />
          </div>

          <div className="login-field">
            <label className="login-label">Email address</label>
            <input
              className="login-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="jane@studio.com"
              required
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button
            className="login-btn"
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Sending…' : 'Send request'}
          </button>

          <button
            type="button"
            className="login-btn"
            style={{ background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb', marginTop: 8 }}
            onClick={onBack}
          >
            ← Back
          </button>

        </form>
      </div>
    </div>
  )
}
