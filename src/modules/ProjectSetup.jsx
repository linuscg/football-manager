import { useState, useEffect } from 'react'

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

// Supported currencies (excluding baseCurrency when rendering)
const SUPPORTED_CURRENCIES = [
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'JPY', label: 'JPY — Japanese Yen' },
  { code: 'SEK', label: 'SEK — Swedish Krona' },
  { code: 'AUD', label: 'AUD — Australian Dollar' },
  { code: 'CAD', label: 'CAD — Canadian Dollar' },
  { code: 'CHF', label: 'CHF — Swiss Franc' },
  { code: 'PLN', label: 'PLN — Polish Złoty' },
  { code: 'CZK', label: 'CZK — Czech Koruna' },
  { code: 'GBP', label: 'GBP — British Pound' },
]

// symbol → code map (matches Budget.jsx)
const SYMBOL_TO_CODE = {
  '£': 'GBP', '$': 'USD', '€': 'EUR', '¥': 'JPY',
  'kr': 'SEK', 'A$': 'AUD', 'C$': 'CAD', 'CHF': 'CHF',
  'zł': 'PLN', 'Kč': 'CZK',
}

// ─── CastMemberRow — local state to avoid focus loss ─────────────────────────

function CastMemberRow({ member, index, total, onUpdate, onDelete, onMoveUp, onMoveDown }) {
  const [lName, setLName] = useState(member.name)
  const [lRole, setLRole] = useState(member.role)

  useEffect(() => setLName(member.name), [member.name])
  useEffect(() => setLRole(member.role), [member.role])

  return (
    <div className="cast-member-row">
      <input
        className="field-input"
        value={lName}
        placeholder="Name"
        onChange={e => setLName(e.target.value)}
        onBlur={() => { if (lName !== member.name) onUpdate(member.id, 'name', lName) }}
        style={{ flex: 2 }}
      />
      <input
        className="field-input"
        value={lRole}
        placeholder="Role / Character"
        onChange={e => setLRole(e.target.value)}
        onBlur={() => { if (lRole !== member.role) onUpdate(member.id, 'role', lRole) }}
        style={{ flex: 2 }}
      />
      <button className="btn-icon" onClick={() => onMoveUp(index)} disabled={index === 0} title="Move up">↑</button>
      <button className="btn-icon" onClick={() => onMoveDown(index)} disabled={index === total - 1} title="Move down">↓</button>
      <button className="btn-icon danger" onClick={() => onDelete(member.id)} title="Remove cast member">✕</button>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProjectSetup({
  production,
  onUpdate,
  onGenerate,
  shootDays = [],
  castMembers = [],
  onAddCastMember,
  onDeleteCastMember,
  onUpdateCastMember,
  onReorderCastMembers,
}) {
  const [genStatus,    setGenStatus]    = useState(null)  // null | 'loading' | { count }
  const [genError,     setGenError]     = useState(null)
  const [lastGenRange, setLastGenRange] = useState(null)  // { start, end } after successful gen
  const [fxLoading,    setFxLoading]    = useState(false)
  const [fxError,      setFxError]      = useState(null)

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

  // Derive base currency code from symbol
  const baseCurrencyCode = SYMBOL_TO_CODE[production.currency ?? '£'] ?? 'GBP'

  async function handleFetchRates() {
    setFxLoading(true)
    setFxError(null)
    try {
      const res = await fetch(`https://api.frankfurter.app/latest?from=${baseCurrencyCode}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const rates = json.rates ?? {}
      onUpdate('exchangeRates', rates)
    } catch (err) {
      setFxError(err.message)
    } finally {
      setFxLoading(false)
    }
  }

  function handleRateBlur(code, value) {
    const num = parseFloat(value)
    if (!isNaN(num) && num > 0) {
      onUpdate('exchangeRates', { ...(production.exchangeRates ?? {}), [code]: num })
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

      {/* ── Currency ─────────────────────────────────────────────────────────── */}
      <div className="setup-card">
        <div className="setup-phase-header">
          <span className="setup-phase-icon">💱</span>
          <span className="setup-phase-label" style={{ color: '#374151' }}>Currency</span>
        </div>
        <div className="setup-date-row">
          <div className="field-group">
            <label className="field-label">Display currency</label>
            <select
              className="field-input"
              value={production.currency ?? '£'}
              onChange={e => onUpdate('currency', e.target.value)}
              style={{ width: 160 }}
            >
              {[
                { symbol: '£',  label: '£  GBP — British Pound' },
                { symbol: '$',  label: '$  USD — US Dollar' },
                { symbol: '€',  label: '€  EUR — Euro' },
                { symbol: 'kr', label: 'kr  SEK / NOK / DKK' },
                { symbol: '¥',  label: '¥  JPY — Japanese Yen' },
                { symbol: 'A$', label: 'A$  AUD — Australian Dollar' },
                { symbol: 'C$', label: 'C$  CAD — Canadian Dollar' },
                { symbol: 'CHF', label: 'CHF  Swiss Franc' },
                { symbol: 'zł', label: 'zł  PLN — Polish Złoty' },
                { symbol: 'Kč', label: 'Kč  CZK — Czech Koruna' },
              ].map(c => (
                <option key={c.symbol} value={c.symbol}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="setup-card-hint">
          Symbol used throughout Cost Tracking. Rates are entered in this currency.
        </p>
      </div>

      {/* ── Exchange Rates ────────────────────────────────────────────────────── */}
      <div className="setup-card">
        <div className="setup-phase-header">
          <span className="setup-phase-icon">📊</span>
          <span className="setup-phase-label" style={{ color: '#374151' }}>Exchange Rates</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleFetchRates}
            disabled={fxLoading}
          >
            {fxLoading ? 'Fetching…' : 'Fetch live rates'}
          </button>
          {fxError && <span className="setup-gen-error">Error: {fxError}</span>}
          {!fxError && !fxLoading && Object.keys(production.exchangeRates ?? {}).length > 0 && (
            <span style={{ fontSize: 11, color: '#9ca3af' }}>
              Rates loaded — edit below if needed
            </span>
          )}
        </div>

        <div className="fx-rate-grid">
          {SUPPORTED_CURRENCIES
            .filter(c => c.code !== baseCurrencyCode)
            .map(c => {
              const val = production.exchangeRates?.[c.code] ?? ''
              return (
                <div key={c.code} className="field-group">
                  <label className="field-label">{c.label}</label>
                  <input
                    className="field-input"
                    type="number"
                    min="0"
                    step="0.0001"
                    defaultValue={val || ''}
                    key={`${c.code}-${val}`}
                    placeholder="—"
                    onBlur={e => handleRateBlur(c.code, e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              )
            })}
        </div>

        <p className="setup-card-hint">
          Costs are entered in your base currency. Use these rates to view the budget in another currency.
        </p>
      </div>

      {/* ── Day Length ───────────────────────────────────────────────────────── */}
      <div className="setup-card">
        <div className="setup-phase-header">
          <span className="setup-phase-icon">⏱</span>
          <span className="setup-phase-label" style={{ color: '#374151' }}>Day Length</span>
        </div>

        <div className="setup-date-row" style={{ flexWrap: 'wrap', gap: '12px 24px' }}>
          <div className="field-group">
            <label className="field-label">Work hours / day</label>
            <input
              className="field-input"
              type="number"
              min="1"
              max="24"
              step="0.5"
              value={production.workHours}
              onChange={e => onUpdate('workHours', parseFloat(e.target.value) || 10)}
              style={{ width: 80 }}
            />
          </div>

          <div className="field-group">
            <label className="field-label">Default day type</label>
            <select
              className="field-input"
              value={production.defaultDayType}
              onChange={e => onUpdate('defaultDayType', e.target.value)}
              style={{ width: 120 }}
            >
              <option value="SWD">SWD</option>
              <option value="CWD">CWD</option>
              <option value="SCWD">SCWD</option>
            </select>
          </div>
        </div>

        <div className="setup-card-label" style={{ marginTop: 16, marginBottom: 8 }}>Lunch breaks (minutes)</div>
        <div className="setup-date-row" style={{ flexWrap: 'wrap', gap: '12px 24px' }}>
          {[
            { key: 'swdLunch',  label: 'SWD — Standard' },
            { key: 'cwdLunch',  label: 'CWD — Continuous' },
            { key: 'scwdLunch', label: 'SCWD — Semi-Continuous' },
          ].map(({ key, label }) => (
            <div key={key} className="field-group">
              <label className="field-label">{label}</label>
              <input
                className="field-input"
                type="number"
                min="0"
                max="120"
                step="5"
                value={production[key]}
                onChange={e => onUpdate(key, parseInt(e.target.value, 10) || 0)}
                style={{ width: 80 }}
              />
            </div>
          ))}
        </div>
        <p className="setup-card-hint">
          Wrap time = General Call + work hours + lunch. Set per day in Schedule,
          or leave blank to use the default day type above.
        </p>
      </div>

      {/* ── Cast ─────────────────────────────────────────────────────────────── */}
      <div className="setup-card">
        <div className="setup-phase-header">
          <span className="setup-phase-icon">🎭</span>
          <span className="setup-phase-label" style={{ color: '#374151' }}>Cast</span>
        </div>

        {castMembers.length === 0 && (
          <p className="setup-card-hint" style={{ marginBottom: 10 }}>
            No cast members yet. Add them below, then assign them to scenes in the Schedule.
          </p>
        )}

        {castMembers.map((member, i) => (
          <CastMemberRow
            key={member.id}
            member={member}
            index={i}
            total={castMembers.length}
            onUpdate={onUpdateCastMember}
            onDelete={onDeleteCastMember}
            onMoveUp={idx => onReorderCastMembers(idx, idx - 1)}
            onMoveDown={idx => onReorderCastMembers(idx, idx + 1)}
          />
        ))}

        <button
          className="btn btn-secondary btn-sm"
          style={{ marginTop: 10 }}
          onClick={onAddCastMember}
        >
          + Add Cast Member
        </button>
      </div>
    </div>
  )
}
