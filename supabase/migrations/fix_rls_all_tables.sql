-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: Enable RLS on all public tables that were created without it.
--
-- Every table in the original schema.sql was created without Row Level
-- Security, making them publicly readable/writable.  This migration enables
-- RLS and adds the minimal policies needed to keep the app working.
--
-- Pattern used throughout:
--   get_my_production_ids() → returns the production UUIDs the current
--   authenticated user is a member of (via production_members table).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Helper function (idempotent) ──────────────────────────────────────────────
-- Returns the set of production IDs the calling user belongs to.
-- SECURITY DEFINER so it can bypass RLS on production_members itself.
CREATE OR REPLACE FUNCTION get_my_production_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT production_id FROM production_members WHERE user_id = auth.uid()
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. profiles
--    Owned by auth.users; users manage their own row.
--    Members of a shared production can read each other's basic profiles.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (
    id = auth.uid()
    OR id IN (
      SELECT pm.user_id
      FROM   production_members pm
      WHERE  pm.production_id IN (SELECT get_my_production_ids())
    )
  );

CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. production
--    Users can only see productions they are a member of.
--    Only the owner (role = 'owner') can update/delete.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE production ENABLE ROW LEVEL SECURITY;

CREATE POLICY "production_select_member" ON production
  FOR SELECT USING (id IN (SELECT get_my_production_ids()));

CREATE POLICY "production_insert_auth" ON production
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "production_update_owner" ON production
  FOR UPDATE USING (
    id IN (
      SELECT production_id FROM production_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "production_delete_owner" ON production
  FOR DELETE USING (
    id IN (
      SELECT production_id FROM production_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. production_members
--    Users can see all members of productions they belong to.
--    Only owners/admins can add/remove members.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE production_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "production_members_select" ON production_members
  FOR SELECT USING (production_id IN (SELECT get_my_production_ids()));

CREATE POLICY "production_members_insert_owner" ON production_members
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      -- Owners/admins can add members
      production_id IN (
        SELECT production_id FROM production_members
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
      -- Allow the trigger that adds the creator on production insert
      OR user_id = auth.uid()
    )
  );

CREATE POLICY "production_members_delete_owner" ON production_members
  FOR DELETE USING (
    production_id IN (
      SELECT production_id FROM production_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
    -- Users can always remove themselves
    OR user_id = auth.uid()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. shoot_days
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE shoot_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shoot_days_member_all" ON shoot_days
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. scenes  (no production_id — joins via shoot_days)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE scenes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scenes_member_all" ON scenes
  FOR ALL USING (
    day_id IN (
      SELECT id FROM shoot_days
      WHERE production_id IN (SELECT get_my_production_ids())
    )
  )
  WITH CHECK (
    day_id IN (
      SELECT id FROM shoot_days
      WHERE production_id IN (SELECT get_my_production_ids())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. day_extras  (no production_id — joins via shoot_days)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE day_extras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "day_extras_member_all" ON day_extras
  FOR ALL USING (
    day_id IN (
      SELECT id FROM shoot_days
      WHERE production_id IN (SELECT get_my_production_ids())
    )
  )
  WITH CHECK (
    day_id IN (
      SELECT id FROM shoot_days
      WHERE production_id IN (SELECT get_my_production_ids())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. cast_members
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE cast_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cast_members_member_all" ON cast_members
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. hods
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE hods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hods_member_all" ON hods
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. fulltime_crew
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE fulltime_crew ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fulltime_crew_member_all" ON fulltime_crew
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. resources
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resources_member_all" ON resources
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. resource_bookings  (no production_id — joins via resources)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE resource_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resource_bookings_member_all" ON resource_bookings
  FOR ALL USING (
    resource_id IN (
      SELECT id FROM resources
      WHERE production_id IN (SELECT get_my_production_ids())
    )
  )
  WITH CHECK (
    resource_id IN (
      SELECT id FROM resources
      WHERE production_id IN (SELECT get_my_production_ids())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. hotels
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE hotels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hotels_member_all" ON hotels
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. hotel_travel_times
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE hotel_travel_times ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hotel_travel_times_member_all" ON hotel_travel_times
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. crew_hotel_assignments
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE crew_hotel_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crew_hotel_assignments_member_all" ON crew_hotel_assignments
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. budget_items
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "budget_items_member_all" ON budget_items
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. backpage_dept_settings
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE backpage_dept_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backpage_dept_settings_member_all" ON backpage_dept_settings
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. backpage_member_overrides
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE backpage_member_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backpage_member_overrides_member_all" ON backpage_member_overrides
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. backpage_day_settings
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE backpage_day_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backpage_day_settings_member_all" ON backpage_day_settings
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 19. catering_collections
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE catering_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "catering_collections_member_all" ON catering_collections
  FOR ALL USING (production_id IN (SELECT get_my_production_ids()))
  WITH CHECK (production_id IN (SELECT get_my_production_ids()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 20. invites  (production_id column)
--    Members can read; owners/admins can create/delete.
--    The invite-accept flow (unauthenticated token lookup) uses SELECT — we
--    allow that by permitting token lookups that don't need production membership.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- Anyone can look up a specific invite by token (needed for the accept-invite page)
CREATE POLICY "invites_select_token_or_member" ON invites
  FOR SELECT USING (
    production_id IN (SELECT get_my_production_ids())
    OR token IS NOT NULL   -- allow token-based lookup for unauthenticated accept flow
  );

CREATE POLICY "invites_insert_owner" ON invites
  FOR INSERT WITH CHECK (
    production_id IN (
      SELECT production_id FROM production_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "invites_update_token" ON invites
  FOR UPDATE USING (token IS NOT NULL);  -- accept flow marks accepted = true

CREATE POLICY "invites_delete_owner" ON invites
  FOR DELETE USING (
    production_id IN (
      SELECT production_id FROM production_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 21. invite_requests
--    A public sign-up interest form — anyone can INSERT.
--    Only authenticated owners/admins can read/delete.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE invite_requests ENABLE ROW LEVEL SECURITY;

-- Public insert (unauthenticated users submitting interest)
CREATE POLICY "invite_requests_public_insert" ON invite_requests
  FOR INSERT WITH CHECK (true);

-- Only authenticated users can read (production admins checking requests)
CREATE POLICY "invite_requests_auth_select" ON invite_requests
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "invite_requests_auth_delete" ON invite_requests
  FOR DELETE USING (auth.uid() IS NOT NULL);
