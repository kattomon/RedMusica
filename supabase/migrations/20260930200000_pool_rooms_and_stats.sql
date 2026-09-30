-- Online 8-ball pool: temporary rooms, finished matches and public win counts.
-- Rooms and matches are only reachable through the pool Edge Function (service_role).
-- Browsers may read pool_stats to show wins on profiles; nobody but the server writes it.
begin;

create table public.pool_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null references public.profiles(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index pool_rooms_expires_at_idx on public.pool_rooms (expires_at);
create index pool_rooms_host_id_idx on public.pool_rooms (host_id);
alter table public.pool_rooms enable row level security;
revoke all on public.pool_rooms from anon, authenticated;
grant all on public.pool_rooms to service_role;
create policy pool_rooms_server on public.pool_rooms to service_role using (true) with check (true);

create table public.pool_matches (
  id uuid primary key,
  room_code text not null check (room_code ~ '^[A-Z0-9]{6}$'),
  winner_id uuid references public.profiles(id) on delete set null,
  loser_id uuid references public.profiles(id) on delete set null,
  reason text not null default '' check (char_length(reason) <= 160),
  finished_at timestamptz not null default now(),
  check (winner_id is null or loser_id is null or winner_id <> loser_id)
);
create index pool_matches_winner_id_idx on public.pool_matches (winner_id);
create index pool_matches_loser_id_idx on public.pool_matches (loser_id);
alter table public.pool_matches enable row level security;
revoke all on public.pool_matches from anon, authenticated;
grant all on public.pool_matches to service_role;
create policy pool_matches_server on public.pool_matches to service_role using (true) with check (true);

create table public.pool_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  updated_at timestamptz not null default now()
);
alter table public.pool_stats enable row level security;
revoke all on public.pool_stats from anon, authenticated;
grant select on public.pool_stats to anon, authenticated;
grant all on public.pool_stats to service_role;
create policy pool_stats_read on public.pool_stats for select to anon, authenticated using (true);
create policy pool_stats_server on public.pool_stats to service_role using (true) with check (true);

-- Records a finished match once (the match id is the game id) and updates both counters.
create function public.record_pool_result(p_match uuid, p_room text, p_winner uuid, p_loser uuid, p_reason text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  insert into public.pool_matches (id, room_code, winner_id, loser_id, reason)
  values (p_match, p_room, p_winner, p_loser, left(coalesce(p_reason, ''), 160))
  on conflict (id) do nothing;
  if not found then
    return false;
  end if;
  insert into public.pool_stats (user_id, wins) values (p_winner, 1)
  on conflict (user_id) do update set wins = public.pool_stats.wins + 1, updated_at = now();
  insert into public.pool_stats (user_id, losses) values (p_loser, 1)
  on conflict (user_id) do update set losses = public.pool_stats.losses + 1, updated_at = now();
  return true;
end;
$$;
revoke all on function public.record_pool_result(uuid, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_pool_result(uuid, text, uuid, uuid, text) to service_role;

commit;
