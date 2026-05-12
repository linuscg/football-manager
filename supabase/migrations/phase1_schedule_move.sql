-- Add to_reconfirm status to resource_bookings
ALTER TABLE resource_bookings DROP CONSTRAINT IF EXISTS resource_bookings_status_check;
ALTER TABLE resource_bookings ADD CONSTRAINT resource_bookings_status_check
  CHECK (status IN ('booked', 'hold', 'unavailable', 'cancelled', 'to_reconfirm'));

-- Schedule changes audit table
CREATE TABLE IF NOT EXISTS schedule_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid REFERENCES production(id) ON DELETE CASCADE,
  changed_by    uuid,
  changed_at    timestamptz DEFAULT now(),
  day_id        uuid,
  day_number    integer,
  day_label     text,
  day_category  text DEFAULT 'main',
  old_date      date,
  new_date      date,
  change_type   text DEFAULT 'date_move',
  notes         text
);

ALTER TABLE schedule_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_can_read_schedule_changes" ON schedule_changes
  FOR SELECT USING (production_id IN (SELECT get_my_production_ids()));

CREATE POLICY "members_can_insert_schedule_changes" ON schedule_changes
  FOR INSERT WITH CHECK (production_id IN (SELECT get_my_production_ids()));
