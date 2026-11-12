-- Google Sheet sync round 2:
--   • five tracker columns that previously had no app counterpart
--   • sheet_synced flags rows whose data is managed by the linked sheet
--     (locked in the Crew Tracker UI; cleared by clicking the green dot)
alter table resources add column if not exists payroll_forwarded text;
alter table resources add column if not exists deal_memo_executed text;
alter table resources add column if not exists team_engine text;
alter table resources add column if not exists shoot_crew text;
alter table resources add column if not exists rtw_check text;
alter table resources add column if not exists sheet_synced boolean not null default false;
notify pgrst, 'reload schema';
