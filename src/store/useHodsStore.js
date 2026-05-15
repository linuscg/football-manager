import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

function mapHod(row) {
  return {
    id:         row.id,
    name:       row.name       ?? '',
    title:      row.title      ?? '',
    department: row.department ?? '',
    phone:      row.phone      ?? '',
    email:      row.email      ?? '',
    sortOrder:  row.sort_order ?? 0,
  }
}

export function useHodsStore() {
  const [hods, setHods] = useState([])

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return
    const { data, error } = await supabase
      .from('hods')
      .select('*')
      .eq('production_id', prodId)
      .order('sort_order', { ascending: true })
    if (!error) setHods((data ?? []).map(mapHod))
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => { setHods([]); loadAll() })
    const channel = supabase
      .channel('hods_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hods' }, loadAll)
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
    setHods(hs => [...hs, { id: newId, name: '', title: '', department: '', phone: '', email: '', sortOrder }])
    dbWrite(supabase.from('hods').insert({ id: newId, production_id: prodId, sort_order: sortOrder }))
  }

  function deleteHod(id) {
    setHods(hs => hs.filter(h => h.id !== id))
    dbWrite(supabase.from('hods').delete().eq('id', id))
  }

  const HOD_FIELD_MAP = {
    name:       'name',
    title:      'title',
    department: 'department',
    phone:      'phone',
    email:      'email',
  }

  function updateHod(id, field, value) {
    setHods(hs => hs.map(h => h.id === id ? { ...h, [field]: value } : h))
    dbWrite(supabase.from('hods').update({ [HOD_FIELD_MAP[field] ?? field]: value }).eq('id', id))
  }

  return { hods, addHod, deleteHod, updateHod }
}
