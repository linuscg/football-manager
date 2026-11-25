-- AI assistant access (Claude / ChatGPT via the fm-mcp server) is READ-ONLY.
--
-- OAuth access tokens issued by Supabase Auth are ordinary user JWTs plus a
-- client_id claim, so on their own they could write anywhere the user can.
-- These RESTRICTIVE policies block every insert/update/delete made with such a
-- token, on every RLS-enabled table in public — normal app sessions (no
-- client_id) and the service role are unaffected. Reads keep the user's usual
-- RLS (membership, tab gates, rate hiding).
--
-- When assistant writes arrive (phase 2) they'll go through specific
-- SECURITY DEFINER RPCs that do their own checks, not by lifting this.

do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists "oauth_no_insert" on %I', t);
    execute format('drop policy if exists "oauth_no_update" on %I', t);
    execute format('drop policy if exists "oauth_no_delete" on %I', t);
    execute format('create policy "oauth_no_insert" on %I as restrictive for insert
                    with check ((select auth.jwt() ->> ''client_id'') is null)', t);
    execute format('create policy "oauth_no_update" on %I as restrictive for update
                    using ((select auth.jwt() ->> ''client_id'') is null)
                    with check ((select auth.jwt() ->> ''client_id'') is null)', t);
    execute format('create policy "oauth_no_delete" on %I as restrictive for delete
                    using ((select auth.jwt() ->> ''client_id'') is null)', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
