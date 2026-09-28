-- Community concert history, book reviews, and a searchable shared game catalogue.
begin;

-- Book reviews use the same social feed, likes, and comment threads as films and albums.
alter table public.posts
  add column book_google_id text,
  add column book_title text,
  add column book_authors text not null default '',
  add column book_year integer,
  add column book_cover text,
  add column book_rating numeric(2,1);
alter table public.posts drop constraint posts_post_type_check;
alter table public.posts add constraint posts_post_type_check check(post_type in ('album','meme','film','status','book'));
alter table public.posts drop constraint posts_content_type_check;
alter table public.posts add constraint posts_content_type_check check (
 (post_type='album' and album_id is not null and album_title is not null and album_artist is not null and image_path is null and link_url is null
  and film_wikidata_id is null and film_tmdb_id is null and film_title is null and film_director is null and film_year is null and film_poster is null and film_rating is null)
 or
 (post_type='meme' and album_id is null and album_title is null and album_artist is null and link_url is null and image_path is not null
  and image_path ~ ('^'||user_id::text||'/[0-9a-f-]{36}\.(jpg|gif)$')
  and film_wikidata_id is null and film_tmdb_id is null and film_title is null and film_director is null and film_year is null and film_poster is null and film_rating is null)
 or
 (post_type='film' and album_id is null and album_title is null and album_artist is null and image_path is null and link_url is null
  and film_title is not null and char_length(btrim(film_title)) between 1 and 500
  and (film_wikidata_id is null or film_wikidata_id ~ '^Q[1-9][0-9]*$')
  and (film_tmdb_id is null or film_tmdb_id>0)
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
 or
 (post_type='book' and album_id is null and album_title is null and album_artist is null and image_path is null and link_url is null
  and film_wikidata_id is null and film_tmdb_id is null and film_title is null and film_director is null and film_year is null and film_poster is null and film_rating is null
  and book_google_id ~ '^[A-Za-z0-9_-]{1,128}$' and book_title is not null and char_length(btrim(book_title)) between 1 and 500
  and char_length(book_authors)<=500 and (book_year is null or book_year between 0 and 2100)
  and (book_cover is null or (char_length(book_cover)<=1000 and book_cover ~ '^https://'))
  and book_rating is not null and book_rating between 0.5 and 5)
);
alter table public.posts add constraint posts_book_metadata_check check (
 post_type='book' or (book_google_id is null and book_title is null and book_authors='' and book_year is null and book_cover is null and book_rating is null)
);
grant insert(book_google_id,book_title,book_authors,book_year,book_cover,book_rating) on public.posts to authenticated;

-- A shared community catalogue with one attendance row per user and concert.
create table public.concerts (
 id uuid primary key default gen_random_uuid(),
 artist text not null check(char_length(btrim(artist)) between 1 and 120),
 concert_date date not null,
 venue text not null check(char_length(btrim(venue)) between 1 and 120),
 city text not null check(char_length(btrim(city)) between 1 and 80),
 country text not null default '' check(char_length(country)<=80),
 tour text not null default '' check(char_length(tour)<=120),
 source_url text not null default '' check(char_length(source_url)<=500 and (source_url='' or source_url ~ '^https://[^[:space:]]+$')),
 created_by uuid not null references public.profiles(id) on delete cascade,
 hidden boolean not null default false,
 created_at timestamptz not null default now()
);
create unique index concerts_deduplicate_idx on public.concerts(lower(btrim(artist)),concert_date,lower(btrim(venue)),lower(btrim(city)));
create index concerts_artist_date_idx on public.concerts(lower(artist),concert_date desc);
create index concerts_city_date_idx on public.concerts(lower(city),concert_date desc);
alter table public.concerts enable row level security;
revoke all on public.concerts from anon,authenticated;
grant select on public.concerts to authenticated;
grant all on public.concerts to service_role;
create policy concerts_read on public.concerts for select to authenticated using(true);
create policy concerts_visible on public.concerts as restrictive for select to authenticated using(not hidden);

create table public.concert_attendance (
 user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
 concert_id uuid not null references public.concerts(id) on delete cascade,
 memory text not null default '' check(char_length(memory)<=500),
 created_at timestamptz not null default now(),
 primary key(user_id,concert_id)
);
create index concert_attendance_profile_idx on public.concert_attendance(user_id,created_at desc);
create index concert_attendance_concert_idx on public.concert_attendance(concert_id);
alter table public.concert_attendance enable row level security;
revoke all on public.concert_attendance from anon,authenticated;
grant select,delete on public.concert_attendance to authenticated;
grant insert(concert_id) on public.concert_attendance to authenticated;
grant all on public.concert_attendance to service_role;
create policy concert_attendance_read on public.concert_attendance for select to authenticated using(
 exists(select 1 from public.concerts c where c.id=concert_id and not c.hidden)
);
create policy concert_attendance_add_self on public.concert_attendance for insert to authenticated with check(
 user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and not p.suspended)
 and exists(select 1 from public.concerts c where c.id=concert_id and not c.hidden)
);
create policy concert_attendance_update_self on public.concert_attendance for update to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy concert_attendance_delete_self on public.concert_attendance for delete to authenticated using(user_id=(select auth.uid()));
grant update(memory) on public.concert_attendance to authenticated;

