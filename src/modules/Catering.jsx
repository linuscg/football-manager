import { useState, useMemo, useCallback } from 'react'
import { useFulltimeCrewStore } from '../store/useFulltimeCrewStore'
import { useCrewStore }         from '../store/useCrewStore'
import { useBackpageStore }     from '../store/useBackpageStore'
import { useCateringStore }     from '../store/useCateringStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function dayLabel(d) {
  const dateStr = d.date
    ? new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', {
        weekday: 'short', day: '2-digit', month: 'short',
      })
    : 'No date'
  if (d.dayCategory === 'main') {
    return `D${d.dayNumber} — ${dateStr}${d.locations?.[0] ? ` · ${d.locations[0]}` : ''}`
  }
  const cat = d.dayCategory
    ? d.dayCategory.charAt(0).toUpperCase() + d.dayCategory.slice(1)
    : 'Day'
  return `${cat} — ${dateStr}`
}

const TYPE_LABEL = {
  fulltime:   'Fulltime',
  additional: 'Additional',
  cast:       'Cast',
  adhoc:      'Ad-hoc',
}

const TYPE_CLS = {
  fulltime:   'cat-badge--ft',
  additional: 'cat-badge--add',
  cast:       'cat-badge--cast',
  adhoc:      'cat-badge--adhoc',
}

// ─── PersonRow ────────────────────────────────────────────────────────────────

