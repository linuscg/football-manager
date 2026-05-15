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

function sortAlpha(members) {
  return [...members].sort((a, b) => {
    const d = (a.department || '').toLowerCase().localeCompare((b.department || '').toLowerCase())
    if (d !== 0) return d
    return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
  })
}

// ─── HodRow ───────────────────────────────────────────────────────────────────

function HodRow({ hod, onUpdate, deptSuggestions }) {
  const [lName,  setLName]  = useState(hod.name)
  const [lTitle, setLTitle] = useState(hod.title)
  const [lDept,  setLDept]  = useState(hod.department)
  const [lPhone, setLPhone] = useState(hod.phone)
  const [lEmail, setLEmail] = useState(hod.email)

  useEffect(() => setLName(hod.name),           [hod.name])
  useEffect(() => setLTitle(hod.title),         [hod.title])
  useEffect(() => setLDept(hod.department),     [hod.department])
  useEffect(() => setLPhone(hod.phone),         [hod.phone])
  useEffect(() => setLEmail(hod.email),         [hod.email])

  function commit(field, val, orig) {
    if (val !== orig) onUpdate(hod.id, field, val)
  }

  return (
    <tr className="ftc-row ftc-row--hod">
      <td className="ftc-cell ftc-cell-drag">
        <span className="ftc-hod-badge" title="Head of Department">HOD</span>
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
          onChange={e => { setLDept(e.target.value); onUpdate(hod.id, 'department', e.target.value) }}
          onBlur={() => commit('department', lDept, hod.department)}
        />
        <datalist id={`ftc-hod-dept-${hod.id}`}>
          {deptSuggestions.map(s => <option key={s} value={s} />)}
        </datalist>
      </td>
      <td className="ftc-cell ftc-cell--date" />
      <td className="ftc-cell ftc-cell--date" />
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
  member, isDragOver, isDragging,
  onUpdate, onDelete,
  deptSuggestions, roleSuggestions,
  onDragStart, onDragOver, onDrop, onDragEnd,
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
    <tr
      className={[
        'ftc-row',
        isDragging ? 'is-dragging' : '',
        isDragOver ? 'drag-over'   : '',
      ].filter(Boolean).join(' ')}
      draggable
      onDragStart={() => onDragStart(member.id)}
      onDragOver={e => { e.preventDefault(); onDragOver(member.id) }}
      onDrop={() => onDrop(member.id)}
      onDragEnd={onDragEnd}
    >
      <td className="ftc-cell ftc-cell-drag">
        <span className="ftc-drag-handle" title="Drag to reorder">⠿</span>
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

export default function FulltimeCrew() {
  const {
    members, loading, error,
    addMember, deleteMember, updateMember,
    importMembers,
  } = useFulltimeCrewStore()

  const { hods, updateHod } = useHodsStore()

  // ── Local display order (alphabetical by default; drag can reorder for the session) ──

  const [displayIds, setDisplayIds] = useState([])

  useEffect(() => {
    // Re-sort alphabetically whenever the SET of member IDs changes
    // (new member added, member deleted). Preserves current order when only data changes.
    const incomingIds = new Set(members.map(m => m.id))
    const currentIds  = new Set(displayIds)
    const unchanged   = incomingIds.size === currentIds.size &&
                        [...incomingIds].every(id => currentIds.has(id))
    if (!unchanged) {
      setDisplayIds(sortAlpha(members).map(m => m.id))
    }
  }, [members]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ordered member objects for rendering
  const displayMembers = displayIds
    .map(id => members.find(m => m.id === id))
    .filter(Boolean)

  // ── Drag state ─────────────────────────────────────────────────────────────

  const dragId    = useRef(null)
  const [dragOverId, setDragOverId] = useState(null)

  function onDragStart(id) {
    dragId.current = id
  }

  function onDragOver(id) {
    if (id !== dragId.current) setDragOverId(id)
  }

  function onDrop(targetId) {
    if (!dragId.current || dragId.current === targetId) {
      dragId.current = null; setDragOverId(null); return
    }
    setDisplayIds(ids => {
      const from = ids.indexOf(dragId.current)
      const to   = ids.indexOf(targetId)
      if (from === -1 || to === -1) return ids
      const next = [...ids]
      next.splice(from, 1)
      next.splice(to, 0, dragId.current)
      return next
    })
    dragId.current = null
    setDragOverId(null)
  }

  function onDragEnd() {
    dragId.current = null
    setDragOverId(null)
  }

  // ── Autocomplete suggestions ───────────────────────────────────────────────

  const deptSuggestions = uniq(members.map(m => m.department))
  const roleSuggestions = uniq(members.map(m => m.role))

  // ── Grouping — merge HODs (at top of dept) with regular members ────────────

  const FALLBACK = 'Unassigned'
  const groupMap = {}

  // HODs first (so they land at the top of each department group)
  for (const h of hods) {
    const key = h.department.trim() || FALLBACK
    if (!groupMap[key]) groupMap[key] = { hods: [], members: [] }
    groupMap[key].hods.push(h)
  }
  for (const m of displayMembers) {
    const key = m.department.trim() || FALLBACK
    if (!groupMap[key]) groupMap[key] = { hods: [], members: [] }
    groupMap[key].members.push(m)
  }

  // Departments sorted alphabetically; Unassigned last
  const groups = Object.entries(groupMap).sort(([a], [b]) => {
    if (a === FALLBACK) return 1
    if (b === FALLBACK) return -1
    return a.localeCompare(b)
  })

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
                  {/* HODs first, at the top of the department */}
                  {deptHods.map(hod => (
                    <HodRow
                      key={hod.id}
                      hod={hod}
                      onUpdate={updateHod}
                      deptSuggestions={deptSuggestions}
                    />
                  ))}
                  {/* Regular crew members below */}
                  {deptMembers.map(member => (
                    <MemberRow
                      key={member.id}
                      member={member}
                      isDragging={dragId.current === member.id}
                      isDragOver={dragOverId === member.id}
                      onUpdate={updateMember}
                      onDelete={deleteMember}
                      deptSuggestions={deptSuggestions}
                      roleSuggestions={roleSuggestions}
                      onDragStart={onDragStart}
                      onDragOver={onDragOver}
                      onDrop={onDrop}
                      onDragEnd={onDragEnd}
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
