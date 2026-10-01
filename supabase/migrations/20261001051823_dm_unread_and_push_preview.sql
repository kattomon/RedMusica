-- Unread private messages (like the 2012 chat: badges, "seen") and a preview in push alerts.
-- Applied remotely as version 20261001051823.
alter table public.dm_messages add column if not exists read_at timestamptz;
-- Messages that already exist count as read, so nobody gets a flood of old alerts.
update public.dm_messages set read_at = created_at where read_at is null;
create index if not exists dm_messages_unread_idx on public.dm_messages (recipient_id, sender_id) where read_at is null;

-- Only the recipient can mark a conversation as read; clients still have no UPDATE grant on the table.
create or replace function public.mark_dm_read(p_friend uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    me uuid := (select auth.uid());
    changed integer;
begin
    if me is null or p_friend is null then return 0; end if;
    update public.dm_messages set read_at = now()
     where recipient_id = me and sender_id = p_friend and read_at is null;
    get diagnostics changed = row_count;
    return changed;
end;
$$;
revoke all on function public.mark_dm_read(uuid) from public, anon;
grant execute on function public.mark_dm_read(uuid) to authenticated;

-- Push event now carries a short text preview (GIF links become "GIF").
create or replace function private.push_direct_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    preview text := btrim(regexp_replace(new.body, '\s*\[GIF\]\s*https://\S+\s*$', ''));
begin
    if preview = '' then preview := '📷 GIF'; end if;
    perform private.send_redmusica_push(new.recipient_id, jsonb_build_object(
        'kind', 'message', 'actor_id', new.sender_id, 'preview', left(preview, 140)
    ));
    return new;
end;
$$;
