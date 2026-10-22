import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'
import { syncFulltimeBookings } from '../lib/fulltimeBookingSync'

// Fulltime crew, backed by the `resources` table
// (type='crew', crew_class='fulltime', is_hod=false).
// Public API is unchanged from the old `fulltime_crew`-backed store.

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapMember(row) {
  return {
    id:         row.id,
    name:       row.name            ?? '',
    department: row.department      ?? '',
    role:       row.role            ?? '',
    phone:      row.contact_phone   ?? '',
    email:      row.contact_email   ?? '',
    sortOrder:  row.sort_order      ?? 0,
    startDate:  row.hire_start_date ?? '',
    endDate:    row.hire_end_date   ?? '',
    level:      row.level           ?? 5,
  }
}

// ─── Store hook ───────────────────────────────────────────────────────────────

export function useFulltimeCrewStore() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // Guards against the production-switch race: a slow loadAll for the previous
  // production must never land its rows after a newer load began.
  const loadGenRef = useRef(0)

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return
    const gen = ++loadGenRef.current
    try {
      const { data, error: err } = await supabase
        .from('resources')
        .select('*')
        .eq('production_id', prodId)
        .eq('type', 'crew')
        .eq('crew_class', 'fulltime')
        .eq('is_hod', false)
        .order('sort_order', { ascending: true })
      if (err) throw err
      // A newer load (production switch) started while we were fetching —
      // discard this result instead of overwriting the newer production.
      if (gen !== loadGenRef.current) return
      setMembers((data ?? []).map(mapMember))
      setError(null)
    } catch (err) {
      if (gen !== loadGenRef.current) return
      console.error('[fulltime crew store] loadAll:', err)
      setError(err.message)
    } finally {
      if (gen === loadGenRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => {
      setLoading(true)
      setMembers([])
      loadAll()
    })
    // Unique topic per hook instance — duplicate joins on a fixed topic
    // conflict in supabase-js when several components mount the same hook.
    const channel = supabase
      .channel(`fulltime_crew_resources_changes_${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' }, loadAll)
      .subscribe()
    return () => { unsub(); supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function dbWrite(promise) {
    const { error: err } = await promise
    if (err) { console.error('[fulltime crew store]', err); loadAll() }
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  function addMember() {
    const prodId    = getCurrentProductionId()
    const newId     = crypto.randomUUID()
    const sortOrder = members.length
    const blank = { id: newId, name: '', department: '', role: '', phone: '', email: '', sortOrder, startDate: '', endDate: '', level: 5 }
    setMembers(ms => [...ms, blank])
    dbWrite(supabase.from('resources').insert({
      id: newId, production_id: prodId,
      type: 'crew', crew_class: 'fulltime', is_hod: false,
      name: '', sort_order: sortOrder,
    }))
    return newId
  }

  function deleteMember(id) {
    setMembers(ms => ms.filter(m => m.id !== id))
    dbWrite(supabase.from('resources').delete().eq('id', id))
  }

  const FIELD_MAP = {
    name:       'name',
    department: 'department',
    role:       'role',
    phone:      'contact_phone',
    email:      'contact_email',
    startDate:  'hire_start_date',
    endDate:    'hire_end_date',
    level:      'level',
  }

  function updateMember(id, field, value) {
    const prev = members.find(m => m.id === id)
    setMembers(ms => ms.map(m => m.id === id ? { ...m, [field]: value } : m))
    const col = FIELD_MAP[field] ?? field
    const dbValue = (field === 'startDate' || field === 'endDate') ? (value || null) : value
    const write = dbWrite(supabase.from('resources').update({ [col]: dbValue }).eq('id', id))

    // Fulltime weekday auto-booking sync on hire-date changes
    if ((field === 'startDate' || field === 'endDate') && prev) {
      const start = field === 'startDate' ? (value || null) : (prev.startDate || null)
      const end   = field === 'endDate'   ? (value || null) : (prev.endDate   || null)
      write.then(() => syncFulltimeBookings(supabase, id, start, end))
    }
  }

  function moveMemberUp(id) {
    setMembers(ms => {
      const idx = ms.findIndex(m => m.id === id)
      if (idx <= 0) return ms
      const next = [...ms]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      next.forEach((m, i) => {
        if (m.sortOrder !== i) {
          m.sortOrder = i
          dbWrite(supabase.from('resources').update({ sort_order: i }).eq('id', m.id))
        }
      })
      return next
    })
  }

  function moveMemberDown(id) {
    setMembers(ms => {
      const idx = ms.findIndex(m => m.id === id)
      if (idx < 0 || idx >= ms.length - 1) return ms
      const next = [...ms]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      next.forEach((m, i) => {
        if (m.sortOrder !== i) {
          m.sortOrder = i
          dbWrite(supabase.from('resources').update({ sort_order: i }).eq('id', m.id))
        }
      })
      return next
    })
  }

  // ── Bulk import ────────────────────────────────────────────────────────────

  async function importMembers(rows) {
    const prodId    = getCurrentProductionId()
    const sortStart = members.length
    const inserts   = rows.map((row, i) => ({
      id:            crypto.randomUUID(),
      production_id: prodId,
      type:          'crew',
      crew_class:    'fulltime',
      is_hod:        false,
      sort_order:    sortStart + i,
      name:          row.name       || '',
      department:    row.department || '',
      role:          row.role       || '',
      contact_phone: row.phone      || '',
      contact_email: row.email      || '',
    }))
    const { error: err } = await supabase.from('resources').insert(inserts)
    if (err) { console.error('[fulltime crew store] import:', err); return 0 }
    setMembers(ms => [...ms, ...inserts.map(mapMember)])
    return inserts.length
  }

  return {
    members, loading, error,
    addMember, deleteMember, updateMember,
    moveMemberUp, moveMemberDown,
    importMembers,
  }
}
