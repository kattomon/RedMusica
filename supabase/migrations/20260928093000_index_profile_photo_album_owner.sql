-- Covers the composite profile photo album foreign key for safe cascading deletes.
create index profile_photos_album_owner_fkey_idx
  on public.profile_photos(album_id, user_id);
