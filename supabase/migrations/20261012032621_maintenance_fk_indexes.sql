-- Maintenance: indexes for the four foreign keys the performance advisor flagged.
create index if not exists blackjack_rooms_host_id_idx on public.blackjack_rooms (host_id);
create index if not exists comments_post_parent_idx on public.comments (post_id, parent_comment_id);
create index if not exists concerts_created_by_idx on public.concerts (created_by);
create index if not exists radio_blocklist_blocked_by_idx on public.radio_blocklist (blocked_by);
