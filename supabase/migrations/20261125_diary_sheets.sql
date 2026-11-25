-- Diary board (TV view): links to the production diary and travel/accom log
-- Google Sheets, read server-side by the diary-board edge function.
alter table production add column if not exists diary_sheet_url text;
alter table production add column if not exists travel_sheet_url text;
notify pgrst, 'reload schema';
