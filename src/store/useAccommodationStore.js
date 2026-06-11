import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

function mapHotel(row) {
  return {
    id:             row.id,
    name:           row.name         ?? '',
    address:        row.address      ?? '',
    contactInfo:    row.contact_info ?? '',
    notes:          row.notes        ?? '',
    sortOrder:      row.sort_order   ?? 0,
    code:           row.code            ?? '',
    checkinTime:    row.checkin_time    ?? '',
    checkoutTime:   row.checkout_time   ?? '',
    roomsAllocated: row.rooms_allocated ?? null,
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

function mapStay(row) {
  return {
    id:          row.id,
    productionId: row.production_id,
    personId:    row.person_id   ?? null,
    personType:  row.person_type ?? 'crew',
    name:        row.name        ?? '',
    jobTitle:    row.job_title   ?? '',
    department:  row.department  ?? '',
    roomType:    row.room_type   ?? '',
    costPerNight: row.cost_per_night ?? null,
    note:        row.note        ?? '',
    costCode:    row.cost_code   ?? '',
    poNumber:    row.po_number   ?? '',
    tmoNumber:   row.tmo_number  ?? '',
    sortOrder:   row.sort_order  ?? 0,
    createdAt:   row.created_at  ?? null,
  }
}

function mapNight(row) {
  return {
    id:      row.id,
    stayId:  row.stay_id,
    date:    row.date,
    hotelId: row.hotel_id ?? null,
    tbc:     !!row.tbc,
  }
}

export function useAccommodationStore() {
  const [hotels,       setHotels]       = useState([])
  const [assignments,  setAssignments]  = useState([])
  const [stays,        setStays]        = useState([])
  const [nights,       setNights]       = useState([])
  const [travelTimes,  setTravelTimesData] = useState({}) // { "hotelId|loc": "value" }
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) { setLoading(false); return }

    // ── Main load: hotels + assignments ──────────────────────────────────────
    try {
      const [
        { data: hData, error: hErr },
        { data: aData, error: aErr },
        { data: sData, error: sErr },
        { data: nData, error: nErr },
      ] = await Promise.all([
        supabase.from('hotels').select('*').eq('production_id', prodId).order('sort_order'),
        supabase.from('crew_hotel_assignments').select('*').eq('production_id', prodId),
        supabase.from('accom_stays').select('*').eq('production_id', prodId).order('sort_order'),
        supabase.from('accom_nights').select('*').eq('production_id', prodId),
      ])
      if (hErr) throw hErr
      if (aErr) throw aErr
      if (sErr) throw sErr
      if (nErr) throw nErr
      setHotels((hData ?? []).map(mapHotel))
      setAssignments((aData ?? []).map(mapAssignment))
      setStays((sData ?? []).map(mapStay))
      setNights((nData ?? []).map(mapNight))
      setError(null)
    } catch (err) {
      console.error('[accommodation store]', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }

    // ── Travel times: separate so a missing table never blocks main load ─────
    try {
      const { data: tData } = await supabase
        .from('hotel_travel_times').select('*').eq('production_id', prodId)
      const ttMap = {}
      for (const row of tData ?? []) {
        ttMap[`${row.hotel_id}|${row.location_name}`] = row.travel_time ?? ''
      }
      setTravelTimesData(ttMap)
    } catch {
      // table may not exist yet — silently ignore
    }
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => { setLoading(true); loadAll() })
    const channel = supabase.channel('accommodation_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hotels' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_hotel_assignments' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accom_stays' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accom_nights' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hotel_travel_times' }, loadAll)
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
    const colMap = {
      name: 'name', address: 'address', contactInfo: 'contact_info', notes: 'notes',
      code: 'code', checkinTime: 'checkin_time', checkoutTime: 'checkout_time',
      roomsAllocated: 'rooms_allocated',
    }
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

  // ── Move hotel assignments (schedule date move) ───────────────────────────────
  // dateMoves: [{ oldDate, newDate }]
  // Returns undoPayload: [{ assignmentId, oldDate }]

  async function moveHotelAssignments(dateMoves) {
    const undoPayload = []

    for (const { oldDate, newDate } of dateMoves) {
      const affected = assignments.filter(a => a.date === oldDate)

      for (const assignment of affected) {
        undoPayload.push({ assignmentId: assignment.id, oldDate: assignment.date })

        // Optimistic update
        setAssignments(as => as.map(a =>
          a.id === assignment.id ? { ...a, date: newDate } : a
        ))

        // DB write
        supabase.from('crew_hotel_assignments').update({ date: newDate }).eq('id', assignment.id)
          .then(({ error: err }) => {
            if (err) { console.error('[accommodation store] moveHotelAssignments:', err); loadAll() }
          })
      }
    }

    return undoPayload
  }

  // ── Accom stays (one row = one person's stay) ──────────────────────────────────

  async function addStay({ personId = null, personType = 'crew', name = '', jobTitle = '', department = '' } = {}) {
    const prodId    = getCurrentProductionId()
    const newId     = crypto.randomUUID()
    const sortOrder = stays.length
    const newStay = {
      id: newId, productionId: prodId, personId, personType,
      name, jobTitle, department,
      roomType: '', costPerNight: null, note: '',
      costCode: '', poNumber: '', tmoNumber: '',
      sortOrder, createdAt: new Date().toISOString(),
    }
    setStays(ss => [...ss, newStay])
    const { error: err } = await supabase.from('accom_stays').insert({
      id: newId, production_id: prodId,
      person_id: personId, person_type: personType,
      name, job_title: jobTitle, department,
      sort_order: sortOrder,
    })
    if (err) { console.error('[accommodation store] addStay:', err); loadAll() }
    return newId
  }

  async function updateStay(id, field, value) {
    const colMap = {
      name: 'name', jobTitle: 'job_title', department: 'department',
      roomType: 'room_type', costPerNight: 'cost_per_night', note: 'note',
      costCode: 'cost_code', poNumber: 'po_number', tmoNumber: 'tmo_number',
      personId: 'person_id', personType: 'person_type',
    }
    setStays(ss => ss.map(s => s.id === id ? { ...s, [field]: value } : s))
    const { error: err } = await supabase.from('accom_stays')
      .update({ [colMap[field] ?? field]: value }).eq('id', id)
    if (err) { console.error('[accommodation store] updateStay:', err); loadAll() }
  }

  async function deleteStay(id) {
    setStays(ss => ss.filter(s => s.id !== id))
    setNights(ns => ns.filter(n => n.stayId !== id))
    const { error: err } = await supabase.from('accom_stays').delete().eq('id', id)
    if (err) { console.error('[accommodation store] deleteStay:', err); loadAll() }
  }

  // value: a hotelId string, 'TBC', or null (clear)
  async function setNight(stayId, date, value) {
    const prodId = getCurrentProductionId()

    // Optimistic update
    setNights(ns => {
      const rest = ns.filter(n => !(n.stayId === stayId && n.date === date))
      if (value === null) return rest
      if (value === 'TBC') return [...rest, { id: crypto.randomUUID(), stayId, date, hotelId: null, tbc: true }]
      return [...rest, { id: crypto.randomUUID(), stayId, date, hotelId: value, tbc: false }]
    })

    if (value === null) {
      await supabase.from('accom_nights')
        .delete()
        .eq('stay_id', stayId)
        .eq('date', date)
    } else {
      await supabase.from('accom_nights').upsert({
        production_id: prodId,
        stay_id:  stayId,
        date,
        hotel_id: value === 'TBC' ? null : value,
        tbc:      value === 'TBC',
      }, { onConflict: 'stay_id,date' })
    }
  }

  // ── Travel times ──────────────────────────────────────────────────────────────

  async function setTravelTime(hotelId, location, value) {
    const prodId = getCurrentProductionId()
    const key    = `${hotelId}|${location}`
    setTravelTimesData(prev => ({ ...prev, [key]: value }))

    if (!value.trim()) {
      await supabase.from('hotel_travel_times')
        .delete()
        .eq('production_id', prodId)
        .eq('hotel_id', hotelId)
        .eq('location_name', location)
    } else {
      await supabase.from('hotel_travel_times').upsert({
        production_id: prodId,
        hotel_id:      hotelId,
        location_name: location,
        travel_time:   value,
      }, { onConflict: 'production_id,hotel_id,location_name' })
    }
  }

  return {
    hotels, assignments, stays, nights, travelTimes, loading, error,
    addHotel, updateHotel, deleteHotel,
    setAssignment, setTravelTime,
    moveHotelAssignments,
    addStay, updateStay, deleteStay, setNight,
  }
}
