import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function AccountPage({ session, profile, onUpdateProfile }) {
  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [nameError, setNameError] = useState(null)

  const [pwSending,  setPwSending]  = useState(false)
  const [pwSent,     setPwSent]     = useState(false)
  const [pwError,    setPwError]    = useState(null)

  // Sync fields when profile loads
  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name ?? '')
      setLastName(profile.last_name ?? '')
    }
  }, [profile])

  // ── Save name ───────────────────────────────────────────────────────────────
  async function handleSaveName(e) {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) {
      setNameError('Please enter both first and last name.')
      return
    }
    setSaving(true)
    setNameError(null)
    setSaved(false)
    const { error } = await onUpdateProfile({
      first_name: firstName.trim(),
      last_name:  lastName.trim(),
    })
    if (error) {
      setNameError(error.message)
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    }
    setSaving(false)
  }

  // ── Send password reset email ────────────────────────────────────────────────
  async function handleResetPassword() {
    setPwSending(true)
    setPwError(null)
    setPwSent(false)
    const { error } = await supabase.auth.resetPasswordForEmail(
      session.user.email,
      { redirectTo: `${window.location.origin}/` }
    )
    if (error) {
      setPwError(error.message)
    } else {
      setPwSent(true)
    }
    setPwSending(false)
  }

  const isDirty = profile
    ? firstName !== (profile.first_name ?? '') || lastName !== (profile.last_name ?? '')
    : false

  return (
    <div className="acct-wrap">
      <div className="acct-section">
        <h2 className="acct-section-title">Your Details</h2>
        <p className="acct-section-sub">Update your name as it appears in the app.</p>

        <form className="acct-form" onSubmit={handleSaveName}>
          <div className="acct-row">
            <div className="acct-field">
              <label className="acct-label">First name</label>
              <input
                className="acct-input"
                type="text"
                value={firstName}
                onChange={e => { setFirstName(e.target.value); setSaved(false) }}
                placeholder="Jane"
                required
              />
            </div>
            <div className="acct-field">
              <label className="acct-label">Last name</label>
              <input
                className="acct-input"
                type="text"
                value={lastName}
                onChange={e => { setLastName(e.target.value); setSaved(false) }}
                placeholder="Smith"
                required
              />
            </div>
          </div>

          <div className="acct-field">
            <label className="acct-label">Email</label>
            <input
              className="acct-input acct-input--readonly"
              type="email"
              value={session.user.email ?? ''}
              readOnly
            />
            <p className="acct-hint">Email is managed through Supabase Auth and cannot be changed here.</p>
          </div>

          {nameError && <div className="acct-error">{nameError}</div>}

          <div className="acct-actions">
            <button
              className="acct-btn"
              type="submit"
              disabled={saving || !isDirty}
            >
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>

      <div className="acct-divider" />

      <div className="acct-section">
        <h2 className="acct-section-title">Password</h2>
        <p className="acct-section-sub">
          We'll send a password reset link to <strong>{session.user.email}</strong>.
        </p>

        {pwError  && <div className="acct-error">{pwError}</div>}
        {pwSent   && (
          <div className="acct-success">
            Reset email sent — check your inbox.
          </div>
        )}

        <button
          className="acct-btn acct-btn--secondary"
          onClick={handleResetPassword}
          disabled={pwSending || pwSent}
          type="button"
        >
          {pwSending ? 'Sending…' : pwSent ? '✓ Email sent' : 'Send password reset email'}
        </button>
      </div>
    </div>
  )
}
