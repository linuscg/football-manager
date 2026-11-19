import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

export const TRANSPORT_TYPES = ['Cab', 'Courier', 'Unit Driver', 'Airport Transfer', 'Man & Van', 'Minibus', 'Car Hire', 'Truck Hire']

const mapLog = r => ({
  id: r.id, type: r.type ?? 'Cab', date: r.date ?? '', time: r.time ?? '',
  description: r.description ?? '', fromLocation: r.from_location ?? '',
  toLocation: r.to_location ?? '', driver: r.driver ?? '', supplier: r.supplier ?? '',
  po: r.po ?? '', cost: r.cost, notes: r.notes ?? '', sortOrder: r.sort_order ?? 0,
})
const LOG_COLS = {
  type: 'type', date: 'date', time: 'time', description: 'description',
  fromLocation: 'from_location', toLocation: 'to_location', driver: 'driver',
  supplier: 'supplier', po: 'po', cost: 'cost', notes: 'notes', sortOrder: 'sort_order',
}
const mapDriver = r => ({
  id: r.id, name: r.name ?? '', phone: r.phone ?? '', vehicleReg: r.vehicle_reg ?? '',
  company: r.company ?? '', notes: r.notes ?? '', sortOrder: r.sort_order ?? 0,
})
const DRIVER_COLS = { name: 'name', phone: 'phone', vehicleReg: 'vehicle_reg', company: 'company', notes: 'notes' }
const mapSheetRow = r => ({
  id: r.id, date: r.date, section: r.section ?? 'pickups', time: r.time ?? '',
  description: r.description ?? '', fromLocation: r.from_location ?? '',
  toLocation: r.to_location ?? '', driverContact: r.driver_contact ?? '',
  sortOrder: r.sort_order ?? 0, logId: r.log_id ?? null,
})
const SHEET_COLS = {
  date: 'date', section: 'section', time: 'time', description: 'description',
  fromLocation: 'from_location', toLocation: 'to_location',
  driverContact: 'driver_contact', sortOrder: 'sort_order', logId: 'log_id',
}
// Log fields that flow through to a linked transport-sheet row
const LOG_TO_SHEET = {
  time: 'time', description: 'description',
  fromLocation: 'fromLocation', toLocation: 'toLocation', driver: 'driverContact',
}

