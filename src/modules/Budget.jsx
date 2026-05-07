import { useState, useEffect, useMemo } from 'react'
import { useCrewStore }   from '../store/useCrewStore'
import { useBudgetStore } from '../store/useBudgetStore'

// ─── Constants ────────────────────────────────────────────────────────────────

const PHASES = [
  { id: 'prep',  label: 'Pre-Prod', startKey: 'prepStartDate',  endKey: 'prepEndDate',  color: '#7c3aed' },
  { id: 'shoot', label: 'Shoot',    startKey: 'shootStartDate', endKey: 'shootEndDate', color: '#2563eb' },
  { id: 'wrap',  label: 'Wrap',     startKey: 'wrapStartDate',  endKey: 'wrapEndDate',  color: '#16a34a' },
]

// All supported currency symbols and their codes
const CURRENCIES = [
  { symbol: '£',   code: 'GBP', label: '£ GBP' },
  { symbol: '$',   code: 'USD', label: '$ USD' },
  { symbol: '€',   code: 'EUR', label: '€ EUR' },
  { symbol: '¥',   code: 'JPY', label: '¥ JPY' },
  { symbol: 'kr',  code: 'SEK', label: 'kr SEK' },
  { symbol: 'A$',  code: 'AUD', label: 'A$ AUD' },
  { symbol: 'C$',  code: 'CAD', label: 'C$ CAD' },
  { symbol: 'CHF', code: 'CHF', label: 'CHF' },
  { symbol: 'zł',  code: 'PLN', label: 'zł PLN' },
  { symbol: 'Kč',  code: 'CZK', label: 'Kč CZK' },
]

