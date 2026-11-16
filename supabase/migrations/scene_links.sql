-- First-class scene links for scene-attached rows (SAs now; special equipment
-- etc. later). scene_id is the real link; the scene-number text stays as a
-- display label. One trigger keeps every child row on its scene's day and
-- label in sync — drags, imports and renumbering all covered automatically.

alter table day_extras add column if not exists scene_id uuid references scenes(id) on delete set null;

-- Backfill: link rows whose (day, scene text) identifies exactly one scene.
update day_extras de set scene_id = s.id
from scenes s
where de.scene_id is null
  and de.category = 'extras'
  and s.day_id = de.day_id
  and btrim(coalesce(de.scene, '')) <> ''
  and btrim(s.scene_number) = btrim(de.scene)
  and (select count(*) from scenes s2
       where s2.day_id = de.day_id and btrim(s2.scene_number) = btrim(de.scene)) = 1;

-- When a scene moves day or is renumbered, re-home/relabel its children.
-- FUTURE per-scene tables: add one UPDATE per table in this function.
create or replace function public.sync_scene_children()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update day_extras
     set day_id = new.day_id, scene = new.scene_number
   where scene_id = new.id
     and (day_id is distinct from new.day_id or scene is distinct from new.scene_number);
  return new;
end $$;

drop trigger if exists scenes_sync_children on scenes;
create trigger scenes_sync_children
after update of day_id, scene_number on scenes
for each row execute function public.sync_scene_children();

notify pgrst, 'reload schema';
