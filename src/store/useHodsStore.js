import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'
import { syncFulltimeBookings } from '../lib/fulltimeBookingSync'

// HODs, backed by the `resources` table (type='crew', is_hod=true).
// Public API is unchanged from the old `hods`-backed store (title ↔ role).

function mapHod(row) {
  return {
    id:         row.id,
    name:       row.name            ?? '',
    title:      row.role            ?? '',
    department: row.department      ?? '',
    phone:      row.contact_phone   ?? '',
    email:      row.contact_email   ?? '',
    startDate:  row.hire_start_date ?? '',
    endDate:    row.hire_end_date   ?? '',
    sortOrder:  row.sort_order      ?? 0,
    level:      row.level           ?? 1,
  }
}

export function useHodsStore() {
  const [hods,    setHods]    = useState([])
  const [loading, setLoading] = useState(true)

  // Guards against the production-switch race: a slow loadAll for the previous
  // production must never land its rows after a newer load began.
  const loadGenRef = useRef(0)

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return
    const gen = ++loadGenRef.current
    const { data, error } = await supabase
      .from('resources')
      .select('*')
      .eq('production_id', prodId)
      .eq('type', 'crew')
      .eq('is_hod', true)
      .order('sort_order', { ascending: true })
    // A newer load (production switch) started while we were fetching —
    // discard this result instead of overwriting the newer production.
    if (gen !== loadGenRef.current) return
    if (!error) setHods((data ?? []).map(mapHod))
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => { setLoading(true); setHods([]); loadAll() })
    // Unique topic per hook instance — duplicate joins on a fixed topic
    // conflict in supabase-js when several components mount the same hook.
    const channel = supabase
      .channel(`hods_resources_changes_${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' }, loadAll)
      .subscribe()
    return () => { unsub(); supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function dbWrite(promise) {
    const { error } = await promise
    if (error) { console.error('[hods store]', error); loadAll() }
  }

  function addHod() {
    const prodId    = getCurrentProductionId()
    const newId     = crypto.randomUUID()
    const sortOrder = hods.length
    setHods(hs => [...hs, { id: newId, name: '', title: '', department: '', phone: '', email: '', startDate: '', endDate: '', sortOrder, level: 1 }])
    dbWrite(supabase.from('resources').insert({
      id: newId, production_id: prodId,
      type: 'crew', crew_class: 'fulltime', is_hod: true,
      name: '', level: 1, sort_order: sortOrder,
    }))
  }

  function deleteHod(id) {
    setHods(hs => hs.filter(h => h.id !== id))
    dbWrite(supabase.from('resources').delete().eq('id', id))
  }

  const HOD_FIELD_MAP = {
    name:       'name',
    title:      'role',
    department: 'department',
    phone:      'contact_phone',
    email:      'contact_email',
    startDate:  'hire_start_date',
    endDate:    'hire_end_date',
    level:      'level',
  }

  function updateHod(id, field, value) {
    const prev = hods.find(h => h.id === id)
    setHods(hs => hs.map(h => h.id === id ? { ...h, [field]: value } : h))
    const col = HOD_FIELD_MAP[field] ?? field
    const dbValue = (field === 'startDate' || field === 'endDate') ? (value || null) : value
    const write = dbWrite(supabase.from('resources').update({ [col]: dbValue }).eq('id', id))

    // HODs are fulltime crew — keep weekday auto-bookings in step with hire dates
    if ((field === 'startDate' || field === 'endDate') && prev) {
      const start = field === 'startDate' ? (value || null) : (prev.startDate || null)
      const end   = field === 'endDate'   ? (value || null) : (prev.endDate   || null)
      write.then(() => syncFulltimeBookings(supabase, id, start, end))
    }
  }

  return { hods, loading, addHod, deleteHod, updateHod }
}
