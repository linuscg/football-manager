import { useState, useMemo, useCallback, useEffect } from 'react'
import { useFullCrewList } from '../store/useFullCrewList'
import { useCrewStore }         from '../store/useCrewStore'
import { useBackpageStore }     from '../store/useBackpageStore'
import { useCateringStore }     from '../store/useCateringStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roundUp5(n) { return Math.ceil(n / 5) * 5 }

const CAT_ADDITIONALS_KEY = 'fm_cat_additionals'

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

  const { members: ftcMembers }      = useFullCrewList()
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
      .filter(d => ['main', 'splinter', 'prep', 'rehearsal', 'other'].includes(d.dayCategory))
      .sort((a, b) => a.date < b.date ? -1 : 1)
  , [shootDays])

  const [selectedDayId, setSelectedDayId] = useState(() => {
    const saved = localStorage.getItem('fm_cat_day')
    if (saved && allDays.find(d => d.id === saved)) return saved
    return allDays.find(d => d.dayCategory === 'main')?.id ?? allDays[0]?.id ?? null
  })

  const day    = allDays.find(d => d.id === selectedDayId) ?? allDays[0] ?? null
  const dayIdx = allDays.findIndex(d => d.id === (day?.id ?? null))

  const todayStr = new Date().toISOString().slice(0, 10)
  const isToday  = day?.date === todayStr

  function selectDay(id) {
    setSelectedDayId(id)
    localStorage.setItem('fm_cat_day', id)
  }

  function prevDay() {
    if (dayIdx > 0) selectDay(allDays[dayIdx - 1].id)
  }

  function nextDay() {
    if (dayIdx < allDays.length - 1) selectDay(allDays[dayIdx + 1].id)
  }

  function jumpToToday() {
    const todayDay = allDays.find(d => d.date === todayStr)
    if (todayDay) selectDay(todayDay.id)
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

    // 4. Ad-hoc entries — not counted as entitled (walk-ins)
    for (const rec of getAdhoc(day.id)) {
      list.push({
        key:         `adhoc-${rec.id}`,
        id:          rec.id,
        name:        rec.personName,
        role:        rec.personRole ?? '',
        dept:        rec.personDept ?? '',
        type:        'adhoc',
        entitled:    false,
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
  const totalCollected = persons.filter(p => p.collected).length   // includes ad-hoc

  // ── Catering Estimate (mirrors CateringNumbers logic for this day) ───────────

  const cateringEstimate = useMemo(() => {
    if (!day) return null
    const ftIds   = new Set(ftcMembers.map(m => m.id))
    const ftCount = ftcMembers.filter(m => !getMemberOverride(day.id, m.id)?.exclude).length
    const addCount = new Set(
      bookings
        .filter(b =>
          b.date === day.date &&
          (b.status === 'booked' || b.status === 'hold') &&
          (day.dayCategory === 'main' ? !b.dayId : b.dayId === day.id)
        )
        .map(b => resources.find(r => r.id === b.resourceId && r.type === 'crew')?.id)
        .filter(id => id && !ftIds.has(id))
    ).size
    const sceneCastIds = new Set((day.scenes ?? []).flatMap(s => s.castMemberIds ?? []))
    const castCount = castMembers.filter(c => sceneCastIds.has(c.id)).length
    try {
      const stored  = JSON.parse(localStorage.getItem(CAT_ADDITIONALS_KEY) ?? '{}')
      const addl    = Number(stored[day.id] ?? 0)
      return roundUp5((ftCount + addCount + castCount + addl) * 1.12)
    } catch {
      return roundUp5((ftCount + addCount + castCount) * 1.12)
    }
  }, [day, ftcMembers, bookings, resources, castMembers, getMemberOverride])

  // ── Keyboard shortcut: 'A' opens add-person form ────────────────────────────

  useEffect(() => {
    function onKey(e) {
      // Ignore if typing in any input/textarea/select
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        setShowAddInput(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  // ── PDF export ───────────────────────────────────────────────────────────────

  function handleExportPDF() {
    if (!day) return

    const dateLabel = day.date
      ? new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', {
          weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
        })
      : 'Unknown date'

    const productionName = production?.name || ''

    const byDeptThenName = (a, b) =>
      (a.dept || '').localeCompare(b.dept || '') || a.name.localeCompare(b.name)

    const collectedPersons = persons.filter(p => p.collected).sort(byDeptThenName)
    const notCollected     = persons.filter(p => !p.collected && p.entitled).sort(byDeptThenName)

    // Build rows for collected table
    function personRows(list) {
      return list.map((p, i) => `
        <tr class="${i % 2 === 0 ? 'even' : ''}">
          <td class="td-name">${p.name}</td>
          <td class="td-dept">${p.dept || '—'}</td>
          <td class="td-role">${p.role || '—'}</td>
          <td class="td-type">${TYPE_LABEL[p.type] ?? p.type}</td>
          <td class="td-time">${p.collectedAt ? fmtTime(p.collectedAt) : '—'}</td>
          <td class="td-note">${p.note || ''}</td>
        </tr>
      `).join('')
    }

    const adhocCount    = persons.filter(p => !p.entitled && p.collected).length
    const entitledCount = totalEntitled
    const collCount     = totalCollected

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Catering Report — ${dateLabel}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #111; background: #fff; }

  .header { margin-bottom: 14px; border-bottom: 2px solid #111; padding-bottom: 10px; }
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .prod-name { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #555; }
  .page-title { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; color: #111; margin: 4px 0 2px; }
  .date-label { font-size: 12px; color: #444; font-weight: 500; }
  .printed-at { font-size: 9.5px; color: #888; text-align: right; margin-top: 4px; }

  .stats-row { display: flex; gap: 0; margin-bottom: 16px; border: 1.5px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  .stat-box { flex: 1; padding: 10px 14px; border-right: 1px solid #e5e7eb; }
  .stat-box:last-child { border-right: none; }
  .stat-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 4px; }
  .stat-value { font-size: 26px; font-weight: 800; line-height: 1; color: #111; }
  .stat-sub   { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .stat-box--green .stat-value { color: #15803d; }
  .stat-box--pct   .stat-value { color: #6366f1; }
  .stat-box--est   .stat-value { color: #0369a1; }

  .section-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #374151; margin-bottom: 6px; margin-top: 14px; }

  table { width: 100%; border-collapse: collapse; }
  th { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280;
       padding: 5px 8px; border-bottom: 2px solid #e5e7eb; text-align: left; background: #f9fafb; }
  td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
  tr.even td { background: #fafafa; }
  .td-name { font-weight: 600; font-size: 11px; }
  .td-dept { color: #374151; font-size: 10.5px; }
  .td-role { color: #6b7280; font-size: 10.5px; }
  .td-type { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
  .td-time { font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; color: #15803d; white-space: nowrap; }
  .td-note { color: #6b7280; font-size: 10px; font-style: italic; }

  .no-data { padding: 12px 8px; color: #9ca3af; font-style: italic; font-size: 11px; }
  .footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #e5e7eb; font-size: 9px; color: #aaa; text-align: center; }
</style>
</head>
<body>

<div class="header">
  <div class="header-top">
    <div>
      ${productionName ? `<div class="prod-name">${productionName}</div>` : ''}
      <div class="page-title">Catering Report</div>
      <div class="date-label">${dateLabel}</div>
    </div>
    <div class="printed-at">Printed ${new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</div>
  </div>
</div>

<div class="stats-row">
  <div class="stat-box stat-box--green">
    <div class="stat-label">Collected</div>
    <div class="stat-value">${collCount}</div>
    <div class="stat-sub">meals served${adhocCount > 0 ? ` incl. ${adhocCount} ad-hoc` : ''}</div>
  </div>
  <div class="stat-box">
    <div class="stat-label">Entitled</div>
    <div class="stat-value">${entitledCount}</div>
    <div class="stat-sub">planned crew &amp; cast</div>
  </div>
  ${entitledCount > 0 ? `
  <div class="stat-box stat-box--pct">
    <div class="stat-label">Collection rate</div>
    <div class="stat-value">${Math.round((collCount / entitledCount) * 100)}%</div>
    <div class="stat-sub">of entitled crew</div>
  </div>` : ''}
  <div class="stat-box">
    <div class="stat-label">Not collected</div>
    <div class="stat-value">${notCollected.length}</div>
    <div class="stat-sub">entitled, no lunch</div>
  </div>
  ${cateringEstimate !== null ? `
  <div class="stat-box stat-box--est">
    <div class="stat-label">Catering Estimate</div>
    <div class="stat-value">${cateringEstimate}</div>
    <div class="stat-sub">total × 112%, nearest 5</div>
  </div>` : ''}
</div>

<div class="section-title">Collected (${collectedPersons.length})</div>
<table>
  <thead>
    <tr>
      <th>Name</th><th>Department</th><th>Role</th><th>Type</th><th>Time</th><th>Note</th>
    </tr>
  </thead>
  <tbody>
    ${collectedPersons.length > 0 ? personRows(collectedPersons) : `<tr><td colspan="6" class="no-data">No lunches collected yet.</td></tr>`}
  </tbody>
</table>

${notCollected.length > 0 ? `
<div class="section-title">Not yet collected (${notCollected.length})</div>
<table>
  <thead>
    <tr>
      <th>Name</th><th>Department</th><th>Role</th><th>Type</th><th>Time</th><th>Note</th>
    </tr>
  </thead>
  <tbody>
    ${personRows(notCollected)}
  </tbody>
</table>` : ''}

<div class="footer">Football Manager · Catering Report · ${dateLabel}</div>
</body>
</html>`

    const w = window.open('', '_blank', 'width=900,height=700')
    w.document.write(html)
    w.document.close()
    w.addEventListener('load', () => w.print())
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
          {/* Prev / day selector / next */}
          <div className="cat-day-nav">
            <button
              className="cat-day-arrow"
              onClick={prevDay}
              disabled={dayIdx <= 0}
              title="Previous day"
            >‹</button>
            <select
              className="cat-day-select"
              value={selectedDayId ?? ''}
              onChange={e => selectDay(e.target.value)}
            >
              {allDays.map(d => (
                <option key={d.id} value={d.id}>{dayLabel(d)}</option>
              ))}
            </select>
            <button
              className="cat-day-arrow"
              onClick={nextDay}
              disabled={dayIdx >= allDays.length - 1}
              title="Next day"
            >›</button>
          </div>

          {/* Jump to today */}
          {!isToday && allDays.some(d => d.date === todayStr) && (
            <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={jumpToToday}>
              Today
            </button>
          )}
          {isToday && (
            <span className="cat-today-badge">Today</span>
          )}

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
            + Add person <kbd className="cat-kbd">A</kbd>
          </button>
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={handleExportPDF}>
            ↓ Export PDF
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
          {cateringEstimate !== null && (
            <>
              <span className="cat-report-sep">·</span>
              <span className="cat-report-stat">
                estimate <strong>{cateringEstimate}</strong>
              </span>
            </>
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
