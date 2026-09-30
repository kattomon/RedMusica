begin;

create table if not exists public.site_gif_settings (
 id boolean primary key default true check(id),
 api_key text not null default '' check(char_length(api_key)<=200)
);
insert into public.site_gif_settings(id) values(true) on conflict(id) do nothing;
alter table public.site_gif_settings enable row level security;
revoke all on public.site_gif_settings from anon,authenticated;
grant all on public.site_gif_settings to service_role;
drop policy if exists gif_settings_read on public.site_gif_settings;
drop policy if exists gif_settings_server on public.site_gif_settings;
create policy gif_settings_server on public.site_gif_settings to service_role using(true) with check(true);

create or replace function public.set_giphy_api_key(p_key text) returns void
language plpgsql security definer set search_path='' as $$
declare v_role text;
begin
 select role into v_role from public.profiles where id=(select auth.uid()) and not suspended;
 if v_role is distinct from 'owner' then raise exception 'Solo la cuenta owner puede cambiar la clave de GIPHY.'; end if;
 if char_length(coalesce(p_key,''))>200 then raise exception 'La clave es demasiado larga.'; end if;
 update public.site_gif_settings set api_key=btrim(coalesce(p_key,'')) where id=true;
end $$;
revoke all on function public.set_giphy_api_key(text) from public,anon,authenticated;

commit;
