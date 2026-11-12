-- Google Sheet link for the crew tracker sync (read server-side by the
-- crew-sheet-sync edge function via a Google service account).
alter table production add column if not exists crew_sheet_url text;
notify pgrst, 'reload schema';
