-- Transport sheet rows remember which log trip they came from, so the sheet
-- auto-populates from the log without duplicating, and removing a trip from
-- the log removes its sheet row.
alter table transport_sheet_rows add column if not exists log_id uuid;
create index if not exists transport_sheet_rows_log_id_idx on transport_sheet_rows (log_id);
notify pgrst, 'reload schema';
