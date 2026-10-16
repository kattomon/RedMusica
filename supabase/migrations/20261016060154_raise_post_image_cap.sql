-- The per-account cap of 15 wall photos was too low (an active user hit it on 16-oct).
-- Allow up to 200 photos or 40 MB per account, whichever comes first. Photos are reduced in the
-- browser before upload (about 150 kB each), so this still keeps the free storage tier bounded.
create or replace function private.limit_post_images_per_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_owner_id uuid; v_count bigint; v_bytes bigint;
begin
 if new.bucket_id='post-images' then
  v_owner_id:=split_part(new.name,'/',1)::uuid;
  perform pg_advisory_xact_lock(hashtextextended(v_owner_id::text,0));
  select count(*), coalesce(sum((existing_image.metadata->>'size')::bigint),0) into v_count, v_bytes
    from storage.objects existing_image
   where existing_image.bucket_id='post-images' and existing_image.name like v_owner_id::text||'/%';
  if v_count>=200 or v_bytes>=40*1024*1024 then
   raise exception 'Image storage limit reached';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.limit_post_images_per_user() from public,anon,authenticated;