export function useTransportStore() {
  const [log,       setLog]       = useState([])
  const [drivers,   setDrivers]   = useState([])
  const [locations, setLocations] = useState([])
  const [sheetRows, setSheetRows] = useState([])
  const [loading,   setLoading]   = useState(true)
  const loadGenRef = useRef(0)

  async function pagedSelect(table) {
    const prodId = getCurrentProductionId()
    const rows = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(table).select('*')
        .eq('production_id', prodId).order('id').range(from, from + PAGE - 1)
      if (error) { console.error(`[transport] load ${table}:`, error); return rows }
      rows.push(...(data ?? []))
      if (!data || data.length < PAGE) break
    }
    return rows
  }

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return
    const gen = ++loadGenRef.current
    const [l, d, loc, sh] = await Promise.all([
      pagedSelect('transport_log'), pagedSelect('transport_drivers'),
      pagedSelect('transport_locations'), pagedSelect('transport_sheet_rows'),
    ])
    if (gen !== loadGenRef.current) return
    setLog(l.map(mapLog).sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.sortOrder - b.sortOrder))
    setDrivers(d.map(mapDriver).sort((a, b) => a.name.localeCompare(b.name)))
    setLocations(loc.map(r => ({ id: r.id, name: r.name ?? '', notes: r.notes ?? '' })).sort((a, b) => a.name.localeCompare(b.name)))
    setSheetRows(sh.map(mapSheetRow).sort((a, b) => a.sortOrder - b.sortOrder))
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => { setLoading(true); setLog([]); setDrivers([]); setLocations([]); setSheetRows([]); loadAll() })
    const channel = supabase
      .channel(`transport_changes_${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transport_log' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transport_drivers' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transport_locations' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transport_sheet_rows' }, loadAll)
      .subscribe()
    return () => { unsub(); supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function dbWrite(promise) {
    const { error } = await promise
    if (error) { console.error('[transport] write:', error); loadAll() }
  }

  // ── Log ────────────────────────────────────────────────────────────────────
  function addLogRow(initial = {}) {
    const id = crypto.randomUUID()
    const row = {
      id, type: 'Cab', date: new Date().toISOString().slice(0, 10), time: '',
      description: '', fromLocation: '', toLocation: '', driver: '', supplier: '',
      po: '', cost: null, notes: '', sortOrder: Date.now(), ...initial,
    }
    setLog(ls => [...ls, row])
    dbWrite(supabase.from('transport_log').insert({
      id, production_id: getCurrentProductionId(),
      type: row.type, date: row.date || null, time: row.time, description: row.description,
      from_location: row.fromLocation, to_location: row.toLocation, driver: row.driver,
      supplier: row.supplier, po: row.po, cost: row.cost, notes: row.notes ?? '', sort_order: row.sortOrder,
    }))
    return id
  }
  function copyLogRow(srcId) {
    const src = log.find(r => r.id === srcId)
    if (!src) return
    return addLogRow({ ...src, id: undefined, sortOrder: Date.now() })
  }
  function updateLogRow(id, field, value) {
    setLog(ls => ls.map(r => r.id === id ? { ...r, [field]: value } : r))
    const col = LOG_COLS[field] ?? field
    const dbVal = field === 'date' ? (value || null)
                : field === 'cost' ? (value === '' || value == null ? null : value)
                : value
    dbWrite(supabase.from('transport_log').update({ [col]: dbVal }).eq('id', id))
    // Flow the change through to the linked transport-sheet row
    const sheetField = LOG_TO_SHEET[field]
    if (sheetField) {
      const sv = field === 'driver' ? expandDriverContact(value) : value
      setSheetRows(rs => rs.map(r => r.logId === id ? { ...r, [sheetField]: sv } : r))
      dbWrite(supabase.from('transport_sheet_rows').update({ [SHEET_COLS[sheetField]]: sv }).eq('log_id', id))
    } else if (field === 'date') {
      setSheetRows(rs => rs.map(r => r.logId === id ? { ...r, date: value } : r))
      dbWrite(supabase.from('transport_sheet_rows').update({ date: value || null }).eq('log_id', id))
    }
  }
  function deleteLogRow(id) {
    setLog(ls => ls.filter(r => r.id !== id))
    setSheetRows(rs => rs.filter(r => r.logId !== id))
    dbWrite(supabase.from('transport_sheet_rows').delete().eq('log_id', id))
    dbWrite(supabase.from('transport_log').delete().eq('id', id))
  }

  // ── Drivers ────────────────────────────────────────────────────────────────
  function addDriver(initial = {}) {
    const id = crypto.randomUUID()
    const row = { id, name: '', phone: '', vehicleReg: '', company: '', notes: '', sortOrder: Date.now(), ...initial }
    setDrivers(ds => [...ds, row])
    dbWrite(supabase.from('transport_drivers').insert({
      id, production_id: getCurrentProductionId(),
      name: row.name, phone: row.phone, vehicle_reg: row.vehicleReg,
      company: row.company, notes: row.notes, sort_order: row.sortOrder,
    }))
    return id
  }
  function updateDriver(id, field, value) {
    setDrivers(ds => ds.map(r => r.id === id ? { ...r, [field]: value } : r))
    dbWrite(supabase.from('transport_drivers').update({ [DRIVER_COLS[field] ?? field]: value }).eq('id', id))
  }
  function deleteDriver(id) {
    setDrivers(ds => ds.filter(r => r.id !== id))
    dbWrite(supabase.from('transport_drivers').delete().eq('id', id))
  }
  // "Name" → "Name\nPhone\nReg" when the driver is in the database
  function expandDriverContact(value) {
    const d = drivers.find(x => x.name.trim().toLowerCase() === String(value ?? '').trim().toLowerCase())
    if (!d) return value ?? ''
    return [d.name, d.phone, d.vehicleReg].filter(Boolean).join('\n')
  }
  // Remember a driver typed into the log / sheet (dedup case-insensitive)
  function rememberDriver(name) {
    const n = String(name ?? '').trim()
    if (!n) return
    if (drivers.some(d => d.name.trim().toLowerCase() === n.toLowerCase())) return
    addDriver({ name: n })
  }

  // ── Locations ──────────────────────────────────────────────────────────────
  function addLocation(name, notes = '') {
    const id = crypto.randomUUID()
    setLocations(ls => [...ls, { id, name, notes }])
    dbWrite(supabase.from('transport_locations').insert({
      id, production_id: getCurrentProductionId(), name, notes,
    }))
    return id
  }
  function updateLocation(id, field, value) {
    setLocations(ls => ls.map(r => r.id === id ? { ...r, [field]: value } : r))
    dbWrite(supabase.from('transport_locations').update({ [field]: value }).eq('id', id))
  }
  function deleteLocation(id) {
    setLocations(ls => ls.filter(r => r.id !== id))
    dbWrite(supabase.from('transport_locations').delete().eq('id', id))
  }
  function rememberLocation(name) {
    const n = String(name ?? '').trim()
    if (!n || n.toUpperCase() === 'MOW') return
    if (locations.some(l => l.name.trim().toLowerCase() === n.toLowerCase())) return
    addLocation(n)
  }

  // ── Transport sheet rows ───────────────────────────────────────────────────
  function addSheetRow(date, section, initial = {}) {
    const id = crypto.randomUUID()
    const row = {
      id, date, section, time: '', description: '', fromLocation: '',
      toLocation: '', driverContact: '', sortOrder: Date.now(), logId: null, ...initial,
    }
    setSheetRows(rs => [...rs, row])
    dbWrite(supabase.from('transport_sheet_rows').insert({
      id, production_id: getCurrentProductionId(), date, section: row.section,
      time: row.time, description: row.description, from_location: row.fromLocation,
      to_location: row.toLocation, driver_contact: row.driverContact, sort_order: row.sortOrder,
      log_id: row.logId,
    }))
    return id
  }
  function updateSheetRow(id, field, value) {
    setSheetRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r))
    dbWrite(supabase.from('transport_sheet_rows').update({ [SHEET_COLS[field] ?? field]: value }).eq('id', id))
  }
  function deleteSheetRow(id) {
    setSheetRows(rs => rs.filter(r => r.id !== id))
    dbWrite(supabase.from('transport_sheet_rows').delete().eq('id', id))
  }

  return {
    log, drivers, locations, sheetRows, loading,
    addLogRow, copyLogRow, updateLogRow, deleteLogRow,
    addDriver, updateDriver, deleteDriver, rememberDriver, expandDriverContact,
    addLocation, updateLocation, deleteLocation, rememberLocation,
    addSheetRow, updateSheetRow, deleteSheetRow,
  }
}
