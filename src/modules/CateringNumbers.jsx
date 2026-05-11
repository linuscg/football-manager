import { useState, useMemo } from 'react'
import { useFulltimeCrewStore } from '../store/useFulltimeCrewStore'
import { useCrewStore }         from '../store/useCrewStore'
import { useBackpageStore }     from '../store/useBackpageStore'
import { useCateringStore }     from '../store/useCateringStore'

// Round up to nearest 5
function roundUp5(n) {
  return Math.ceil(n / 5) * 5
}

function dayLabel(d) {
  const dateStr = d.date
    ? new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', {
        weekday: 'short', day: '2-digit', month: 'short',
      })
    : 'No date'
  if (d.dayCategory === 'main') {
    return { primary: `D${d.dayNumber} — ${dateStr}`, sub: d.locations?.[0] ?? '' }
  }
  const cat = d.dayCategory
    ? d.dayCategory.charAt(0).toUpperCase() + d.dayCategory.slice(1)
    : 'Day'
  return { primary: `${cat} — ${dateStr}`, sub: '' }
}

const STORAGE_KEY = 'fm_cat_additionals'

function loadAdditionals() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') } catch { return {} }
}

export default function CateringNumbers({ store }) {
  const { shootDays, castMembers } = store

  const { members: ftcMembers }  = useFulltimeCrewStore()
  const { resources, bookings }  = useCrewStore()
  const { getMemberOverride }    = useBackpageStore()
  const { records: catRecords }  = useCateringStore()

  // Per-day "catering additionals" — stored in localStorage by dayId
  const [additionals, setAdditionals] = useState(loadAdditionals)

  function setAdditional(dayId, val) {
    setAdditionals(prev => {
      const next = { ...prev, [dayId]: val }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  // All relevant days sorted by date
  const allDays = useMemo(() =>
    shootDays
      .filter(d => ['main', 'splinter', 'prep', 'other'].includes(d.dayCategory))
      .sort((a, b) => a.date < b.date ? -1 : 1)
  , [shootDays])

  // Per-day counts
  const rows = useMemo(() => allDays.map(day => {

    // 1. Fulltime crew — minus those excluded on this day
    const ftCount = ftcMembers.filter(m => {
      const ov = getMemberOverride(day.id, m.id)
      return !ov?.exclude
    }).length

    // 2. Additional crew — active bookings on this day, not already fulltime
    const ftIds = new Set(ftcMembers.map(m => m.id))
    const additionalIds = new Set(
      bookings
        .filter(b =>
          b.date === day.date &&
          (b.status === 'booked' || b.status === 'hold') &&
          (day.dayCategory === 'main' ? !b.dayId : b.dayId === day.id)
        )
        .map(b => resources.find(r => r.id === b.resourceId && r.type === 'crew')?.id)
        .filter(id => id && !ftIds.has(id))
    )
    const addCount = additionalIds.size

    // 3. Cast — unique cast IDs from scenes on this day
    const sceneCastIds = new Set(
      (day.scenes ?? []).flatMap(s => s.castMemberIds ?? [])
    )
    const castCount = castMembers.filter(c => sceneCastIds.has(c.id)).length

    // 4. Manual additionals
    const addl = Number(additionals[day.id] ?? 0)

    const total     = ftCount + addCount + castCount + addl
    const adjusted  = roundUp5(total * 1.12)
    const collected = catRecords.filter(r => r.dayId === day.id && r.collected).length

    return { day, ftCount, addCount, castCount, addl, total, adjusted, collected }
  }), [allDays, ftcMembers, bookings, resources, castMembers, getMemberOverride, additionals, catRecords])

  // Column totals
  const totals = useMemo(() => rows.reduce((acc, r) => ({
    ft:        acc.ft        + r.ftCount,
    add:       acc.add       + r.addCount,
    cast:      acc.cast      + r.castCount,
    addl:      acc.addl      + r.addl,
    total:     acc.total     + r.total,
    adjusted:  acc.adjusted  + r.adjusted,
    collected: acc.collected + r.collected,
  }), { ft: 0, add: 0, cast: 0, addl: 0, total: 0, adjusted: 0, collected: 0 }), [rows])

  if (allDays.length === 0) {
    return (
      <div className="catn-empty">
        <div style={{ fontSize: 32, opacity: 0.2 }}>📋</div>
        <div className="catn-empty-title">No shoot days yet</div>
        <div className="catn-empty-sub">Add shoot days in the Schedule to see catering numbers.</div>
      </div>
    )
  }

  return (
    <div className="catn-wrap">
      <div className="catn-table-wrap">
        <table className="catn-table">
          <thead>
            <tr>
              <th className="catn-th catn-th--day">Day</th>
              <th className="catn-th catn-th--num" title="Fulltime crew (excluding those marked absent on this day)">Fulltime Crew</th>
              <th className="catn-th catn-th--num" title="Additional crew with active bookings on this day">Additional Crew</th>
              <th className="catn-th catn-th--num" title="Cast members with scenes on this day">Cast</th>
              <th className="catn-th catn-th--num catn-th--addl" title="Manual additions (e.g. extras, visitors)">Catering Additionals</th>
              <th className="catn-th catn-th--num catn-th--total">Total</th>
              <th className="catn-th catn-th--num catn-th--adj" title="Total × 112%, rounded up to nearest 5">Total +12% ↑5</th>
              <th className="catn-th catn-th--num catn-th--collected" title="Lunches collected on this day (from Catering List)">Total Collected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ day, ftCount, addCount, castCount, addl, total, adjusted }) => {
              const { primary, sub } = dayLabel(day)
              return (
                <tr key={day.id} className={`catn-row catn-row--${day.dayCategory}`}>
                  <td className="catn-td catn-td--day">
                    <span className="catn-day-primary">{primary}</span>
                    {sub && <span className="catn-day-sub">{sub}</span>}
                  </td>
                  <td className="catn-td catn-td--num">{ftCount > 0 ? ftCount : <span className="catn-zero">—</span>}</td>
                  <td className="catn-td catn-td--num">{addCount > 0 ? addCount : <span className="catn-zero">—</span>}</td>
                  <td className="catn-td catn-td--num">{castCount > 0 ? castCount : <span className="catn-zero">—</span>}</td>
                  <td className="catn-td catn-td--addl">
                    <input
                      className="catn-addl-input"
                      type="number"
                      min="0"
                      value={additionals[day.id] ?? ''}
                      placeholder="0"
                      onChange={e => {
                        const v = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0)
                        setAdditional(day.id, v)
                      }}
                    />
                  </td>
                  <td className="catn-td catn-td--num catn-td--total">{total}</td>
                  <td className="catn-td catn-td--num catn-td--adj">{adjusted}</td>
                  <td className="catn-td catn-td--num catn-td--collected">{collected > 0 ? collected : <span className="catn-zero">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="catn-foot-row">
              <td className="catn-td catn-td--foot-label">Totals</td>
              <td className="catn-td catn-td--num catn-td--foot">{totals.ft}</td>
              <td className="catn-td catn-td--num catn-td--foot">{totals.add}</td>
              <td className="catn-td catn-td--num catn-td--foot">{totals.cast}</td>
              <td className="catn-td catn-td--num catn-td--foot">{totals.addl}</td>
              <td className="catn-td catn-td--num catn-td--foot catn-td--total">{totals.total}</td>
              <td className="catn-td catn-td--num catn-td--foot catn-td--adj">{totals.adjusted}</td>
              <td className="catn-td catn-td--num catn-td--foot catn-td--collected">{totals.collected}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
