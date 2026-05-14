-- Phase 3: New Starters
-- Adds start/end date tracking to fulltime_crew and introduces the
-- new_starter_status table for onboarding checklist management.

-- ─────────────────────────────────────────────
-- 1. Extend fulltime_crew with date columns
-- ─────────────────────────────────────────────
ALTER TABLE fulltime_crew
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date;

-- ─────────────────────────────────────────────
-- 2. New-starter onboarding checklist table
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS new_starter_status (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id           uuid        NOT NULL REFERENCES production(id) ON DELETE CASCADE,
  -- 'fulltime' → fulltime_crew.id, 'additional' → resources.id
  crew_type               text        NOT NULL CHECK (crew_type IN ('fulltime', 'additional')),
  crew_id                 uuid        NOT NULL,
  -- Onboarding checklist flags
  added_to_scenechronize  boolean     NOT NULL DEFAULT false,
  sent_contract           boolean     NOT NULL DEFAULT false,
  email_sent              boolean     NOT NULL DEFAULT false,
  email_delivered         boolean     NOT NULL DEFAULT false,
  notes                   text        NOT NULL DEFAULT '',
  created_at              timestamptz          DEFAULT now(),
  UNIQUE (production_id, crew_id)
);

-- ─────────────────────────────────────────────
-- 3. Row-level security
-- ─────────────────────────────────────────────
ALTER TABLE new_starter_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "new_starter_status_member_all" ON new_starter_status
  FOR ALL
  USING     (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));