const SYMBOL_TO_CODE = {}
const CODE_TO_SYMBOL = {}
for (const c of CURRENCIES) {
  SYMBOL_TO_CODE[c.symbol] = c.code
  CODE_TO_SYMBOL[c.code]   = c.symbol
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(amount, symbol) {
  if (!amount && amount !== 0) return '—'
  if (amount === 0) return '—'
  return symbol + Math.round(amount).toLocaleString('en-GB')
}

function fmtZero(amount, symbol) {
  return symbol + Math.round(amount).toLocaleString('en-GB')
}

function rateStr(resource) {
  const amt = parseFloat(resource.costAmount)
  if (!amt) return '—'
  if (resource.costType === 'daily') return `${amt.toLocaleString('en-GB')}/day`
  const wk = resource.weekType === '3day' ? '3-day wk' : '5-day wk'
  return `${amt.toLocaleString('en-GB')}/wk (${wk})`
}

function calcCost(resource, bookings, status) {
  const amt = parseFloat(resource.costAmount) || 0
  if (!amt) return 0
  const days = bookings.filter(b => b.resourceId === resource.id && b.status === status).length
  if (!days) return 0
  if (resource.costType === 'daily') return amt * days
  const daysPerWeek = resource.weekType === '3day' ? 3 : 5
  return amt * (days / daysPerWeek)
}

function countDays(resource, bookings, status) {
  return bookings.filter(b => b.resourceId === resource.id && b.status === status).length
}

function phaseForDate(date, production) {
  for (const p of PHASES) {
    const start = production[p.startKey]
    const end   = production[p.endKey]
    if (start && end && date >= start && date <= end) return p.id
  }
  return null
}

// ─── BudgetItemRow — local state so inputs don't lose focus ──────────────────

function BudgetItemRow({ item, symbol, onUpdate, onDelete }) {
  const [lCat,    setLCat]    = useState(item.category)
  const [lName,   setLName]   = useState(item.name)
  const [lAmount, setLAmount] = useState(String(item.amount))
  const [lNotes,  setLNotes]  = useState(item.notes)

  useEffect(() => setLCat(item.category),           [item.category])
  useEffect(() => setLName(item.name),               [item.name])
  useEffect(() => setLAmount(String(item.amount)),   [item.amount])
  useEffect(() => setLNotes(item.notes),             [item.notes])

  function commit(field, local, original, parse) {
    const val = parse ? (parseFloat(local) || 0) : local
    if (val !== original) onUpdate(item.id, field, val)
  }

  return (
    <tr className="budget-other-row">
      <td className="budget-td">
        <input
          className="budget-input"
          value={lCat}
          placeholder="Category"
          onChange={e => setLCat(e.target.value)}
          onBlur={() => commit('category', lCat, item.category, false)}
        />
      </td>
      <td className="budget-td">
        <input
          className="budget-input budget-input-wide"
          value={lName}
          placeholder="Description"
          onChange={e => setLName(e.target.value)}
          onBlur={() => commit('name', lName, item.name, false)}
        />
      </td>
      <td className="budget-td budget-td-num">
        <div className="budget-amount-wrap">
          <span className="budget-sym">{symbol}</span>
          <input
            className="budget-input budget-input-amount"
            type="number"
            min="0"
            step="1"
            value={lAmount}
            placeholder="0"
            onChange={e => setLAmount(e.target.value)}
            onBlur={() => commit('amount', lAmount, item.amount, true)}
          />
        </div>
      </td>
      <td className="budget-td">
        <input
          className="budget-input budget-input-wide"
          value={lNotes}
          placeholder="Notes"
          onChange={e => setLNotes(e.target.value)}
          onBlur={() => commit('notes', lNotes, item.notes, false)}
        />
      </td>
      <td className="budget-td budget-td-action">
        <button
          className="btn-icon danger"
          onClick={() => onDelete(item.id)}
          title="Delete line"
        >✕</button>
      </td>
    </tr>
  )
}

// ─── Section wrapper with collapse ───────────────────────────────────────────

function BudgetSection({ title, total, symbol, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="budget-section">
      <div className="budget-section-header" onClick={() => setOpen(o => !o)}>
        <span className={`budget-section-chevron${open ? ' open' : ''}`}>▶</span>
        <span className="budget-section-title">{title}</span>
        <span className="budget-section-total">{fmtZero(total, symbol)}</span>
      </div>
      {open && <div className="budget-section-body">{children}</div>}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Budget({ store, onUpdate }) {
  const { production } = store
  const baseCurrency = production.currency ?? '£'
  const { resources, bookings } = useCrewStore()
  const { loading: bLoading, items: otherItems, addItem, deleteItem, updateItem } = useBudgetStore()

  // viewCurrency: the currency to display amounts in (defaults to base)
  const [viewCurrency, setViewCurrency] = useState(baseCurrency)

  // If base currency changes, reset view currency
  useEffect(() => { setViewCurrency(baseCurrency) }, [baseCurrency])

  // Compute FX rate for display
  const viewCode    = SYMBOL_TO_CODE[viewCurrency] ?? 'GBP'
  const baseCode    = SYMBOL_TO_CODE[baseCurrency] ?? 'GBP'
  const fxRate      = viewCode === baseCode
    ? 1
    : (production.exchangeRates?.[viewCode] ?? 1)

  // The symbol shown in display — use viewCurrency symbol
  const displaySymbol = viewCurrency

  // ── Auto-calculate costs from bookings ──────────────────────────────────────

  const crewResources  = resources.filter(r => r.type === 'crew')
  const equipResources = resources.filter(r => r.type === 'equipment')

  // Enrich each resource with its cost figures (in base currency)
  const enriched = useMemo(() => resources.map(r => ({
    ...r,
    confirmedDays: countDays(r, bookings, 'booked'),
    holdDays:      countDays(r, bookings, 'hold'),
    confirmedCost: calcCost(r, bookings, 'booked'),
    holdCost:      calcCost(r, bookings, 'hold'),
  })), [resources, bookings])

  const enrichedCrew  = enriched.filter(r => r.type === 'crew')
  const enrichedEquip = enriched.filter(r => r.type === 'equipment')

  // Group crew by department
  const crewByDept = useMemo(() => {
    const map = {}
    for (const r of enrichedCrew) {
      const key = r.department.trim() || 'Unassigned'
      if (!map[key]) map[key] = []
      map[key].push(r)
    }
    return Object.entries(map).sort(([a], [b]) =>
      a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b)
    )
  }, [enrichedCrew])

  // Group equipment by category
  const equipByCat = useMemo(() => {
    const map = {}
    for (const r of enrichedEquip) {
      const key = r.category.trim() || 'Uncategorised'
      if (!map[key]) map[key] = []
      map[key].push(r)
    }
    return Object.entries(map).sort(([a], [b]) =>
      a === 'Uncategorised' ? 1 : b === 'Uncategorised' ? -1 : a.localeCompare(b)
    )
  }, [enrichedEquip])

  // Totals (in base currency)
  const crewConfirmed  = enrichedCrew.reduce((s, r)  => s + r.confirmedCost, 0)
  const crewHold       = enrichedCrew.reduce((s, r)  => s + r.holdCost,      0)
  const equipConfirmed = enrichedEquip.reduce((s, r) => s + r.confirmedCost, 0)
  const equipHold      = enrichedEquip.reduce((s, r) => s + r.holdCost,      0)
  const otherTotal     = otherItems.reduce((s, i)    => s + (parseFloat(i.amount) || 0), 0)

  const grandConfirmed = crewConfirmed + equipConfirmed + otherTotal
  const grandWithHolds = grandConfirmed + crewHold + equipHold

  // Converted totals for display
  const cv = n => n * fxRate

  // Phase cost breakdown — look at which phase each booked day falls in
  const phaseCosts = useMemo(() => {
    const out = { prep: 0, shoot: 0, wrap: 0, other: 0 }
    for (const b of bookings) {
      if (b.status !== 'booked') continue
      const resource = enriched.find(r => r.id === b.resourceId)
      if (!resource) continue
      const amt = parseFloat(resource.costAmount) || 0
      if (!amt) continue
      let dayCost = resource.costType === 'daily'
        ? amt
        : amt / (resource.weekType === '3day' ? 3 : 5)
      const phase = phaseForDate(b.date, production)
      out[phase ?? 'other'] += dayCost
    }
    out.other += otherTotal
    return out
  }, [bookings, enriched, production, otherTotal])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="budget-wrap">

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="budget-topbar">
        <h1 className="budget-title">Budget</h1>
        <div className="budget-currency-row">
          <span className="budget-currency-sym">{baseCurrency}</span>
          <span className="budget-currency-label">Base currency (set in Project Setup)</span>
          <span className="budget-currency-label" style={{ margin: '0 8px' }}>|</span>
          <label className="budget-currency-label" style={{ marginRight: 6 }}>View in:</label>
          <select
            className="budget-currency-select"
            value={viewCurrency}
            onChange={e => setViewCurrency(e.target.value)}
          >
            {CURRENCIES.map(c => (
              <option key={c.symbol} value={c.symbol}>{c.label}</option>
            ))}
          </select>
          {viewCode !== baseCode && (
            <span className="budget-currency-label" style={{ marginLeft: 8, color: '#d97706' }}>
              1 {baseCode} = {fxRate.toLocaleString('en-GB', { maximumFractionDigits: 4 })} {viewCode}
            </span>
          )}
        </div>
      </div>

      <div className="budget-scroll">

        {/* ── Summary cards ──────────────────────────────────────────────────── */}
        <div className="budget-summary-grid">
          <div className="budget-card budget-card-primary">
            <div className="budget-card-label">Total Confirmed</div>
            <div className="budget-card-value">{fmtZero(cv(grandConfirmed), displaySymbol)}</div>
          </div>
          <div className="budget-card budget-card-hold">
            <div className="budget-card-label">Total inc. Holds</div>
            <div className="budget-card-value">{fmtZero(cv(grandWithHolds), displaySymbol)}</div>
            {crewHold + equipHold > 0 && (
              <div className="budget-card-sub">+{fmtZero(cv(crewHold + equipHold), displaySymbol)} on hold</div>
            )}
          </div>
          <div className="budget-card">
            <div className="budget-card-label">Crew</div>
            <div className="budget-card-value">{fmtZero(cv(crewConfirmed), displaySymbol)}</div>
            {crewHold > 0 && <div className="budget-card-sub">+{fmtZero(cv(crewHold), displaySymbol)} on hold</div>}
          </div>
          <div className="budget-card">
            <div className="budget-card-label">Equipment</div>
            <div className="budget-card-value">{fmtZero(cv(equipConfirmed), displaySymbol)}</div>
            {equipHold > 0 && <div className="budget-card-sub">+{fmtZero(cv(equipHold), displaySymbol)} on hold</div>}
          </div>
          <div className="budget-card">
            <div className="budget-card-label">Other Costs</div>
            <div className="budget-card-value">{fmtZero(cv(otherTotal), displaySymbol)}</div>
          </div>
        </div>

        {/* ── Phase breakdown strip ─────────────────────────────────────────── */}
        {(phaseCosts.prep + phaseCosts.shoot + phaseCosts.wrap + phaseCosts.other) > 0 && (
          <div className="budget-phases">
            {PHASES.map(p => phaseCosts[p.id] > 0 && (
              <div key={p.id} className="budget-phase-item" style={{ '--phase-color': p.color }}>
                <span className="budget-phase-dot" />
                <span className="budget-phase-label">{p.label}</span>
                <span className="budget-phase-amount">{fmtZero(cv(phaseCosts[p.id]), displaySymbol)}</span>
              </div>
            ))}
            {phaseCosts.other > 0 && (
              <div className="budget-phase-item" style={{ '--phase-color': '#9ca3af' }}>
                <span className="budget-phase-dot" />
                <span className="budget-phase-label">Other</span>
                <span className="budget-phase-amount">{fmtZero(cv(phaseCosts.other), displaySymbol)}</span>
              </div>
            )}
          </div>
        )}

        {/* ── Crew Costs ───────────────────────────────────────────────────────── */}
        <BudgetSection title="Crew Costs" total={cv(crewConfirmed)} symbol={displaySymbol}>
          {crewByDept.length === 0 ? (
            <p className="budget-empty">No crew added yet — add crew in the Crew &amp; Equipment tab.</p>
          ) : (
            crewByDept.map(([dept, members]) => {
              const deptConf = members.reduce((s, r) => s + r.confirmedCost, 0)
              const deptHold = members.reduce((s, r) => s + r.holdCost, 0)
              return (
                <div key={dept} className="budget-group">
                  <div className="budget-group-header">
                    <span>{dept}</span>
                    <span className="budget-group-total">
                      {fmtZero(cv(deptConf), displaySymbol)}
                      {deptHold > 0 && <span className="budget-hold-note"> +{fmt(cv(deptHold), displaySymbol)} hold</span>}
                    </span>
                  </div>
                  <table className="budget-table">
                    <thead>
                      <tr>
                        <th className="budget-th">Name</th>
                        <th className="budget-th">Role</th>
                        <th className="budget-th budget-th-rate">Rate</th>
                        <th className="budget-th budget-th-num">Conf. days</th>
                        <th className="budget-th budget-th-num">Hold days</th>
                        <th className="budget-th budget-th-cost">Confirmed</th>
                        <th className="budget-th budget-th-cost">On Hold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map(r => (
                        <tr key={r.id} className="budget-resource-row">
                          <td className="budget-td budget-td-name">{r.name}</td>
                          <td className="budget-td budget-td-role">{r.role || '—'}</td>
                          <td className="budget-td budget-td-rate">{rateStr(r)}</td>
                          <td className="budget-td budget-td-num">{r.confirmedDays || '—'}</td>
                          <td className="budget-td budget-td-num">{r.holdDays || '—'}</td>
                          <td className="budget-td budget-td-cost">{fmt(cv(r.confirmedCost), displaySymbol)}</td>
                          <td className="budget-td budget-td-hold">{fmt(cv(r.holdCost), displaySymbol)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="budget-subtotal-row">
                        <td colSpan={5} className="budget-td budget-subtotal-label">
                          {dept} subtotal
                        </td>
                        <td className="budget-td budget-td-cost budget-subtotal-value">
                          {fmtZero(cv(deptConf), displaySymbol)}
                        </td>
                        <td className="budget-td budget-td-hold budget-subtotal-value">
                          {fmt(cv(deptHold), displaySymbol)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
            })
          )}
        </BudgetSection>

        {/* ── Equipment Costs ──────────────────────────────────────────────────── */}
        <BudgetSection title="Equipment Costs" total={cv(equipConfirmed)} symbol={displaySymbol}>
          {equipByCat.length === 0 ? (
            <p className="budget-empty">No equipment added yet — add items in the Crew &amp; Equipment tab.</p>
          ) : (
            equipByCat.map(([cat, items]) => {
              const catConf = items.reduce((s, r) => s + r.confirmedCost, 0)
              const catHold = items.reduce((s, r) => s + r.holdCost, 0)
              return (
                <div key={cat} className="budget-group">
                  <div className="budget-group-header">
                    <span>{cat}</span>
                    <span className="budget-group-total">
                      {fmtZero(cv(catConf), displaySymbol)}
                      {catHold > 0 && <span className="budget-hold-note"> +{fmt(cv(catHold), displaySymbol)} hold</span>}
                    </span>
                  </div>
                  <table className="budget-table">
                    <thead>
                      <tr>
                        <th className="budget-th">Item</th>
                        <th className="budget-th">Vendor</th>
                        <th className="budget-th budget-th-rate">Rate</th>
                        <th className="budget-th budget-th-num">Conf. days</th>
                        <th className="budget-th budget-th-num">Hold days</th>
                        <th className="budget-th budget-th-cost">Confirmed</th>
                        <th className="budget-th budget-th-cost">On Hold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(r => (
                        <tr key={r.id} className="budget-resource-row">
                          <td className="budget-td budget-td-name">{r.name}</td>
                          <td className="budget-td budget-td-role">{r.vendor || '—'}</td>
                          <td className="budget-td budget-td-rate">{rateStr(r)}</td>
                          <td className="budget-td budget-td-num">{r.confirmedDays || '—'}</td>
                          <td className="budget-td budget-td-num">{r.holdDays || '—'}</td>
                          <td className="budget-td budget-td-cost">{fmt(cv(r.confirmedCost), displaySymbol)}</td>
                          <td className="budget-td budget-td-hold">{fmt(cv(r.holdCost), displaySymbol)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="budget-subtotal-row">
                        <td colSpan={5} className="budget-td budget-subtotal-label">
                          {cat} subtotal
                        </td>
                        <td className="budget-td budget-td-cost budget-subtotal-value">
                          {fmtZero(cv(catConf), displaySymbol)}
                        </td>
                        <td className="budget-td budget-td-hold budget-subtotal-value">
                          {fmt(cv(catHold), displaySymbol)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
            })
          )}
        </BudgetSection>

        {/* ── Other Costs ──────────────────────────────────────────────────────── */}
        <BudgetSection title="Other Costs" total={cv(otherTotal)} symbol={displaySymbol}>
          <div className="budget-other-wrap">
            <table className="budget-table budget-other-table">
              <thead>
                <tr>
                  <th className="budget-th budget-th-cat">Category</th>
                  <th className="budget-th">Description</th>
                  <th className="budget-th budget-th-cost">Amount</th>
                  <th className="budget-th">Notes</th>
                  <th className="budget-th budget-th-action" />
                </tr>
              </thead>
              <tbody>
                {otherItems.length === 0 && !bLoading && (
                  <tr>
                    <td colSpan={5} className="budget-td budget-other-empty">
                      No line items yet — click below to add one.
                    </td>
                  </tr>
                )}
                {otherItems.map(item => (
                  <BudgetItemRow
                    key={item.id}
                    item={item}
                    symbol={baseCurrency}
                    onUpdate={updateItem}
                    onDelete={deleteItem}
                  />
                ))}
              </tbody>
              {otherItems.length > 0 && (
                <tfoot>
                  <tr className="budget-subtotal-row">
                    <td colSpan={2} className="budget-td budget-subtotal-label">Total other costs</td>
                    <td className="budget-td budget-td-cost budget-subtotal-value">
                      {fmtZero(cv(otherTotal), displaySymbol)}
                    </td>
                    <td colSpan={2} className="budget-td" />
                  </tr>
                </tfoot>
              )}
            </table>
            <button className="btn btn-secondary btn-sm budget-add-btn" onClick={addItem}>
              + Add line item
            </button>
          </div>
        </BudgetSection>

        {/* ── Grand total strip ─────────────────────────────────────────────────── */}
        <div className="budget-grand-total">
          <div className="budget-grand-row">
            <span className="budget-grand-label">Grand Total (confirmed)</span>
            <span className="budget-grand-value">{fmtZero(cv(grandConfirmed), displaySymbol)}</span>
          </div>
          {crewHold + equipHold > 0 && (
            <div className="budget-grand-row budget-grand-hold">
              <span className="budget-grand-label">Total including holds</span>
              <span className="budget-grand-value">{fmtZero(cv(grandWithHolds), displaySymbol)}</span>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
