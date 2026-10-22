-- Per-person per-date overtime for FLAT (prep/wrap) timesheet days.
CREATE TABLE IF NOT EXISTS timesheet_ot (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid REFERENCES production(id) ON DELETE CASCADE,
  resource_id   uuid NOT NULL,
  date          date NOT NULL,
  ot_hours      numeric NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  UNIQUE(production_id, resource_id, date)
);
ALTER TABLE timesheet_ot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS timesheet_ot_member_all ON timesheet_ot;
CREATE POLICY timesheet_ot_member_all ON timesheet_ot
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));
ALTER PUBLICATION supabase_realtime ADD TABLE timesheet_ot;
