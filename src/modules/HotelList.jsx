import { useState } from 'react'
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

// ── Inline-editable hotel row ──────────────────────────────────────────────────

function HotelRow({ hotel, index, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const color = hotelColor(index)

  // Keyboard shortcut label
  const KEYS = ['1','2','3','4','5','6','7','8','9','0','-','=']
  const keyLabel = KEYS[index] ? `[${KEYS[index]}]` : null

  return (
    <div className={`hotel-row${expanded ? ' hotel-row--open' : ''}`}>

      {/* ── Header ── */}
      <div className="hotel-row-header">
        <div className="hotel-color-swatch" style={{ background: color }} />

        <input
          className="hotel-name-input"
          value={hotel.name}
          placeholder="Hotel name"
          onChange={e => onUpdate(hotel.id, 'name', e.target.value)}
        />

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

      {/* ── Expanded detail fields ── */}
      {expanded && (
        <div className="hotel-details">
          <div className="hotel-detail-field">
            <label className="hotel-detail-label">Address</label>
            <textarea
              className="hotel-detail-input hotel-detail-input--area"
              value={hotel.address}
              placeholder="Full address…"
              rows={2}
              onChange={e => onUpdate(hotel.id, 'address', e.target.value)}
            />
          </div>
          <div className="hotel-detail-field">
            <label className="hotel-detail-label">Contact info</label>
            <input
              className="hotel-detail-input"
              value={hotel.contactInfo}
              placeholder="Phone / email / website"
              onChange={e => onUpdate(hotel.id, 'contactInfo', e.target.value)}
            />
          </div>
          <div className="hotel-detail-field">
            <label className="hotel-detail-label">Notes</label>
            <textarea
              className="hotel-detail-input hotel-detail-input--area"
              value={hotel.notes}
              placeholder="Any additional notes…"
              rows={2}
              onChange={e => onUpdate(hotel.id, 'notes', e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function HotelList() {
  const { hotels, loading, error, addHotel, updateHotel, deleteHotel } = useAccommodationStore()

  if (loading) return <div className="ftc-state">Loading…</div>
  if (error)   return <div className="ftc-state ftc-state--error">Error: {error}</div>

  return (
    <div className="hotel-list-wrap">

      <div className="hotel-list-header">
        <div>
          <h2 className="hotel-list-title">Hotel List</h2>
          <p className="hotel-list-sub">
            Add hotels to this production. They'll be available to assign in Crew Hotels.
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
          {hotels.map((hotel, i) => (
            <HotelRow
              key={hotel.id}
              hotel={hotel}
              index={i}
              onUpdate={updateHotel}
              onDelete={deleteHotel}
            />
          ))}
          <button className="pm-btn pm-btn--ghost pm-btn--sm" onClick={addHotel} style={{ marginTop: 8 }}>
            + Add Hotel
          </button>
        </div>
      )}
    </div>
  )
}
