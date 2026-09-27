begin;

alter table public.posts add column film_tmdb_id bigint;
alter table public.posts drop constraint posts_content_type_check;
alter table public.posts add constraint posts_content_type_check check (
  (post_type='album' and album_id is not null and album_title is not null and album_artist is not null and image_path is null
   and film_wikidata_id is null and film_tmdb_id is null and film_title is null and film_director is null and film_year is null and film_poster is null and film_rating is null)
  or
  (post_type='meme' and album_id is null and album_title is null and album_artist is null and image_path is not null
   and image_path ~ ('^'||user_id::text||'/[0-9a-f-]{36}\.jpg$') and film_wikidata_id is null and film_tmdb_id is null
   and film_title is null and film_director is null and film_year is null and film_poster is null and film_rating is null)
  or
  (post_type='film' and album_id is null and album_title is null and album_artist is null and image_path is null
   and ((film_wikidata_id is not null and film_wikidata_id ~ '^Q[1-9][0-9]*$' and film_tmdb_id is null) or (film_wikidata_id is null and film_tmdb_id is not null and film_tmdb_id>0))
   and film_title is not null and char_length(btrim(film_title)) between 1 and 500
   and (film_director is null or char_length(film_director)<=500)
   and (film_year is null or film_year between 1888 and 2100)
   and (film_poster is null or char_length(film_poster)<=500)
   and film_rating is not null and film_rating between 0.5 and 5)
);
grant insert(film_tmdb_id) on public.posts to authenticated;

create table public.saved_posts (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,post_id)
);
create index saved_posts_user_recent_idx on public.saved_posts(user_id,created_at desc);
alter table public.saved_posts enable row level security;
revoke all on public.saved_posts from anon,authenticated;
grant all on public.saved_posts to service_role;
grant select on public.saved_posts to authenticated;
grant insert(post_id) on public.saved_posts to authenticated;
grant delete on public.saved_posts to authenticated;
create policy saved_posts_owner_read on public.saved_posts for select to authenticated using(user_id=(select auth.uid()));
create policy saved_posts_owner_add on public.saved_posts for insert to authenticated with check(
  user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and not p.suspended)
);
create policy saved_posts_owner_delete on public.saved_posts for delete to authenticated using(user_id=(select auth.uid()));

create table public.personal_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null check(char_length(btrim(name)) between 1 and 50 and name=btrim(name)),
  created_at timestamptz not null default now()
);
create unique index personal_lists_user_name_idx on public.personal_lists(user_id,lower(name));
create index personal_lists_user_recent_idx on public.personal_lists(user_id,created_at desc);
alter table public.personal_lists enable row level security;
revoke all on public.personal_lists from anon,authenticated;
grant all on public.personal_lists to service_role;
grant select on public.personal_lists to authenticated;
grant insert(name) on public.personal_lists to authenticated;
grant update(name) on public.personal_lists to authenticated;
grant delete on public.personal_lists to authenticated;
create policy personal_lists_owner_read on public.personal_lists for select to authenticated using(user_id=(select auth.uid()));
create policy personal_lists_owner_add on public.personal_lists for insert to authenticated with check(
  user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and not p.suspended)
);
create policy personal_lists_owner_edit on public.personal_lists for update to authenticated
  using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy personal_lists_owner_delete on public.personal_lists for delete to authenticated using(user_id=(select auth.uid()));

create table public.personal_list_items (
  list_id uuid not null references public.personal_lists(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(list_id,post_id)
);
create index personal_list_items_recent_idx on public.personal_list_items(list_id,created_at desc);
alter table public.personal_list_items enable row level security;
revoke all on public.personal_list_items from anon,authenticated;
grant all on public.personal_list_items to service_role;
grant select,insert,delete on public.personal_list_items to authenticated;
create policy personal_list_items_owner_read on public.personal_list_items for select to authenticated using(
  exists(select 1 from public.personal_lists l where l.id=list_id and l.user_id=(select auth.uid()))
);
create policy personal_list_items_owner_add on public.personal_list_items for insert to authenticated with check(
  exists(select 1 from public.personal_lists l where l.id=list_id and l.user_id=(select auth.uid()))
);
create policy personal_list_items_owner_delete on public.personal_list_items for delete to authenticated using(
  exists(select 1 from public.personal_lists l where l.id=list_id and l.user_id=(select auth.uid()))
);

commit;
