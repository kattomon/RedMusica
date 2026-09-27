-- Temporary, server-managed blackjack rooms. The deck and round state are only
-- accessible to the Edge Function's service role; browsers never query the table.
begin;

create table public.blackjack_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null references public.profiles(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create index blackjack_rooms_expires_at_idx on public.blackjack_rooms (expires_at);
alter table public.blackjack_rooms enable row level security;
revoke all on public.blackjack_rooms from anon, authenticated;
grant all on public.blackjack_rooms to service_role;

commit;
