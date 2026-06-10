-- Budget / cost codes (production-scoped), assignable to crew, equipment and other-cost rows.
CREATE TABLE IF NOT EXISTS budget_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid REFERENCES production(id) ON DELETE CASCADE,
  code          text NOT NULL DEFAULT '',
  description   text NOT NULL DEFAULT '',
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE budget_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_codes_member_all ON budget_codes;
CREATE POLICY budget_codes_member_all ON budget_codes
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));
ALTER PUBLICATION supabase_realtime ADD TABLE budget_codes;

-- The Other-Costs table (was never provisioned). Created with a cost_code column.
CREATE TABLE IF NOT EXISTS budget_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid REFERENCES production(id) ON DELETE CASCADE,
  category      text NOT NULL DEFAULT 'Other',
  name          text NOT NULL DEFAULT '',
  amount        numeric NOT NULL DEFAULT 0,
  notes         text NOT NULL DEFAULT '',
  cost_code     text NOT NULL DEFAULT '',
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_items_member_all ON budget_items;
CREATE POLICY budget_items_member_all ON budget_items
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));
ALTER PUBLICATION supabase_realtime ADD TABLE budget_items;

-- Cost-code assignment on crew/equipment rows.
ALTER TABLE resources ADD COLUMN IF NOT EXISTS cost_code text NOT NULL DEFAULT '';
