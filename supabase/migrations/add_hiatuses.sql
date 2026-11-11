-- Shoot hiatuses: titled date ranges stored per production.
-- Shape: [{ "id": uuid, "title": text, "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }]
alter table public.production
  add column if not exists hiatuses jsonb not null default '[]';
