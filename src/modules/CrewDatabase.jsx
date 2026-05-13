import { useState, useEffect } from 'react'
import { useCrewPeopleStore } from '../store/useCrewPeopleStore'

// ─── Editable person row ───────────────────────────────────────────────────────

function PersonRow({ person, onUpdate, onDelete }) {
  const [lName,  setLName]  = useState(person.name)
  const [lEmail, setLEmail] = useState(person.email)
  const [lPhone, setLPhone] = useState(person.phone)
  const [lNotes, setLNotes] = useState(person.notes)

  useEffect(() => setLName(person.name),   [person.name])
  useEffect(() => setLEmail(person.email), [person.email])
  useEffect(() => setLPhone(person.phone), [person.phone])
  useEffect(() => setLNotes(person.notes), [person.notes])

  function commit(field, local, original) {
    if (local !== original) onUpdate(person.id, field, local)
  }

  return (
    <tr className="crew-db-row">
      <td className="crew-db-cell crew-db-cell--name">
        <input
          className="crew-db-input"
          value={lName}
          placeholder="Full name"
          onChange={e => setLName(e.target.value)}
          onBlur={() => commit('name', lName, person.name)}
        />
      </td>
      <td className="crew-db-cell">
        <input
          className="crew-db-input"
          type="email"
          value={lEmail}
          placeholder="email@example.com"
          onChange={e => setLEmail(e.target.value)}
          onBlur={() => commit('email', lEmail, person.email)}
        />
      </td>
      <td className="crew-db-cell">
        <input
          className="crew-db-input"
          type="tel"
          value={lPhone}
          placeholder="+44 7700 900000"
          onChange={e => setLPhone(e.target.value)}
          onBlur={() => commit('phone', lPhone, person.phone)}
        />
      </td>
      <td className="crew-db-cell crew-db-cell--notes">
        <input
          className="crew-db-input"
          value={lNotes}
          placeholder="Notes…"
          onChange={e => setLNotes(e.target.value)}
          onBlur={() => commit('notes', lNotes, person.notes)}
        />
      </td>
      <td className="crew-db-cell crew-db-cell--action">
        <button
          className="pm-icon-btn danger"
          title="Remove from database"
          onClick={() => {
            if (window.confirm(`Remove "${person.name}" from the crew database?\n\nThis will unlink them from any productions but won't delete their bookings.`))
              onDelete(person.id)
          }}
        >✕</button>
      </td>
    </tr>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function CrewDatabase() {
  const { people, loading, findOrCreatePerson, updatePerson, deletePerson } = useCrewPeopleStore()
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? people.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.email.toLowerCase().includes(search.toLowerCase()) ||
        p.phone.toLowerCase().includes(search.toLowerCase())
      )
    : people

  async function handleAdd() {
    await findOrCreatePerson({ name: 'New Person' })
  }

  return (
    <div className="pm-module">
      <div className="pm-module-head">
        <div>
          <div className="pm-eyebrow">Section V</div>
          <h1 className="pm-h1">Crew Database</h1>
          <div className="pm-h1-sub">
            Cross-production roster · {people.length} {people.length === 1 ? 'person' : 'people'}
          </div>
        </div>
        <div className="pm-module-head-actions">
          <input
            className="crew-db-search"
            type="search"
            placeholder="Search by name, email or phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="pm-btn pm-btn--primary" onClick={handleAdd}>
            + Add person
          </button>
        </div>
      </div>

      {loading ? (
        <div className="crew-db-loading">Loading…</div>
      ) : people.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👤</div>
          <div className="empty-state-text">No people yet.</div>
          <div className="empty-state-sub">
            People are added automatically when you type names in the Crew &amp; Equipment gantt,
            or you can add them manually here.
          </div>
        </div>
      ) : (
        <>
          {search && filtered.length === 0 && (
            <div className="crew-db-no-results">No people match &ldquo;{search}&rdquo;.</div>
          )}
          <div className="crew-db-table-wrap">
            <table className="crew-db-table">
              <thead>
                <tr>
                  <th className="crew-db-th crew-db-th--name">Name</th>
                  <th className="crew-db-th">Email</th>
                  <th className="crew-db-th">Phone</th>
                  <th className="crew-db-th">Notes</th>
                  <th className="crew-db-th crew-db-th--action" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(person => (
                  <PersonRow
                    key={person.id}
                    person={person}
                    onUpdate={updatePerson}
                    onDelete={deletePerson}
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
