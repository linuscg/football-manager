import { useState, useEffect } from 'react'
import { useCrewStore }       from '../store/useCrewStore'
import { useCrewPeopleStore } from '../store/useCrewPeopleStore'

// ─── Editable crew row ─────────────────────────────────────────────────────────
// Shows a resource (from the Gantt) with editable contact fields.
// If the resource has a personId, edits also sync to the crew_people record.

function CrewRow({ resource, onUpdate, onUpdatePerson, people }) {
  const [lName,      setLName]      = useState(resource.name)
  const [lRole,      setLRole]      = useState(resource.role)
  const [lDept,      setLDept]      = useState(resource.department)
  const [lEmail,     setLEmail]     = useState(resource.contactEmail)
  const [lPhone,     setLPhone]     = useState(resource.contactPhone)
  const [lNotes,     setLNotes]     = useState(resource.notes)
  const [lRate,      setLRate]      = useState(resource.costAmount)
  const [lStartDate, setLStartDate] = useState(resource.hireStartDate)
  const [lEndDate,   setLEndDate]   = useState(resource.hireEndDate)

  useEffect(() => setLName(resource.name),             [resource.name])
  useEffect(() => setLRole(resource.role),             [resource.role])
  useEffect(() => setLDept(resource.department),       [resource.department])
  useEffect(() => setLEmail(resource.contactEmail),    [resource.contactEmail])
  useEffect(() => setLPhone(resource.contactPhone),    [resource.contactPhone])
  useEffect(() => setLNotes(resource.notes),           [resource.notes])
  useEffect(() => setLRate(resource.costAmount),       [resource.costAmount])
  useEffect(() => setLStartDate(resource.hireStartDate),[resource.hireStartDate])
  useEffect(() => setLEndDate(resource.hireEndDate),   [resource.hireEndDate])

  function commit(field, local, original) {
    if (local.trim() !== original) onUpdate(resource.id, field, local.trim())
  }

  function commitEmail() {
    if (lEmail !== resource.contactEmail) {
      onUpdate(resource.id, 'contactEmail', lEmail)
      if (resource.personId) onUpdatePerson(resource.personId, 'email', lEmail)
    }
  }

  function commitPhone() {
    if (lPhone !== resource.contactPhone) {
      onUpdate(resource.id, 'contactPhone', lPhone)
      if (resource.personId) onUpdatePerson(resource.personId, 'phone', lPhone)
    }
  }

  const linked = resource.personId
    ? people.find(p => p.id === resource.personId)
    : null

  return (
    <tr className="crew-db-row">
      <td className="crew-db-cell crew-db-cell--name">
        <input
          className="crew-db-input"
          value={lName}
          placeholder="Full name"
          onChange={e => setLName(e.target.value)}
          onBlur={() => commit('name', lName, resource.name)}
        />
        {linked && (
          <span className="gantt-person-linked" title="Linked to crew database" style={{ marginLeft: 4 }}>●</span>
        )}
      </td>
      <td className="crew-db-cell">
        <input
          className="crew-db-input"
          value={lRole}
          placeholder="Role / job title"
          onChange={e => setLRole(e.target.value)}
          onBlur={() => commit('role', lRole, resource.role)}
        />
      </td>
      <td className="crew-db-cell">
        <input
          className="crew-db-input"
          value={lDept}
          placeholder="Department"
          onChange={e => setLDept(e.target.value)}
          onBlur={() => commit('department', lDept, resource.department)}
        />
      </td>
      <td className="crew-db-cell crew-db-cell--date">
        <input
          className="crew-db-input"
          type="date"
          value={lStartDate}
          onChange={e => { setLStartDate(e.target.value); onUpdate(resource.id, 'hireStartDate', e.target.value) }}
        />
      </td>
      <td className="crew-db-cell crew-db-cell--date">
        <input
          className="crew-db-input"
          type="date"
          value={lEndDate}
          onChange={e => { setLEndDate(e.target.value); onUpdate(resource.id, 'hireEndDate', e.target.value) }}
        />
      </td>
      <td className="crew-db-cell crew-db-cell--rate">
        <input
          className="crew-db-input"
          type="number"
          min="0"
          step="0.01"
          value={lRate}
          placeholder="0.00"
          onChange={e => setLRate(e.target.value)}
          onBlur={() => { if (lRate !== resource.costAmount) onUpdate(resource.id, 'costAmount', lRate) }}
        />
      </td>
      <td className="crew-db-cell">
        <input
          className="crew-db-input"
          type="email"
          value={lEmail}
          placeholder="email@example.com"
          onChange={e => setLEmail(e.target.value)}
          onBlur={commitEmail}
        />
      </td>
      <td className="crew-db-cell">
        <input
          className="crew-db-input"
          type="tel"
          value={lPhone}
          placeholder="+44 7700 900000"
          onChange={e => setLPhone(e.target.value)}
          onBlur={commitPhone}
        />
      </td>
      <td className="crew-db-cell crew-db-cell--notes">
        <input
          className="crew-db-input"
          value={lNotes}
          placeholder="Notes…"
          onChange={e => setLNotes(e.target.value)}
          onBlur={() => commit('notes', lNotes, resource.notes)}
        />
      </td>
    </tr>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function CrewDatabase() {
  const { resources, loading, addResource, updateResource } = useCrewStore()
  const { people, updatePerson: updateCrewPerson }          = useCrewPeopleStore()
  const [search, setSearch] = useState('')

  // Only crew-type resources, sorted by name
  const crew = resources
    .filter(r => r.type === 'crew')
    .sort((a, b) => a.name.localeCompare(b.name))

  const filtered = search.trim()
    ? crew.filter(r =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.role.toLowerCase().includes(search.toLowerCase()) ||
        r.department.toLowerCase().includes(search.toLowerCase()) ||
        r.contactEmail.toLowerCase().includes(search.toLowerCase()) ||
        r.contactPhone.toLowerCase().includes(search.toLowerCase())
      )
    : crew

  return (
    <div className="pm-module">
      <div className="pm-module-head">
        <div>
          <div className="pm-eyebrow">Section V</div>
          <h1 className="pm-h1">Crew Database</h1>
          <div className="pm-h1-sub">
            Production roster · {crew.length} {crew.length === 1 ? 'person' : 'people'}
          </div>
        </div>
        <div className="pm-module-head-actions">
          <input
            className="crew-db-search"
            type="search"
            placeholder="Search by name, role, email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="pm-btn pm-btn--primary" onClick={() => addResource('crew')}>
            + Add person
          </button>
        </div>
      </div>

      {loading ? (
        <div className="crew-db-loading">Loading…</div>
      ) : crew.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👤</div>
          <div className="empty-state-text">No crew yet.</div>
          <div className="empty-state-sub">
            Add crew members here or in the Crew &amp; Equipment Gantt — they'll appear in both places.
          </div>
        </div>
      ) : (
        <>
          {search && filtered.length === 0 && (
            <div className="crew-db-no-results">No crew match &ldquo;{search}&rdquo;.</div>
          )}
          <div className="crew-db-table-wrap">
            <table className="crew-db-table">
              <thead>
                <tr>
                  <th className="crew-db-th crew-db-th--name">Name</th>
                  <th className="crew-db-th">Role</th>
                  <th className="crew-db-th">Department</th>
                  <th className="crew-db-th crew-db-th--date">Start date</th>
                  <th className="crew-db-th crew-db-th--date">End date</th>
                  <th className="crew-db-th crew-db-th--rate">Day rate</th>
                  <th className="crew-db-th">Email</th>
                  <th className="crew-db-th">Phone</th>
                  <th className="crew-db-th crew-db-cell--notes">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(resource => (
                  <CrewRow
                    key={resource.id}
                    resource={resource}
                    onUpdate={updateResource}
                    onUpdatePerson={updateCrewPerson}
                    people={people}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
