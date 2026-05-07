// Tracks which shoot-day IDs the Gantt has already "seen", so we don't
// re-show the "new shoot day" notice for days that were auto-generated
// or already dismissed by the user.

const KEY = 'fm_gantt_notified_ids'

export function getNotifiedIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export function markIdsNotified(ids) {
  const set = getNotifiedIds()
  for (const id of ids) set.add(id)
  localStorage.setItem(KEY, JSON.stringify([...set]))
}
