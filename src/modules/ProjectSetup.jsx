import { useState } from 'react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysBetween(startStr, endStr) {
  if (!startStr || !endStr) return null
  const diff = Math.round(
    (new Date(endStr + 'T00:00:00') - new Date(startStr + 'T00:00:00')) / 86400000
  ) + 1
  return diff > 0 ? diff : null
}

function weekdaysBetween(startStr, endStr) {
  if (!startStr || !endStr) return 0
  let count = 0
  const cur = new Date(startStr + 'T00:00:00')
  const end = new Date(endStr   + 'T00:00:00')
  while (cur <= end) {
    const d = cur.getDay()
    if (d !== 0 && d !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

function formatDateRange(startStr, endStr) {
  if (!startStr && !endStr) return null
  const opts = { day: 'numeric', month: 'short', year: 'numeric' }
  const fmt  = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-GB', opts) : '?'
  return `${fmt(startStr)} → ${fmt(endStr)}`
}

// ─── Phase config ─────────────────────────────────────────────────────────────

const PHASES = [
  { id: 'prep',  label: 'Pre-Production', icon: '📋', color: '#7c3aed', startField: 'prepStartDate',  endField: 'prepEndDate'  },
  { id: 'shoot', label: 'Shoot',          icon: '🎬', color: '#2563eb', startField: 'shootStartDate', endField: 'shootEndDate' },
  { id: 'wrap',  label: 'Wrap',           icon: '📦', color: '#16a34a', startField: 'wrapStartDate',  endField: 'wrapEndDate'  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProjectSetup({ production, onUpdate, onGenerate, shootDays = [] }) {
  const [genStatus,    setGenStatus]    = useState(null)  // null | 'loading' | { count }
  const [genError,     setGenError]     = useState(null)
  const [lastGenRange, setLastGenRange] = useState(null)  // { start, end } after successful gen

  const shootStart = production.shootStartDate
  const shootEnd   = production.shootEndDate
  const wdCount    = weekdaysBetween(shootStart, shootEnd)

  // Count actual shooting days (non-non-shoot days) within the shoot date range
  const actualShootDays = shootDays.filter(d =>
    !d.isNonShootDay &&
    d.date && shootStart && shootEnd &&
    d.date >= shootStart && d.date <= shootEnd
  ).length

  // Grey out the button if dates haven't changed since last generation
  const alreadyGenerated = !!(
    lastGenRange &&
    lastGenRange.start === shootStart &&
    lastGenRange.end   === shootEnd
  )

  async function handleGenerate() {
    if (!shootStart || !shootEnd) return
    const msg = wdCount === 0
      ? 'No weekdays found in the shoot range.'
      : `Generate ${wdCount} weekday shooting day${wdCount !== 1 ? 's' : ''} (Mon–Fri) from ${shootStart} to ${shootEnd}?\n\nDays that already exist in the Schedule will be skipped.`
    if (!window.confirm(msg)) return

    setGenStatus('loading')
    setGenError(null)
    try {
      const result = await onGenerate(shootStart, shootEnd)
      setGenStatus(result)
      setLastGenRange({ start: shootStart, end: shootEnd })
    } catch (err) {
      setGenError(err.message)
      setGenStatus(null)
    }
  }

  return (
    <div className="module-wrap">
      <div className="module-header">
        <h1 className="module-title">Project Setup</h1>
      </div>

      {/* ── Production name ──────────────────────────────────────────────────── */}
      <div className="setup-card">
        <div className="setup-card-label">Production Name</div>
        <input
          className="field-input setup-name-input"
          value={production.name}
          placeholder="Untitled Production"
          onChange={e => onUpdate('name', e.target.value)}
        />
        <p className="setup-card-hint">Updates the sidebar and all exports.</p>
      </div>

      {/* ── Phase cards ──────────────────────────────────────────────────────── */}
      {PHASES.map(phase => {
        const start = production[phase.startField]
        const end   = production[phase.endField]
        const total = daysBetween(start, end)
        const range = formatDateRange(start, end)

        return (
          <div key={phase.id} className="setup-card">
            <div className="setup-phase-header">
              <span className="setup-phase-icon">{phase.icon}</span>
              <span className="setup-phase-label" style={{ color: phase.color }}>
                {phase.label}
              </span>
              {total !== null && (
                <span className="setup-phase-badge" style={{ background: phase.color }}>
                  {total} day{total !== 1 ? 's' : ''}
                </span>
              )}
              {phase.id === 'shoot' && actualShootDays > 0 && (
                <span className="setup-phase-badge setup-phase-badge-shoot">
                  {actualShootDays} shoot day{actualShootDays !== 1 ? 's' : ''} in schedule
                </span>
              )}
            </div>

            {range && <div className="setup-phase-summary">{range}</div>}

            <div className="setup-date-row">
              <div className="field-group">
                <label className="field-label">Start</label>
                <input
                  className="field-input"
                  type="date"
                  value={start}
                  onChange={e => onUpdate(phase.startField, e.target.value)}
                />
              </div>
              <div className="setup-date-arrow">→</div>
              <div className="field-group">
                <label className="field-label">End</label>
                <input
                  className="field-input"
                  type="date"
                  value={end}
                  min={start || undefined}
                  onChange={e => onUpdate(phase.endField, e.target.value)}
                />
              </div>
            </div>

            {/* Generate button — only on the Shoot phase card */}
            {phase.id === 'shoot' && (
              <div className="setup-generate-row">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!shootStart || !shootEnd || wdCount === 0 || genStatus === 'loading' || alreadyGenerated}
                  onClick={handleGenerate}
                  title={alreadyGenerated ? 'Change the shoot dates to re-generate' : undefined}
                >
                  {genStatus === 'loading'
                    ? 'Generating…'
                    : alreadyGenerated
                      ? `✓ Generated ${wdCount} day${wdCount !== 1 ? 's' : ''}`
                      : wdCount > 0
                        ? `Generate ${wdCount} shooting day${wdCount !== 1 ? 's' : ''} in Schedule`
                        : 'Generate shooting days'}
                </button>

                {genStatus && genStatus !== 'loading' && (
                  <span className="setup-gen-success">
                    {genStatus.count === 0
                      ? '✓ All weekdays already in schedule'
                      : `✓ Added ${genStatus.count} day${genStatus.count !== 1 ? 's' : ''} to Schedule`}
                  </span>
                )}
                {genError && (
                  <span className="setup-gen-error">Error: {genError}</span>
                )}

                <p className="setup-card-hint" style={{ marginTop: 0 }}>
                  Adds one shoot day per weekday (Mon–Fri). Existing dates are skipped.
                  Weekend days can still be added manually in Schedule.
                </p>
              </div>
            )}
          </div>
        )
      })}

      <p className="setup-info-note">
        Phase date ranges populate the columns in <strong>Crew &amp; Equipment</strong>.
        Each phase can be expanded or collapsed in that view.
      </p>
    </div>
  )
}