create or replace function public.add_concert_attendance(
 p_artist text,p_concert_date date,p_venue text,p_city text,p_country text default '',p_tour text default '',p_source_url text default '',p_memory text default ''
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_id uuid;
begin
 if v_user is null or not exists(select 1 from public.profiles where id=v_user and not suspended) then raise exception 'Inicia sesión con una cuenta activa.'; end if;
 if char_length(btrim(coalesce(p_artist,''))) not between 1 and 120 or char_length(btrim(coalesce(p_venue,''))) not between 1 and 120 or char_length(btrim(coalesce(p_city,''))) not between 1 and 80 then raise exception 'Completa artista, sala y ciudad.'; end if;
 if p_concert_date is null or p_concert_date>current_date then raise exception 'La fecha debe ser hoy o anterior.'; end if;
 if char_length(coalesce(p_country,''))>80 or char_length(coalesce(p_tour,''))>120 or char_length(coalesce(p_source_url,''))>500 or char_length(coalesce(p_memory,''))>500 then raise exception 'Uno de los campos supera el límite permitido.'; end if;
 if coalesce(p_source_url,'')<>'' and p_source_url !~ '^https://[^[:space:]]+$' then raise exception 'El enlace debe ser HTTPS.'; end if;
 select id into v_id from public.concerts where lower(btrim(artist))=lower(btrim(p_artist)) and concert_date=p_concert_date and lower(btrim(venue))=lower(btrim(p_venue)) and lower(btrim(city))=lower(btrim(p_city)) limit 1;
 if v_id is null then
  if (select count(*) from public.concerts where created_by=v_user)>=500 then raise exception 'Ya añadiste el máximo de conciertos al catálogo.'; end if;
  insert into public.concerts(artist,concert_date,venue,city,country,tour,source_url,created_by)
   values(btrim(p_artist),p_concert_date,btrim(p_venue),btrim(p_city),btrim(coalesce(p_country,'')),btrim(coalesce(p_tour,'')),btrim(coalesce(p_source_url,'')),v_user)
   on conflict do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.concerts where lower(btrim(artist))=lower(btrim(p_artist)) and concert_date=p_concert_date and lower(btrim(venue))=lower(btrim(p_venue)) and lower(btrim(city))=lower(btrim(p_city)) limit 1; end if;
 end if;
 if v_id is null or exists(select 1 from public.concerts where id=v_id and hidden) then raise exception 'Ese registro no está disponible.'; end if;
 if not exists(select 1 from public.concert_attendance where user_id=v_user and concert_id=v_id) and (select count(*) from public.concert_attendance where user_id=v_user)>=1000 then raise exception 'Tu perfil alcanzó el máximo de conciertos.'; end if;
 insert into public.concert_attendance(user_id,concert_id,memory) values(v_user,v_id,btrim(coalesce(p_memory,'')))
  on conflict(user_id,concert_id) do update set memory=case when excluded.memory<>'' then excluded.memory else public.concert_attendance.memory end;
 return v_id;
end $$;
revoke all on function public.add_concert_attendance(text,date,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.add_concert_attendance(text,date,text,text,text,text,text,text) to authenticated;

-- Shared searchable catalogue of cross-platform games, initially seeded from existing recommendations.
create table public.games_catalog (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(btrim(title)) between 1 and 120),
 platforms text not null check(char_length(btrim(platforms)) between 1 and 120),
 genre text not null default '' check(char_length(genre)<=60),
 external_url text not null default '' check(char_length(external_url)<=500 and (external_url='' or external_url ~ '^https://[^[:space:]]+$')),
 created_by uuid not null references public.profiles(id) on delete cascade,
 hidden boolean not null default false,
 created_at timestamptz not null default now()
);
create unique index games_catalog_title_idx on public.games_catalog(lower(btrim(title)));
create index games_catalog_recent_idx on public.games_catalog(created_at desc);
alter table public.games_catalog enable row level security;
revoke all on public.games_catalog from anon,authenticated;
grant select on public.games_catalog to authenticated;
grant all on public.games_catalog to service_role;
create policy games_catalog_read on public.games_catalog for select to authenticated using(true);
create policy games_catalog_visible on public.games_catalog as restrictive for select to authenticated using(not hidden);
insert into public.games_catalog(title,platforms,genre,created_by)
select distinct on(lower(btrim(title))) btrim(title),btrim(platform),left(genre,60),user_id from public.game_recommendations
order by lower(btrim(title)),created_at desc
on conflict do nothing;
alter table public.game_recommendations add column game_id uuid references public.games_catalog(id) on delete set null;
update public.game_recommendations r set game_id=g.id from public.games_catalog g where lower(btrim(r.title))=lower(btrim(g.title));
create index game_recommendations_game_recent_idx on public.game_recommendations(game_id,created_at desc);
grant insert(game_id) on public.game_recommendations to authenticated;

create or replace function public.add_game_catalog(p_title text,p_platforms text,p_genre text default '',p_external_url text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_id uuid;
begin
 if v_user is null or not exists(select 1 from public.profiles where id=v_user and not suspended) then raise exception 'Inicia sesión con una cuenta activa.'; end if;
 if char_length(btrim(coalesce(p_title,''))) not between 1 and 120 or char_length(btrim(coalesce(p_platforms,''))) not between 1 and 120 or char_length(coalesce(p_genre,''))>60 or char_length(coalesce(p_external_url,''))>500 then raise exception 'Revisa el nombre, plataforma y género del juego.'; end if;
 if coalesce(p_external_url,'')<>'' and p_external_url !~ '^https://[^[:space:]]+$' then raise exception 'El enlace debe ser HTTPS.'; end if;
 select id into v_id from public.games_catalog where lower(btrim(title))=lower(btrim(p_title)) limit 1;
 if v_id is null then
  if (select count(*) from public.games_catalog where created_by=v_user)>=300 then raise exception 'Ya añadiste el máximo de juegos al catálogo.'; end if;
  insert into public.games_catalog(title,platforms,genre,external_url,created_by) values(btrim(p_title),btrim(p_platforms),left(btrim(coalesce(p_genre,'')),60),btrim(coalesce(p_external_url,'')),v_user)
   on conflict do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.games_catalog where lower(btrim(title))=lower(btrim(p_title)) limit 1; end if;
 end if;
 if v_id is null or exists(select 1 from public.games_catalog where id=v_id and hidden) then raise exception 'Ese juego no está disponible.'; end if;
 return v_id;
end $$;
revoke all on function public.add_game_catalog(text,text,text,text) from public,anon,authenticated;
grant execute on function public.add_game_catalog(text,text,text,text) to authenticated;

commit;
