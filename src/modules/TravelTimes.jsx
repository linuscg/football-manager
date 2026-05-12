import { useMemo } from 'react'
import { useAccommodationStore } from '../store/useAccommodationStore'
import { hotelColor }            from './HotelList'

// ─── Main component ────────────────────────────────────────────────────────────

export default function TravelTimes({ shootDays = [] }) {
  const { hotels, travelTimes, setTravelTime, loading } = useAccommodationStore()

  // Collect unique, non-empty location names from all shoot days
  const locations = useMemo(() => {
    const locs = new Set()
    for (const day of shootDays) {
      for (const loc of day.locations ?? []) {
        const t = (loc ?? '').trim()
        if (t) locs.add(t)
      }
    }
    return [...locs].sort()
  }, [shootDays])

  if (loading) return <div className="ftc-state">Loading…</div>

  if (hotels.length === 0) {
    return (
      <div className="ftc-empty">
        <div className="ftc-empty-icon">🏨</div>
        <div className="ftc-empty-title">No hotels yet</div>
        <div className="ftc-empty-sub">Add hotels in the Hotel List tab first.</div>
      </div>
    )
  }

  if (locations.length === 0) {
    return (
      <div className="ftc-empty">
        <div className="ftc-empty-icon">📍</div>
        <div className="ftc-empty-title">No shoot locations yet</div>
        <div className="ftc-empty-sub">
          Add shoot day locations in the Schedule tab — they'll appear as columns here.
        </div>
      </div>
    )
  }

  return (
    <div className="tt-wrap">

      <div className="tt-header">
        <div>
          <h2 className="tt-title">Travel Times</h2>
          <p className="tt-sub">
            Enter estimated travel times in <strong>minutes</strong> between each hotel and shoot location.
          </p>
        </div>
      </div>

      <div className="tt-table-outer">
        <table className="tt-table">
          <thead>
            <tr>
              <th className="tt-th-hotel">Hotel</th>
              {locations.map(loc => (
                <th key={loc} className="tt-th-loc">
                  <div className="tt-loc-label" title={loc}>{loc}</div>
                  <div className="tt-loc-unit">min</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hotels.map((hotel, hi) => (
              <tr key={hotel.id} className="tt-tr">
                <td className="tt-td-hotel">
                  <span className="tt-hotel-swatch" style={{ background: hotelColor(hi) }} />
                  <span className="tt-hotel-name">{hotel.name || `Hotel ${hi + 1}`}</span>
                </td>
                {locations.map(loc => {
                  const key = `${hotel.id}|${loc}`
                  const val = travelTimes[key] ?? ''
                  return (
                    <td key={loc} className="tt-td-time">
                      <input
                        className="tt-time-input"
                        type="number"
                        min="0"
                        value={val}
                        placeholder="0"
                        onChange={e => setTravelTime(hotel.id, loc, e.target.value)}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}
