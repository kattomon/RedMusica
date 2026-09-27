-- Run after schema.sql, admin.sql and profiles.sql.
create table public.follows (
 user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 followed_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(user_id,followed_id), check(user_id<>followed_id)
);
create index follows_followed_idx on public.follows(followed_id,created_at desc);
create table public.notifications (
 id uuid primary key default gen_random_uuid(),
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 actor_id uuid references public.profiles(id) on delete set null,
 kind text not null check(kind in ('comment','like','follow')),
 post_id uuid references public.posts(id) on delete cascade,
 comment_id uuid references public.comments(id) on delete cascade,
 created_at timestamptz not null default now(),
 read_at timestamptz,
 check(recipient_id is distinct from actor_id),
 check((kind='follow' and post_id is null and comment_id is null) or
       (kind='like' and post_id is not null and comment_id is null) or
       (kind='comment' and post_id is not null and comment_id is not null))
);
create index notifications_recipient_recent_idx on public.notifications(recipient_id,created_at desc,id desc);
create index notifications_unread_idx on public.notifications(recipient_id) where read_at is null;
create index notifications_actor_idx on public.notifications(actor_id);
create index notifications_post_idx on public.notifications(post_id);
create index notifications_comment_idx on public.notifications(comment_id);
create unique index notifications_like_dedupe on public.notifications(recipient_id,actor_id,post_id) where kind='like';
create unique index notifications_follow_dedupe on public.notifications(recipient_id,actor_id) where kind='follow';
alter table public.follows enable row level security;
alter table public.notifications enable row level security;
revoke all on public.follows,public.notifications from anon,authenticated;
grant all on public.follows,public.notifications to service_role;
grant select on public.follows to anon,authenticated;
grant insert(followed_id) on public.follows to authenticated;
grant delete on public.follows to authenticated;
grant select on public.notifications to authenticated;
grant update(read_at) on public.notifications to authenticated;
create policy follows_read on public.follows for select to anon,authenticated using(true);
create policy follows_self_insert on public.follows for insert to authenticated with check(
 user_id=(select auth.uid()) and exists(select 1 from public.profiles where id=user_id and not suspended)
 and exists(select 1 from public.profiles where id=followed_id and not suspended));
create policy follows_self_delete on public.follows for delete to authenticated using(user_id=(select auth.uid()));
create policy notifications_read_self on public.notifications for select to authenticated using(recipient_id=(select auth.uid()));
create policy notifications_mark_read_self on public.notifications for update to authenticated using(recipient_id=(select auth.uid())) with check(recipient_id=(select auth.uid()));

create function private.create_social_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient uuid; item public.notifications;
begin
 if tg_table_name='follows' then recipient:=new.followed_id;
 elsif tg_table_name='likes' then select user_id into recipient from public.posts where id=new.post_id;
 else select user_id into recipient from public.posts where id=new.post_id;
 end if;
 if recipient is not null and recipient<>new.user_id then
  begin
   if tg_table_name='follows' then
    insert into public.notifications(recipient_id,actor_id,kind) values(recipient,new.user_id,'follow');
   elsif tg_table_name='likes' then
    insert into public.notifications(recipient_id,actor_id,kind,post_id) values(recipient,new.user_id,'like',new.post_id);
   else
    insert into public.notifications(recipient_id,actor_id,kind,post_id,comment_id) values(recipient,new.user_id,'comment',new.post_id,new.id);
   end if;
  exception when unique_violation then null;
  end;
  delete from public.notifications where id in
   (select id from public.notifications where recipient_id=recipient order by created_at desc,id desc offset 100);
 end if;
 return new;
end $$;
revoke all on function private.create_social_notification() from public,anon,authenticated;
create trigger notify_new_follow after insert on public.follows for each row execute function private.create_social_notification();
create trigger notify_new_like after insert on public.likes for each row execute function private.create_social_notification();
create trigger notify_new_comment after insert on public.comments for each row execute function private.create_social_notification();

create function private.remove_social_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
 if tg_table_name='follows' then
  delete from public.notifications where kind='follow' and actor_id=old.user_id and recipient_id=old.followed_id;
 elsif tg_table_name='likes' then
  select user_id into recipient from public.posts where id=old.post_id;
  delete from public.notifications where kind='like' and actor_id=old.user_id and recipient_id=recipient and post_id=old.post_id;
 end if;
 return old;
end $$;
revoke all on function private.remove_social_notification() from public,anon,authenticated;
create trigger remove_follow_notification after delete on public.follows for each row execute function private.remove_social_notification();
create trigger remove_like_notification after delete on public.likes for each row execute function private.remove_social_notification();
