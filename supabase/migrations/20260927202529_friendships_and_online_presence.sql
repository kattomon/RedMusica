begin;

create table public.friendships (
 user_a uuid not null references public.profiles(id) on delete cascade,
 user_b uuid not null references public.profiles(id) on delete cascade,
 requested_by uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','declined')),
 created_at timestamptz not null default now(),
 primary key(user_a,user_b),
 check(user_a<user_b),
 check(requested_by in (user_a,user_b))
);
create index friendships_user_b_recent_idx on public.friendships(user_b,created_at desc);
create index friendships_requester_recent_idx on public.friendships(requested_by,created_at desc);

alter table public.friendships enable row level security;
revoke all on public.friendships from anon,authenticated;
grant all on public.friendships to service_role;
grant select on public.friendships to authenticated;
grant insert(user_a,user_b,requested_by) on public.friendships to authenticated;
grant update(status) on public.friendships to authenticated;
grant delete on public.friendships to authenticated;

create policy friendships_participant_read on public.friendships for select to authenticated using((select auth.uid()) in (user_a,user_b));
create policy friendships_send_request on public.friendships for insert to authenticated with check(
 requested_by=(select auth.uid()) and status='pending'
 and exists(select 1 from public.profiles p where p.id=requested_by and not p.suspended)
 and exists(select 1 from public.profiles p where p.id=case when requested_by=user_a then user_b else user_a end and not p.suspended));
create policy friendships_respond on public.friendships for update to authenticated
 using(status='pending' and requested_by<>(select auth.uid()) and (select auth.uid()) in (user_a,user_b))
 with check(status in ('accepted','declined') and requested_by<>(select auth.uid()) and (select auth.uid()) in (user_a,user_b));
create policy friendships_remove on public.friendships for delete to authenticated using(
 ((select auth.uid())=requested_by and status in ('pending','declined'))
 or ((select auth.uid()) in (user_a,user_b) and status in ('accepted','declined')));

commit;
