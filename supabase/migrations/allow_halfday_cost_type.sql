-- Allow 'halfday' as a resource cost type (was daily/weekly only).
ALTER TABLE resources DROP CONSTRAINT IF EXISTS resources_cost_type_check;
ALTER TABLE resources ADD CONSTRAINT resources_cost_type_check
  CHECK (cost_type = ANY (ARRAY['daily','halfday','weekly']));
