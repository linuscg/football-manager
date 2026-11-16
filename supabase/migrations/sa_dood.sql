-- Supporting Artists module: linking + Day-out-of-Days metadata on SA rows.
--   link_key — rows on the SAME day sharing a link_key are the same group of
--              people appearing in several scenes; day totals count them once.
--   dood_id  — the DooD report's row id (e.g. '104'), set by the DooD import.
alter table day_extras add column if not exists link_key text;
alter table day_extras add column if not exists dood_id text;
notify pgrst, 'reload schema';
