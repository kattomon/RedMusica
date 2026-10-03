-- Applied remotely as version 20261003193154.
-- "Adivina la canción", second part: Bandle-style steps (with skips), the distribution of the step at
-- which each song was guessed, and live rooms for many players.
-- Rooms hold the answers, so like the daily tables they are only reachable through the cancion
-- Edge Function (service_role). song_stats stays readable for profiles.
begin;

alter table public.song_stats
  add column dist integer[] not null default '{0,0,0,0,0,0,0}' check (cardinality(dist) = 7),
  add column live_games integer not null default 0 check (live_games >= 0),
  add column live_wins integer not null default 0 check (live_wins >= 0);

create table public.song_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null references public.profiles(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);
create index song_rooms_expires_at_idx on public.song_rooms (expires_at);
create index song_rooms_host_id_idx on public.song_rooms (host_id);

create table public.song_room_matches (
  id uuid primary key,
  room_code text not null check (room_code ~ '^[A-Z0-9]{6}$'),
  players integer not null check (players >= 0),
  finished_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['song_rooms', 'song_room_matches'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy %I on public.%I to service_role using (true) with check (true)', t || '_server', t);
  end loop;
end $$;

-- The daily result now also adds one to the step at which each song was guessed (7 = not guessed).
-- The older two-argument record_song_day(uuid, date) stays (service_role only, unused); dropping it
-- needs an explicit approval and changes nothing in practice.
create function public.record_song_day(p_user uuid, p_day date, p_dist integer[])
returns boolean
language plpgsql
set search_path = ''
as $$
declare play public.song_plays;
declare d integer[];
begin
  if cardinality(p_dist) <> 7 then return false; end if;
  update public.song_plays set recorded = true, updated_at = now()
  where user_id = p_user and day = p_day and finished and not recorded
  returning * into play;
  if not found then return false; end if;
  d := array(select greatest(0, least(10, x)) from unnest(p_dist) as x);
  insert into public.song_stats as s (user_id, days, points, best, solved, streak, best_streak, last_day, dist)
  values (p_user, 1, play.score, play.score, play.solved, 1, 1, p_day, d)
  on conflict (user_id) do update set
    days = s.days + 1,
    points = s.points + play.score,
    best = greatest(s.best, play.score),
    solved = s.solved + play.solved,
    streak = case when s.last_day = p_day - 1 then s.streak + 1 when s.last_day = p_day then s.streak else 1 end,
    best_streak = greatest(s.best_streak, case when s.last_day = p_day - 1 then s.streak + 1 else 1 end),
    last_day = greatest(s.last_day, p_day),
    dist = array(select s.dist[i] + d[i] from generate_series(1, 7) as i),
    updated_at = now();
  return true;
end;
$$;
revoke all on function public.record_song_day(uuid, date, integer[]) from public, anon, authenticated;
grant execute on function public.record_song_day(uuid, date, integer[]) to service_role;

-- Records a finished live game once: one game for every player, one win for the winners.
create function public.record_song_room(p_match uuid, p_room text, p_players uuid[], p_winners uuid[])
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  insert into public.song_room_matches (id, room_code, players) values (p_match, p_room, cardinality(p_players))
  on conflict (id) do nothing;
  if not found then return false; end if;
  insert into public.song_stats as s (user_id, live_games, live_wins)
  select p, 1, case when p = any(p_winners) then 1 else 0 end from unnest(p_players) as p
  where exists (select 1 from public.profiles where id = p)
  on conflict (user_id) do update set
    live_games = s.live_games + 1,
    live_wins = s.live_wins + excluded.live_wins,
    updated_at = now();
  return true;
end;
$$;
revoke all on function public.record_song_room(uuid, text, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.record_song_room(uuid, text, uuid[], uuid[]) to service_role;

commit;
