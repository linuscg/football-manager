import { useState, useMemo } from 'react'
import { useAccommodationStore } from '../store/useAccommodationStore'

// Fixed colour palette — hotels are assigned colours by index
export const HOTEL_PALETTE = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
  '#a78bfa', '#fb923c', '#34d399',
]

export function hotelColor(index) {
  return HOTEL_PALETTE[index % HOTEL_PALETTE.length]
}

const CURRENCY = '£'

function formatMoney(n) {
  return `${CURRENCY}${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`
}

function formatNightDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d)) return iso
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

// ── Blur-committing inputs (local state, commit on blur to avoid focus loss) ──

function BlurInput({ value, onCommit, className, transform, ...rest }) {
  const [local, setLocal] = useState(null) // null = not editing
  return (
    <input
      {...rest}
      className={className}
      value={local ?? value ?? ''}
      onChange={e => setLocal(transform ? transform(e.target.value) : e.target.value)}
      onBlur={() => {
        if (local !== null && local !== (value ?? '')) onCommit(local)
        setLocal(null)
      }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

function BlurTextarea({ value, onCommit, className, ...rest }) {
  const [local, setLocal] = useState(null)
  return (
    <textarea
      {...rest}
      className={className}
      value={local ?? value ?? ''}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== null && local !== (value ?? '')) onCommit(local)
        setLocal(null)
      }}
    />
  )
}

// ── Per-hotel derived stats ────────────────────────────────────────────────────

function computeHotelStats(hotel, stays, nights) {
  const hotelNights = nights.filter(n => n.hotelId === hotel.id)

  // Rooms booked per night: count of night rows per date
  const perDate = {}
  for (const n of hotelNights) {
    perDate[n.date] = (perDate[n.date] || 0) + 1
  }
  const dates = Object.keys(perDate).sort()
  const peak = dates.reduce((max, d) => Math.max(max, perDate[d]), 0)

  // Nights at this hotel per stay → spend + PO numbers
  const nightsByStay = {}
  for (const n of hotelNights) {
    nightsByStay[n.stayId] = (nightsByStay[n.stayId] || 0) + 1
  }
  let spend = 0
  const poNumbers = []
  for (const stay of stays) {
    const count = nightsByStay[stay.id]
    if (!count) continue
    spend += count * (Number(stay.costPerNight) || 0)
    const po = (stay.poNumber || '').trim()
    if (po && !poNumbers.includes(po)) poNumbers.push(po)
  }

  const allocated = hotel.roomsAllocated ?? null
  const remaining = allocated != null && allocated !== '' ? Number(allocated) - peak : null

  return { perDate, dates, peak, spend, poNumbers, allocated, remaining, isBooked: hotelNights.length > 0 }
}

// ── Inline-editable hotel row ──────────────────────────────────────────────────

