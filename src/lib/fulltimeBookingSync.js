import { supabase as defaultSupabase } from './supabase'

// ─── Fulltime weekday auto-booking sync ──────────────────────────────────────
//
// When a fulltime crew member's hire dates change, keep their gantt bookings
// in step with the hire range:
//   • insert a 'booked' booking for every WEEKDAY (Mon–Fri) in [start, end]
//     that has no existing booking for this resource
//   • delete this resource's bookings dated OUTSIDE [start, end]
// If either date is missing the sync does nothing (never wipes bookings).
//
// existingBookings is optional: an array of { id, date } for this resource.
// When omitted, the helper fetches the resource's bookings itself.

function toISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export async function syncFulltimeBookings(supabase, resourceId, start, end, existingBookings = null) {
  const sb = supabase ?? defaultSupabase
  if (!resourceId || !start || !end || end < start) return

  let existing = existingBookings
  if (!existing) {
    const { data, error } = await sb
      .from('resource_bookings')
      .select('id, booking_date')
      .eq('resource_id', resourceId)
    if (error) {
      console.error('[fulltime booking sync] fetch bookings:', error)
      return
    }
    existing = (data ?? []).map(b => ({ id: b.id, date: b.booking_date }))
  }

  const existingDates = new Set(existing.map(b => b.date))

  // Weekdays in range with no existing booking → batched insert
  const inserts = []
  const endDate = new Date(end + 'T00:00:00')
  for (let d = new Date(start + 'T00:00:00'); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay()
    if (dow === 0 || dow === 6) continue           // skip weekends
    const iso = toISODate(d)
    if (existingDates.has(iso)) continue
    inserts.push({
      id:           crypto.randomUUID(),
      resource_id:  resourceId,
      booking_date: iso,
      status:       'booked',
    })
  }

  // This resource's bookings outside the range → batched delete
  const outsideIds = existing
    .filter(b => b.date && (b.date < start || b.date > end))
    .map(b => b.id)

  if (inserts.length) {
    const { error } = await sb.from('resource_bookings').insert(inserts)
    if (error) console.error('[fulltime booking sync] insert:', error)
  }
  if (outsideIds.length) {
    const { error } = await sb.from('resource_bookings').delete().in('id', outsideIds)
    if (error) console.error('[fulltime booking sync] delete:', error)
  }
}
