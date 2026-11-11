import { supabase as defaultSupabase } from './supabase'
import { getCurrentProductionId } from './productionContext'

// ─── Fulltime weekday auto-booking sync ──────────────────────────────────────
//
// When a fulltime crew member's hire dates change, keep their gantt bookings
// in step with the hire range:
//   • insert a 'booked' booking for every WEEKDAY (Mon–Fri) in [start, end]
//     that has no existing booking for this resource — skipping any day that
//     falls inside a production hiatus
//   • delete this resource's bookings dated OUTSIDE [start, end]
//   • delete auto 'booked' main-unit bookings that fall INSIDE a hiatus
//     (manual statuses — hold/unavailable/etc — are left alone)
// If the end date is missing, the production's final shoot day is used as the
// ESTIMATED end (matching the UI's "est." end date). If the start date is
// missing — or no end can be resolved — the sync does nothing (never wipes).

function toISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Set of every date inside any valid hiatus range
function hiatusDateSet(hiatuses) {
  const set = new Set()
  for (const h of hiatuses ?? []) {
    if (!h.startDate || !h.endDate || h.endDate < h.startDate) continue
    const end = new Date(`${h.endDate}T00:00:00`)
    for (let d = new Date(`${h.startDate}T00:00:00`); d <= end; d.setDate(d.getDate() + 1)) {
      set.add(toISODate(d))
    }
  }
  return set
}

export async function syncFulltimeBookings(supabase, resourceId, start, end) {
  const sb = supabase ?? defaultSupabase
  if (!resourceId || !start) return

  const prodId = getCurrentProductionId()
  if (!prodId) return
  const { data: prod, error: prodErr } = await sb
    .from('production')
    .select('shoot_end_date, hiatuses')
    .eq('id', prodId)
    .single()
  if (prodErr) { console.error('[fulltime booking sync] fetch production:', prodErr); return }

  const effEnd = end || prod?.shoot_end_date || null
  if (!effEnd || effEnd < start) return
  end = effEnd
  const hiatus = hiatusDateSet(prod?.hiatuses)

  const { data, error } = await sb
    .from('resource_bookings')
    .select('id, booking_date, status, day_id')
    .eq('resource_id', resourceId)
  if (error) {
    console.error('[fulltime booking sync] fetch bookings:', error)
    return
  }
  const existing = (data ?? []).map(b => ({ id: b.id, date: b.booking_date, status: b.status, dayId: b.day_id }))
  const existingDates = new Set(existing.map(b => b.date))

  // Weekdays in range with no existing booking (and not on hiatus) → insert
  const inserts = []
  const endDate = new Date(end + 'T00:00:00')
  for (let d = new Date(start + 'T00:00:00'); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay()
    if (dow === 0 || dow === 6) continue           // skip weekends
    const iso = toISODate(d)
    if (hiatus.has(iso)) continue                  // skip hiatus days
    if (existingDates.has(iso)) continue
    inserts.push({
      id:           crypto.randomUUID(),
      resource_id:  resourceId,
      booking_date: iso,
      status:       'booked',
    })
  }

  // Outside the hire range → delete; inside a hiatus, auto 'booked' main-unit
  // rows are cleared too (manual hold/unavailable/etc stay)
  const deleteIds = existing
    .filter(b => b.date && (
      b.date < start || b.date > end ||
      (hiatus.has(b.date) && b.status === 'booked' && !b.dayId)
    ))
    .map(b => b.id)

  if (inserts.length) {
    const { error: err } = await sb.from('resource_bookings').insert(inserts)
    if (err) console.error('[fulltime booking sync] insert:', err)
  }
  if (deleteIds.length) {
    const { error: err } = await sb.from('resource_bookings').delete().in('id', deleteIds)
    if (err) console.error('[fulltime booking sync] delete:', err)
  }
}
