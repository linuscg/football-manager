import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapMember(row) {
  return {
    id:         row.id,
    name:       row.name        ?? '',
    department: row.department  ?? '',
    role:       row.role        ?? '',
    phone:      row.phone       ?? '',
    email:      row.email       ?? '',
    sortOrder:  row.sort_order  ?? 0,
    startDate:  row.start_date  ?? '',
    endDate:    row.end_date    ?? '',
  }
}

// ─── Store hook ───────────────────────────────────────────────────────────────

export function useFulltimeCrewStore() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return
    try {
      const { data, error: err } = await supabase
        .from('fulltime_crew')
        .select('*')
        .eq('production_id', prodId)
        .order('sort_order', { ascending: true })
      if (err) throw err
      setMembers((data ?? []).map(mapMember))
      setError(null)
    } catch (err) {
      console.error('[fulltime crew store] loadAll:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => {
      setLoading(true)
      setMembers([])
      loadAll()
    })
    const channel = supabase
      .channel('fulltime_crew_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fulltime_crew' }, loadAll)
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
    const blank = { id: newId, name: '', department: '', role: '', phone: '', email: '', sortOrder, startDate: '', endDate: '' }
    setMembers(ms => [...ms, blank])
    dbWrite(supabase.from('fulltime_crew').insert({
      id: newId, production_id: prodId, sort_order: sortOrder,
    }))
    return newId
  }

  function deleteMember(id) {
    setMembers(ms => ms.filter(m => m.id !== id))
    dbWrite(supabase.from('fulltime_crew').delete().eq('id', id))
  }

  const FIELD_MAP = {
    name:       'name',
    department: 'department',
    role:       'role',
    phone:      'phone',
    email:      'email',
    startDate:  'start_date',
    endDate:    'end_date',
  }

  function updateMember(id, field, value) {
    setMembers(ms => ms.map(m => m.id === id ? { ...m, [field]: value } : m))
    dbWrite(supabase.from('fulltime_crew').update({ [FIELD_MAP[field] ?? field]: value }).eq('id', id))
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
          dbWrite(supabase.from('fulltime_crew').update({ sort_order: i }).eq('id', m.id))
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
          dbWrite(supabase.from('fulltime_crew').update({ sort_order: i }).eq('id', m.id))
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
      sort_order:    sortStart + i,
      name:          row.name       || '',
      department:    row.department || '',
      role:          row.role       || '',
      phone:         row.phone      || '',
      email:         row.email      || '',
    }))
    const { error: err } = await supabase.from('fulltime_crew').insert(inserts)
    if (err) { console.error('[fulltime crew store] import:', err); return 0 }
    setMembers(ms => [...ms, ...inserts.map(r => mapMember({ ...r, sort_order: r.sort_order }))])
    return inserts.length
  }

  return {
    members, loading, error,
    addMember, deleteMember, updateMember,
    moveMemberUp, moveMemberDown,
    importMembers,
  }
}
