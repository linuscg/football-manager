import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

let _productionId = null

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapResource(row) {
  return {
    id:           row.id,
    type:         row.type          ?? 'crew',
    name:         row.name          ?? '',
    department:   row.department    ?? '',
    role:         row.role          ?? '',
    category:     row.category      ?? '',
    notes:        row.notes         ?? '',
    sortOrder:    row.sort_order    ?? 0,
    // Cost
    costAmount:   row.cost_amount   ?? '',
    costType:     row.cost_type     ?? 'daily',
    weekType:     row.week_type     ?? '5day',
    // Crew-specific
    contactEmail: row.contact_email ?? '',
    contactPhone: row.contact_phone ?? '',
    // Equipment-specific
    vendor:       row.vendor        ?? '',
  }
}

function mapBooking(row) {
  return {
    id:         row.id,
    resourceId: row.resource_id,
    date:       row.booking_date,   // date string YYYY-MM-DD
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
    try {
      if (!_productionId) {
        const { data: prods, error: prodErr } = await supabase
          .from('production').select('id').limit(1)
        if (prodErr) throw prodErr
        if (!prods?.length) throw new Error('No production row found')
        _productionId = prods[0].id
      }

      const { data: recs, error: recErr } = await supabase
        .from('resources').select('*')
        .eq('production_id', _productionId)
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
    const channel = supabase
      .channel('crew_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' },         loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resource_bookings' }, loadAll)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function optR(fn) { setResources(rs => fn(rs)) }
  function optB(fn) { setBookings(bs => fn(bs)) }
  async function dbWrite(promise) {
    const { error: err } = await promise
    if (err) { console.error('[crew store] write:', err); loadAll() }
  }

  // ── Resources ──────────────────────────────────────────────────────────────

  function addResource(type = 'crew') {
    const newId     = crypto.randomUUID()
    const sortOrder = resources.length
    const newRes = {
      id: newId, type,
      name:       type === 'crew' ? 'New Person' : 'New Item',
      department: '', role: '', category: '', notes: '', sortOrder,
    }
    optR(rs => [...rs, newRes])
    dbWrite(
      supabase.from('resources').insert({
        id: newId, production_id: _productionId,
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
    name: 'name', department: 'department',
    role: 'role', category: 'category', notes: 'notes',
    costAmount:   'cost_amount',
    costType:     'cost_type',
    weekType:     'week_type',
    contactEmail: 'contact_email',
    contactPhone: 'contact_phone',
    vendor:       'vendor',
  }

  function updateResource(id, field, value) {
    optR(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r))
    const col = FIELD_MAP[field] ?? field
    dbWrite(supabase.from('resources').update({ [col]: value }).eq('id', id))
  }

  // ── Bookings (keyed by date string, not day_id) ────────────────────────────

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

  // ── Direct-set booking (used by drag-paint; status=null clears) ───────────
  //
  // Unlike toggleBooking (which cycles), this sets an exact status or removes
  // the booking entirely. Uses fire-and-forget DB writes for drag performance.

  function setBooking(resourceId, dateStr, status) {
    const existing = bookings.find(b => b.resourceId === resourceId && b.date === dateStr)

    if (status === null) {
      // Clear
      if (!existing) return
      optB(bs => bs.filter(b => b.id !== existing.id))
      supabase.from('resource_bookings').delete().eq('id', existing.id)
        .then(({ error: err }) => { if (err) loadAll() })
    } else if (existing) {
      if (existing.status === status) return // no-op
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
    toggleBooking, setBooking,
    moveResourceUp, moveResourceDown,
  }
}
