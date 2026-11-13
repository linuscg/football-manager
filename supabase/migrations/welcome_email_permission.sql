-- "Can edit the welcome email template" permission: members with
-- permissions->>'allowWelcomeEmailEdit' = true may write the template
-- (owners/admins always can). Enforced here, mirrored in the UI.
create or replace function public.member_can_edit_welcome_email(prod uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from production_members
    where production_id = prod
      and user_id = auth.uid()
      and (role in ('owner', 'admin')
           or coalesce((permissions->>'allowWelcomeEmailEdit')::boolean, false))
  )
$$;

drop policy if exists "wec_insert_admin" on welcome_email_config;
create policy "wec_insert_admin" on welcome_email_config
  for insert with check (member_can_edit_welcome_email(production_id));

drop policy if exists "wec_update_admin" on welcome_email_config;
create policy "wec_update_admin" on welcome_email_config
  for update using (member_can_edit_welcome_email(production_id))
  with check (member_can_edit_welcome_email(production_id));

notify pgrst, 'reload schema';
