-- Applied remotely as version 20261003184717.
-- "Adivina la canción": the daily challenge (ten songs a day, the same for everyone).
-- The songs of each day and every player's tries are only reachable through the cancion Edge Function
-- (service_role), so nobody can read the answers before playing. Browsers may read song_stats for profiles.
begin;

create table public.song_days (
  day date primary key,
  songs integer[] not null check (cardinality(songs) = 10),
  created_at timestamptz not null default now()
);

create table public.song_plays (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null references public.song_days(day) on delete cascade,
  guesses jsonb not null default '[[],[],[],[],[],[],[],[],[],[]]'::jsonb check (jsonb_typeof(guesses) = 'array' and jsonb_array_length(guesses) = 10),
  score integer not null default 0 check (score between 0 and 60),
  solved integer not null default 0 check (solved between 0 and 10),
  finished boolean not null default false,
  recorded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index song_plays_day_idx on public.song_plays (day);

create table public.song_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  days integer not null default 0 check (days >= 0),
  points bigint not null default 0 check (points >= 0),
  best integer not null default 0 check (best between 0 and 60),
  solved integer not null default 0 check (solved >= 0),
  streak integer not null default 0 check (streak >= 0),
  best_streak integer not null default 0 check (best_streak >= 0),
  last_day date,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['song_days', 'song_plays', 'song_stats'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy %I on public.%I to service_role using (true) with check (true)', t || '_server', t);
  end loop;
end $$;
grant select on public.song_stats to anon, authenticated;
create policy song_stats_read on public.song_stats for select to anon, authenticated using (true);

-- Adds a finished day to the player's stats once (the play row is marked as recorded in the same step).
create function public.record_song_day(p_user uuid, p_day date)
returns boolean
language plpgsql
set search_path = ''
as $$
declare play public.song_plays;
begin
  update public.song_plays set recorded = true, updated_at = now()
  where user_id = p_user and day = p_day and finished and not recorded
  returning * into play;
  if not found then return false; end if;
  insert into public.song_stats as s (user_id, days, points, best, solved, streak, best_streak, last_day)
  values (p_user, 1, play.score, play.score, play.solved, 1, 1, p_day)
  on conflict (user_id) do update set
    days = s.days + 1,
    points = s.points + play.score,
    best = greatest(s.best, play.score),
    solved = s.solved + play.solved,
    streak = case when s.last_day = p_day - 1 then s.streak + 1 when s.last_day = p_day then s.streak else 1 end,
    best_streak = greatest(s.best_streak, case when s.last_day = p_day - 1 then s.streak + 1 else 1 end),
    last_day = greatest(s.last_day, p_day),
    updated_at = now();
  return true;
end;
$$;
revoke all on function public.record_song_day(uuid, date) from public, anon, authenticated;
grant execute on function public.record_song_day(uuid, date) to service_role;

commit;
