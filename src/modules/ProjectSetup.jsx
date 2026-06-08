import { useState, useEffect, useRef } from 'react'
import { useHodsStore } from '../store/useHodsStore'
import CastListImportModal from './CastListImportModal'

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

function CastMemberRow({ member, onUpdate, onDelete, onDragStart, onDragOver, onDrop, isDragOver }) {
  const [lNum,   setLNum]   = useState(member.castNumber ?? '')
  const [lName,  setLName]  = useState(member.name)
  const [lRole,  setLRole]  = useState(member.role)
  const [lNotes, setLNotes] = useState(member.notes ?? '')

  useEffect(() => setLNum(member.castNumber ?? ''),  [member.castNumber])
  useEffect(() => setLName(member.name),             [member.name])
  useEffect(() => setLRole(member.role),             [member.role])
  useEffect(() => setLNotes(member.notes ?? ''),     [member.notes])

  return (
    <div
      className={`cast-member-row${isDragOver ? ' drag-over' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={e => { e.preventDefault(); onDragOver() }}
      onDrop={onDrop}
    >
      <span className="cast-drag-handle" title="Drag to reorder">⠿</span>
      <input
        className="pm-input"
        type="number"
        min="1"
        value={lNum}
        placeholder="#"
        title="Cast ID number — list is sorted by this"
        onChange={e => setLNum(e.target.value)}
        onBlur={() => {
          const n = parseInt(lNum, 10)
          const val = isNaN(n) ? null : n
          if (val !== member.castNumber) onUpdate(member.id, 'castNumber', val)
        }}
        style={{ width: 52, flexShrink: 0 }}
      />
      <input
        className="pm-input"
        value={lName}
        placeholder="Name"
        onChange={e => setLName(e.target.value)}
        onBlur={() => { if (lName !== member.name) onUpdate(member.id, 'name', lName) }}
        style={{ flex: 2 }}
      />
      <input
        className="pm-input"
        value={lRole}
        placeholder="Role / Character"
        onChange={e => setLRole(e.target.value)}
        onBlur={() => { if (lRole !== member.role) onUpdate(member.id, 'role', lRole) }}
        style={{ flex: 2 }}
      />
      <input
        className="pm-input"
        value={lNotes}
        placeholder="Notes"
        onChange={e => setLNotes(e.target.value)}
        onBlur={() => { if (lNotes !== (member.notes ?? '')) onUpdate(member.id, 'notes', lNotes) }}
        style={{ flex: 2 }}
      />
      <button className="pm-icon-btn danger" onClick={() => onDelete(member.id)} title="Remove cast member">✕</button>
    </div>
  )
}

// ─── RateInput — controlled input for a single FX rate ───────────────────────

function RateInput({ code, label, storedValue, onSave }) {
  const [local, setLocal] = useState(storedValue != null ? String(storedValue) : '')

  useEffect(() => {
    setLocal(storedValue != null ? String(storedValue) : '')
  }, [storedValue])

  return (
    <div className="pm-field-group">
      <label className="pm-field-label">{label}</label>
      <input
        className="pm-input"
        type="number"
        min="0"
        step="0.0001"
        value={local}
        placeholder="—"
        onChange={e => setLocal(e.target.value)}
        onBlur={() => {
          const num = parseFloat(local)
          if (!isNaN(num) && num > 0) onSave(code, num)
        }}
      />
    </div>
  )
}

// ─── HodRow — local state to avoid focus loss ────────────────────────────────

function HodRow({ hod, onUpdate, onDelete }) {
  const [lName,  setLName]  = useState(hod.name)
  const [lTitle, setLTitle] = useState(hod.title)
  const [lPhone, setLPhone] = useState(hod.phone)
  const [lEmail, setLEmail] = useState(hod.email)

  useEffect(() => setLName(hod.name),   [hod.name])
  useEffect(() => setLTitle(hod.title), [hod.title])
  useEffect(() => setLPhone(hod.phone), [hod.phone])
  useEffect(() => setLEmail(hod.email), [hod.email])

  return (
    <div className="cast-member-row">
      <input className="pm-input" value={lName} placeholder="Name"
        onChange={e => setLName(e.target.value)}
        onBlur={() => { if (lName !== hod.name) onUpdate(hod.id, 'name', lName) }}
        style={{ flex: 2 }} />
      <input className="pm-input" value={lTitle} placeholder="Title / Role"
        onChange={e => setLTitle(e.target.value)}
        onBlur={() => { if (lTitle !== hod.title) onUpdate(hod.id, 'title', lTitle) }}
        style={{ flex: 2 }} />
      <input className="pm-input" value={lPhone} placeholder="Phone"
        onChange={e => setLPhone(e.target.value)}
        onBlur={() => { if (lPhone !== hod.phone) onUpdate(hod.id, 'phone', lPhone) }}
        style={{ flex: 1.5 }} />
      <input className="pm-input" value={lEmail} placeholder="Email" type="email"
        onChange={e => setLEmail(e.target.value)}
        onBlur={() => { if (lEmail !== hod.email) onUpdate(hod.id, 'email', lEmail) }}
        style={{ flex: 2 }} />
      <button className="pm-icon-btn danger" onClick={() => onDelete(hod.id)} title="Remove">✕</button>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProjectSetup({
  production,
  onUpdate,
  onGenerate,
  onDeleteAllShootDays,
  shootDays = [],
  castMembers = [],
  onAddCastMember,
  onDeleteCastMember,
  onUpdateCastMember,
  onReorderCastMembers,
  onImportCastMembers,
  onApplyCastListImport,
}) {
  const [genStatus,    setGenStatus]    = useState(null)  // null | 'loading' | { count }
  const [genError,     setGenError]     = useState(null)
  const [fxLoading,    setFxLoading]    = useState(false)
  const [fxError,      setFxError]      = useState(null)
  const [fxUpdated,    setFxUpdated]    = useState(null)  // time of last successful fetch
  const [castImportMsg, setCastImportMsg] = useState(null)
  const [castDragIdx,   setCastDragIdx]   = useState(null)
  const [castDragOver,  setCastDragOver]  = useState(null)
  const [castPdfOpen,   setCastPdfOpen]   = useState(false)
  const castImportRef = useRef(null)

  const { hods, addHod, deleteHod, updateHod } = useHodsStore()

  const shootStart = production.shootStartDate
  const shootEnd   = production.shootEndDate
  const wdCount    = weekdaysBetween(shootStart, shootEnd)

  // Count actual shooting days (non-non-shoot days) within the shoot date range
  const actualShootDays = shootDays.filter(d =>
    !d.isNonShootDay &&
    d.date && shootStart && shootEnd &&
    d.date >= shootStart && d.date <= shootEnd
  ).length

  // Show "already generated" if there are shoot days in the schedule range
  const alreadyGenerated = actualShootDays > 0

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
      const res = await fetch(`https://open.er-api.com/v6/latest/${baseCurrencyCode}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.result !== 'success') throw new Error(json['error-type'] ?? 'API error')
      // Strip the base currency from the rates object before saving
      const { [baseCurrencyCode]: _base, ...rates } = json.rates
      onUpdate('exchangeRates', rates)
      setFxUpdated(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
    } catch (err) {
      setFxError(err.message)
    } finally {
      setFxLoading(false)
    }
  }

  function handleRateSave(code, num) {
    onUpdate('exchangeRates', { ...(production.exchangeRates ?? {}), [code]: num })
  }

  // ── Cast CSV helpers ──────────────────────────────────────────────────────

  function parseCastCSV(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
    return lines.map(line => {
      const fields = []
      let cur = '', inQ = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') { inQ = !inQ }
        else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = '' }
        else cur += ch
      }
      fields.push(cur.trim())
      return fields
    })
  }

  function downloadCastTemplate() {
    const headers = ['Cast Number', 'Name', 'Role / Character']
    const example = ['1', 'Jane Smith', 'Detective Sara']
    const csv = [headers, example].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'cast_template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportCastFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const text  = await file.text()
    const rows  = parseCastCSV(text)
    if (rows.length < 2) return
    const [header, ...dataRows] = rows
    const h = header.map(s => s.toLowerCase())
    const numIdx  = h.findIndex(x => x.includes('cast') || x.includes('number') || x === '#')
    const nameIdx = h.indexOf('name')
    const roleIdx = h.findIndex(x => x.includes('role') || x.includes('character'))
    const mapped  = dataRows.map(r => ({
      castNumber: numIdx  >= 0 ? (parseInt(r[numIdx],  10) || null) : null,
      name:       nameIdx >= 0 ? (r[nameIdx] ?? '') : '',
      role:       roleIdx >= 0 ? (r[roleIdx] ?? '') : '',
    })).filter(r => r.name)
    if (!mapped.length) return
    const count = await onImportCastMembers(mapped)
    setCastImportMsg(count)
    setTimeout(() => setCastImportMsg(null), 4000)
  }

  // ── Cast drag-and-drop ────────────────────────────────────────────────────

  function handleCastDrop(toIdx) {
    if (castDragIdx === null || castDragIdx === toIdx) { setCastDragIdx(null); setCastDragOver(null); return }
    onReorderCastMembers(castDragIdx, toIdx)
    setCastDragIdx(null)
    setCastDragOver(null)
  }

  // Sort cast by castNumber (nulls last)
  const sortedCast = [...castMembers].sort((a, b) => {
    if (a.castNumber == null && b.castNumber == null) return 0
    if (a.castNumber == null) return 1
    if (b.castNumber == null) return -1
    return a.castNumber - b.castNumber
  })

  return (
    <div className="pm-module">
      <div className="pm-module-head">
        <h1 className="pm-h1">Project Setup</h1>
      </div>

      {/* ── Production name ──────────────────────────────────────────────────── */}
      <div className="setup-card">
        <div className="setup-card-label">Production Name</div>
        <input
          className="pm-input setup-name-input"
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
              <div className="pm-field-group">
                <label className="pm-field-label">Start</label>
                <input
                  className="pm-input"
                  type="date"
                  value={start}
                  onChange={e => onUpdate(phase.startField, e.target.value)}
                />
              </div>
              <div className="setup-date-arrow">→</div>
              <div className="pm-field-group">
                <label className="pm-field-label">End</label>
                <input
                  className="pm-input"
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
                  className="pm-btn pm-btn--primary pm-btn--sm"
                  disabled={!shootStart || !shootEnd || wdCount === 0 || genStatus === 'loading' || alreadyGenerated}
                  onClick={handleGenerate}
                  title={alreadyGenerated ? 'Change the shoot dates to re-generate' : undefined}
                >
                  {genStatus === 'loading'
                    ? 'Generating…'
                    : alreadyGenerated
                      ? `✓ ${actualShootDays} day${actualShootDays !== 1 ? 's' : ''} in Schedule`
                      : wdCount > 0
                        ? `Generate ${wdCount} shooting day${wdCount !== 1 ? 's' : ''} in Schedule`
                        : 'Generate shooting days'}
                </button>

                {shootDays.length > 0 && (
                  <button
                    className="pm-btn pm-btn--ghost pm-btn--sm setup-delete-all-btn"
                    onClick={() => {
                      if (window.confirm(`Delete all ${shootDays.length} day${shootDays.length !== 1 ? 's' : ''} from the schedule? This cannot be undone.`)) {
                        onDeleteAllShootDays?.()
                      }
                    }}
                  >
                    🗑 Clear all days
                  </button>
                )}

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

      {/* ── Currency & Exchange Rates ─────────────────────────────────────────── */}
      <div className="setup-card">
        <div className="setup-phase-header">
          <span className="setup-phase-icon">💱</span>
          <span className="setup-phase-label" style={{ color: '#374151' }}>Currency &amp; Exchange Rates</span>
        </div>

        <div className="setup-date-row" style={{ marginBottom: 16 }}>
          <div className="pm-field-group">
            <label className="pm-field-label">Base currency</label>
            <select
              className="pm-input"
              value={production.currency ?? '£'}
              onChange={e => onUpdate('currency', e.target.value)}
              style={{ width: 200 }}
            >
              {[
                { symbol: '£',   label: '£  GBP — British Pound' },
                { symbol: '$',   label: '$  USD — US Dollar' },
                { symbol: '€',   label: '€  EUR — Euro' },
                { symbol: 'kr',  label: 'kr  SEK / NOK / DKK' },
                { symbol: '¥',   label: '¥  JPY — Japanese Yen' },
                { symbol: 'A$',  label: 'A$  AUD — Australian Dollar' },
                { symbol: 'C$',  label: 'C$  CAD — Canadian Dollar' },
                { symbol: 'CHF', label: 'CHF  Swiss Franc' },
                { symbol: 'zł',  label: 'zł  PLN — Polish Złoty' },
                { symbol: 'Kč',  label: 'Kč  CZK — Czech Koruna' },
              ].map(c => (
                <option key={c.symbol} value={c.symbol}>{c.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            <button
              className="pm-btn pm-btn--ghost pm-btn--sm"
              onClick={handleFetchRates}
              disabled={fxLoading}
            >
              {fxLoading ? 'Fetching…' : '↻ Fetch live rates'}
            </button>
            {fxError && <span className="setup-gen-error">Error: {fxError}</span>}
            {!fxError && fxUpdated && (
              <span style={{ fontSize: 11, color: '#16a34a' }}>✓ Rates updated at {fxUpdated}</span>
            )}
            {!fxError && !fxUpdated && !fxLoading && Object.keys(production.exchangeRates ?? {}).length > 0 && (
              <span style={{ fontSize: 11, color: '#16a34a' }}>✓ Rates loaded</span>
            )}
          </div>
        </div>

        <div className="fx-rate-grid">
          {SUPPORTED_CURRENCIES
            .filter(c => c.code !== baseCurrencyCode)
            .map(c => (
              <RateInput
                key={c.code}
                code={c.code}
                label={c.label}
                storedValue={production.exchangeRates?.[c.code] ?? null}
                onSave={handleRateSave}
              />
            ))}
        </div>

        <p className="setup-card-hint">
          All costs are entered in your base currency. Fetch live rates or enter manually to view the budget in another currency.
        </p>
      </div>

      {/* ── Day Length ───────────────────────────────────────────────────────── */}
      <div className="setup-card">
        <div className="setup-phase-header">
          <span className="setup-phase-icon">⏱</span>
          <span className="setup-phase-label" style={{ color: '#374151' }}>Day Length</span>
        </div>

        <div className="setup-date-row" style={{ flexWrap: 'wrap', gap: '12px 24px' }}>
          <div className="pm-field-group">
            <label className="pm-field-label">Work hours / day</label>
            <input
              className="pm-input"
              type="number"
              min="1"
              max="24"
              step="0.5"
              value={production.workHours}
              onChange={e => onUpdate('workHours', parseFloat(e.target.value) || 10)}
              style={{ width: 80 }}
            />
          </div>

          <div className="pm-field-group">
            <label className="pm-field-label">Default day type</label>
            <select
              className="pm-input"
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
            <div key={key} className="pm-field-group">
              <label className="pm-field-label">{label}</label>
              <input
                className="pm-input"
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
            No cast members yet. Add them below or import from CSV, then assign to scenes in the Schedule.
          </p>
        )}

        {sortedCast.map((member, i) => (
          <CastMemberRow
            key={member.id}
            member={member}
            onUpdate={onUpdateCastMember}
            onDelete={onDeleteCastMember}
            onDragStart={() => setCastDragIdx(i)}
            onDragOver={() => setCastDragOver(i)}
            onDrop={() => handleCastDrop(i)}
            isDragOver={castDragOver === i && castDragIdx !== i}
          />
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={onAddCastMember}>
            + Add Cast Member
          </button>
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={downloadCastTemplate} title="Download CSV template">
            ↓ Template
          </button>
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={() => castImportRef.current?.click()} title="Import from CSV">
            ↑ Import CSV
          </button>
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={() => setCastPdfOpen(true)} title="Import cast list from PDF">
            ↑ Import PDF
          </button>
          <input ref={castImportRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleImportCastFile} />
          {castImportMsg != null && (
            <span style={{ fontSize: 12, color: '#16a34a' }}>✓ Imported {castImportMsg} cast member{castImportMsg !== 1 ? 's' : ''}</span>
          )}
        </div>

        {castPdfOpen && (
          <CastListImportModal
            existingCast={castMembers}
            onClose={() => setCastPdfOpen(false)}
            onApply={onApplyCastListImport}
          />
        )}
      </div>

      {/* ── Format ───────────────────────────────────────────────────────────── */}
      <div className="setup-card">
        <div className="setup-phase-header">
          <span className="setup-phase-icon">🎞</span>
          <span className="setup-phase-label" style={{ color: '#374151' }}>Format</span>
        </div>
        <div className="setup-date-row" style={{ gap: '12px 24px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="pm-field-group">
            <label className="pm-field-label">Production type</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {['film', 'tv'].map(fmt => (
                <button
                  key={fmt}
                  className={`pm-btn pm-btn--sm${(production.format ?? 'film') === fmt ? ' pm-btn--primary' : ' pm-btn--ghost'}`}
                  onClick={() => onUpdate('format', fmt)}
                >
                  {fmt === 'film' ? '🎬 Film' : '📺 TV Series'}
                </button>
              ))}
            </div>
          </div>
          {(production.format ?? 'film') === 'tv' && (
            <div className="pm-field-group">
              <label className="pm-field-label">Number of episodes</label>
              <input
                className="pm-input"
                type="number"
                min="1"
                max="999"
                value={production.episodeCount ?? ''}
                placeholder="—"
                onChange={e => {
                  const n = parseInt(e.target.value, 10)
                  onUpdate('episodeCount', isNaN(n) ? null : n)
                }}
                style={{ width: 80 }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── HODs ─────────────────────────────────────────────────────────────── */}
      <div className="setup-card">
        <div className="setup-phase-header">
          <span className="setup-phase-icon">🎬</span>
          <span className="setup-phase-label" style={{ color: '#374151' }}>
            Heads of Department
            {hods.length > 0 && (
              <span className="setup-phase-badge" style={{ background: '#2563eb', marginLeft: 8 }}>
                {hods.length}
              </span>
            )}
          </span>
        </div>

        {hods.length === 0 && (
          <p className="setup-card-hint" style={{ marginBottom: 10 }}>
            Key contacts for the production. Separate from the full crew roster in Crew &amp; Equipment.
          </p>
        )}

        {hods.map(h => (
          <HodRow
            key={h.id}
            hod={h}
            onUpdate={updateHod}
            onDelete={deleteHod}
          />
        ))}

        <button
          className="pm-btn pm-btn--ghost pm-btn--sm"
          style={{ marginTop: 10 }}
          onClick={addHod}
        >
          + Add HOD
        </button>
      </div>
    </div>
  )
}
