-- Restore client write paths after removing the broader legacy policies. Restrictive
-- policies alone cannot authorize a command, so these permissive policies provide
-- narrowly scoped access for an active user to their own posts.
begin;

drop policy if exists posts_active_insert on public.posts;
create policy posts_active_insert on public.posts as permissive for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and not p.suspended)
  and (select s.accept_posts from public.site_settings s where s.id = 1)
);

drop policy if exists posts_active_update on public.posts;
create policy posts_active_update on public.posts as permissive for update to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and not p.suspended))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and not p.suspended));

drop policy if exists posts_active_delete on public.posts;
create policy posts_active_delete on public.posts as permissive for delete to authenticated using (
  user_id = (select auth.uid())
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and not p.suspended)
);

commit;
