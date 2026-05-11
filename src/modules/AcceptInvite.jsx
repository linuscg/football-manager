import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function AcceptInvite({ token, session }) {
  const [invite,          setInvite]          = useState(null)
  const [loadingInvite,   setLoadingInvite]   = useState(true)
  const [inviteError,     setInviteError]     = useState(null)

  const [firstName,       setFirstName]       = useState('')
  const [lastName,        setLastName]        = useState('')
  const [password,        setPassword]        = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [formError,  setFormError]  = useState(null)
  const [done,       setDone]       = useState(false)

  // ── Load and validate the invite ───────────────────────────────────────────
  useEffect(() => {
    async function loadInvite() {
      const { data, error } = await supabase
        .from('invites')
        .select('*, productions(name)')
        .eq('token', token)
        .eq('accepted', false)
        .gte('expires_at', new Date().toISOString())
        .maybeSingle()

      if (error || !data) {
        setInviteError('This invite link is invalid or has already been used.')
      } else if (data.email.toLowerCase() !== session.user.email?.toLowerCase()) {
        setInviteError(
          `This invite was sent to ${data.email}. You are signed in as ${session.user.email}.`
        )
      } else {
        setInvite(data)
      }
      setLoadingInvite(false)
    }
    loadInvite()
  }, [token, session])

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    setFormError(null)

    if (!firstName.trim() || !lastName.trim()) {
      setFormError('Please enter your first and last name.')
      return
    }
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    if (password !== passwordConfirm) {
      setFormError('Passwords do not match.')
      return
    }

    setSubmitting(true)

    // 1. Set password
    const { error: pwError } = await supabase.auth.updateUser({ password })
    if (pwError) {
      setFormError(pwError.message)
      setSubmitting(false)
      return
    }

    // 2. Upsert profile (trigger may have already created a row)
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id:         session.user.id,
        first_name: firstName.trim(),
        last_name:  lastName.trim(),
        is_owner:   false,
      }, { onConflict: 'id' })

    if (profileError) {
      setFormError(profileError.message)
      setSubmitting(false)
      return
    }

    // 3. Add to production_members (RLS invite-acceptance policy allows this)
    const { error: memberError } = await supabase
      .from('production_members')
      .insert({
        production_id: invite.production_id,
        user_id:       session.user.id,
        role:          invite.role,
      })

    if (memberError) {
      setFormError(memberError.message)
      setSubmitting(false)
      return
    }

    // 4. Mark invite accepted
    await supabase
      .from('invites')
      .update({ accepted: true })
      .eq('token', token)

    setDone(true)
    setSubmitting(false)

    // Clean URL + reload into main app after a short delay
    setTimeout(() => {
      window.location.replace(window.location.pathname)
    }, 1800)
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loadingInvite) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
          <div className="login-logo">
            <img src="/favicon.svg" alt="FM" className="login-logo-img" />
          </div>
          <p className="login-sub" style={{ marginTop: 16 }}>Verifying your invitation…</p>
        </div>
      </div>
    )
  }

  // ── Invalid invite ────────────────────────────────────────────────────────────
  if (inviteError) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
          <div className="login-logo">
            <img src="/favicon.svg" alt="FM" className="login-logo-img" />
          </div>
          <h1 className="login-title" style={{ fontSize: 18 }}>Invite Not Found</h1>
          <div className="login-error" style={{ marginTop: 20, textAlign: 'left' }}>{inviteError}</div>
          <p style={{ marginTop: 20, fontSize: 12, color: '#9ca3af' }}>
            Contact the person who sent you the invite to request a new link.
          </p>
        </div>
      </div>
    )
  }

  // ── Done ──────────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
          <h1 className="login-title" style={{ fontSize: 20 }}>You're all set!</h1>
          <p className="login-sub">Taking you to {invite.productions?.name || 'the app'}…</p>
        </div>
      </div>
    )
  }

  const productionName = invite.productions?.name || 'the production'
  const roleLabel = invite.role.charAt(0).toUpperCase() + invite.role.slice(1)

  // ── Form ──────────────────────────────────────────────────────────────────────
  return (
    <div className="login-wrap">
      <div className="login-card">

        <div className="login-logo">
          <img src="/favicon.svg" alt="FM" className="login-logo-img" />
        </div>

        <h1 className="login-title">Welcome to Football Manager</h1>
        <p className="login-sub">
          You've been invited to <strong>{productionName}</strong> as <strong>{roleLabel}</strong>.
          <br />Set up your account to get started.
        </p>

        <form className="login-form" onSubmit={handleSubmit}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="login-field">
              <label className="login-label">First name</label>
              <input
                className="login-input"
                type="text"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="Jane"
                autoFocus
                required
              />
            </div>
            <div className="login-field">
              <label className="login-label">Last name</label>
              <input
                className="login-input"
                type="text"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="Smith"
                required
              />
            </div>
          </div>

          <div className="login-field" style={{ marginTop: 4 }}>
            <label className="login-label">Email</label>
            <input
              className="login-input"
              type="email"
              value={session.user.email ?? ''}
              readOnly
              style={{ background: '#f9fafb', color: '#6b7280', cursor: 'default' }}
            />
          </div>

          <div className="login-field">
            <label className="login-label">Set a password</label>
            <input
              className="login-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
            />
          </div>

          <div className="login-field">
            <label className="login-label">Confirm password</label>
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

          {formError && (
            <div className="login-error">{formError}</div>
          )}

          <button
            className="login-btn"
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Setting up your account…' : 'Create account & join'}
          </button>

        </form>
      </div>
    </div>
  )
}
