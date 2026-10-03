-- Applied remotely as version 20261003130719.
-- Bachillerato (tutti frutti) online: rooms with any number of players.
-- Rooms, players, answers, votes and finished games are only reachable through the
-- bachillerato Edge Function (service_role). Browsers may read tutti_stats for profiles.
begin;

create table public.tutti_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null references public.profiles(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);
create index tutti_rooms_expires_at_idx on public.tutti_rooms (expires_at);
create index tutti_rooms_host_id_idx on public.tutti_rooms (host_id);

-- One row per player, so joining never competes with the room state for writes.
create table public.tutti_players (
  room_id uuid not null references public.tutti_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  username text not null check (char_length(username) <= 60),
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index tutti_players_user_id_idx on public.tutti_players (user_id);

-- Each player's answers for one round of one game; points are filled in when the round is scored.
create table public.tutti_answers (
  game_id uuid not null,
  round smallint not null check (round between 1 and 15),
  user_id uuid not null references public.profiles(id) on delete cascade,
  room_id uuid not null references public.tutti_rooms(id) on delete cascade,
  answers jsonb not null default '[]' check (jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) <= 12),
  points jsonb check (points is null or jsonb_typeof(points) = 'array'),
  status jsonb check (status is null or jsonb_typeof(status) = 'array'),
  score integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (game_id, round, user_id)
);
create index tutti_answers_room_id_idx on public.tutti_answers (room_id);
create index tutti_answers_user_id_idx on public.tutti_answers (user_id);

-- Each voter's rejected answers ("userId:categoryIndex") and whether they are done reviewing.
create table public.tutti_votes (
  game_id uuid not null,
  round smallint not null check (round between 1 and 15),
  voter_id uuid not null references public.profiles(id) on delete cascade,
  room_id uuid not null references public.tutti_rooms(id) on delete cascade,
  rejects jsonb not null default '[]' check (jsonb_typeof(rejects) = 'array' and jsonb_array_length(rejects) <= 300),
  ready boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (game_id, round, voter_id)
);
create index tutti_votes_room_id_idx on public.tutti_votes (room_id);
create index tutti_votes_voter_id_idx on public.tutti_votes (voter_id);

create table public.tutti_games (
  id uuid primary key,
  room_code text not null check (room_code ~ '^[A-Z0-9]{6}$'),
  players integer not null check (players >= 0),
  finished_at timestamptz not null default now()
);

create table public.tutti_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  games integer not null default 0 check (games >= 0),
  wins integer not null default 0 check (wins >= 0),
  points bigint not null default 0 check (points >= 0),
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['tutti_rooms', 'tutti_players', 'tutti_answers', 'tutti_votes', 'tutti_games', 'tutti_stats'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy %I on public.%I to service_role using (true) with check (true)', t || '_server', t);
  end loop;
end $$;
grant select on public.tutti_stats to anon, authenticated;
create policy tutti_stats_read on public.tutti_stats for select to anon, authenticated using (true);

-- Records a finished game once and adds games, wins and points for every player in it.
-- p_results: [{ "user_id": uuid, "points": int, "won": bool }]
create function public.record_tutti_result(p_game uuid, p_room text, p_results jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare row jsonb;
begin
  if jsonb_typeof(p_results) <> 'array' then return false; end if;
  insert into public.tutti_games (id, room_code, players) values (p_game, p_room, jsonb_array_length(p_results))
  on conflict (id) do nothing;
  if not found then return false; end if;
  for row in select * from jsonb_array_elements(p_results) loop
    insert into public.tutti_stats as s (user_id, games, wins, points)
    values ((row->>'user_id')::uuid, 1, case when (row->>'won')::boolean then 1 else 0 end, greatest(0, coalesce((row->>'points')::int, 0)))
    on conflict (user_id) do update set games = s.games + 1, wins = s.wins + excluded.wins, points = s.points + excluded.points, updated_at = now();
  end loop;
  return true;
end;
$$;
revoke all on function public.record_tutti_result(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_tutti_result(uuid, text, jsonb) to service_role;

commit;
