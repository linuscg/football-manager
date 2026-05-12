import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

function mapHotel(row) {
  return {
    id:          row.id,
    name:        row.name         ?? '',
    address:     row.address      ?? '',
    contactInfo: row.contact_info ?? '',
    notes:       row.notes        ?? '',
    sortOrder:   row.sort_order   ?? 0,
  }
}

function mapAssignment(row) {
  return {
    id:        row.id,
    crewId:    row.crew_id,
    crewType:  row.crew_type,
    date:      row.date,
    hotelId:   row.hotel_id,
  }
}

export function useAccommodationStore() {
  const [hotels,      setHotels]      = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return
    try {
      const [{ data: hData, error: hErr }, { data: aData, error: aErr }] = await Promise.all([
        supabase.from('hotels').select('*').eq('production_id', prodId).order('sort_order'),
        supabase.from('crew_hotel_assignments').select('*').eq('production_id', prodId),
      ])
      if (hErr) throw hErr
      if (aErr) throw aErr
      setHotels((hData ?? []).map(mapHotel))
      setAssignments((aData ?? []).map(mapAssignment))
      setError(null)
    } catch (err) {
      console.error('[accommodation store]', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => { setLoading(true); loadAll() })
    const channel = supabase.channel('accommodation_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hotels' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_hotel_assignments' }, loadAll)
      .subscribe()
    return () => { unsub(); supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hotels CRUD ───────────────────────────────────────────────────────────────

  async function addHotel() {
    const prodId   = getCurrentProductionId()
    const newId    = crypto.randomUUID()
    const sortOrder = hotels.length
    const newHotel = { id: newId, name: '', address: '', contactInfo: '', notes: '', sortOrder }
    setHotels(hs => [...hs, newHotel])
    await supabase.from('hotels').insert({
      id: newId, production_id: prodId,
      name: '', address: '', contact_info: '', notes: '', sort_order: sortOrder,
    })
  }

  async function updateHotel(id, field, value) {
    const colMap = { name: 'name', address: 'address', contactInfo: 'contact_info', notes: 'notes' }
    setHotels(hs => hs.map(h => h.id === id ? { ...h, [field]: value } : h))
    await supabase.from('hotels').update({ [colMap[field] ?? field]: value }).eq('id', id)
  }

  async function deleteHotel(id) {
    setHotels(hs => hs.filter(h => h.id !== id))
    setAssignments(as => as.filter(a => a.hotelId !== id))
    await supabase.from('hotels').delete().eq('id', id)
  }

  // ── Hotel assignments ─────────────────────────────────────────────────────────

  async function setAssignment(crewId, crewType, date, hotelId) {
    const prodId = getCurrentProductionId()

    // Optimistic update
    setAssignments(as => {
      const rest = as.filter(a => !(a.crewId === crewId && a.crewType === crewType && a.date === date))
      if (hotelId === null) return rest
      return [...rest, { id: crypto.randomUUID(), crewId, crewType, date, hotelId }]
    })

    if (hotelId === null) {
      await supabase.from('crew_hotel_assignments')
        .delete()
        .eq('production_id', prodId)
        .eq('crew_id', crewId)
        .eq('crew_type', crewType)
        .eq('date', date)
    } else {
      await supabase.from('crew_hotel_assignments').upsert({
        production_id: prodId,
        crew_id:   crewId,
        crew_type: crewType,
        date,
        hotel_id:  hotelId,
      }, { onConflict: 'production_id,crew_id,crew_type,date' })
    }
  }

  return {
    hotels, assignments, loading, error,
    addHotel, updateHotel, deleteHotel,
    setAssignment,
  }
}