function PersonRow({ person, onToggle, onNoteChange, onDelete }) {
  const [localNote, setLocalNote] = useState(person.note)
  const collected   = person.collected
  const collectedAt = person.collectedAt

  return (
    <div className={`cat-row${collected ? ' cat-row--done' : ''}`}>

      {/* Checkbox */}
      <button
        className={`cat-check${collected ? ' cat-check--done' : ''}`}
        onClick={() => onToggle(person)}
        title={collected ? 'Mark as not collected' : 'Mark lunch collected'}
      >
        {collected ? '✓' : ''}
      </button>

      {/* Name + timestamp */}
      <div className="cat-name-block">
        <span className="cat-name">{person.name}</span>
        {collectedAt && (
          <span className="cat-collected-time">collected {fmtTime(collectedAt)}</span>
        )}
      </div>

      {/* Dept */}
      <span className="cat-dept">{person.dept || '—'}</span>

      {/* Role */}
      <span className="cat-role">{person.role || '—'}</span>

      {/* Type badge */}
      <span className={`cat-badge ${TYPE_CLS[person.type] ?? ''}`}>
        {TYPE_LABEL[person.type] ?? person.type}
      </span>

      {/* Note */}
      <input
        className="cat-note-input"
        value={localNote}
        placeholder="Add note…"
        data-person-id={person.key}
        onChange={e => setLocalNote(e.target.value)}
        onBlur={() => { if (localNote !== person.note) onNoteChange(person, localNote) }}
      />

      {/* Delete (ad-hoc only) */}
      {person.type === 'adhoc' && (
        <button className="cat-del-btn" onClick={() => onDelete(person)} title="Remove">✕</button>
      )}
      {person.type !== 'adhoc' && <div className="cat-del-spacer" />}

    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Catering({ store }) {
  const { production, shootDays, castMembers } = store

  const { members: ftcMembers }      = useFulltimeCrewStore()
  const { resources, bookings }      = useCrewStore()
  const { getMemberOverride }        = useBackpageStore()
  const {
    getRecord, getAdhoc,
    setCollected, setNote,
    addAdhoc, setAdhocCollected, setAdhocNote, deleteAdhoc,
  } = useCateringStore()

  // ── Day selection ───────────────────────────────────────────────────────────

  const allDays = useMemo(() =>
    shootDays
      .filter(d => ['main', 'splinter', 'prep', 'other'].includes(d.dayCategory))
      .sort((a, b) => a.date < b.date ? -1 : 1)
  , [shootDays])

  const [selectedDayId, setSelectedDayId] = useState(() => {
    const saved = localStorage.getItem('fm_cat_day')
    if (saved && allDays.find(d => d.id === saved)) return saved
    return allDays.find(d => d.dayCategory === 'main')?.id ?? allDays[0]?.id ?? null
  })

  const day = allDays.find(d => d.id === selectedDayId) ?? allDays[0] ?? null

  function selectDay(id) {
    setSelectedDayId(id)
    localStorage.setItem('fm_cat_day', id)
  }

  // ── Search + add adhoc UI ───────────────────────────────────────────────────

  const [search,       setSearch]       = useState('')
  const [showAddInput, setShowAddInput] = useState(false)
  const [addingName,   setAddingName]   = useState('')
  const [addingRole,   setAddingRole]   = useState('')
  const [addingDept,   setAddingDept]   = useState('')

  function resetAddForm() {
    setAddingName('')
    setAddingRole('')
    setAddingDept('')
    setShowAddInput(false)
  }

  // ── Build person list ───────────────────────────────────────────────────────

  const persons = useMemo(() => {
    if (!day) return []
    const list = []

    // 1. Fulltime crew
    for (const m of ftcMembers) {
      const rec      = getRecord(day.id, m.id)
      const entitled = getMemberOverride(day.id, m.id)?.lunch ?? true
      list.push({
        key:         `ft-${m.id}`,
        id:          m.id,
        name:        m.name,
        role:        m.role,
        dept:        m.department,
        type:        'fulltime',
        entitled,
        collected:   rec?.collected   ?? false,
        collectedAt: rec?.collectedAt ?? null,
        note:        rec?.note        ?? '',
        recId:       rec?.id          ?? null,
      })
    }

    // 2. Additional crew — those with an active booking on this day
    const activeOnDay = bookings.filter(b =>
      b.date === day.date &&
      (b.status === 'booked' || b.status === 'hold') &&
      (day.dayCategory === 'main' ? !b.dayId : b.dayId === day.id)
    )
    for (const booking of activeOnDay) {
      const resource = resources.find(r => r.id === booking.resourceId && r.type === 'crew')
      if (!resource) continue
      if (list.some(p => p.id === resource.id)) continue
      const rec      = getRecord(day.id, resource.id)
      const entitled = getMemberOverride(day.id, resource.id)?.lunch ?? true
      list.push({
        key:         `add-${resource.id}`,
        id:          resource.id,
        name:        resource.name,
        role:        resource.role,
        dept:        resource.department,
        type:        'additional',
        entitled,
        collected:   rec?.collected   ?? false,
        collectedAt: rec?.collectedAt ?? null,
        note:        rec?.note        ?? '',
        recId:       rec?.id          ?? null,
      })
    }

    // 3. Cast members with scenes on this day
    const sceneCastIds = new Set(
      (day.scenes ?? []).flatMap(s => s.castMemberIds ?? [])
    )
    const castOnDay = sceneCastIds.size > 0
      ? castMembers.filter(c => sceneCastIds.has(c.id))
      : []
    for (const c of castOnDay) {
      const rec = getRecord(day.id, c.id)
      list.push({
        key:         `cast-${c.id}`,
        id:          c.id,
        name:        c.name,
        role:        c.castNumber != null ? `Cast #${c.castNumber}` : 'Cast',
        dept:        'Cast',
        type:        'cast',
        entitled:    true,
        collected:   rec?.collected   ?? false,
        collectedAt: rec?.collectedAt ?? null,
        note:        rec?.note        ?? '',
        recId:       rec?.id          ?? null,
      })
    }

    // 4. Ad-hoc entries
    for (const rec of getAdhoc(day.id)) {
      list.push({
        key:         `adhoc-${rec.id}`,
        id:          rec.id,
        name:        rec.personName,
        role:        rec.personRole ?? '',
        dept:        rec.personDept ?? '',
        type:        'adhoc',
        entitled:    true,
        collected:   rec.collected   ?? false,
        collectedAt: rec.collectedAt ?? null,
        note:        rec.note        ?? '',
        recId:       rec.id,
      })
    }

    list.sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [day, ftcMembers, resources, bookings, castMembers, getRecord, getAdhoc, getMemberOverride])

  // ── Search filter ───────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!search.trim()) return persons
    const q = search.toLowerCase()
    return persons.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.role.toLowerCase().includes(q) ||
      p.dept.toLowerCase().includes(q)
    )
  }, [persons, search])

  // ── Stats ───────────────────────────────────────────────────────────────────

  const totalEntitled  = persons.filter(p => p.entitled).length
  const totalCollected = persons.filter(p => p.collected).length

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleToggle = useCallback((person) => {
    const newCollected = !person.collected
    if (person.type === 'adhoc') {
      setAdhocCollected(person.recId, newCollected)
    } else {
      setCollected(day.id, person.id, person.name, person.type, newCollected)
    }
  }, [day, setCollected, setAdhocCollected])

  const handleNote = useCallback((person, note) => {
    if (person.type === 'adhoc') {
      setAdhocNote(person.recId, note)
    } else {
      setNote(day.id, person.id, person.name, person.type, note)
    }
  }, [day, setNote, setAdhocNote])

  const handleDelete = useCallback((person) => {
    deleteAdhoc(person.recId)
  }, [deleteAdhoc])

  async function handleAddPerson() {
    const name = addingName.trim()
    if (!name || !day) return
    await addAdhoc(day.id, name, addingRole.trim(), addingDept.trim())
    resetAddForm()
  }

  // ── Excel export ─────────────────────────────────────────────────────────────

  async function handleExport() {
    if (!day) return
    const XLSX = (await import('xlsx-js-style')).default

    const headers = ['Name', 'Department', 'Role', 'Type', 'Entitled to Lunch', 'Collected', 'Time Collected', 'Note']
    const rows = persons.map(p => [
      p.name,
      p.dept || '',
      p.role || '',
      TYPE_LABEL[p.type] ?? p.type,
      p.entitled ? 'Yes' : 'No',
      p.collected ? 'Yes' : 'No',
      p.collectedAt ? fmtTime(p.collectedAt) : '',
      p.note || '',
    ])

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [{ wch: 28 }, { wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 30 }]

    const dateLabel = day.date
      ? new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).replace(' ', '')
      : 'Day'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Catering')
    XLSX.writeFile(wb, `Catering-${dateLabel}.xlsx`)
  }

  // ── Empty / no-day state ────────────────────────────────────────────────────

  if (allDays.length === 0) {
    return (
      <div className="cat-empty">
        <div style={{ fontSize: 32, opacity: 0.2 }}>🍽</div>
        <div className="cat-empty-title">No shoot days yet</div>
        <div className="cat-empty-sub">Add shoot days in the Schedule to see a catering list.</div>
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="cat-wrap">

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div className="cat-bar">
        <div className="cat-bar-left">
          {/* Day selector */}
          <select
            className="cat-day-select"
            value={selectedDayId ?? ''}
            onChange={e => selectDay(e.target.value)}
          >
            {allDays.map(d => (
              <option key={d.id} value={d.id}>{dayLabel(d)}</option>
            ))}
          </select>

          {/* Search */}
          <input
            className="cat-search"
            type="search"
            placeholder="Search name, role, dept…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="cat-bar-right">
          <button
            className="pm-btn pm-btn--ghost pm-btn--sm"
            onClick={() => setShowAddInput(v => !v)}
          >
            + Add person
          </button>
          <button className="pm-btn pm-btn--primary pm-btn--sm" onClick={handleExport}>
            ↓ Export Excel
          </button>
        </div>
      </div>

      {/* ── Add person inline form ─────────────────────────────────────────── */}
      {showAddInput && (
        <div className="cat-add-bar">
          <input
            className="cat-add-input cat-add-input--name"
            type="text"
            placeholder="Full name…"
            value={addingName}
            autoFocus
            onChange={e => setAddingName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')  handleAddPerson()
              if (e.key === 'Escape') resetAddForm()
            }}
          />
          <input
            className="cat-add-input cat-add-input--dept"
            type="text"
            placeholder="Department…"
            value={addingDept}
            onChange={e => setAddingDept(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')  handleAddPerson()
              if (e.key === 'Escape') resetAddForm()
            }}
          />
          <input
            className="cat-add-input cat-add-input--role"
            type="text"
            placeholder="Role…"
            value={addingRole}
            onChange={e => setAddingRole(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')  handleAddPerson()
              if (e.key === 'Escape') resetAddForm()
            }}
          />
          <button className="pm-btn pm-btn--primary pm-btn--sm" onClick={handleAddPerson}>Add</button>
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={resetAddForm}>Cancel</button>
        </div>
      )}

      {/* ── Column headers ────────────────────────────────────────────────── */}
      <div className="cat-list-head">
        <div className="cat-col-check" />
        <div className="cat-col-name">Name</div>
        <div className="cat-col-dept">Dept</div>
        <div className="cat-col-role">Role</div>
        <div className="cat-col-type">Type</div>
        <div className="cat-col-note">Note</div>
        <div className="cat-col-del" />
      </div>

      {/* ── Person list ───────────────────────────────────────────────────── */}
      <div className="cat-list">
        {filtered.length === 0 && (
          <div className="cat-list-empty">
            {search ? 'No results for that search.' : 'No crew on this day yet.'}
          </div>
        )}
        {filtered.map(person => (
          <PersonRow
            key={person.key}
            person={person}
            onToggle={handleToggle}
            onNoteChange={handleNote}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {/* ── Report strip ──────────────────────────────────────────────────── */}
      <div className="cat-report">
        <div className="cat-report-inner">
          <span className="cat-report-label">LUNCH REPORT</span>
          <span className="cat-report-stat">
            <strong>{totalCollected}</strong> collected
          </span>
          <span className="cat-report-sep">/</span>
          <span className="cat-report-stat">
            <strong>{totalEntitled}</strong> entitled
          </span>
          {totalEntitled > 0 && (
            <span className="cat-report-pct">
              ({Math.round((totalCollected / totalEntitled) * 100)}%)
            </span>
          )}
          {totalCollected > 0 && (
            <span className="cat-report-times">
              {persons.filter(p => p.collected && p.collectedAt).map(p =>
                `${p.name}: ${fmtTime(p.collectedAt)}`
              ).join(' · ')}
            </span>
          )}
        </div>
      </div>

    </div>
  )
}
