-- Run once in a new Supabase project, using its SQL editor.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[a-zA-Z0-9_]{3,24}$'),
  created_at timestamptz not null default now()
);
create unique index profiles_username_unique on public.profiles (lower(username));

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  album_id uuid not null,
  album_title text not null check (char_length(album_title) between 1 and 500),
  album_artist text not null check (char_length(album_artist) between 1 and 500),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index posts_created_at_idx on public.posts (created_at desc, id desc);
create index posts_user_id_idx on public.posts (user_id);

create table public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  primary key (post_id, user_id)
);
create index likes_user_id_idx on public.likes (user_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  parent_comment_id uuid,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  constraint comments_post_id_id_unique unique (post_id,id),
  constraint comments_parent_same_post_fkey foreign key (post_id,parent_comment_id)
    references public.comments(post_id,id) on delete cascade
);
create index comments_post_id_idx on public.comments (post_id, created_at);
create index comments_parent_recent_idx on public.comments (parent_comment_id, created_at, id) where parent_comment_id is not null;
create index comments_user_id_idx on public.comments (user_id);

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;

-- Reset the API role grants so only these operations/columns are writable.
revoke all on public.profiles, public.posts, public.likes, public.comments from anon, authenticated;
grant select on public.profiles, public.posts, public.likes, public.comments to anon, authenticated;
grant insert (album_id, album_title, album_artist, body) on public.posts to authenticated;
grant update (body) on public.posts to authenticated;
grant delete on public.posts to authenticated;
grant insert (post_id) on public.likes to authenticated;
grant delete on public.likes to authenticated;
grant insert (post_id, parent_comment_id, body) on public.comments to authenticated;
grant delete on public.comments to authenticated;

create policy profiles_read on public.profiles for select to anon, authenticated using (true);
create policy posts_read on public.posts for select to anon, authenticated using (true);
create policy posts_create on public.posts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy posts_edit on public.posts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy posts_delete on public.posts for delete to authenticated using ((select auth.uid()) = user_id);
create policy likes_read on public.likes for select to anon, authenticated using (true);
create policy likes_create on public.likes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy likes_delete on public.likes for delete to authenticated using ((select auth.uid()) = user_id);
create policy comments_read on public.comments for select to anon, authenticated using (true);
create policy comments_create on public.comments for insert to authenticated with check ((select auth.uid()) = user_id);
create policy comments_delete on public.comments for delete to authenticated using ((select auth.uid()) = user_id);

-- The browser cannot create/change another person's profile or author identity.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and auth.uid() <> new.id then
    raise exception 'Profile owner mismatch';
  end if;
  insert into public.profiles (id, username)
  values (new.id, btrim(new.raw_user_meta_data ->> 'username'));
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

create function private.validate_comment_reply() returns trigger
language plpgsql set search_path='' as $$
declare parent_post_id uuid; grandparent_id uuid;
begin
  if new.parent_comment_id is null then return new; end if;
  select parent.post_id,parent.parent_comment_id into parent_post_id,grandparent_id
  from public.comments parent where parent.id=new.parent_comment_id;
  if not found or parent_post_id is distinct from new.post_id then
    raise exception 'Replies must reference a comment on the same post.';
  end if;
  if grandparent_id is not null then raise exception 'Only one reply level is supported.'; end if;
  return new;
end $$;
revoke all on function private.validate_comment_reply() from public,anon,authenticated;
create trigger validate_comment_reply before insert or update of post_id,parent_comment_id on public.comments
for each row execute function private.validate_comment_reply();

commit;
