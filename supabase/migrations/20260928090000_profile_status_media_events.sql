-- Estados breves, álbumes fotográficos y eventos sociales.
alter table public.profiles
  add column status_text text not null default '' check (char_length(status_text) <= 100);
grant update(status_text) on public.profiles to authenticated;

-- El muro admite publicaciones libres y mantiene albums, memes y reseñas existentes.
alter table public.posts add column link_url text;
alter table public.posts drop constraint posts_post_type_check;
alter table public.posts add constraint posts_post_type_check check(post_type in ('album','meme','film','status'));
alter table public.posts drop constraint posts_content_type_check;
alter table public.posts add constraint posts_content_type_check check (
  (post_type='album' and album_id is not null and album_title is not null and album_artist is not null and image_path is null and link_url is null
   and film_wikidata_id is null and film_tmdb_id is null and film_title is null and film_director is null and film_year is null and film_poster is null and film_rating is null)
  or
  (post_type='meme' and album_id is null and album_title is null and album_artist is null and link_url is null
   and image_path is not null and image_path ~ ('^'||user_id::text||'/[0-9a-f-]{36}\.(jpg|gif)$')
   and film_wikidata_id is null and film_tmdb_id is null and film_title is null and film_director is null and film_year is null and film_poster is null and film_rating is null)
  or
  (post_type='film' and album_id is null and album_title is null and album_artist is null and image_path is null and link_url is null
   and film_title is not null and char_length(btrim(film_title)) between 1 and 500
   and (film_wikidata_id is null or film_wikidata_id ~ '^Q[1-9][0-9]*$')
   and (film_director is null or char_length(film_director)<=500)
   and (film_year is null or film_year between 1888 and 2100)
   and (film_poster is null or char_length(film_poster)<=500)
   and film_rating is not null and film_rating between 0.5 and 5)
  or
  (post_type='status' and album_id is null and album_title is null and album_artist is null
   and (image_path is null or image_path ~ ('^'||user_id::text||'/[0-9a-f-]{36}\.jpg$'))
   and (link_url is null or (char_length(link_url)<=1000 and link_url ~ '^https://'))
   and (char_length(btrim(body))>0 or image_path is not null or link_url is not null)
   and film_wikidata_id is null and film_tmdb_id is null and film_title is null and film_director is null and film_year is null and film_poster is null and film_rating is null)
);
alter table public.posts drop constraint posts_body_check;
alter table public.posts add constraint posts_body_check check(
  (post_type='status' and char_length(btrim(body))<=5000) or
  (post_type<>'status' and char_length(btrim(body)) between 1 and 5000)
);
grant insert(post_type, image_path, link_url) on public.posts to authenticated;

create table public.profile_photo_albums (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id)
);
create index profile_photo_albums_owner_idx on public.profile_photo_albums(user_id, created_at desc);

create table public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  object_path text not null unique,
  caption text not null default '' check (char_length(caption) <= 160),
  created_at timestamptz not null default now(),
  foreign key (album_id, user_id) references public.profile_photo_albums(id, user_id) on delete cascade,
  check (object_path ~ ('^'||user_id::text||'/[0-9a-f-]{36}\.jpg$'))
);
create index profile_photos_album_recent_idx on public.profile_photos(album_id, created_at desc);
create index profile_photos_owner_recent_idx on public.profile_photos(user_id, created_at desc);
alter table public.profile_photo_albums enable row level security;
alter table public.profile_photos enable row level security;
revoke all on public.profile_photo_albums, public.profile_photos from anon, authenticated;
grant all on public.profile_photo_albums, public.profile_photos to service_role;
grant select on public.profile_photo_albums, public.profile_photos to authenticated;
grant insert(name) on public.profile_photo_albums to authenticated;
grant insert(album_id, object_path, caption) on public.profile_photos to authenticated;
grant delete on public.profile_photos to authenticated;
create policy profile_photo_albums_read on public.profile_photo_albums for select to authenticated using (true);
create policy profile_photo_albums_create_self on public.profile_photo_albums for insert to authenticated with check (
  user_id = (select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and not p.suspended)
);
create policy profile_photos_read on public.profile_photos for select to authenticated using (true);
create policy profile_photos_create_self on public.profile_photos for insert to authenticated with check (
  user_id = (select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and not p.suspended)
  and exists(select 1 from public.profile_photo_albums a where a.id=album_id and a.user_id=(select auth.uid()))
);
create policy profile_photos_delete_self on public.profile_photos for delete to authenticated using (user_id=(select auth.uid()));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', true, 1048576, array['image/jpeg']);
create policy profile_photos_upload_self on storage.objects for insert to authenticated with check (
  bucket_id='profile-photos' and name ~ ('^'||(select auth.uid())::text||'/[0-9a-f-]{36}\.jpg$')
  and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and not p.suspended)
);
create policy profile_photos_remove_self on storage.objects for delete to authenticated using (
  bucket_id='profile-photos' and name like (select auth.uid())::text||'/%'
);

