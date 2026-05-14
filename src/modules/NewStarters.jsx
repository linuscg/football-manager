import { useState, useRef } from 'react'

const RESEND_API_KEY = 're_YoTz8hWx_HKbB1c9W8p111Hdcf7hrNWe5'
import { useFulltimeCrewStore }  from '../store/useFulltimeCrewStore'
import { useCrewStore }          from '../store/useCrewStore'
import { useNewStartersStore }   from '../store/useNewStartersStore'

// ─── Date helpers ──────────────────────────────────────────────────────────────

function startOfWeek(date) {
  // Monday-based week
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toISO(date) {
  return date.toISOString().slice(0, 10)
}

function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function fmtWeekRange(weekStart) {
  const weekEnd = addDays(weekStart, 6)
  const opts = { day: 'numeric', month: 'short' }
  return `${weekStart.toLocaleDateString('en-GB', opts)} – ${weekEnd.toLocaleDateString('en-GB', { ...opts, year: 'numeric' })}`
}

// ─── Welcome email helpers ─────────────────────────────────────────────────────

const STORAGE_KEY = 'fm_welcome_email_config'

function loadEmailConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
  } catch { return {} }
}

function saveEmailConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
}

function applyPlaceholders(template, { name, startDate, endDate }) {
  return template
    .replace(/\{\{name\}\}/gi,       name      || '')
    .replace(/\{\{start_date\}\}/gi, startDate ? fmtDate(startDate) : '')
    .replace(/\{\{end_date\}\}/gi,   endDate   ? fmtDate(endDate)   : '')
}

// ─── Email config modal ────────────────────────────────────────────────────────

const PLACEHOLDERS = [
  { label: '{{name}}',       value: '{{name}}'       },
  { label: '{{start_date}}', value: '{{start_date}}' },
  { label: '{{end_date}}',   value: '{{end_date}}'   },
]

