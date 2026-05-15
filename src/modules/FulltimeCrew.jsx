import { useState, useEffect, useRef, Fragment } from 'react'
import { useFulltimeCrewStore } from '../store/useFulltimeCrewStore'
import { useHodsStore }         from '../store/useHodsStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))].sort()
}

function parseCSV(text) {
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

function deptPriority(dept) {
  const d = (dept || '').toLowerCase().trim()
  if (d === 'director' || d === 'directors') return 0
  if (d === 'producer' || d === 'producers') return 1
  if (d === 'production') return 2
  return 3
}

// ─── Level options + colours ──────────────────────────────────────────────────

const LEVEL_OPTIONS = [
  { value: 1,  label: '1 — HOD' },
  { value: 2,  label: '2 — 2IC' },
  { value: 3,  label: '3' },
  { value: 4,  label: '4' },
  { value: 5,  label: '5' },
  { value: 6,  label: '6' },
  { value: 7,  label: '7' },
  { value: 8,  label: '8' },
  { value: 9,  label: '9' },
  { value: 10, label: '10' },
]

const LEVEL_COLORS = {
  1:  { color: '#5b21b6', bg: '#ede9fe', border: '#c4b5fd' }, // deep purple  — HOD
  2:  { color: '#3730a3', bg: '#e0e7ff', border: '#a5b4fc' }, // indigo       — 2IC
  3:  { color: '#1d4ed8', bg: '#dbeafe', border: '#93c5fd' }, // blue
  4:  { color: '#0369a1', bg: '#e0f2fe', border: '#7dd3fc' }, // sky
  5:  { color: '#047857', bg: '#d1fae5', border: '#6ee7b7' }, // emerald
  6:  { color: '#4d7c0f', bg: '#ecfccb', border: '#bef264' }, // lime
  7:  { color: '#b45309', bg: '#fef3c7', border: '#fcd34d' }, // amber
  8:  { color: '#c2410c', bg: '#ffedd5', border: '#fdba74' }, // orange
  9:  { color: '#b91c1c', bg: '#fee2e2', border: '#fca5a5' }, // red
  10: { color: '#374151', bg: '#f3f4f6', border: '#d1d5db' }, // grey
}

function levelStyle(level) {
  const c = LEVEL_COLORS[level] ?? LEVEL_COLORS[5]
  return { color: c.color, background: c.bg, borderColor: c.border }
}

// ─── HodRow ───────────────────────────────────────────────────────────────────

function HodRow({ hod, onUpdate, deptSuggestions }) {
  const [lName,      setLName]      = useState(hod.name)
  const [lTitle,     setLTitle]     = useState(hod.title)
  const [lDept,      setLDept]      = useState(hod.department)
  const [lPhone,     setLPhone]     = useState(hod.phone)
  const [lEmail,     setLEmail]     = useState(hod.email)
  const [lStartDate, setLStartDate] = useState(hod.startDate)
  const [lEndDate,   setLEndDate]   = useState(hod.endDate)

  useEffect(() => setLName(hod.name),           [hod.name])
  useEffect(() => setLTitle(hod.title),         [hod.title])
  useEffect(() => setLDept(hod.department),     [hod.department])
  useEffect(() => setLPhone(hod.phone),         [hod.phone])
  useEffect(() => setLEmail(hod.email),         [hod.email])
  useEffect(() => setLStartDate(hod.startDate), [hod.startDate])
  useEffect(() => setLEndDate(hod.endDate),     [hod.endDate])

  function commit(field, val, orig) {
    if (val !== orig) onUpdate(hod.id, field, val)
  }

  return (
    <tr className="ftc-row ftc-row--hod">
      <td className="ftc-cell ftc-cell-drag">
        <select
          className="ftc-level-select"
          value={hod.level ?? 1}
          style={levelStyle(hod.level ?? 1)}
          onChange={e => onUpdate(hod.id, 'level', parseInt(e.target.value))}
        >
          {LEVEL_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </td>
      <td className="ftc-cell ftc-cell-name">
        <input
          className="ftc-input"
          value={lName}
          placeholder="Full name"
          onChange={e => setLName(e.target.value)}
          onBlur={() => commit('name', lName, hod.name)}
        />
      </td>
      <td className="ftc-cell">
        <input
          className="ftc-input"
          value={lTitle}
          placeholder="Job title"
          onChange={e => setLTitle(e.target.value)}
          onBlur={() => commit('title', lTitle, hod.title)}
        />
      </td>
      <td className="ftc-cell">
        <input
          className="ftc-input"
          value={lDept}
          placeholder="Department"
          list={`ftc-hod-dept-${hod.id}`}
          onChange={e => setLDept(e.target.value)}
          onBlur={() => commit('department', lDept, hod.department)}
        />
        <datalist id={`ftc-hod-dept-${hod.id}`}>
          {deptSuggestions.map(s => <option key={s} value={s} />)}
        </datalist>
      </td>
      <td className="ftc-cell ftc-cell--date">
        <input
          className="ftc-input"
          type="date"
          value={lStartDate}
          onChange={e => { setLStartDate(e.target.value); onUpdate(hod.id, 'startDate', e.target.value) }}
        />
      </td>
      <td className="ftc-cell ftc-cell--date">
        <input
          className="ftc-input"
          type="date"
          value={lEndDate}
          onChange={e => { setLEndDate(e.target.value); onUpdate(hod.id, 'endDate', e.target.value) }}
        />
      </td>
      <td className="ftc-cell">
        <input
          className="ftc-input"
          value={lPhone}
          placeholder="+44 7700 900000"
          type="tel"
          onChange={e => setLPhone(e.target.value)}
          onBlur={() => commit('phone', lPhone, hod.phone)}
        />
      </td>
      <td className="ftc-cell">
        <input
          className="ftc-input"
          value={lEmail}
          placeholder="email@example.com"
          type="email"
          onChange={e => setLEmail(e.target.value)}
          onBlur={() => commit('email', lEmail, hod.email)}
        />
      </td>
      <td className="ftc-cell ftc-cell-del" />
    </tr>
  )
}

// ─── MemberRow ────────────────────────────────────────────────────────────────

function MemberRow({
  member,
  onUpdate, onDelete,
  deptSuggestions, roleSuggestions,
}) {
  const [lName,      setLName]      = useState(member.name)
  const [lRole,      setLRole]      = useState(member.role)
  const [lDept,      setLDept]      = useState(member.department)
  const [lPhone,     setLPhone]     = useState(member.phone)
  const [lEmail,     setLEmail]     = useState(member.email)
  const [lStartDate, setLStartDate] = useState(member.startDate)
  const [lEndDate,   setLEndDate]   = useState(member.endDate)

  useEffect(() => setLName(member.name),            [member.name])
  useEffect(() => setLRole(member.role),            [member.role])
  useEffect(() => setLDept(member.department),      [member.department])
  useEffect(() => setLPhone(member.phone),          [member.phone])
  useEffect(() => setLEmail(member.email),          [member.email])
  useEffect(() => setLStartDate(member.startDate),  [member.startDate])
  useEffect(() => setLEndDate(member.endDate),      [member.endDate])

  function commit(field, val, orig) {
    if (val !== orig) onUpdate(member.id, field, val)
  }

  return (
    <tr className="ftc-row">
      <td className="ftc-cell ftc-cell-drag">
        <select
          className="ftc-level-select"
          value={member.level ?? 5}
          style={levelStyle(member.level ?? 5)}
          onChange={e => onUpdate(member.id, 'level', parseInt(e.target.value))}
        >
          {LEVEL_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </td>

      <td className="ftc-cell ftc-cell-name">
        <input
          className="ftc-input"
          value={lName}
          placeholder="Full name"
          onChange={e => setLName(e.target.value)}
          onBlur={() => commit('name', lName, member.name)}
        />
      </td>

      <td className="ftc-cell">
        <input
          className="ftc-input"
          value={lRole}
          placeholder="Role / title"
          list={`ftc-role-${member.id}`}
          onChange={e => setLRole(e.target.value)}
          onBlur={() => commit('role', lRole, member.role)}
        />
        <datalist id={`ftc-role-${member.id}`}>
          {roleSuggestions.map(s => <option key={s} value={s} />)}
        </datalist>
      </td>

      <td className="ftc-cell">
        <input
          className="ftc-input"
          value={lDept}
          placeholder="Department"
          list={`ftc-dept-${member.id}`}
          onChange={e => setLDept(e.target.value)}
          onBlur={() => commit('department', lDept, member.department)}
        />
        <datalist id={`ftc-dept-${member.id}`}>
          {deptSuggestions.map(s => <option key={s} value={s} />)}
        </datalist>
      </td>

      <td className="ftc-cell ftc-cell--date">
        <input
          className="ftc-input"
          type="date"
          value={lStartDate}
          onChange={e => { setLStartDate(e.target.value); onUpdate(member.id, 'startDate', e.target.value) }}
        />
      </td>

      <td className="ftc-cell ftc-cell--date">
        <input
          className="ftc-input"
          type="date"
          value={lEndDate}
          onChange={e => { setLEndDate(e.target.value); onUpdate(member.id, 'endDate', e.target.value) }}
        />
      </td>

      <td className="ftc-cell">
        <input
          className="ftc-input"
          value={lPhone}
          placeholder="+44 7700 900000"
          type="tel"
          onChange={e => setLPhone(e.target.value)}
          onBlur={() => commit('phone', lPhone, member.phone)}
        />
      </td>

      <td className="ftc-cell">
        <input
          className="ftc-input"
          value={lEmail}
          placeholder="email@example.com"
          type="email"
          onChange={e => setLEmail(e.target.value)}
          onBlur={() => commit('email', lEmail, member.email)}
        />
      </td>

      <td className="ftc-cell ftc-cell-del">
        <button
          className="pm-icon-btn danger"
          title="Remove"
          onClick={() => {
            if (window.confirm(`Remove "${member.name || 'this person'}" from the fulltime crew list?`))
              onDelete(member.id)
          }}
        >✕</button>
      </td>
    </tr>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

const CSV_HEADERS = ['Name', 'Role', 'Department', 'Phone', 'Email']

export default function FulltimeCrew({ productionName }) {
  const {
    members, loading, error,
    addMember, deleteMember, updateMember,
    importMembers,
  } = useFulltimeCrewStore()

  const { hods, updateHod } = useHodsStore()

  // ── Autocomplete suggestions ───────────────────────────────────────────────

  const deptSuggestions = uniq(members.map(m => m.department))
  const roleSuggestions = uniq(members.map(m => m.role))

  // ── Grouping — merge HODs with regular members, sorted by dept priority then level then name ──

  const FALLBACK = 'Unassigned'
  const groupMap = {}

  for (const h of hods) {
    const key = h.department.trim() || FALLBACK
    if (!groupMap[key]) groupMap[key] = { hods: [], members: [] }
    groupMap[key].hods.push(h)
  }
  for (const m of members) {
    const key = m.department.trim() || FALLBACK
    if (!groupMap[key]) groupMap[key] = { hods: [], members: [] }
    groupMap[key].members.push(m)
  }

  // Sort HODs and members within each group by level then name
  for (const key of Object.keys(groupMap)) {
    groupMap[key].hods.sort((a, b) => {
      const la = a.level ?? 1, lb = b.level ?? 1
      if (la !== lb) return la - lb
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
    })
    groupMap[key].members.sort((a, b) => {
      const la = a.level ?? 5, lb = b.level ?? 5
      if (la !== lb) return la - lb
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
    })
  }

  // Sort departments by priority, then alpha within same priority; Unassigned last
  const groups = Object.entries(groupMap).sort(([a], [b]) => {
    if (a === FALLBACK) return 1
    if (b === FALLBACK) return -1
    const pa = deptPriority(a), pb = deptPriority(b)
    if (pa !== pb) return pa - pb
    return a.toLowerCase().localeCompare(b.toLowerCase())
  })

  // ── Export Unit List ───────────────────────────────────────────────────────

  function handleExportUnitList() {
    const prodName = productionName || 'Untitled Production'
    const now = new Date()
    const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

    const deptBlocks = groups.map(([deptName, { hods: deptHods, members: deptMembers }]) => {
      const rows = [
        ...deptHods.map(h => `
          <tr>
            <td>${h.name || ''}</td>
            <td>${h.title || ''}</td>
            <td>${h.phone || ''}</td>
            <td>${h.email || ''}</td>
          </tr>`),
        ...deptMembers.map(m => `
          <tr>
            <td>${m.name || ''}</td>
            <td>${m.role || ''}</td>
            <td>${m.phone || ''}</td>
            <td>${m.email || ''}</td>
          </tr>`),
      ].join('')

      return `
        <div class="dept">
          <div class="dept-name">${deptName}</div>
          <table><tbody>${rows}</tbody></table>
        </div>`
    }).join('')

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Unit List — ${prodName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #111; padding: 40px; font-size: 13px; }
    .header { margin-bottom: 32px; border-bottom: 2px solid #111; padding-bottom: 16px; }
    .header h1 { font-size: 22px; font-weight: 700; }
    .header p { font-size: 12px; color: #666; margin-top: 4px; }
    .dept { margin-bottom: 24px; }
    .dept-name { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 5px 8px; vertical-align: top; }
    td:first-child { width: 220px; font-weight: 600; }
    td:nth-child(2) { width: 200px; color: #444; }
    td:nth-child(3) { width: 140px; color: #666; font-size: 12px; }
    td:nth-child(4) { color: #666; font-size: 12px; }
    tr:nth-child(even) td { background: #f9f9f9; }
    @media print {
      body { padding: 20px; }
      @page { margin: 15mm; size: A4; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${prodName}</h1>
    <p>Unit List — ${dateStr}</p>
  </div>
  ${deptBlocks}
</body>
</html>`

    const win = window.open('', '_blank')
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print() }, 500)
  }

  // ── CSV template ───────────────────────────────────────────────────────────

  const importRef = useRef(null)
  const [importMsg, setImportMsg] = useState(null)

  function downloadTemplate() {
    const example = ['Jane Smith', 'Director of Photography', 'Camera', '+44 7700 900000', 'jane@example.com']
    const csv = [CSV_HEADERS, example].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'fulltime_crew_template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const text = await file.text()
    const rows = parseCSV(text)
    if (rows.length < 2) return
    const [header, ...dataRows] = rows
    const h = header.map(s => s.toLowerCase())
    const mapped = dataRows.map(r => ({
      name:       r[h.indexOf('name')]       ?? '',
      role:       r[h.indexOf('role')]       ?? '',
      department: r[h.indexOf('department')] ?? '',
      phone:      r[h.indexOf('phone')]      ?? '',
      email:      r[h.indexOf('email')]      ?? '',
    })).filter(r => r.name)
    if (!mapped.length) return
    const count = await importMembers(mapped)
    setImportMsg(count)
    setTimeout(() => setImportMsg(null), 4000)
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  const deptCount  = Object.keys(groupMap).filter(k => k !== FALLBACK).length
  const totalCount = members.length + hods.length

  if (loading) return <div className="ftc-state">Loading…</div>
  if (error)   return <div className="ftc-state ftc-state--error">Error: {error}</div>

  return (
    <div className="ftc-wrap">

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="ftc-top">
        <div className="ftc-summary">
          {totalCount > 0
            ? <><strong>{totalCount}</strong> crew member{totalCount !== 1 ? 's' : ''} across <strong>{deptCount}</strong> department{deptCount !== 1 ? 's' : ''}</>
            : 'No crew added yet'
          }
        </div>
        <div className="ftc-toolbar">
          {importMsg != null && (
            <span className="ftc-import-msg">✓ Imported {importMsg} member{importMsg !== 1 ? 's' : ''}</span>
          )}
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={downloadTemplate}>↓ Template</button>
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={() => importRef.current?.click()}>↑ Import CSV</button>
          <input ref={importRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleImportFile} />
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={handleExportUnitList}>↓ Export Unit List</button>
          <button className="pm-btn pm-btn--primary pm-btn--sm" onClick={addMember}>+ Add Crew Member</button>
        </div>
      </div>

      {/* ── Table / empty state ───────────────────────────────────────────────── */}
      {members.length === 0 ? (
        <div className="ftc-empty">
          <div className="ftc-empty-icon">👥</div>
          <div className="ftc-empty-title">No fulltime crew yet</div>
          <div className="ftc-empty-sub">Add crew members one by one, or import a CSV to get started quickly.</div>
          <div className="ftc-empty-actions">
            <button className="pm-btn pm-btn--primary pm-btn--sm" onClick={addMember}>+ Add Crew Member</button>
            <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={downloadTemplate}>↓ Download CSV Template</button>
          </div>
        </div>
      ) : (
        <div className="ftc-table-wrap">
          <table className="ftc-table">
            <thead>
              <tr>
                <th className="ftc-th ftc-th-drag" />
                <th className="ftc-th">Name</th>
                <th className="ftc-th">Role</th>
                <th className="ftc-th">Department</th>
                <th className="ftc-th ftc-th--date">Start Date</th>
                <th className="ftc-th ftc-th--date">End Date</th>
                <th className="ftc-th">Phone</th>
                <th className="ftc-th">Email</th>
                <th className="ftc-th ftc-th-del" />
              </tr>
            </thead>
            <tbody>
              {groups.map(([deptName, { hods: deptHods, members: deptMembers }]) => (
                <Fragment key={deptName}>
                  <tr className="ftc-dept-row">
                    <td colSpan={9}>
                      <span className="ftc-dept-label">{deptName}</span>
                      <span className="ftc-dept-count">{deptHods.length + deptMembers.length}</span>
                    </td>
                  </tr>
                  {/* HODs first, sorted by level then name */}
                  {deptHods.map(hod => (
                    <HodRow
                      key={hod.id}
                      hod={hod}
                      onUpdate={updateHod}
                      deptSuggestions={deptSuggestions}
                    />
                  ))}
                  {/* Regular crew members below, sorted by level then name */}
                  {deptMembers.map(member => (
                    <MemberRow
                      key={member.id}
                      member={member}
                      onUpdate={updateMember}
                      onDelete={deleteMember}
                      deptSuggestions={deptSuggestions}
                      roleSuggestions={roleSuggestions}
                    />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div className="ftc-add-bottom">
            <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={addMember}>+ Add Crew Member</button>
          </div>
        </div>
      )}
    </div>
  )
}
