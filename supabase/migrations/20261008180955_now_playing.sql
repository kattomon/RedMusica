-- "Escuchando ahora": what each person is listening to right now, shown on their profile and to friends.
-- Free text (song - artist) plus an optional Spotify link for the embedded player.
-- now_playing_at is set only by the trigger, so nobody can backdate or extend it.
alter table public.profiles
  add column if not exists now_playing text not null default ''
    check (char_length(now_playing) <= 150 and now_playing !~ '[[:cntrl:]]'),
  add column if not exists now_playing_url text
    check (now_playing_url is null or now_playing_url ~ '^https://open\.spotify\.com/(intl-[a-z]{2}(-[a-z]{2})?/)?(track|album|playlist|episode)/[A-Za-z0-9]{22}$'),
  add column if not exists now_playing_at timestamptz;

grant update(now_playing, now_playing_url) on public.profiles to authenticated;

create or replace function public.stamp_now_playing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.now_playing is distinct from old.now_playing or new.now_playing_url is distinct from old.now_playing_url then
    new.now_playing := btrim(new.now_playing);
    new.now_playing_at := case when new.now_playing = '' and new.now_playing_url is null then null else now() end;
  else
    new.now_playing_at := old.now_playing_at;
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_now_playing() from public, anon, authenticated;

-- (applied remotely as version 20261008180955)
create trigger profiles_now_playing before insert or update on public.profiles
  for each row execute function public.stamp_now_playing();