function EmailConfigModal({ onClose, onSaved }) {
  const [cfg, setCfg] = useState(loadEmailConfig)
  const [dragging, setDragging] = useState(false)
  const bodyRef = useRef(null)

  function set(field, value) {
    setCfg(c => ({ ...c, [field]: value }))
  }

  // Insert placeholder at the textarea's current cursor position
  function insertPlaceholder(placeholder) {
    const el = bodyRef.current
    if (!el) return
    const start = el.selectionStart
    const end   = el.selectionEnd
    const current = cfg.body ?? ''
    const next = current.slice(0, start) + placeholder + current.slice(end)
    set('body', next)
    // Restore cursor position after the inserted text
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + placeholder.length, start + placeholder.length)
    })
  }

  function handleFileDrop(e) {
    e.preventDefault()
    setDragging(false)
    const files = [...(e.dataTransfer?.files ?? [])]
    if (!files.length) return
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => {
        setCfg(c => ({
          ...c,
          attachments: [
            ...(c.attachments ?? []),
            { name: file.name, type: file.type, data: ev.target.result.split(',')[1] },
          ],
        }))
      }
      reader.readAsDataURL(file)
    })
  }

  function removeAttachment(idx) {
    setCfg(c => ({ ...c, attachments: (c.attachments ?? []).filter((_, i) => i !== idx) }))
  }

  function handleSave() {
    saveEmailConfig(cfg)
    onSaved(cfg)
    onClose()
  }

  return (
    <div className="ns-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ns-modal">
        <div className="ns-modal-head">
          <h2 className="ns-modal-title">Edit Welcome Email</h2>
          <button className="pm-icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="ns-modal-body">
          <div className="ns-field-row">
            <div className="ns-field">
              <label className="ns-label">From name</label>
              <input className="ns-input" value={cfg.fromName ?? ''} placeholder="Production Office" onChange={e => set('fromName', e.target.value)} />
            </div>
            <div className="ns-field">
              <label className="ns-label">From email</label>
              <input className="ns-input" type="email" value={cfg.fromEmail ?? ''} placeholder="hello@yourdomain.com" onChange={e => set('fromEmail', e.target.value)} />
            </div>
          </div>

          <div className="ns-field">
            <label className="ns-label">Subject</label>
            <input className="ns-input" value={cfg.subject ?? ''} placeholder="Welcome to the team, {{name}}!" onChange={e => set('subject', e.target.value)} />
          </div>

          <div className="ns-field">
            <label className="ns-label">
              Email body
            </label>
            <div className="ns-placeholder-bar">
              <span className="ns-placeholder-bar-label">Insert:</span>
              {PLACEHOLDERS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  className="ns-placeholder-btn"
                  onMouseDown={e => {
                    // Use mousedown so we don't lose textarea focus/selection before click
                    e.preventDefault()
                    insertPlaceholder(p.value)
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <textarea
              ref={bodyRef}
              className="ns-textarea"
              rows={10}
              value={cfg.body ?? ''}
              placeholder={`Hi {{name}},\n\nWe're excited to have you joining us on {{start_date}}.\n\nPlease find your contract and details attached.\n\nBest,\nThe Production Team`}
              onChange={e => set('body', e.target.value)}
            />
          </div>

          <div className="ns-field">
            <label className="ns-label">Attachments</label>
            <div
              className={`ns-drop-zone${dragging ? ' ns-drop-zone--active' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleFileDrop}
            >
              {(cfg.attachments ?? []).length === 0
                ? <span className="ns-drop-hint">Drag &amp; drop files here to attach to every welcome email</span>
                : (cfg.attachments ?? []).map((att, i) => (
                    <div key={i} className="ns-attachment">
                      <span className="ns-attachment-name">📎 {att.name}</span>
                      <button className="pm-icon-btn danger" onClick={() => removeAttachment(i)}>✕</button>
                    </div>
                  ))
              }
              {(cfg.attachments ?? []).length > 0 && (
                <div className="ns-drop-hint ns-drop-hint--small">Drop more files to add</div>
              )}
            </div>
          </div>
        </div>

        <div className="ns-modal-foot">
          <button className="pm-btn pm-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="pm-btn pm-btn--primary" onClick={handleSave}>Save template</button>
        </div>
      </div>
    </div>
  )
}

// ─── Starter row ───────────────────────────────────────────────────────────────

function StarterRow({ person, status, crewType, onStatusChange, onSendEmail, sendingId }) {
  const [lNotes, setLNotes] = useState(status?.notes ?? '')

  function toggle(field) {
    onStatusChange(person.id, crewType, field, !(status?.[field] ?? false))
  }

  function commitNotes() {
    if (lNotes !== (status?.notes ?? '')) {
      onStatusChange(person.id, crewType, 'notes', lNotes)
    }
  }

  const isSending = sendingId === person.id

  return (
    <tr className="ns-row">
      <td className="ns-cell ns-cell--name">
        {person.name || <span className="ns-unnamed">Unnamed</span>}
      </td>
      <td className="ns-cell">{person.role || '—'}</td>
      <td className="ns-cell">{person.department || '—'}</td>
      <td className="ns-cell ns-cell--date">{fmtDate(person.startDate)}</td>
      <td className="ns-cell ns-cell--date">{fmtDate(person.endDate)}</td>
      {crewType === 'additional' && (
        <td className="ns-cell ns-cell--check">
          {person.returning && <span className="ns-check-yes" title="Previously worked on this production">✓</span>}
        </td>
      )}
      {/* Send welcome email */}
      <td className="ns-cell ns-cell--action">
        <button
          className={`pm-btn pm-btn--sm ${status?.emailSent ? 'pm-btn--ghost' : 'pm-btn--primary'}`}
          onClick={() => onSendEmail(person)}
          disabled={isSending || !person.email}
          title={!person.email ? 'No email address on file' : undefined}
        >
          {isSending ? 'Sending…' : status?.emailSent ? 'Resend' : 'Send'}
        </button>
      </td>
      {/* Sent */}
      <td className="ns-cell ns-cell--check">
        <span className={`ns-status-dot${status?.emailSent ? ' ns-status-dot--on' : ''}`} title="Email sent" />
      </td>
      {/* Delivered */}
      <td className="ns-cell ns-cell--check">
        <span className={`ns-status-dot${status?.emailDelivered ? ' ns-status-dot--on ns-status-dot--delivered' : ''}`} title="Email delivered" />
      </td>
      {/* Scenechronize */}
      <td className="ns-cell ns-cell--check">
        <input
          type="checkbox"
          className="ns-checkbox"
          checked={status?.addedToScenechronize ?? false}
          onChange={() => toggle('addedToScenechronize')}
        />
      </td>
      {/* Contract */}
      <td className="ns-cell ns-cell--check">
        <input
          type="checkbox"
          className="ns-checkbox"
          checked={status?.sentContract ?? false}
          onChange={() => toggle('sentContract')}
        />
      </td>
      {/* Notes */}
      <td className="ns-cell ns-cell--notes">
        <input
          className="ns-notes-input"
          value={lNotes}
          placeholder="Notes…"
          onChange={e => setLNotes(e.target.value)}
          onBlur={commitNotes}
        />
      </td>
    </tr>
  )
}

// ─── Table section ─────────────────────────────────────────────────────────────

function StarterTable({ title, rows, crewType, hasReturning, statuses, onStatusChange, onSendEmail, sendingId }) {
  if (!rows.length) return null
  return (
    <div className="ns-section">
      <div className="ns-section-head">{title}</div>
      <div className="ns-table-wrap">
        <table className="ns-table">
          <thead>
            <tr>
              <th className="ns-th ns-th--name">Name</th>
              <th className="ns-th">Role</th>
              <th className="ns-th">Department</th>
              <th className="ns-th ns-th--date">Start</th>
              <th className="ns-th ns-th--date">End</th>
              {crewType === 'additional' && <th className="ns-th ns-th--check" title="Returning crew member">Returning</th>}
              <th className="ns-th ns-th--action">Welcome email</th>
              <th className="ns-th ns-th--check" title="Email sent">Sent</th>
              <th className="ns-th ns-th--check" title="Email delivered">Delivered</th>
              <th className="ns-th ns-th--check" title="Added to Scenechronize">Scenechr.</th>
              <th className="ns-th ns-th--check" title="Contract sent">Contract</th>
              <th className="ns-th ns-th--notes">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(person => (
              <StarterRow
                key={person.id}
                person={person}
                status={statuses.find(s => s.crewId === person.id)}
                crewType={crewType}
                onStatusChange={onStatusChange}
                onSendEmail={onSendEmail}
                sendingId={sendingId}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function NewStarters() {
  const { members }                            = useFulltimeCrewStore()
  const { resources, bookings }                = useCrewStore()
  const { statuses, updateStatus }             = useNewStartersStore()

  const [weekStart, setWeekStart] = useState(() => {
    const saved = localStorage.getItem('fm_new_starters_week')
    if (saved) {
      const d = new Date(saved)
      if (!isNaN(d)) return startOfWeek(d)
    }
    return startOfWeek(new Date())
  })

  function navigateWeek(delta) {
    setWeekStart(w => {
      const next = addDays(w, delta)
      localStorage.setItem('fm_new_starters_week', toISO(next))
      return next
    })
  }
  const [showEmailCfg,  setShowEmailCfg]  = useState(false)
  const [emailCfg,      setEmailCfg]      = useState(loadEmailConfig)
  const [sendingId,     setSendingId]     = useState(null)
  const [sendMsg,       setSendMsg]       = useState(null) // { type: 'ok'|'err', text }

  const weekEndISO   = toISO(addDays(weekStart, 6))
  const weekStartISO = toISO(weekStart)

  // ── Fulltime crew starting this week ─────────────────────────────────────────

  const fulltimeStarters = members
    .filter(m => m.startDate && m.startDate >= weekStartISO && m.startDate <= weekEndISO)
    .map(m => ({ ...m, email: m.email, startDate: m.startDate, endDate: m.endDate }))
    .sort((a, b) => {
      const deptCmp = (a.department || '').localeCompare(b.department || '')
      if (deptCmp !== 0) return deptCmp
      return (a.startDate || '').localeCompare(b.startDate || '')
    })

  // ── Additional crew (Gantt) starting this week ───────────────────────────────

  const crewResources = resources.filter(r => r.type === 'crew')

  const additionalStarters = crewResources
    .filter(r => r.hireStartDate && r.hireStartDate >= weekStartISO && r.hireStartDate <= weekEndISO)
    .map(r => {
      // "Returning" = another resource row with the same personId whose hireEndDate
      // is before this resource's hireStartDate, AND it has actual bookings
      const isReturning = r.personId
        ? crewResources.some(other =>
            other.id !== r.id &&
            other.personId === r.personId &&
            other.hireEndDate &&
            other.hireEndDate < r.hireStartDate &&
            bookings.some(b => b.resourceId === other.id)
          )
        : false

      return {
        id:         r.id,
        name:       r.name,
        role:       r.role,
        department: r.department,
        email:      r.contactEmail,
        phone:      r.contactPhone,
        startDate:  r.hireStartDate,
        endDate:    r.hireEndDate,
        returning:  isReturning,
      }
    })
    .sort((a, b) => {
      const deptCmp = (a.department || '').localeCompare(b.department || '')
      if (deptCmp !== 0) return deptCmp
      return (a.startDate || '').localeCompare(b.startDate || '')
    })

  const totalStarters = fulltimeStarters.length + additionalStarters.length

  // ── Send welcome email ────────────────────────────────────────────────────────

  async function handleSendEmail(person) {
    const cfg = loadEmailConfig()
    if (!cfg.fromEmail) {
      setSendMsg({ type: 'err', text: 'No "from" email configured. Click "Edit Welcome Email" to add one.' })
      setTimeout(() => setSendMsg(null), 5000)
      return
    }
    if (!person.email) return

    setSendingId(person.id)

    const body    = applyPlaceholders(cfg.body    ?? '', person)
    const subject = applyPlaceholders(cfg.subject ?? 'Welcome to the team!', person)
    const from    = cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail

    const payload = {
      from,
      to:      [person.email],
      subject,
      text:    body,
      attachments: (cfg.attachments ?? []).map(att => ({
        filename: att.name,
        content:  att.data,
      })),
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
        body:    JSON.stringify(payload),
      })
      if (res.ok) {
        await updateStatus(person.id, person._crewType ?? 'additional', 'emailSent', true)
        setSendMsg({ type: 'ok', text: `Welcome email sent to ${person.name || person.email}` })
      } else {
        const err = await res.json().catch(() => ({}))
        setSendMsg({ type: 'err', text: `Failed to send: ${err.message ?? res.statusText}` })
      }
    } catch (err) {
      setSendMsg({ type: 'err', text: `Network error: ${err.message}` })
    }

    setSendingId(null)
    setTimeout(() => setSendMsg(null), 5000)
  }

  function handleStatusChange(crewId, crewType, field, value) {
    updateStatus(crewId, crewType, field, value)
  }

  // Tag each person with their crew type for the send handler
  const taggedFulltime    = fulltimeStarters.map(p => ({ ...p, _crewType: 'fulltime' }))
  const taggedAdditional  = additionalStarters.map(p => ({ ...p, _crewType: 'additional' }))

  return (
    <div className="ns-wrap">

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="ns-top">
        <div className="ns-top-left">
          <h1 className="pm-h1" style={{ margin: 0 }}>New Starters</h1>
          <div className="pm-h1-sub" style={{ marginTop: 2 }}>
            {totalStarters > 0
              ? `${totalStarters} starter${totalStarters !== 1 ? 's' : ''} this week`
              : 'No starters this week'}
          </div>
        </div>
        <div className="ns-top-right">
          {sendMsg && (
            <div className={`ns-send-msg ns-send-msg--${sendMsg.type}`}>{sendMsg.text}</div>
          )}
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={() => setShowEmailCfg(true)}>
            ✉ Edit Welcome Email
          </button>
        </div>
      </div>

      {/* ── Week navigator ───────────────────────────────────────────────────── */}
      <div className="ns-week-nav">
        <button className="ns-week-btn" onClick={() => navigateWeek(-7)}>‹</button>
        <span className="ns-week-label">{fmtWeekRange(weekStart)}</span>
        <button className="ns-week-btn" onClick={() => navigateWeek(7)}>›</button>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      {totalStarters === 0 ? (
        <div className="empty-state" style={{ marginTop: 48 }}>
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-text">No starters this week</div>
          <div className="empty-state-sub">
            Set start dates on fulltime crew members or add hire start dates in the Crew &amp; Equipment Gantt.
          </div>
        </div>
      ) : (
        <div className="ns-content">
          <StarterTable
            title="Fulltime Crew"
            rows={taggedFulltime}
            crewType="fulltime"
            statuses={statuses}
            onStatusChange={handleStatusChange}
            onSendEmail={handleSendEmail}
            sendingId={sendingId}
          />
          <StarterTable
            title="Additional Crew"
            rows={taggedAdditional}
            crewType="additional"
            statuses={statuses}
            onStatusChange={handleStatusChange}
            onSendEmail={handleSendEmail}
            sendingId={sendingId}
          />
        </div>
      )}

      {/* ── Email config modal ───────────────────────────────────────────────── */}
      {showEmailCfg && (
        <EmailConfigModal
          onClose={() => setShowEmailCfg(false)}
          onSaved={cfg => setEmailCfg(cfg)}
        />
      )}
    </div>
  )
}
