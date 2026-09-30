-- Index the game foreign key so deleting or joining a catalogue entry stays inexpensive.
create index if not exists posts_game_id_idx on public.posts(game_id) where game_id is not null;
