-- Unify all crew (fulltime + HODs + additional) into the resources/gantt system.
-- crew_class distinguishes fulltime vs additional; is_hod marks Heads of Department.
-- Rows are migrated KEEPING their original ids so backpage overrides, new-starter
-- statuses and other references stay linked. Old tables are left in place (unread).
ALTER TABLE resources ADD COLUMN IF NOT EXISTS crew_class text NOT NULL DEFAULT 'additional';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 5;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS is_hod boolean NOT NULL DEFAULT false;

INSERT INTO resources (id, production_id, type, crew_class, is_hod, name, department, role,
                       contact_phone, contact_email, hire_start_date, hire_end_date, level, sort_order)
SELECT f.id, f.production_id, 'crew', 'fulltime', false, f.name, f.department, f.role,
       f.phone, f.email, f.start_date, f.end_date, COALESCE(f.level,5), f.sort_order
FROM fulltime_crew f
ON CONFLICT (id) DO NOTHING;

INSERT INTO resources (id, production_id, type, crew_class, is_hod, name, department, role,
                       contact_phone, contact_email, hire_start_date, hire_end_date, level, sort_order)
SELECT h.id, h.production_id, 'crew', 'fulltime', true, h.name, h.department, h.title,
       h.phone, h.email, h.start_date, h.end_date, COALESCE(h.level,1), h.sort_order
FROM hods h
ON CONFLICT (id) DO NOTHING;

-- Auto-book weekdays across each fulltime member's hire range.
INSERT INTO resource_bookings (id, resource_id, booking_date, status)
SELECT gen_random_uuid(), r.id, d::date, 'booked'
FROM resources r
CROSS JOIN LATERAL generate_series(r.hire_start_date, r.hire_end_date, interval '1 day') AS d
WHERE r.type='crew' AND r.crew_class='fulltime'
  AND r.hire_start_date IS NOT NULL AND r.hire_end_date IS NOT NULL
  AND extract(dow from d) NOT IN (0,6)
  AND NOT EXISTS (SELECT 1 FROM resource_bookings b WHERE b.resource_id=r.id AND b.booking_date=d::date);
