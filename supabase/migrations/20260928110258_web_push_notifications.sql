begin;

create extension if not exists pg_net;

create table if not exists public.push_subscriptions (
    endpoint text primary key check (endpoint ~ '^https://'),
    user_id uuid not null references public.profiles(id) on delete cascade,
    subscription jsonb not null check (jsonb_typeof(subscription) = 'object'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant all on public.push_subscriptions to service_role;

create or replace function public.redmusica_push_config()
returns jsonb
language sql
security definer
set search_path = ''
as $$
    select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
    from vault.decrypted_secrets
    where name in ('redmusica_push_public_key', 'redmusica_push_private_key', 'redmusica_push_subject', 'redmusica_push_webhook_secret');
$$;
revoke all on function public.redmusica_push_config() from public, anon, authenticated;
grant execute on function public.redmusica_push_config() to service_role;

create or replace function private.send_redmusica_push(p_recipient uuid, p_event jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare push_secret text;
begin
    select decrypted_secret into push_secret
    from vault.decrypted_secrets where name = 'redmusica_push_webhook_secret';
    if push_secret is null then return; end if;
    perform net.http_post(
        url := 'https://svnmwttoawpoavohfrya.supabase.co/functions/v1/push',
        headers := jsonb_build_object('Content-Type','application/json','x-redmusica-push-secret',push_secret),
        body := jsonb_build_object('action','dispatch','recipient_id',p_recipient,'event',p_event),
        timeout_milliseconds := 5000
    );
end;
$$;
revoke all on function private.send_redmusica_push(uuid, jsonb) from public, anon, authenticated;

create or replace function private.push_social_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform private.send_redmusica_push(new.recipient_id, jsonb_build_object(
        'kind', new.kind, 'actor_id', new.actor_id, 'post_id', new.post_id
    ));
    return new;
end;
$$;
revoke all on function private.push_social_notification() from public, anon, authenticated;
drop trigger if exists push_social_notification on public.notifications;
create trigger push_social_notification after insert on public.notifications
for each row execute function private.push_social_notification();

create or replace function private.push_direct_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform private.send_redmusica_push(new.recipient_id, jsonb_build_object(
        'kind', 'message', 'actor_id', new.sender_id
    ));
    return new;
end;
$$;
revoke all on function private.push_direct_message() from public, anon, authenticated;
drop trigger if exists push_direct_message on public.dm_messages;
create trigger push_direct_message after insert on public.dm_messages
for each row execute function private.push_direct_message();

commit;
