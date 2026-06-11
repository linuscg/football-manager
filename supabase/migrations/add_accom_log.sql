-- Phase 1: Accommodation Log
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS code text NOT NULL DEFAULT '';
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS checkin_time text NOT NULL DEFAULT '';
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS checkout_time text NOT NULL DEFAULT '';
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS rooms_allocated integer;

CREATE TABLE IF NOT EXISTS accom_stays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid REFERENCES production(id) ON DELETE CASCADE,
  person_id uuid, person_type text NOT NULL DEFAULT 'crew',
  name text NOT NULL DEFAULT '', job_title text NOT NULL DEFAULT '', department text NOT NULL DEFAULT '',
  room_type text NOT NULL DEFAULT '', cost_per_night numeric,
  note text NOT NULL DEFAULT '', cost_code text NOT NULL DEFAULT '',
  po_number text NOT NULL DEFAULT '', tmo_number text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0, created_at timestamptz DEFAULT now()
);
ALTER TABLE accom_stays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accom_stays_member_all ON accom_stays;
CREATE POLICY accom_stays_member_all ON accom_stays FOR ALL
  USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));
ALTER PUBLICATION supabase_realtime ADD TABLE accom_stays;

CREATE TABLE IF NOT EXISTS accom_nights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid REFERENCES production(id) ON DELETE CASCADE,
  stay_id uuid REFERENCES accom_stays(id) ON DELETE CASCADE,
  date date NOT NULL,
  hotel_id uuid REFERENCES hotels(id) ON DELETE SET NULL,
  tbc boolean NOT NULL DEFAULT false,
  UNIQUE(stay_id, date)
);
ALTER TABLE accom_nights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accom_nights_member_all ON accom_nights;
CREATE POLICY accom_nights_member_all ON accom_nights FOR ALL
  USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));
ALTER PUBLICATION supabase_realtime ADD TABLE accom_nights;
