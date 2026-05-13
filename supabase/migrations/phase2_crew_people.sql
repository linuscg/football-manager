-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2: Crew People Database
--
-- Separates "who the person is" from "what role they fill on this production".
-- crew_people is cross-production — John Smith appears once regardless of how
-- many productions he's worked on.  resources rows gain an optional person_id
-- FK so a role-slot can be linked to a person in the database.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. People table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crew_people (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  name        text        NOT NULL DEFAULT '',
  email       text        NOT NULL DEFAULT '',
  phone       text        NOT NULL DEFAULT '',
  notes       text        NOT NULL DEFAULT '',
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE crew_people ENABLE ROW LEVEL SECURITY;

-- You can see:
--   (a) people you created yourself, OR
--   (b) people linked to a production you are a member of
CREATE POLICY "crew_people_select" ON crew_people
  FOR SELECT USING (
    created_by = auth.uid()
    OR id IN (
      SELECT r.person_id
      FROM   resources r
      JOIN   production_members pm ON pm.production_id = r.production_id
      WHERE  pm.user_id = auth.uid()
        AND  r.person_id IS NOT NULL
    )
  );

-- Only the creator can write
CREATE POLICY "crew_people_insert" ON crew_people
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY "crew_people_update" ON crew_people
  FOR UPDATE USING (created_by = auth.uid());

CREATE POLICY "crew_people_delete" ON crew_people
  FOR DELETE USING (created_by = auth.uid());

-- 2. Link column on resources ─────────────────────────────────────────────────

ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS person_id uuid
    REFERENCES crew_people(id) ON DELETE SET NULL;
