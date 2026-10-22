-- Equipment split: Run of Show vs additional. Existing equipment defaults to
-- RoS (the first tab); rows are movable via the gantt right-click menu.
alter table public.resources
  add column if not exists equip_class text not null default 'ros';
