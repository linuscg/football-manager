// ─── Shared production context ─────────────────────────────────────────────────
// All three stores (schedule, crew, budget) read the current production ID from
// this module so switching productions only requires one call.

const KEY = 'fm_production_id'

let _currentId = localStorage.getItem(KEY) || null
const _callbacks = new Set()

export function getCurrentProductionId() {
  return _currentId
}

export function setCurrentProductionId(id) {
  if (_currentId === id) return
  _currentId = id
  if (id) localStorage.setItem(KEY, id)
  else localStorage.removeItem(KEY)
  _callbacks.forEach(cb => cb(id))
}

export function onProductionChange(cb) {
  _callbacks.add(cb)
  return () => _callbacks.delete(cb)
}
