-- Applied remotely as version 20261003160207.
-- Card games (brisca, poto sucio, carioca, ¡Última!): rooms with secret hands.
-- Rooms and finished matches are only reachable through the naipes Edge Function (service_role),
-- because the room state holds every hand and the deck. Browsers may read card_stats for profiles.
begin;

create table public.card_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null references public.profiles(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);
create index card_rooms_expires_at_idx on public.card_rooms (expires_at);
create index card_rooms_host_id_idx on public.card_rooms (host_id);

create table public.card_matches (
  id uuid primary key,
  game text not null check (game in ('brisca', 'potosucio', 'carioca', 'ultima')),
  room_code text not null check (room_code ~ '^[A-Z0-9]{6}$'),
  players integer not null check (players >= 0),
  finished_at timestamptz not null default now()
);

create table public.card_stats (
  user_id uuid not null references public.profiles(id) on delete cascade,
  game text not null check (game in ('brisca', 'potosucio', 'carioca', 'ultima')),
  games integer not null default 0 check (games >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, game)
);

do $$
declare t text;
begin
  foreach t in array array['card_rooms', 'card_matches', 'card_stats'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy %I on public.%I to service_role using (true) with check (true)', t || '_server', t);
  end loop;
end $$;
grant select on public.card_stats to anon, authenticated;
create policy card_stats_read on public.card_stats for select to anon, authenticated using (true);

-- Records a finished match once. p_results: [{ "user_id": uuid, "won": bool, "lost": bool }]
create function public.record_card_result(p_match uuid, p_game text, p_room text, p_results jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare row jsonb;
begin
  if jsonb_typeof(p_results) <> 'array' then return false; end if;
  insert into public.card_matches (id, game, room_code, players) values (p_match, p_game, p_room, jsonb_array_length(p_results))
  on conflict (id) do nothing;
  if not found then return false; end if;
  for row in select * from jsonb_array_elements(p_results) loop
    insert into public.card_stats as s (user_id, game, games, wins, losses)
    values ((row->>'user_id')::uuid, p_game, 1,
            case when (row->>'won')::boolean then 1 else 0 end,
            case when (row->>'lost')::boolean then 1 else 0 end)
    on conflict (user_id, game) do update set games = s.games + 1, wins = s.wins + excluded.wins, losses = s.losses + excluded.losses, updated_at = now();
  end loop;
  return true;
end;
$$;
revoke all on function public.record_card_result(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_card_result(uuid, text, text, jsonb) to service_role;

commit;
