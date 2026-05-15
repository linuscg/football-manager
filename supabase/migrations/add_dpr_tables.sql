-- DPR (Daily Production Report) — one row per (production, shoot_day)
CREATE TABLE IF NOT EXISTS dpr_day (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid REFERENCES production(id) ON DELETE CASCADE,
  shoot_day_id  uuid REFERENCES shoot_days(id) ON DELETE CASCADE,

  -- Header
  unit          text DEFAULT 'Main Unit',
  country       text DEFAULT '',
  pr_total      integer,

  -- Timings (stored as text "HH:MM" for flexibility)
  breakfast        text DEFAULT '',
  unit_call        text DEFAULT '',
  first_shot_am    text DEFAULT '',
  lunch_start      text DEFAULT '',
  lunch_end        text DEFAULT '',
  first_shot_after text DEFAULT '',
  est_wrap         text DEFAULT '',
  actual_wrap      text DEFAULT '',
  total_hours      text DEFAULT '',
  split_day        boolean DEFAULT false,
  night_work       boolean DEFAULT false,
  sixth_day        boolean DEFAULT false,
  bank_holiday     boolean DEFAULT false,

  -- Address blocks (free text)
  tech_base_address text DEFAULT '',
  unit_base_address text DEFAULT '',
  lunch_location    text DEFAULT '',

  -- Scene tracking summary (free text strings)
  scenes_scheduled    text DEFAULT '',
  scenes_shot         text DEFAULT '',
  part_complete       text DEFAULT '',
  scheduled_not_shot  text DEFAULT '',
  shot_not_scheduled  text DEFAULT '',
  day_complete        text DEFAULT '',
  scene_summary_notes text DEFAULT '',

  -- Arrays stored as JSONB. Each item: { id, source_id, removed, ...fields }
  -- source_id null = manually added; removed=true = greyed out
  scenes          jsonb DEFAULT '[]'::jsonb,
  cast_members    jsonb DEFAULT '[]'::jsonb,
  fittings        jsonb DEFAULT '[]'::jsonb,  -- costume fittings/makeup tests
  supporting_arts jsonb DEFAULT '[]'::jsonb,
  childrens_hours jsonb DEFAULT '[]'::jsonb,

  -- Script stats
  set_ups_previous   integer DEFAULT 0,
  set_ups_today      integer DEFAULT 0,
  cam_inventory      jsonb   DEFAULT '{}'::jsonb,
  -- shape: { a_prev, a_today, b_prev, b_today, t_prev, t_today, c_prev, c_today,
  --          a_rolls, b_rolls, t_rolls, c_rolls }
  sound_previous     integer DEFAULT 0,
  sound_today        integer DEFAULT 0,
  sound_card_numbers text    DEFAULT '',
  video_previous     numeric DEFAULT 0,
  video_today        numeric DEFAULT 0,
  timings_previous   text    DEFAULT '',
  timings_today      text    DEFAULT '',
  catering_estimated integer DEFAULT 0,
  catering_actual    integer DEFAULT 0,
  script_min_prev_est   text DEFAULT '',
  script_min_prev_act   text DEFAULT '',
  script_min_today_est  text DEFAULT '',
  script_min_today_act  text DEFAULT '',

  -- SA counts/costs
  sa_counts_costs jsonb DEFAULT '{}'::jsonb,
  -- shape: { prev_count, today_count, prev_cost, today_cost }

  -- Free text sections
  additional_crew       text DEFAULT '',
  additional_equipment  text DEFAULT '',
  additional_facilities text DEFAULT '',
  ot_toc_notes          text DEFAULT '',
  vfx_sfx_notes         text DEFAULT '',
  hs_medical_notes      text DEFAULT '',
  notes                 text DEFAULT '',

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(production_id, shoot_day_id)
);

ALTER TABLE dpr_day ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dpr_day_member_all" ON dpr_day
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));

ALTER PUBLICATION supabase_realtime ADD TABLE dpr_day;