function HotelRow({ hotel, index, stats, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(true)
  const [showNights, setShowNights] = useState(false)
  const color = hotelColor(index)

  // Keyboard shortcut label
  const KEYS = ['1','2','3','4','5','6','7','8','9','0','-','=']
  const keyLabel = KEYS[index] ? `[${KEYS[index]}]` : null

  const commit = field => value => onUpdate(hotel.id, field, value)

  return (
    <div className={`hotel-row${expanded ? ' hotel-row--open' : ''}`}>

      {/* ── Header ── */}
      <div className="hotel-row-header">
        <div className="hotel-color-swatch" style={{ background: color }} />

        <BlurInput
          className="hotel-name-input"
          value={hotel.name}
          placeholder="Hotel name"
          onCommit={commit('name')}
        />

        {hotel.code && <span className="hotel-code-badge">{hotel.code}</span>}

        {keyLabel && (
          <span className="hotel-key-badge">{keyLabel}</span>
        )}

        <button
          className="hotel-expand-btn"
          title={expanded ? 'Hide details' : 'Add details'}
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? '▴' : '▾'}
        </button>

        <button
          className="hotel-delete-btn"
          title="Delete hotel"
          onClick={() => onDelete(hotel.id)}
        >
          ✕
        </button>
      </div>

      {/* ── Stats strip (derived from Accommodation Log) ── */}
      {stats.isBooked && (
        <div className="hotel-stats">
          <span className="hotel-stat">
            <span className="hotel-stat-label">Booked (peak)</span>
            <span className="hotel-stat-value">{stats.peak}/night</span>
          </span>
          <span className="hotel-stat">
            <span className="hotel-stat-label">Allocated</span>
            <span className="hotel-stat-value">{stats.allocated ?? '—'}</span>
          </span>
          <span className="hotel-stat">
            <span className="hotel-stat-label">Remaining</span>
            <span className={`hotel-stat-value${stats.remaining != null && stats.remaining < 0 ? ' hotel-stat-value--negative' : ''}`}>
              {stats.remaining != null ? stats.remaining : '—'}
            </span>
          </span>
          <span className="hotel-stat">
            <span className="hotel-stat-label">Spend</span>
            <span className="hotel-stat-value">{formatMoney(stats.spend)}</span>
          </span>
          <button
            className="hotel-stats-toggle"
            onClick={() => setShowNights(v => !v)}
          >
            {showNights ? 'Hide nightly usage ▴' : 'Nightly usage ▾'}
          </button>
        </div>
      )}

      {stats.isBooked && stats.poNumbers.length > 0 && (
        <div className="hotel-po-row">
          <span className="hotel-po-label">PO numbers:</span>
          {stats.poNumbers.map(po => (
            <span key={po} className="hotel-po-chip">{po}</span>
          ))}
        </div>
      )}

      {/* ── Per-night usage breakdown ── */}
      {stats.isBooked && showNights && (
        <div className="hotel-nights-table">
          {stats.dates.map(date => (
            <div key={date} className="hotel-nights-row">
              <span className="hotel-nights-date">{formatNightDate(date)}</span>
              <span className={`hotel-nights-count${stats.allocated != null && stats.perDate[date] > Number(stats.allocated) ? ' hotel-stat-value--negative' : ''}`}>
                {stats.perDate[date]} room{stats.perDate[date] === 1 ? '' : 's'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Expanded detail fields ── */}
      {expanded && (
        <div className="hotel-details">
          <div className="hotel-details-grid">
            <div className="hotel-detail-field">
              <label className="hotel-detail-label">Code</label>
              <BlurInput
                className="hotel-detail-input hotel-detail-input--code"
                value={hotel.code}
                placeholder="e.g. RTH"
                maxLength={6}
                transform={v => v.toUpperCase()}
                onCommit={commit('code')}
              />
            </div>
            <div className="hotel-detail-field">
              <label className="hotel-detail-label">Check-in time</label>
              <BlurInput
                type="time"
                className="hotel-detail-input hotel-detail-input--time"
                value={hotel.checkinTime}
                onCommit={commit('checkinTime')}
              />
            </div>
            <div className="hotel-detail-field">
              <label className="hotel-detail-label">Check-out time</label>
              <BlurInput
                type="time"
                className="hotel-detail-input hotel-detail-input--time"
                value={hotel.checkoutTime}
                onCommit={commit('checkoutTime')}
              />
            </div>
            <div className="hotel-detail-field">
              <label className="hotel-detail-label">Rooms allocated</label>
              <BlurInput
                type="number"
                min="0"
                className="hotel-detail-input hotel-detail-input--rooms"
                value={hotel.roomsAllocated ?? ''}
                placeholder="—"
                onCommit={v => onUpdate(hotel.id, 'roomsAllocated', v === '' ? null : Number(v))}
              />
            </div>
          </div>
          <div className="hotel-detail-field">
            <label className="hotel-detail-label">Address</label>
            <BlurTextarea
              className="hotel-detail-input hotel-detail-input--area"
              value={hotel.address}
              placeholder="Full address…"
              rows={2}
              onCommit={commit('address')}
            />
          </div>
          <div className="hotel-detail-field">
            <label className="hotel-detail-label">Contact info</label>
            <BlurInput
              className="hotel-detail-input"
              value={hotel.contactInfo}
              placeholder="Phone / email / website"
              onCommit={commit('contactInfo')}
            />
          </div>
          <div className="hotel-detail-field">
            <label className="hotel-detail-label">Notes</label>
            <BlurTextarea
              className="hotel-detail-input hotel-detail-input--area"
              value={hotel.notes}
              placeholder="Any additional notes…"
              rows={2}
              onCommit={commit('notes')}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function HotelList() {
  const { hotels, stays, nights, loading, error, addHotel, updateHotel, deleteHotel } = useAccommodationStore()

  // Stats per hotel, keyed by hotel id. Index in the FULL hotels array drives
  // colour + keyboard badge so they match the Accommodation Log legend.
  const { booked, candidates, statsById } = useMemo(() => {
    const statsById = {}
    const booked = []
    const candidates = []
    hotels.forEach((hotel, index) => {
      const stats = computeHotelStats(hotel, stays, nights)
      statsById[hotel.id] = stats
      if (stats.isBooked) booked.push({ hotel, index })
      else candidates.push({ hotel, index })
    })
    return { booked, candidates, statsById }
  }, [hotels, stays, nights])

  if (loading) return <div className="ftc-state">Loading…</div>
  if (error)   return <div className="ftc-state ftc-state--error">Error: {error}</div>

  const renderRows = items => items.map(({ hotel, index }) => (
    <HotelRow
      key={hotel.id}
      hotel={hotel}
      index={index}
      stats={statsById[hotel.id]}
      onUpdate={updateHotel}
      onDelete={deleteHotel}
    />
  ))

  return (
    <div className="hotel-list-wrap">

      <div className="hotel-list-header">
        <div>
          <h2 className="hotel-list-title">Hotel List</h2>
          <p className="hotel-list-sub">
            Add hotels to this production. They'll be available to assign in the Accommodation Log.
          </p>
        </div>
        <button className="pm-btn pm-btn--primary pm-btn--sm" onClick={addHotel}>
          + Add Hotel
        </button>
      </div>

      {hotels.length === 0 ? (
        <div className="ftc-empty">
          <div className="ftc-empty-icon">🏨</div>
          <div className="ftc-empty-title">No hotels yet</div>
          <div className="ftc-empty-sub">Add hotels to start assigning crew accommodation.</div>
          <button className="pm-btn pm-btn--primary pm-btn--sm" onClick={addHotel} style={{ marginTop: 16 }}>
            + Add Hotel
          </button>
        </div>
      ) : (
        <div className="hotel-list">

          {booked.length > 0 && (
            <>
              <div className="hotel-section-header">
                <span className="hotel-section-title">Booked Hotels</span>
                <span className="hotel-section-count">{booked.length}</span>
              </div>
              {renderRows(booked)}
            </>
          )}

          {candidates.length > 0 && (
            <>
              <div className="hotel-section-header">
                <span className="hotel-section-title">Candidates</span>
                <span className="hotel-section-count">{candidates.length}</span>
                <span className="hotel-section-note">not yet used in the Accommodation Log</span>
              </div>
              {renderRows(candidates)}
            </>
          )}

          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={addHotel} style={{ marginTop: 8 }}>
            + Add Hotel
          </button>
        </div>
      )}
    </div>
  )
}
