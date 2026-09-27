-- Apply after schema.sql and admin.sql. Public photos, owner-only editing.
alter table public.profiles add column bio text not null default '' check(char_length(bio)<=300);
alter table public.profiles add column avatar_updated_at timestamptz;
grant update(bio,avatar_updated_at) on public.profiles to authenticated;
create policy profiles_edit_self on public.profiles for update to authenticated
 using(id=(select auth.uid()) and not suspended)
 with check(id=(select auth.uid()) and not suspended);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('avatars','avatars',true,1048576,array['image/jpeg']);
create policy avatars_read on storage.objects for select to authenticated
 using(bucket_id='avatars' and name=(select auth.uid())::text||'/avatar.jpg');
create policy avatars_insert_self on storage.objects for insert to authenticated with check(
 bucket_id='avatars' and name=(select auth.uid())::text||'/avatar.jpg'
 and exists(select 1 from public.profiles where id=(select auth.uid()) and not suspended));
create policy avatars_update_self on storage.objects for update to authenticated using(
 bucket_id='avatars' and name=(select auth.uid())::text||'/avatar.jpg'
 and exists(select 1 from public.profiles where id=(select auth.uid()) and not suspended)) with check(
 bucket_id='avatars' and name=(select auth.uid())::text||'/avatar.jpg'
 and exists(select 1 from public.profiles where id=(select auth.uid()) and not suspended));
create policy avatars_delete_self on storage.objects for delete to authenticated using(
 bucket_id='avatars' and name=(select auth.uid())::text||'/avatar.jpg'
 and exists(select 1 from public.profiles where id=(select auth.uid()) and not suspended));
