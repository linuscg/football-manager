-- Crew Tracker detail panel: deal-memo status, agent, rate extras and per-row
-- rate overrides (null = derived from the production's rate_calc settings).
ALTER TABLE resources ADD COLUMN IF NOT EXISTS agent             text NOT NULL DEFAULT '';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS tax_status        text NOT NULL DEFAULT '';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS box_pw            numeric;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS car_allowance     numeric;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS ot_rate           numeric;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS sixth_day_rate    numeric;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS seventh_day_rate  numeric;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS deal_memo_emailed text NOT NULL DEFAULT '';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS deal_memo_drafted text NOT NULL DEFAULT '';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS deal_memo_sent    text NOT NULL DEFAULT '';
-- Global rate-calculation parameters (holidayFactor, daysPerWeek, hoursPerDay,
-- sixthDayMult, seventhDayMult, otMult), editable on the Crew Tracker.
ALTER TABLE production ADD COLUMN IF NOT EXISTS rate_calc jsonb NOT NULL DEFAULT '{}'::jsonb;
