begin;

alter table public.comments add column parent_comment_id uuid;
alter table public.comments add constraint comments_post_id_id_unique unique(post_id,id);
alter table public.comments add constraint comments_parent_same_post_fkey
  foreign key(post_id,parent_comment_id) references public.comments(post_id,id) on delete cascade;
create index comments_parent_recent_idx on public.comments(parent_comment_id,created_at,id)
  where parent_comment_id is not null;
grant insert(parent_comment_id) on public.comments to authenticated;

create or replace function private.validate_comment_reply() returns trigger
language plpgsql set search_path='' as $$
declare parent_post_id uuid; grandparent_id uuid;
begin
  if new.parent_comment_id is null then return new; end if;
  select parent.post_id,parent.parent_comment_id into parent_post_id,grandparent_id
  from public.comments parent where parent.id=new.parent_comment_id;
  if not found or parent_post_id is distinct from new.post_id then
    raise exception 'Replies must reference a comment on the same post.';
  end if;
  if grandparent_id is not null then raise exception 'Only one reply level is supported.'; end if;
  return new;
end $$;
revoke all on function private.validate_comment_reply() from public,anon,authenticated;
create trigger validate_comment_reply before insert or update of post_id,parent_comment_id on public.comments
for each row execute function private.validate_comment_reply();

create or replace function private.create_social_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient uuid; item public.notifications;
begin
 if tg_table_name='follows' then recipient:=new.followed_id;
 elsif tg_table_name='likes' then select user_id into recipient from public.posts where id=new.post_id;
 elsif new.parent_comment_id is not null then select user_id into recipient from public.comments where id=new.parent_comment_id;
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

commit;
