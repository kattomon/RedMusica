begin;
create index saved_posts_post_idx on public.saved_posts(post_id);
create index personal_list_items_post_idx on public.personal_list_items(post_id);
commit;