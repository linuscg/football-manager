// ─── Weekly-rate-driven crew rate calculation engine ──────────────────────────
//
// All derived figures flow from a single source rate on the resource
// (costAmount + costType) plus the production-level rate_calc settings.
//
//   weekly  ⇄ daily  (× / ÷ daysPerWeek)
//   hourly  = daily / hoursPerDay
//   net     = gross / holidayFactor      (holiday-inclusive → net)
//   hol     = gross − net                (the holiday element)
//   6th day = daily  × sixthDayMult      (unless overridden per-row)
//   7th day = daily  × seventhDayMult    (unless overridden per-row)
//   OT      = hourly × otMult            (unless overridden per-row)

export const RATE_CALC_DEFAULTS = {
  holidayFactor: 1.1207,
  daysPerWeek:   5,
  hoursPerDay:   11,
  sixthDayMult:  1.5,
  seventhDayMult: 2,
  otMult:        1.5,
}

// Merge the production's stored rate_calc jsonb over the defaults.
export function getRateCalc(production) {
  return { ...RATE_CALC_DEFAULTS, ...(production?.rateCalc ?? {}) }
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

export function deriveRates(resource, calc) {
  const {
    holidayFactor, daysPerWeek, hoursPerDay,
    sixthDayMult, seventhDayMult, otMult,
  } = calc

  const amount = toNumber(resource?.costAmount)

  let weekly = null
  let daily  = null
  let source = null
  if (amount != null) {
    if (resource.costType === 'weekly') {
      source = 'weekly'
      weekly = amount
      daily  = daysPerWeek > 0 ? weekly / daysPerWeek : null
    } else if (resource.costType === 'daily' || resource.costType === 'halfday') {
      source = 'daily'
      daily  = amount
      weekly = daily * daysPerWeek
    }
  }

  const hourly = daily != null && hoursPerDay > 0 ? daily / hoursPerDay : null

  const net = g => (g != null && holidayFactor > 0 ? g / holidayFactor : null)
  const hol = g => (g != null && net(g) != null ? g - net(g) : null)

  const sixthOverride   = toNumber(resource?.sixthDayRate)
  const seventhOverride = toNumber(resource?.seventhDayRate)
  const otOverride      = toNumber(resource?.otRate)

  return {
    weekly,  weeklyNet: net(weekly),  weeklyHol: hol(weekly),
    daily,   dailyNet:  net(daily),   dailyHol:  hol(daily),
    hourly,  hourlyNet: net(hourly),  hourlyHol: hol(hourly),
    sixth:   sixthOverride   ?? (daily  != null ? daily  * sixthDayMult   : null),
    seventh: seventhOverride ?? (daily  != null ? daily  * seventhDayMult : null),
    ot:      otOverride      ?? (hourly != null ? hourly * otMult         : null),
    sixthIsOverride:   sixthOverride   != null,
    seventhIsOverride: seventhOverride != null,
    otIsOverride:      otOverride      != null,
    source,
  }
}
