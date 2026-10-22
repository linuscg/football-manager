import { useState, useEffect } from 'react'
import { useCrewStore } from '../store/useCrewStore'

// ─── Editable equipment row ───────────────────────────────────────────────────
// Shows an equipment resource (from the Gantt) with editable detail fields.
function EquipmentRow({ resource, onUpdate }) {
  const [lName,      setLName]      = useState(resource.name)
  const [lCategory,  setLCategory]  = useState(resource.category)
  const [lVendor,    setLVendor]    = useState(resource.vendor)
  const [lPo,        setLPo]        = useState(resource.poNumber)
  const [lRate,      setLRate]      = useState(resource.costAmount)
  const [lStartDate, setLStartDate] = useState(resource.hireStartDate)
  const [lEndDate,   setLEndDate]   = useState(resource.hireEndDate)
  const [lNotes,     setLNotes]     = useState(resource.notes)

  useEffect(() => setLName(resource.name),              [resource.name])
  useEffect(() => setLCategory(resource.category),      [resource.category])
  useEffect(() => setLVendor(resource.vendor),          [resource.vendor])
  useEffect(() => setLPo(resource.poNumber),            [resource.poNumber])
  useEffect(() => setLRate(resource.costAmount),        [resource.costAmount])
  useEffect(() => setLStartDate(resource.hireStartDate),[resource.hireStartDate])
  useEffect(() => setLEndDate(resource.hireEndDate),    [resource.hireEndDate])
  useEffect(() => setLNotes(resource.notes),            [resource.notes])

  function commit(field, local, original) {
    if (String(local).trim() !== String(original ?? '')) onUpdate(resource.id, field, String(local).trim())
  }

  return (
    <tr className="crew-db-row">
      <td className="crew-db-cell crew-db-cell--name">
        <input
          className="crew-db-input"
          value={lName}
          placeholder="Item"
          onChange={e => setLName(e.target.value)}
          onBlur={() => commit('name', lName, resource.name)}
        />
      </td>
      <td className="crew-db-cell">
        <input
          className="crew-db-input"
          value={lCategory}
          placeholder="Category"
          onChange={e => setLCategory(e.target.value)}
          onBlur={() => commit('category', lCategory, resource.category)}
        />
      </td>
      <td className="crew-db-cell">
        <select
          className="crew-db-input"
          value={resource.equipClass ?? 'ros'}
          onChange={e => onUpdate(resource.id, 'equipClass', e.target.value)}
        >
          <option value="ros">Run of Show</option>
          <option value="additional">Additional</option>
        </select>
      </td>
      <td className="crew-db-cell">
        <input
          className="crew-db-input"
          value={lVendor}
          placeholder="Vendor"
          onChange={e => setLVendor(e.target.value)}
          onBlur={() => commit('vendor', lVendor, resource.vendor)}
        />
      </td>
      <td className="crew-db-cell">
        <input
          className="crew-db-input"
          value={lPo}
          placeholder="PO #"
          onChange={e => setLPo(e.target.value)}
          onBlur={() => commit('poNumber', lPo, resource.poNumber)}
        />
      </td>
      <td className="crew-db-cell crew-db-cell--date">
        <input
          className="crew-db-input"
          type="date"
          value={lStartDate || ''}
          onChange={e => setLStartDate(e.target.value)}
          onBlur={() => commit('hireStartDate', lStartDate, resource.hireStartDate)}
        />
      </td>
      <td className="crew-db-cell crew-db-cell--date">
        <input
          className="crew-db-input"
          type="date"
          value={lEndDate || ''}
          onChange={e => setLEndDate(e.target.value)}
          onBlur={() => commit('hireEndDate', lEndDate, resource.hireEndDate)}
        />
      </td>
      <td className="crew-db-cell crew-db-cell--rate">
        <input
          className="crew-db-input"
          value={lRate ?? ''}
          placeholder="Day rate"
          onChange={e => setLRate(e.target.value)}
          onBlur={() => commit('costAmount', lRate ?? '', resource.costAmount ?? '')}
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

export default function EquipmentDatabase() {
  const { resources, loading, addResource, updateResource } = useCrewStore()
  const [search, setSearch] = useState('')

  // Only equipment-type resources, sorted by name
  const equipment = resources
    .filter(r => r.type === 'equipment')
    .sort((a, b) => a.name.localeCompare(b.name))

  const filtered = search.trim()
    ? equipment.filter(r =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.category.toLowerCase().includes(search.toLowerCase()) ||
        (r.vendor ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (r.poNumber ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : equipment

  return (
    <div className="pm-module">
      <div className="pm-module-head">
        <div>
          <div className="pm-eyebrow">Section V</div>
          <h1 className="pm-h1">Equipment Database</h1>
          <div className="pm-h1-sub">
            Production inventory · {equipment.length} {equipment.length === 1 ? 'item' : 'items'}
          </div>
        </div>
        <div className="pm-module-head-actions">
          <input
            className="crew-db-search"
            type="search"
            placeholder="Search by item, category, vendor…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="pm-btn pm-btn--primary" onClick={() => addResource('equipment')}>
            + Add item
          </button>
        </div>
      </div>

      {loading ? (
        <div className="crew-db-loading">Loading…</div>
      ) : equipment.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎥</div>
          <div className="empty-state-text">No equipment yet.</div>
          <div className="empty-state-sub">
            Add items here or in the Equipment gantt — they'll appear in both places.
          </div>
        </div>
      ) : (
        <>
          {search && filtered.length === 0 && (
            <div className="crew-db-no-results">No equipment matches &ldquo;{search}&rdquo;.</div>
          )}
          <div className="crew-db-table-wrap">
            <table className="crew-db-table">
              <thead>
                <tr>
                  <th className="crew-db-th crew-db-th--name">Item</th>
                  <th className="crew-db-th">Category</th>
                  <th className="crew-db-th">Class</th>
                  <th className="crew-db-th">Vendor</th>
                  <th className="crew-db-th">PO #</th>
                  <th className="crew-db-th crew-db-th--date">Start date</th>
                  <th className="crew-db-th crew-db-th--date">End date</th>
                  <th className="crew-db-th crew-db-th--rate">Day rate</th>
                  <th className="crew-db-th crew-db-cell--notes">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(resource => (
                  <EquipmentRow
                    key={resource.id}
                    resource={resource}
                    onUpdate={updateResource}
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
