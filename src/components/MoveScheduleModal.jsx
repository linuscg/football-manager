import { useState, useMemo } from 'react'

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function diffDays(a, b) {
  return Math.round(
    (new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000
  )
}

export default function MoveScheduleModal({
  pendingMove,
  allShootDays,
  bookings,
  resources,
  assignments,
  onConfirm,
  onCancel,
}) {
  const [renumber, setRenumber] = useState(true)

  const { selectedDays, newStartDate, type } = pendingMove

  const computed = useMemo(() => {
    // ── Build the primary date mapping for selected days ──────────────────────
    const sorted = [...selectedDays].sort((a, b) =>
      (a.date || '').localeCompare(b.date || '')
    )

    // The selected days mapped to their new dates
    const primaryMoves = [] // { dayId, oldDate, newDate, day }
    if (type === 'single') {
      const day = sorted[0]
      primaryMoves.push({
        dayId:   day.id,
        oldDate: day.date,
        newDate: newStartDate,
        day,
      })
    } else {
      // multi: maintain relative gaps from the first selected day
      const firstOld = sorted[0].date
      sorted.forEach(day => {
        const gap = diffDays(firstOld, day.date)
        primaryMoves.push({
          dayId:   day.id,
          oldDate: day.date,
          newDate: addDays(newStartDate, gap),
          day,
        })
      })
    }

    const selectedIds = new Set(selectedDays.map(d => d.id))

    // ── Shunting: slide non-selected days to fill the holes we've created ──────
    //
    // Moving FORWARD (oldDate < newDate):
    //   Days in range (oldDate, newDate] slide BACK by 1 to fill the vacated slot.
    // Moving BACKWARD (oldDate > newDate):
    //   Days in range [newDate, oldDate) slide FORWARD by 1 to make room.
    //
    // shuntMap[dayId] = the running new date for that day (applied across
    // all primary moves so multiple overlapping moves compound correctly).

    const shuntMap = {}  // dayId → newDate

    for (const primary of primaryMoves) {
      const { oldDate, newDate } = primary
      if (oldDate === newDate) continue
      const movingForward = newDate > oldDate

      const inRange = allShootDays.filter(d => {
        if (selectedIds.has(d.id) || !d.date) return false
        return movingForward
          ? (d.date > oldDate && d.date <= newDate)   // fill hole: slide back
          : (d.date >= newDate && d.date < oldDate)   // make room: slide forward
      })

      for (const day of inRange) {
        const cur = shuntMap[day.id] ?? day.date
        shuntMap[day.id] = addDays(cur, movingForward ? -1 : 1)
      }
    }

    const shuntMoves = Object.entries(shuntMap).map(([dayId, newDate]) => {
      const day = allShootDays.find(d => d.id === dayId)
      return { dayId, oldDate: day.date, newDate, day, isShunt: true }
    })

    // ── All moves combined ────────────────────────────────────────────────────
    const allMoves = [
      ...primaryMoves.map(m => ({ ...m, isShunt: false })),
      ...shuntMoves,
    ]

    // ── Count affected bookings on old dates of primary (non-shunt) moves ─────
    const primaryOldDates = new Set(primaryMoves.map(m => m.oldDate))
    let crewCount  = 0
    let equipCount = 0
    for (const b of bookings) {
      if (!primaryOldDates.has(b.date)) continue
      const res = resources.find(r => r.id === b.resourceId)
      if (!res) continue
      if (res.type === 'crew') crewCount++
      else equipCount++
    }

    // ── Conflict detection: bookings that already exist on new dates ──────────
    // A conflict = resource has a booking on both oldDate (that will move) AND newDate (existing)
    let conflictCount = 0
    for (const move of primaryMoves) {
      const movedBookings = bookings.filter(
        b => b.date === move.oldDate && !b.dayId
      )
      for (const mb of movedBookings) {
        const hasConflict = bookings.some(
          b => b.resourceId === mb.resourceId && b.date === move.newDate && b.id !== mb.id
        )
        if (hasConflict) conflictCount++
      }
    }

    return { allMoves, crewCount, equipCount, conflictCount }
  }, [pendingMove, allShootDays, bookings, resources])

  const { allMoves, crewCount, equipCount, conflictCount } = computed

  function handleConfirm() {
    // Build logChanges from non-shunted moves
    const logChanges = allMoves
      .filter(m => !m.isShunt)
      .map(m => ({
        dayId:       m.dayId,
        dayNumber:   m.day.dayNumber,
        dayLabel:    m.day.dayLabel,
        dayCategory: m.day.dayCategory,
        oldDate:     m.oldDate,
        newDate:     m.newDate,
      }))

    onConfirm({ dayMoves: allMoves, logChanges, renumber })
  }

  return (
    <div className="move-modal-overlay" onClick={onCancel}>
      <div className="move-modal" onClick={e => e.stopPropagation()}>
        <h2 className="move-modal-title">Move Shoot Days</h2>
        <p className="move-modal-sub">
          Review all date changes before confirming.
        </p>

        <table className="move-modal-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Old date</th>
              <th></th>
              <th>New date</th>
            </tr>
          </thead>
          <tbody>
            {allMoves
              .sort((a, b) => (a.oldDate || '').localeCompare(b.oldDate || ''))
              .map(m => {
                const label = m.day.dayCategory === 'main'
                  ? `Day ${m.day.dayNumber ?? '?'}`
                  : m.day.dayCategory === 'prep'
                    ? `Prep${m.day.dayLabel ? ' ' + m.day.dayLabel : ''}`
                    : m.day.dayCategory === 'splinter'
                      ? `Split${m.day.dayLabel ? ' ' + m.day.dayLabel : ''}`
                      : `Other${m.day.dayLabel ? ' ' + m.day.dayLabel : ''}`
                return (
                  <tr key={m.dayId} className={m.isShunt ? 'move-modal-shunt' : ''}>
                    <td>
                      {label}
                      {m.isShunt && <span className="move-modal-badge">shunted</span>}
                    </td>
                    <td>{fmtDate(m.oldDate)}</td>
                    <td>→</td>
                    <td>{fmtDate(m.newDate)}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>

        <div className="move-modal-summary">
          <strong>{crewCount}</strong> crew booking{crewCount !== 1 ? 's' : ''} and{' '}
          <strong>{equipCount}</strong> equipment booking{equipCount !== 1 ? 's' : ''} will
          move and be marked <em>To Reconfirm</em>
          {crewCount === 0 && equipCount === 0 && ' (none found on these dates)'}.
        </div>

        {conflictCount > 0 && (
          <div className="move-modal-warning">
            ⚠ {conflictCount} booking{conflictCount !== 1 ? 's' : ''} already exist on the
            new dates — these will remain and may need manual review.
          </div>
        )}

        <label className="move-modal-renumber">
          <input
            type="checkbox"
            checked={renumber}
            onChange={e => setRenumber(e.target.checked)}
          />
          Renumber shoot days after move?
        </label>

        <div className="move-modal-actions">
          <button className="pm-btn pm-btn--ghost" onClick={onCancel}>Cancel</button>
          <button className="pm-btn pm-btn--primary" onClick={handleConfirm}>
            Confirm Move
          </button>
        </div>
      </div>
    </div>
  )
}
