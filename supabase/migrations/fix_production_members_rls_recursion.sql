-- Fix infinite recursion in production_members RLS policies.
-- The DELETE (and INSERT) policies were querying production_members directly,
-- which re-triggered the SELECT policy, causing recursion.
-- Solution: a SECURITY DEFINER function that bypasses RLS for the admin check.

CREATE OR REPLACE FUNCTION is_production_admin(prod_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM production_members
    WHERE production_id = prod_id
      AND user_id       = auth.uid()
      AND role          IN ('owner', 'admin')
  )
$$;

-- Rebuild the DELETE policy using the helper
DROP POLICY IF EXISTS "production_members_delete_owner" ON production_members;
CREATE POLICY "production_members_delete_owner" ON production_members
  FOR DELETE USING (
    is_production_admin(production_id)
    OR user_id = auth.uid()
  );

-- Rebuild the INSERT policy using the helper (same recursion risk)
DROP POLICY IF EXISTS "production_members_insert_owner" ON production_members;
CREATE POLICY "production_members_insert_owner" ON production_members
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      is_production_admin(production_id)
      OR user_id = auth.uid()
    )
  );
