-- Apply after schema.sql, admin.sql, profiles.sql and social.sql.
begin;

alter table public.posts alter column album_id drop not null;
alter table public.posts alter column album_title drop not null;
alter table public.posts alter column album_artist drop not null;
alter table public.posts add column post_type text not null default 'album'
  check(post_type in ('album','meme'));
alter table public.posts add column image_path text;
alter table public.posts add column film_wikidata_id text;
alter table public.posts add column film_title text;
alter table public.posts add column film_director text;
alter table public.posts add column film_year integer;
alter table public.posts add column film_poster text;
alter table public.posts add column film_rating numeric(2,1);
alter table public.posts drop constraint posts_post_type_check;
alter table public.posts add constraint posts_post_type_check check(post_type in ('album','meme','film'));
alter table public.posts add constraint posts_content_type_check check (
  (post_type='album' and album_id is not null and album_title is not null and album_artist is not null and image_path is null
   and film_wikidata_id is null and film_title is null and film_director is null and film_year is null and film_poster is null and film_rating is null)
  or
  (post_type='meme' and album_id is null and album_title is null and album_artist is null
   and image_path is not null and image_path ~ ('^'||user_id::text||'/[0-9a-f-]{36}\.jpg$')
   and film_wikidata_id is null and film_title is null and film_director is null and film_year is null and film_poster is null and film_rating is null)
  or
  (post_type='film' and album_id is null and album_title is null and album_artist is null and image_path is null
   and film_wikidata_id ~ '^Q[1-9][0-9]*$' and film_title is not null and char_length(btrim(film_title)) between 1 and 500
   and (film_director is null or char_length(film_director)<=500)
   and (film_year is null or film_year between 1888 and 2100)
   and (film_poster is null or char_length(film_poster)<=500)
   and film_rating is not null and film_rating between 0.5 and 5)
);
grant insert(post_type,image_path) on public.posts to authenticated;
grant insert(film_wikidata_id,film_title,film_director,film_year,film_poster,film_rating) on public.posts to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('post-images','post-images',true,1048576,array['image/jpeg']);
create policy post_images_insert_self on storage.objects for insert to authenticated with check (
 bucket_id='post-images' and name ~ ('^'||(select auth.uid())::text||'/[0-9a-f-]{36}\.jpg$')
 and exists(select 1 from public.profiles where id=(select auth.uid()) and not suspended)
);
create policy post_images_delete_self on storage.objects for delete to authenticated using (
 bucket_id='post-images' and name like (select auth.uid())::text||'/%'
);

-- Hard per-account cap keeps the free storage tier bounded even if a client fails to clean up.
create function private.limit_post_images_per_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_owner_id uuid;
begin
 if new.bucket_id='post-images' then
  v_owner_id:=split_part(new.name,'/',1)::uuid;
  perform pg_advisory_xact_lock(hashtextextended(v_owner_id::text,0));
  if (select count(*) from storage.objects existing_image where existing_image.bucket_id='post-images' and existing_image.name like v_owner_id::text||'/%')>=15 then
   raise exception 'Image storage limit reached';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.limit_post_images_per_user() from public,anon,authenticated;
create trigger limit_post_images before insert on storage.objects for each row execute function private.limit_post_images_per_user();

create table public.chat_messages (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 body text not null check(char_length(btrim(body)) between 1 and 500),
 created_at timestamptz not null default now()
);
create index chat_messages_recent_idx on public.chat_messages(created_at desc,id desc);
create index chat_messages_user_id_idx on public.chat_messages(user_id);
alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from anon,authenticated;
grant select on public.chat_messages to anon,authenticated;
grant insert(body) on public.chat_messages to authenticated;
grant delete on public.chat_messages to authenticated;
grant all on public.chat_messages to service_role;
create policy chat_read on public.chat_messages for select to anon,authenticated using(true);
create policy chat_insert_self on public.chat_messages for insert to authenticated with check(
 user_id=(select auth.uid()) and exists(select 1 from public.profiles where id=user_id and not suspended)
);
create policy chat_delete_self on public.chat_messages for delete to authenticated using(user_id=(select auth.uid()));

create function private.trim_chat_messages() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(726304);
 delete from public.chat_messages where id in (
  select id from public.chat_messages order by created_at desc,id desc offset 500
 );
 return new;
end $$;
revoke all on function private.trim_chat_messages() from public,anon,authenticated;
create trigger trim_chat after insert on public.chat_messages for each row execute function private.trim_chat_messages();

do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
  and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages') then
  execute 'alter publication supabase_realtime add table public.chat_messages';
 end if;
end $$;

commit;
