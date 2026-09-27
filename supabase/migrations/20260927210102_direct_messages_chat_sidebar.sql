begin;

create table public.dm_messages (
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 body text not null check(char_length(btrim(body)) between 1 and 1000),
 created_at timestamptz not null default now(),
 check(sender_id<>recipient_id)
);
create index dm_messages_sender_recent_idx on public.dm_messages(sender_id,created_at desc,id desc);
create index dm_messages_recipient_recent_idx on public.dm_messages(recipient_id,created_at desc,id desc);
alter table public.dm_messages enable row level security;
revoke all on public.dm_messages from anon,authenticated;
grant all on public.dm_messages to service_role;
grant select on public.dm_messages to authenticated;
grant insert(recipient_id,body) on public.dm_messages to authenticated;
create policy dm_read_participant on public.dm_messages for select to authenticated using(
 (select auth.uid()) in (sender_id,recipient_id)
 and exists(select 1 from public.friendships f where f.status='accepted'
  and ((f.user_a=sender_id and f.user_b=recipient_id) or (f.user_a=recipient_id and f.user_b=sender_id)))
);
create policy dm_send_friend on public.dm_messages for insert to authenticated with check(
 sender_id=(select auth.uid()) and recipient_id<>(select auth.uid())
 and exists(select 1 from public.friendships f where f.status='accepted'
  and ((f.user_a=sender_id and f.user_b=recipient_id) or (f.user_a=recipient_id and f.user_b=sender_id)))
);
create function private.trim_dm_messages() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 delete from public.dm_messages where id in (
  select id from public.dm_messages
  where (sender_id=new.sender_id and recipient_id=new.recipient_id)
     or (sender_id=new.recipient_id and recipient_id=new.sender_id)
  order by created_at desc,id desc offset 200
 );
 return new;
end $$;
revoke all on function private.trim_dm_messages() from public,anon,authenticated;
create trigger trim_dm after insert on public.dm_messages for each row execute function private.trim_dm_messages();
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
  and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dm_messages') then
  execute 'alter publication supabase_realtime add table public.dm_messages';
 end if;
end $$;

commit;
