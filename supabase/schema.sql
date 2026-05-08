-- Run this once in the Supabase SQL editor (supabase.com → your project → SQL Editor)

-- Production metadata
create table if not exists production (
  id        uuid primary key default gen_random_uuid(),
  name      text not null default 'Untitled Production',
  prep_start_date date,
  created_at timestamptz default now()
);

-- Shoot days
create table if not exists shoot_days (
  id              uuid primary key default gen_random_uuid(),
  production_id   uuid references production(id) on delete cascade,
  day_number      integer,          -- null for non-shooting days
  date            date,
  location        text default '',
  unit_base       text default '',
  general_call    time,
  is_non_shoot_day boolean not null default false,
  notes           text default '',
  sort_order      integer not null default 0,
  created_at      timestamptz default now()
);

-- Scenes (child of shoot_days)
create table if not exists scenes (
  id          uuid primary key default gen_random_uuid(),
  day_id      uuid references shoot_days(id) on delete cascade,
  scene_number text default '',
  int_ext      text not null default 'INT' check (int_ext in ('INT','EXT')),
  location     text default '',
  day_night    text not null default 'DAY' check (day_night in ('DAY','NIGHT')),
  description  text default '',
  pages        text default '',
  sort_order   integer not null default 0,
  created_at   timestamptz default now()
);

-- Enable real-time on both tables (needed for multi-user live updates)
alter publication supabase_realtime add table shoot_days;
alter publication supabase_realtime add table scenes;

-- Insert a default production row to get started
insert into production (name) values ('Untitled Production');

-- ─── Migrations (run in Supabase SQL editor after initial setup) ──────────────

-- Film vs TV format + episode count (added for format toggle feature)
alter table production add column if not exists format text default 'film';
alter table production add column if not exists episode_count integer;

-- Episode number on scenes (for TV episode assignment)
alter table scenes add column if not exists episode_number integer;

-- Heads of Department (separate from crew/resources table)
create table if not exists hods (
  id            uuid primary key default gen_random_uuid(),
  production_id uuid references production(id) on delete cascade,
  name          text not null default '',
  title         text not null default '',
  phone         text not null default '',
  email         text not null default '',
  sort_order    integer not null default 0,
  created_at    timestamptz default now()
);

-- Fulltime crew list (Crew Times module — Step 2)
create table if not exists fulltime_crew (
  id            uuid primary key default gen_random_uuid(),
  production_id uuid references production(id) on delete cascade,
  name          text not null default '',
  department    text not null default '',
  role          text not null default '',
  phone         text not null default '',
  email         text not null default '',
  sort_order    integer not null default 0,
  created_at    timestamptz default now()
);

-- Backpage department settings (Crew Times module — Step 3)
create table if not exists backpage_dept_settings (
  id            uuid primary key default gen_random_uuid(),
  production_id uuid references production(id) on delete cascade,
  day_id        uuid references shoot_days(id) on delete cascade,
  department    text not null default '',
  pre_call_mins integer not null default 0,
  derig_mins    integer not null default 0,
  created_at    timestamptz default now()
);
alter publication supabase_realtime add table backpage_dept_settings;
