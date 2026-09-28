-- Long-form profile notes inspired by early personal blogs and social network notes.
begin;

alter table public.posts
  add column blog_title text,
  add column blog_tags text not null default '';

alter table public.posts drop constraint posts_post_type_check;
alter table public.posts add constraint posts_post_type_check
  check(post_type in ('album','meme','film','status','book','blog'));

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
);

alter table public.posts add constraint posts_blog_metadata_check check (
 post_type='blog' or (blog_title is null and blog_tags='')
);
grant insert(blog_title,blog_tags) on public.posts to authenticated;
create index posts_blog_recent_idx on public.posts(created_at desc,id desc) where post_type='blog';

commit;
