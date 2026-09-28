begin;

alter table public.posts drop constraint posts_content_type_check;
alter table public.posts add constraint posts_content_type_check check (
  (post_type='album' and album_id is not null and album_title is not null and album_artist is not null and image_path is null
   and film_wikidata_id is null and film_tmdb_id is null and film_title is null and film_director is null and film_year is null and film_poster is null and film_rating is null)
  or
  (post_type='meme' and album_id is null and album_title is null and album_artist is null and image_path is not null
   and image_path ~ ('^'||user_id::text||'/[0-9a-f-]{36}\.(jpg|gif)$') and film_wikidata_id is null and film_tmdb_id is null
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

update storage.buckets
set file_size_limit=1048576,allowed_mime_types=array['image/jpeg','image/gif']
where id='post-images';

drop policy if exists post_images_insert_self on storage.objects;
create policy post_images_insert_self on storage.objects for insert to authenticated with check (
 bucket_id='post-images' and name ~ ('^'||(select auth.uid())::text||'/[0-9a-f-]{36}\.(jpg|gif)$')
 and exists(select 1 from public.profiles where id=(select auth.uid()) and not suspended)
);

commit;
