import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'
import { syncFulltimeBookings } from '../lib/fulltimeBookingSync'

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
    personId:      row.person_id       ?? null,
    costCode:      row.cost_code        ?? '',
    crewClass:     row.crew_class      ?? 'additional',
    level:         row.level           ?? 5,
    isHod:         row.is_hod          ?? false,
    agent:          row.agent             ?? '',
    taxStatus:      row.tax_status        ?? '',
    boxPw:          row.box_pw            ?? '',
    carAllowance:   row.car_allowance     ?? '',
    otRate:         row.ot_rate           ?? null,
    sixthDayRate:   row.sixth_day_rate    ?? null,
    seventhDayRate: row.seventh_day_rate  ?? null,
    dealMemoEmailed: row.deal_memo_emailed ?? '',
    dealMemoDrafted: row.deal_memo_drafted ?? '',
    dealMemoSent:    row.deal_memo_sent    ?? '',
  }
}

function mapBooking(row) {
  return {
    id:         row.id,
    resourceId: row.resource_id,
    date:       row.booking_date,
    dayId:      row.day_id ?? null,
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

      // Bookings can easily exceed Supabase's 1,000-row per-request cap
      // (fulltime crew × ~170 weekdays), so fetch in pages until exhausted.
      const bks = []
      if (ids.length) {
        const PAGE = 1000
        for (let from = 0; ; from += PAGE) {
          const { data, error: bkErr } = await supabase
            .from('resource_bookings')
            .select('*')
            .in('resource_id', ids)
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1)
          if (bkErr) throw bkErr
          bks.push(...(data ?? []))
          if (!data || data.length < PAGE) break
        }
      }

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

  // ── Realtime handlers ────────────────────────────────────────────────────────

  // Debounce full reloads (resources change rarely; bursts collapse to one).
  const debounceRef = { current: null }
  function debouncedLoadAll() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { debounceRef.current = null; loadAll() }, 400)
  }

  // Apply a single resource_bookings change to state. Optimistic writes use
  // client-generated ids, so our own events reconcile by id with no visual
  // change; other users' edits stream in row by row.
  function applyBookingEvent(payload) {
    const { eventType } = payload
    if (eventType === 'DELETE') {
      const oldId = payload.old?.id
      if (oldId) setBookings(bs => bs.filter(b => b.id !== oldId))
      return
    }
    const row = payload.new
    if (!row?.id) return
    const mapped = mapBooking(row)
    setBookings(bs => {
      const idx = bs.findIndex(b => b.id === mapped.id)
      if (idx === -1) return [...bs, mapped]
      const next = [...bs]
      next[idx] = mapped
      return next
    })
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
      // Resources change rarely — a debounced full reload is fine.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' }, debouncedLoadAll)
      // Bookings change in bursts while painting — apply each event
      // incrementally instead of re-fetching thousands of rows (which also
      // stomped optimistic paints and made cells flash).
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resource_bookings' }, applyBookingEvent)
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

  function addResource(type = 'crew', options = {}) {
    const prodId    = getCurrentProductionId()
    const newId     = crypto.randomUUID()
    const sortOrder = resources.length
    const crewClass = options.crewClass ?? 'additional'
    const newRes = {
      id: newId, type,
      name: type === 'crew' ? 'New Person' : 'New Item',
      department: '', role: '', category: '', notes: '', sortOrder,
      costAmount: '', costType: 'daily', weekType: '5day',
      contactEmail: '', contactPhone: '', isVendorCrew: false,
      vendor: '', poNumber: '', hireStartDate: '', hireEndDate: '',
      crewClass, level: 5, isHod: false,
      agent: '', taxStatus: '', boxPw: '', carAllowance: '',
      otRate: null, sixthDayRate: null, seventhDayRate: null,
      dealMemoEmailed: '', dealMemoDrafted: '', dealMemoSent: '',
    }
    optR(rs => [...rs, newRes])
    dbWrite(
      supabase.from('resources').insert({
        id: newId, production_id: prodId,
        type, name: newRes.name, sort_order: sortOrder,
        crew_class: crewClass,
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
    personId:      'person_id',
    costCode:      'cost_code',
    crewClass:     'crew_class',
    level:         'level',
    isHod:         'is_hod',
    agent:           'agent',
    taxStatus:       'tax_status',
    boxPw:           'box_pw',
    carAllowance:    'car_allowance',
    otRate:          'ot_rate',
    sixthDayRate:    'sixth_day_rate',
    seventhDayRate:  'seventh_day_rate',
    dealMemoEmailed: 'deal_memo_emailed',
    dealMemoDrafted: 'deal_memo_drafted',
    dealMemoSent:    'deal_memo_sent',
  }

  // Numeric columns where an empty input must be written as NULL
  const NUMERIC_NULL_FIELDS = new Set([
    'boxPw', 'carAllowance', 'otRate', 'sixthDayRate', 'seventhDayRate',
  ])

  function updateResource(id, field, value) {
    const prev = resources.find(r => r.id === id)
    optR(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r))
    const col = FIELD_MAP[field] ?? field
    const dbValue = (field === 'hireStartDate' || field === 'hireEndDate' || field === 'personId')
      ? (value || null)
      : NUMERIC_NULL_FIELDS.has(field)
        ? (value === '' || value === undefined ? null : value)
        : value
    const write = dbWrite(supabase.from('resources').update({ [col]: dbValue }).eq('id', id))

    // Fulltime weekday auto-booking sync: when a fulltime crew member's hire
    // dates change, fill weekdays in range and clear bookings outside it.
    if (
      (field === 'hireStartDate' || field === 'hireEndDate') &&
      prev && prev.type === 'crew' && prev.crewClass === 'fulltime'
    ) {
      const start = field === 'hireStartDate' ? (value || null) : (prev.hireStartDate || null)
      const end   = field === 'hireEndDate'   ? (value || null) : (prev.hireEndDate   || null)
      const existing = bookings
        .filter(b => b.resourceId === id)
        .map(b => ({ id: b.id, date: b.date }))
      write.then(() => syncFulltimeBookings(supabase, id, start, end, existing))
      // realtime subscription on resource_bookings refreshes the store
    }
  }

  // ── Bulk import (CSV / crew tracker Excel) ─────────────────────────────────
  // rows: array of plain objects already mapped to camelCase resource fields.
  // Rows may optionally carry the full crew-detail field set (agent, taxStatus,
  // boxPw, carAllowance, rate overrides, deal memo statuses, hire dates) — those
  // columns are only written when present on the row, so existing CSV call
  // sites are unaffected.
  // Returns the inserted resources (mapped, with their generated ids), or []
  // on failure.

  async function importResources(type, rows, options = {}) {
    const prodId    = getCurrentProductionId()
    const sortStart = resources.filter(r => r.type === type).length
    const crewClass = options.crewClass ?? 'additional'

    // '' / undefined → NULL for numeric columns
    const numOrNull = v => (v === '' || v === undefined || v === null ? null : v)

    const inserts = rows.map((row, i) => {
      const rec = {
        id:            crypto.randomUUID(),
        production_id: prodId,
        type,
        crew_class:    crewClass,
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
      }
      // Extended crew-detail fields — only written when the row provides them
      if (row.agent           !== undefined) rec.agent             = row.agent || ''
      if (row.taxStatus       !== undefined) rec.tax_status        = row.taxStatus || ''
      if (row.boxPw           !== undefined) rec.box_pw            = numOrNull(row.boxPw)
      if (row.carAllowance    !== undefined) rec.car_allowance     = numOrNull(row.carAllowance)
      if (row.otRate          !== undefined) rec.ot_rate           = numOrNull(row.otRate)
      if (row.sixthDayRate    !== undefined) rec.sixth_day_rate    = numOrNull(row.sixthDayRate)
      if (row.seventhDayRate  !== undefined) rec.seventh_day_rate  = numOrNull(row.seventhDayRate)
      if (row.dealMemoEmailed !== undefined) rec.deal_memo_emailed = row.dealMemoEmailed || ''
      if (row.dealMemoDrafted !== undefined) rec.deal_memo_drafted = row.dealMemoDrafted || ''
      if (row.dealMemoSent    !== undefined) rec.deal_memo_sent    = row.dealMemoSent || ''
      if (row.hireStartDate   !== undefined) rec.hire_start_date   = row.hireStartDate || null
      if (row.hireEndDate     !== undefined) rec.hire_end_date     = row.hireEndDate || null
      if (row.level           !== undefined) rec.level             = row.level ?? 5
      return rec
    })

    const mapped = inserts.map(r => mapResource(r))

    // Optimistic update
    optR(rs => [...rs, ...mapped])

    const { error: err } = await supabase.from('resources').insert(inserts)
    if (err) {
      console.error('[crew store] importResources:', err)
      loadAll()
      return []
    }
    return mapped
  }

  // ── Bookings ───────────────────────────────────────────────────────────────

  const CYCLE = ['booked', 'hold', 'unavailable', 'cancelled', 'to_reconfirm']

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

  // skipConflicts: when true, skip the "one person per unit" conflict cleanup.
  // Used by the backpage sync so main (✗) and sub (✓) can coexist simultaneously.
  function setBooking(resourceId, dateStr, status, dayId = null, skipConflicts = false) {
    // Sub-unit bookings keyed by dayId; main bookings by (resourceId, date, no dayId)
    const existing = dayId
      ? bookings.find(b => b.resourceId === resourceId && b.dayId === dayId)
      : bookings.find(b => b.resourceId === resourceId && b.date === dateStr && !b.dayId)

    // One person can only be in one place at a time — when setting a booking,
    // clear any conflicting bookings on the same date for a different unit.
    // (Skip this when backpage is syncing both columns deliberately.)
    if (status !== null && !skipConflicts) {
      const conflicts = bookings.filter(b =>
        b.resourceId === resourceId &&
        b.date === dateStr &&
        b.id !== existing?.id &&
        (dayId === null ? b.dayId !== null : b.dayId !== dayId)
      )
      if (conflicts.length) {
        optB(bs => bs.filter(b => !conflicts.some(c => c.id === b.id)))
        conflicts.forEach(c => {
          supabase.from('resource_bookings').delete().eq('id', c.id)
            .then(({ error: err }) => { if (err) loadAll() })
        })
      }
    }

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
      optB(bs => [...bs, { id: newId, resourceId, date: dateStr, dayId, status }])
      supabase.from('resource_bookings').insert({
        id: newId, resource_id: resourceId, booking_date: dateStr,
        day_id: dayId ?? null, status,
      }).then(({ error: err }) => { if (err) loadAll() })
    }
  }

  // ── Move bookings (schedule date move) ───────────────────────────────────
  // dateMoves: [{ oldDate, newDate, oldDayId?, newDayId? }]
  // Returns undoPayload: [{ bookingId, oldDate, oldDayId, oldStatus }]

  async function moveBookings(dateMoves) {
    const undoPayload = []

    for (const { oldDate, newDate, oldDayId, newDayId } of dateMoves) {
      // Find all bookings on the old date matching the unit type
      const affected = bookings.filter(b => {
        if (oldDayId) return b.dayId === oldDayId
        return b.date === oldDate && !b.dayId
      })

      for (const booking of affected) {
        const resource = resources.find(r => r.id === booking.resourceId)
        // Determine new status: keep as-is if new date falls within hire range
        let newStatus = 'to_reconfirm'
        if (resource && resource.hireStartDate && resource.hireEndDate) {
          if (newDate >= resource.hireStartDate && newDate <= resource.hireEndDate) {
            newStatus = booking.status
          }
        }

        undoPayload.push({
          bookingId: booking.id,
          oldDate:   booking.date,
          oldDayId:  booking.dayId,
          oldStatus: booking.status,
        })

        // Optimistic update
        optB(bs => bs.map(b =>
          b.id === booking.id
            ? { ...b, date: newDate, dayId: newDayId ?? b.dayId, status: newStatus }
            : b
        ))

        // DB write
        const patch = {
          booking_date: newDate,
          status: newStatus,
        }
        if (newDayId !== undefined) patch.day_id = newDayId ?? null
        supabase.from('resource_bookings').update(patch).eq('id', booking.id)
          .then(({ error: err }) => { if (err) { console.error('[crew store] moveBookings:', err); loadAll() } })
      }
    }

    return undoPayload
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
    moveBookings,
    moveResourceUp, moveResourceDown,
  }
}
