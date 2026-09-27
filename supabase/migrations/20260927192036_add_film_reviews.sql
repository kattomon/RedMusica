begin;

alter table public.posts
  add column film_wikidata_id text,
  add column film_title text,
  add column film_director text,
  add column film_year integer,
  add column film_poster text,
  add column film_rating numeric(2,1);

alter table public.posts drop constraint posts_post_type_check;
alter table public.posts add constraint posts_post_type_check
  check (post_type in ('album','meme','film'));

alter table public.posts drop constraint posts_content_type_check;
alter table public.posts add constraint posts_content_type_check check (
  (post_type='album' and album_id is not null and album_title is not null and album_artist is not null
    and image_path is null and film_wikidata_id is null and film_title is null and film_director is null
    and film_year is null and film_poster is null and film_rating is null)
  or
  (post_type='meme' and album_id is null and album_title is null and album_artist is null
    and image_path is not null and image_path ~ ('^'||user_id::text||'/[0-9a-f-]{36}\.jpg$')
    and film_wikidata_id is null and film_title is null and film_director is null
    and film_year is null and film_poster is null and film_rating is null)
  or
  (post_type='film' and album_id is null and album_title is null and album_artist is null and image_path is null
    and film_wikidata_id ~ '^Q[1-9][0-9]*$' and film_title is not null
    and char_length(btrim(film_title)) between 1 and 500
    and (film_director is null or char_length(film_director)<=500)
    and (film_year is null or film_year between 1888 and 2100)
    and (film_poster is null or char_length(film_poster)<=500)
    and film_rating is not null and film_rating between 0.5 and 5)
);

grant insert(film_wikidata_id,film_title,film_director,film_year,film_poster,film_rating)
  on public.posts to authenticated;

commit;
