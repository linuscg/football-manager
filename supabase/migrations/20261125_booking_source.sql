-- Where a gantt booking came from: 'sheet' = created by the crew sheet sync
-- (from an "X" in the tracker's day columns). The sync only ever removes its
-- own 'sheet' bookings when the X goes; days painted in the app (null) are
-- never removed by it.
alter table resource_bookings add column if not exists source text;
notify pgrst, 'reload schema';