create function private.limit_profile_photos_per_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_owner_id uuid;
begin
  v_owner_id := new.user_id;
  perform pg_advisory_xact_lock(hashtextextended(v_owner_id::text, 0));
  if (select count(*) from public.profile_photos p where p.user_id=v_owner_id) >= 20 then
    raise exception 'Profile photo limit reached';
  end if;
  return new;
end $$;
revoke all on function private.limit_profile_photos_per_user() from public, anon, authenticated;
create trigger limit_profile_photos before insert on public.profile_photos for each row execute function private.limit_profile_photos_per_user();

create table public.events (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 100),
  venue text not null default '' check (char_length(venue) <= 120),
  description text not null default '' check (char_length(description) <= 800),
  starts_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index events_upcoming_idx on public.events(starts_at, created_at desc);
create index events_host_idx on public.events(host_id, starts_at desc);
alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
grant all on public.events to service_role;
grant select on public.events to authenticated;
grant insert(title, venue, description, starts_at) on public.events to authenticated;
grant delete on public.events to authenticated;
create policy events_read_authenticated on public.events for select to authenticated using (starts_at > now() - interval '30 days');
create policy events_create_self on public.events for insert to authenticated with check (
  host_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and not p.suspended)
  and starts_at > now() and (select count(*) from public.events e where e.host_id=(select auth.uid()) and e.starts_at > now()) < 20
);
create policy events_delete_host on public.events for delete to authenticated using (host_id=(select auth.uid()));

create table public.event_invites (
  event_id uuid not null references public.events(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  inviter_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  response text not null default 'invited' check (response in ('invited','going','interested','declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key(event_id, invitee_id),
  check (invitee_id <> inviter_id)
);
create index event_invites_inbox_idx on public.event_invites(invitee_id, response, created_at desc);
create index event_invites_host_idx on public.event_invites(inviter_id, event_id);
alter table public.event_invites enable row level security;
revoke all on public.event_invites from anon, authenticated;
grant all on public.event_invites to service_role;
grant select on public.event_invites to authenticated;
grant insert(event_id, invitee_id) on public.event_invites to authenticated;
grant update(response, responded_at) on public.event_invites to authenticated;
create policy event_invites_participants_read on public.event_invites for select to authenticated using (
  inviter_id=(select auth.uid()) or invitee_id=(select auth.uid()) or exists(
    select 1 from public.events e where e.id=event_id and e.host_id=(select auth.uid())
  )
);
create policy event_invites_friend_only on public.event_invites for insert to authenticated with check (
  inviter_id=(select auth.uid()) and invitee_id<>(select auth.uid())
  and exists(select 1 from public.events e where e.id=event_id and e.host_id=(select auth.uid()) and e.starts_at>now())
  and exists(select 1 from public.friendships f where f.status='accepted'
    and f.user_a=least((select auth.uid()),invitee_id) and f.user_b=greatest((select auth.uid()),invitee_id))
  and exists(select 1 from public.profiles p where p.id=invitee_id and not p.suspended)
);
create policy event_invites_guest_respond on public.event_invites for update to authenticated
using (invitee_id=(select auth.uid()))
with check (invitee_id=(select auth.uid()) and response in ('going','interested','declined'));

create table public.game_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 100),
  platform text not null check (char_length(btrim(platform)) between 1 and 60),
  genre text not null default '' check (char_length(genre) <= 50),
  reason text not null check (char_length(btrim(reason)) between 1 and 700),
  created_at timestamptz not null default now()
);
create index game_recommendations_recent_idx on public.game_recommendations(created_at desc, id desc);
create index game_recommendations_user_recent_idx on public.game_recommendations(user_id, created_at desc);
alter table public.game_recommendations enable row level security;
revoke all on public.game_recommendations from anon, authenticated;
grant all on public.game_recommendations to service_role;
grant select on public.game_recommendations to authenticated;
grant insert(title, platform, genre, reason) on public.game_recommendations to authenticated;
grant delete on public.game_recommendations to authenticated;
create policy game_recommendations_read on public.game_recommendations for select to authenticated using (true);
create policy game_recommendations_add_self on public.game_recommendations for insert to authenticated with check (
  user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and not p.suspended)
  and (select count(*) from public.game_recommendations r where r.user_id=(select auth.uid())) < 50
);
create policy game_recommendations_delete_self on public.game_recommendations for delete to authenticated using (user_id=(select auth.uid()));

create table public.game_recommendation_votes (
  recommendation_id uuid not null references public.game_recommendations(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(recommendation_id, user_id)
);
create index game_recommendation_votes_user_idx on public.game_recommendation_votes(user_id,created_at desc);
alter table public.game_recommendation_votes enable row level security;
revoke all on public.game_recommendation_votes from anon, authenticated;
grant all on public.game_recommendation_votes to service_role;
grant select on public.game_recommendation_votes to authenticated;
grant insert(recommendation_id) on public.game_recommendation_votes to authenticated;
grant delete on public.game_recommendation_votes to authenticated;
create policy game_votes_read on public.game_recommendation_votes for select to authenticated using (true);
create policy game_votes_add_self on public.game_recommendation_votes for insert to authenticated with check (
  user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and not p.suspended)
);
create policy game_votes_remove_self on public.game_recommendation_votes for delete to authenticated using (user_id=(select auth.uid()));
