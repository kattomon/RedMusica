-- Expand the shared games catalogue into searchable game pages and social reviews.
begin;

alter table public.games_catalog
  add column wikidata_id text check (wikidata_id is null or wikidata_id ~ '^Q[1-9][0-9]{0,11}$'),
  add column cover_url text check (cover_url is null or (char_length(cover_url) <= 1000 and cover_url ~ '^https://commons\.wikimedia\.org/wiki/Special:FilePath/')),
  add column release_year integer check (release_year is null or release_year between 1950 and 2100),
  add column summary text not null default '' check (char_length(summary) <= 500);
create unique index games_catalog_wikidata_id_idx on public.games_catalog(wikidata_id) where wikidata_id is not null;
create index games_catalog_search_title_idx on public.games_catalog(lower(title));

create policy games_catalog_add_self on public.games_catalog for insert to authenticated with check (
  created_by = (select auth.uid())
  and not hidden
  and exists (select 1 from public.profiles p where p.id=(select auth.uid()) and not p.suspended)
  and (select s.accept_posts from public.site_settings s where s.id=1)
);
create policy games_catalog_update_self on public.games_catalog for update to authenticated
  using (created_by=(select auth.uid()) and not hidden)
  with check (created_by=(select auth.uid()) and not hidden);
grant insert(title,platforms,genre,external_url,created_by,wikidata_id,cover_url,release_year,summary) on public.games_catalog to authenticated;
grant update(wikidata_id,cover_url,release_year,summary,external_url) on public.games_catalog to authenticated;

create or replace function public.add_external_game_catalog(
  p_wikidata_id text,
  p_title text,
  p_platforms text,
  p_genre text,
  p_external_url text,
  p_cover_url text,
  p_release_year integer,
  p_summary text
) returns uuid
language plpgsql
set search_path=''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
  v_owner uuid;
begin
  if v_user is null or not exists(select 1 from public.profiles where id=v_user and not suspended) then
    raise exception 'Inicia sesión con una cuenta activa.';
  end if;
  if not (select accept_posts from public.site_settings where id=1) then raise exception 'Las publicaciones están pausadas.'; end if;
  if coalesce(p_wikidata_id,'') !~ '^Q[1-9][0-9]{0,11}$'
    or char_length(btrim(coalesce(p_title,''))) not between 1 and 120
    or char_length(btrim(coalesce(p_platforms,''))) not between 1 and 120
    or char_length(coalesce(p_genre,'')) > 60
    or coalesce(p_external_url,'') <> 'https://www.wikidata.org/wiki/'||p_wikidata_id
    or (p_cover_url is not null and (char_length(p_cover_url)>1000 or p_cover_url !~ '^https://commons\.wikimedia\.org/wiki/Special:FilePath/'))
    or (p_release_year is not null and p_release_year not between 1950 and 2100)
    or char_length(coalesce(p_summary,''))>500 then
    raise exception 'La ficha del juego no tiene datos válidos.';
  end if;

  select id,created_by into v_id,v_owner from public.games_catalog
    where wikidata_id=p_wikidata_id or lower(btrim(title))=lower(btrim(p_title))
    order by (wikidata_id=p_wikidata_id) desc limit 1;
  if v_id is not null then
    if v_owner=v_user then
      update public.games_catalog set
        wikidata_id=coalesce(wikidata_id,p_wikidata_id),
        cover_url=coalesce(cover_url,p_cover_url),
        release_year=coalesce(release_year,p_release_year),
        summary=case when summary='' then coalesce(p_summary,'') else summary end,
        external_url=case when external_url='' then p_external_url else external_url end
      where id=v_id;
    end if;
    return v_id;
  end if;
  if (select count(*) from public.games_catalog where created_by=v_user)>=300 then
    raise exception 'Ya añadiste el máximo de juegos al catálogo.';
  end if;
  insert into public.games_catalog(title,platforms,genre,external_url,created_by,wikidata_id,cover_url,release_year,summary)
    values(btrim(p_title),btrim(p_platforms),left(btrim(coalesce(p_genre,'')),60),p_external_url,v_user,p_wikidata_id,p_cover_url,p_release_year,btrim(coalesce(p_summary,'')))
    on conflict do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.games_catalog
      where wikidata_id=p_wikidata_id or lower(btrim(title))=lower(btrim(p_title)) limit 1;
  end if;
  if v_id is null then raise exception 'Ese juego no está disponible.'; end if;
  return v_id;
end;
$$;
revoke all on function public.add_external_game_catalog(text,text,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.add_external_game_catalog(text,text,text,text,text,text,integer,text) to authenticated;

alter table public.posts
  add column game_id uuid references public.games_catalog(id) on delete cascade,
  add column game_rating numeric(2,1);
alter table public.posts drop constraint posts_post_type_check;
alter table public.posts add constraint posts_post_type_check
  check(post_type in ('album','meme','film','status','book','blog','game'));
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
  and (film_wikidata_id is null or film_wikidata_id ~ '^Q[1-9][0-9]*$') and (film_tmdb_id is null or film_tmdb_id>0)
  and (film_director is null or char_length(film_director)<=500) and (film_year is null or film_year between 1888 and 2100)
  and (film_poster is null or char_length(film_poster)<=500) and film_rating is not null and film_rating between 0.5 and 5)
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
 or
 (post_type='blog' and album_id is null and album_title is null and album_artist is null and image_path is null and link_url is null
  and film_wikidata_id is null and film_tmdb_id is null and film_title is null and film_director is null and film_year is null and film_poster is null and film_rating is null
  and book_google_id is null and book_title is null and book_authors='' and book_year is null and book_cover is null and book_rating is null
  and blog_title is not null and char_length(btrim(blog_title)) between 1 and 160 and char_length(btrim(body)) between 1 and 5000 and char_length(blog_tags)<=180)
 or
 (post_type='game' and album_id is null and album_title is null and album_artist is null and image_path is null and link_url is null
  and film_wikidata_id is null and film_tmdb_id is null and film_title is null and film_director is null and film_year is null and film_poster is null and film_rating is null
  and book_google_id is null and book_title is null and book_authors='' and book_year is null and book_cover is null and book_rating is null
  and blog_title is null and blog_tags='' and game_id is not null and game_rating is not null and game_rating between 0.5 and 5
  and char_length(btrim(body)) between 1 and 5000)
);
alter table public.posts add constraint posts_game_metadata_check
  check(post_type='game' or (game_id is null and game_rating is null));
grant insert(game_id,game_rating) on public.posts to authenticated;
grant select(game_id,game_rating) on public.posts to anon,authenticated;
create index posts_game_recent_idx on public.posts(created_at desc,id desc) where post_type='game';

commit;

