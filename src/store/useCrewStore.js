import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapResource(row) {
  return {
    id:            row.id,
    type:          row.type            ?? 'crew',
    name:          row.name            ?? '',
    department:    row.department      ?? '',
    role:          row.role            ?? '',
    category:      row.category        ?? '',
    notes:         row.notes           ?? '',
    sortOrder:     row.sort_order      ?? 0,
    costAmount:    row.cost_amount     ?? '',
    costType:      row.cost_type       ?? 'daily',
    weekType:      row.week_type       ?? '5day',
    contactEmail:  row.contact_email   ?? '',
    contactPhone:  row.contact_phone   ?? '',
    isVendorCrew:  row.is_vendor_crew  ?? false,
    vendor:        row.vendor          ?? '',
    poNumber:      row.po_number       ?? '',
    hireStartDate: row.hire_start_date ?? '',
    hireEndDate:   row.hire_end_date   ?? '',
  }
}

function mapBooking(row) {
  return {
    id:         row.id,
    resourceId: row.resource_id,
    date:       row.booking_date,
    status:     row.status ?? 'booked',
  }
}

// ─── Store hook ───────────────────────────────────────────────────────────────

export function useCrewStore() {
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [resources, setResources] = useState([])
  const [bookings,  setBookings]  = useState([])

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return   // wait for production context to be set

    try {
      const { data: recs, error: recErr } = await supabase
        .from('resources').select('*')
        .eq('production_id', prodId)
        .order('sort_order', { ascending: true })
      if (recErr) throw recErr

      const ids = (recs ?? []).map(r => r.id)
      const { data: bks, error: bkErr } = ids.length
        ? await supabase.from('resource_bookings').select('*').in('resource_id', ids)
        : { data: [], error: null }
      if (bkErr) throw bkErr

      setResources((recs ?? []).map(mapResource))
      setBookings((bks ?? []).map(mapBooking))
      setError(null)
    } catch (err) {
      console.error('[crew store] loadAll:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => {
      setLoading(true)
      setResources([])
      setBookings([])
      loadAll()
    })
    const channel = supabase
      .channel('crew_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' },         loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resource_bookings' }, loadAll)
      .subscribe()
    return () => {
      unsub()
      supabase.removeChannel(channel)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function optR(fn) { setResources(rs => fn(rs)) }
  function optB(fn) { setBookings(bs => fn(bs)) }
  async function dbWrite(promise) {
    const { error: err } = await promise
    if (err) { console.error('[crew store] write:', err); loadAll() }
  }

  // ── Resources ──────────────────────────────────────────────────────────────

  function addResource(type = 'crew') {
    const prodId    = getCurrentProductionId()
    const newId     = crypto.randomUUID()
    const sortOrder = resources.length
    const newRes = {
      id: newId, type,
      name: type === 'crew' ? 'New Person' : 'New Item',
      department: '', role: '', category: '', notes: '', sortOrder,
      costAmount: '', costType: 'daily', weekType: '5day',
      contactEmail: '', contactPhone: '', isVendorCrew: false,
      vendor: '', poNumber: '', hireStartDate: '', hireEndDate: '',
    }
    optR(rs => [...rs, newRes])
    dbWrite(
      supabase.from('resources').insert({
        id: newId, production_id: prodId,
        type, name: newRes.name, sort_order: sortOrder,
      })
    )
    return newId
  }

  function deleteResource(id) {
    optR(rs => rs.filter(r => r.id !== id))
    optB(bs => bs.filter(b => b.resourceId !== id))
    dbWrite(supabase.from('resources').delete().eq('id', id))
  }

  const FIELD_MAP = {
    name:          'name',
    department:    'department',
    role:          'role',
    category:      'category',
    notes:         'notes',
    costAmount:    'cost_amount',
    costType:      'cost_type',
    weekType:      'week_type',
    contactEmail:  'contact_email',
    contactPhone:  'contact_phone',
    isVendorCrew:  'is_vendor_crew',
    vendor:        'vendor',
    poNumber:      'po_number',
    hireStartDate: 'hire_start_date',
    hireEndDate:   'hire_end_date',
  }

  function updateResource(id, field, value) {
    optR(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r))
    const col = FIELD_MAP[field] ?? field
    const dbValue = (field === 'hireStartDate' || field === 'hireEndDate')
      ? (value || null)
      : value
    dbWrite(supabase.from('resources').update({ [col]: dbValue }).eq('id', id))
  }

  // ── Bulk import (CSV) ──────────────────────────────────────────────────────
  // rows: array of plain objects already mapped to camelCase resource fields.
  // Returns the number of resources actually created.

  async function importResources(type, rows) {
    const prodId    = getCurrentProductionId()
    const sortStart = resources.filter(r => r.type === type).length

    const inserts = rows.map((row, i) => ({
      id:            crypto.randomUUID(),
      production_id: prodId,
      type,
      sort_order:    sortStart + i,
      name:          row.name          || '',
      role:          row.role          || '',
      department:    row.department    || '',
      category:      row.category      || '',
      contact_email: row.contactEmail  || '',
      contact_phone: row.contactPhone  || '',
      is_vendor_crew: Boolean(row.isVendorCrew),
      vendor:        row.vendor        || '',
      po_number:     row.poNumber      || '',
      cost_amount:   row.costAmount    || null,
      cost_type:     row.costType      || 'daily',
      week_type:     row.weekType      || '5day',
      notes:         row.notes         || '',
    }))

    // Optimistic update
    optR(rs => [...rs, ...inserts.map(r => mapResource({ ...r, sort_order: r.sort_order }))])

    const { error: err } = await supabase.from('resources').insert(inserts)
    if (err) {
      console.error('[crew store] importResources:', err)
      loadAll()
      return 0
    }
    return inserts.length
  }

  // ── Bookings ───────────────────────────────────────────────────────────────

  const CYCLE = ['booked', 'hold', 'unavailable', 'cancelled']

  async function toggleBooking(resourceId, dateStr) {
    const existing = bookings.find(b => b.resourceId === resourceId && b.date === dateStr)

    if (!existing) {
      const newId = crypto.randomUUID()
      optB(bs => [...bs, { id: newId, resourceId, date: dateStr, status: 'booked' }])
      const { error: err } = await supabase.from('resource_bookings').insert({
        id: newId, resource_id: resourceId, booking_date: dateStr, status: 'booked',
      })
      if (err) { console.error('[crew store] booking insert:', err); loadAll() }
    } else {
      const idx = CYCLE.indexOf(existing.status)
      if (idx === CYCLE.length - 1) {
        optB(bs => bs.filter(b => b.id !== existing.id))
        const { error: err } = await supabase.from('resource_bookings').delete().eq('id', existing.id)
        if (err) { console.error('[crew store] booking delete:', err); loadAll() }
      } else {
        const next = CYCLE[idx + 1]
        optB(bs => bs.map(b => b.id === existing.id ? { ...b, status: next } : b))
        const { error: err } = await supabase.from('resource_bookings').update({ status: next }).eq('id', existing.id)
        if (err) { console.error('[crew store] booking update:', err); loadAll() }
      }
    }
  }

  function setBooking(resourceId, dateStr, status) {
    const existing = bookings.find(b => b.resourceId === resourceId && b.date === dateStr)

    if (status === null) {
      if (!existing) return
      optB(bs => bs.filter(b => b.id !== existing.id))
      supabase.from('resource_bookings').delete().eq('id', existing.id)
        .then(({ error: err }) => { if (err) loadAll() })
    } else if (existing) {
      if (existing.status === status) return
      optB(bs => bs.map(b => b.id === existing.id ? { ...b, status } : b))
      supabase.from('resource_bookings').update({ status }).eq('id', existing.id)
        .then(({ error: err }) => { if (err) loadAll() })
    } else {
      const newId = crypto.randomUUID()
      optB(bs => [...bs, { id: newId, resourceId, date: dateStr, status }])
      supabase.from('resource_bookings').insert({
        id: newId, resource_id: resourceId, booking_date: dateStr, status,
      }).then(({ error: err }) => { if (err) loadAll() })
    }
  }

  // ── Reorder ────────────────────────────────────────────────────────────────

  async function _reorder(list) {
    const updated = list.map((r, i) => ({ ...r, sortOrder: i }))
    optR(() => updated)
    await Promise.all(
      updated.map(r =>
        supabase.from('resources').update({ sort_order: r.sortOrder }).eq('id', r.id)
      )
    )
  }

  function moveResourceUp(id) {
    const list = [...resources]
    const idx = list.findIndex(r => r.id === id)
    if (idx <= 0) return
    ;[list[idx - 1], list[idx]] = [list[idx], list[idx - 1]]
    _reorder(list)
  }

  function moveResourceDown(id) {
    const list = [...resources]
    const idx = list.findIndex(r => r.id === id)
    if (idx < 0 || idx >= list.length - 1) return
    ;[list[idx], list[idx + 1]] = [list[idx + 1], list[idx]]
    _reorder(list)
  }

  return {
    loading, error,
    resources, bookings,
    addResource, deleteResource, updateResource,
    importResources,
    toggleBooking, setBooking,
    moveResourceUp, moveResourceDown,
  }
}
