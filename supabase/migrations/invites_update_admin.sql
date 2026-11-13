-- Allow production owners/admins to edit pending invites (used to change a
-- pending invite's pre-set access from User Management).
drop policy if exists "invites_update_admin" on public.invites;
create policy "invites_update_admin" on public.invites
  for update using (is_production_admin(production_id))
  with check (is_production_admin(production_id));
notify pgrst, 'reload schema';
