-- Run after schema.sql and radio.sql. Roles are server-managed, never user metadata.
alter table public.profiles add column role text not null default 'member' check(role in ('member','admin','owner'));
alter table public.profiles add column suspended boolean not null default false;
alter table public.posts add column hidden boolean not null default false;
alter table public.comments add column hidden boolean not null default false;
alter table public.radio_queue add column cancelled boolean not null default false;
create table public.site_settings (
 id integer primary key check(id=1),
 title text not null default 'RedMusica' check(length(btrim(title)) between 1 and 60),
 description text not null default 'Un lugar para compartir lo que escuchamos.' check(length(description)<=300),
 accept_posts boolean not null default true,
 radio_enabled boolean not null default true,
 paused_at timestamptz,
 radio_revision integer not null default 0
);
insert into public.site_settings(id) values(1);

create table public.site_gif_settings (
 id boolean primary key default true check(id),
 api_key text not null default '' check(char_length(api_key)<=200)
);
insert into public.site_gif_settings(id) values(true);
alter table public.site_gif_settings enable row level security;
revoke all on public.site_gif_settings from anon,authenticated;
grant select on public.site_gif_settings to anon,authenticated;
create policy gif_settings_read on public.site_gif_settings for select to anon,authenticated using(true);

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
grant execute on function public.set_giphy_api_key(text) to authenticated;
create table public.admin_audit (
 id bigint generated always as identity primary key,
 actor uuid references public.profiles(id) on delete set null,
 action text not null, target uuid, created_at timestamptz not null default now()
);
create index admin_audit_actor_idx on public.admin_audit(actor);
alter table public.site_settings enable row level security;
alter table public.admin_audit enable row level security;
revoke all on public.site_settings,public.admin_audit from anon,authenticated;
grant select on public.site_settings to anon,authenticated;
grant all on public.site_settings,public.admin_audit,public.profiles,public.posts,public.comments,public.likes to service_role;
grant usage,select on sequence public.admin_audit_id_seq to service_role;
create policy settings_read on public.site_settings for select to anon,authenticated using(true);
create policy settings_server on public.site_settings to service_role using(true) with check(true);
create policy audit_server on public.admin_audit to service_role using(true) with check(true);

-- Restrictive policies also apply to existing owner-write policies.
create policy posts_active_insert on public.posts as restrictive for insert to authenticated with check(
 exists(select 1 from public.profiles where id=(select auth.uid()) and not suspended)
 and (select accept_posts from public.site_settings where id=1));
create policy posts_active_update on public.posts as restrictive for update to authenticated using(
 exists(select 1 from public.profiles where id=(select auth.uid()) and not suspended)) with check(
 exists(select 1 from public.profiles where id=(select auth.uid()) and not suspended));
create policy posts_active_delete on public.posts as restrictive for delete to authenticated using(
 exists(select 1 from public.profiles where id=(select auth.uid()) and not suspended));
create policy likes_active_insert on public.likes as restrictive for insert to authenticated with check(
 exists(select 1 from public.profiles where id=(select auth.uid()) and not suspended)
 and exists(select 1 from public.posts where id=post_id));
create policy likes_active_delete on public.likes as restrictive for delete to authenticated using(
 exists(select 1 from public.profiles where id=(select auth.uid()) and not suspended));
create policy comments_active_insert on public.comments as restrictive for insert to authenticated with check(
 exists(select 1 from public.profiles where id=(select auth.uid()) and not suspended)
 and exists(select 1 from public.posts where id=post_id));
create policy comments_active_delete on public.comments as restrictive for delete to authenticated using(
 exists(select 1 from public.profiles where id=(select auth.uid()) and not suspended));
create policy posts_visible on public.posts as restrictive for select to anon,authenticated using(not hidden);
create policy comments_visible on public.comments as restrictive for select to anon,authenticated using(not hidden and exists(select 1 from public.posts where id=post_id));

create or replace function public.radio_state() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_song public.radio_queue; v_last text; v_now timestamptz:=now(); v_rows jsonb; cfg public.site_settings;
begin
 perform pg_advisory_xact_lock(834272);
 select * into cfg from public.site_settings where id=1;
 if not cfg.radio_enabled then v_now:=coalesce(cfg.paused_at,v_now); end if;
 delete from public.radio_queue where ends_at<v_now-interval '7 days';
 if cfg.radio_enabled and not exists(select 1 from public.radio_queue where ends_at>v_now and not cancelled) then
  select video_id into v_last from public.radio_queue order by ends_at desc limit 1;
  select * into v_song from public.radio_queue where user_id is not null and not cancelled order by (video_id=v_last),random() limit 1;
  if v_song.id is not null then
   insert into public.radio_queue(video_id,title,channel,duration,starts_at,ends_at)
   values(v_song.video_id,v_song.title,v_song.channel,v_song.duration,v_now,v_now+make_interval(secs=>v_song.duration));
  end if;
 end if;
 select coalesce(jsonb_agg(x order by x.starts_at),'[]'::jsonb) into v_rows from (
  select q.id,q.video_id,q.title,q.channel,q.duration,q.user_id,q.starts_at,q.ends_at,p.username
  from public.radio_queue q left join public.profiles p on p.id=q.user_id
  where q.ends_at>v_now and not q.cancelled order by q.starts_at limit 20
 ) x;
 return jsonb_build_object('now',v_now,'queue',v_rows,'paused',not cfg.radio_enabled,'revision',cfg.radio_revision);
end $$;

create or replace function public.radio_enqueue(p_user uuid,p_video text,p_title text,p_channel text,p_duration integer) returns uuid
language plpgsql security invoker set search_path='' as $$
declare v_start timestamptz; v_id uuid; v_role text;
begin
 perform pg_advisory_xact_lock(834272);
 select role into v_role from public.profiles where id=p_user and not suspended;
 if v_role is null then raise exception 'Inicia sesión con una cuenta activa.'; end if;
 if not (select radio_enabled from public.site_settings where id=1) then raise exception 'La radio está pausada por administración.'; end if;
 if (select count(*) from public.radio_queue where ends_at>now() and not cancelled)>=20 then raise exception 'La cola está llena.'; end if;
 if v_role='member' and (select count(*) from public.radio_queue where user_id=p_user and ends_at>now() and not cancelled)>=3 then raise exception 'Ya tienes tres canciones en la cola.'; end if;
 if exists(select 1 from public.radio_queue where video_id=p_video and ends_at>now() and not cancelled) then raise exception 'Esta canción ya está en la cola.'; end if;
 select greatest(now()+interval '3 seconds',coalesce(max(ends_at),now())) into v_start from public.radio_queue where not cancelled;
 insert into public.radio_queue(video_id,title,channel,duration,user_id,starts_at,ends_at)
 values(p_video,p_title,p_channel,p_duration,p_user,v_start,v_start+make_interval(secs=>p_duration)) returning id into v_id;
 return v_id;
end $$;

-- The Edge Function supplies p_actor from auth.getUser, never from request JSON.
create function public.site_manage(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor_role text; target_id uuid; target_role text; v_rows jsonb; v_kind text;
 v_offset int:=greatest(0,least(100000,coalesce((p_data->>'offset')::int,0)));
 v_query text:=left(coalesce(p_data->>'query',''),100);
 v_start timestamptz; v_row record; v_selected public.radio_queue; v_current uuid;
begin
 -- Serializes role revocation, suspension and all privileged actions.
 perform pg_advisory_xact_lock(834273);
 select role into actor_role from public.profiles where id=p_actor and not suspended;
 if actor_role is null then raise exception 'Acceso denegado: cuenta no activa.'; end if;
 if p_action='me' then return jsonb_build_object('role',actor_role); end if;
 if p_action<>'cancel_request' and actor_role not in ('admin','owner') then raise exception 'Acceso denegado.'; end if;
 target_id:=nullif(p_data->>'id','')::uuid;
 if p_action='list' then
  v_kind:=p_data->>'kind';
  if v_kind='users' then
   select coalesce(jsonb_agg(t),'[]'::jsonb) into v_rows from (select id,username,role,suspended from public.profiles where username ilike '%'||v_query||'%' order by created_at desc,id limit 30 offset v_offset) t;
  elsif v_kind='posts' then
   select coalesce(jsonb_agg(t),'[]'::jsonb) into v_rows from (select q.id,q.body,q.album_title,q.hidden,p.username from public.posts q join public.profiles p on p.id=q.user_id where q.body ilike '%'||v_query||'%' or p.username ilike '%'||v_query||'%' order by q.created_at desc,q.id limit 30 offset v_offset) t;
  elsif v_kind='comments' then
   select coalesce(jsonb_agg(t),'[]'::jsonb) into v_rows from (select q.id,q.body,q.hidden,p.username from public.comments q join public.profiles p on p.id=q.user_id where q.body ilike '%'||v_query||'%' or p.username ilike '%'||v_query||'%' order by q.created_at desc,q.id limit 30 offset v_offset) t;
  elsif v_kind='audit' then
   select coalesce(jsonb_agg(t),'[]'::jsonb) into v_rows from (select a.action,a.target,a.created_at,p.username from public.admin_audit a left join public.profiles p on p.id=a.actor order by a.id desc limit 30 offset v_offset) t;
  else raise exception 'Acción no válida.'; end if;
  return jsonb_build_object('items',v_rows);
 elsif p_action='settings' then
  if actor_role<>'owner' then raise exception 'Acceso denegado: solo owner.'; end if;
  update public.site_settings set title=btrim(p_data->>'title'),description=p_data->>'description',accept_posts=(p_data->>'accept_posts')::boolean where id=1;
 elsif p_action in ('role','suspend') then
  select role into target_role from public.profiles where id=target_id;
  if target_role is null or target_role='owner' or target_id=p_actor then raise exception 'No puedes modificar esta cuenta.'; end if;
  if p_action='role' then
   if actor_role<>'owner' or p_data->>'role' not in ('member','admin') or p_data->>'role' is null then raise exception 'Acceso denegado: rango no permitido.'; end if;
   update public.profiles set role=p_data->>'role' where id=target_id;
  else
   if actor_role<>'owner' and target_role<>'member' then raise exception 'Acceso denegado.'; end if;
   update public.profiles set suspended=(p_data->>'suspended')::boolean where id=target_id;
  end if;
 elsif p_action='moderate' then
  if p_data->>'kind'='posts' then update public.posts set hidden=(p_data->>'hidden')::boolean where id=target_id;
  elsif p_data->>'kind'='comments' then update public.comments set hidden=(p_data->>'hidden')::boolean where id=target_id;
  else raise exception 'Acción no válida.'; end if;
 elsif p_action in ('cancel_request','remove','priority','play_now','skip','radio_toggle') then
  perform pg_advisory_xact_lock(834272);
  if p_action<>'radio_toggle' and not (select radio_enabled from public.site_settings where id=1) then raise exception 'La radio está pausada. Reanúdala para cambiar la cola.'; end if;
  select id into v_current from public.radio_queue where not cancelled and starts_at<=now() and ends_at>now() order by starts_at limit 1;
  if p_action='radio_toggle' then
   if (p_data->>'enabled')::boolean then
    update public.radio_queue set starts_at=starts_at+(now()-s.paused_at),ends_at=ends_at+(now()-s.paused_at)
    from public.site_settings s where s.id=1 and s.paused_at is not null and not cancelled and ends_at>s.paused_at;
   end if;
   update public.site_settings set radio_enabled=(p_data->>'enabled')::boolean,
    paused_at=case when (p_data->>'enabled')::boolean then null else coalesce(paused_at,now()) end,
    radio_revision=radio_revision+1 where id=1;
   v_current:=null;
  elsif p_action='skip' then
   update public.radio_queue set cancelled=true where id=v_current;
   v_current:=null;
   update public.site_settings set radio_revision=radio_revision+1 where id=1;
  else
   select * into v_selected from public.radio_queue where id=target_id and not cancelled and ends_at>now();
   if v_selected.id is null then raise exception 'Pedido no disponible.'; end if;
   if p_action='cancel_request' and (v_selected.user_id is distinct from p_actor or v_selected.starts_at<=now()) then raise exception 'Solo puedes cancelar tus pedidos pendientes.'; end if;
   if p_action in ('cancel_request','remove') then
    update public.radio_queue set cancelled=true where id=target_id;
    if target_id=v_current then v_current:=null; update public.site_settings set radio_revision=radio_revision+1 where id=1; end if;
   elsif p_action='play_now' then
    update public.radio_queue set cancelled=true where id=v_current and id<>target_id;
    v_current:=null;
    update public.site_settings set radio_revision=radio_revision+1 where id=1;
   end if;
  end if;
  select ends_at into v_start from public.radio_queue where id=v_current;
  v_start:=coalesce(v_start,now()+interval '1 second');
  for v_row in select id,duration from public.radio_queue where not cancelled and ends_at>now() and id is distinct from v_current
   order by (case when p_action in ('priority','play_now') and id=target_id then 0 else 1 end),starts_at,id loop
    update public.radio_queue set starts_at=v_start,ends_at=v_start+make_interval(secs=>v_row.duration) where id=v_row.id;
    v_start:=v_start+make_interval(secs=>v_row.duration);
  end loop;
 else raise exception 'Acción no válida.';
 end if;
 insert into public.admin_audit(actor,action,target) values(p_actor,p_action,target_id);
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.site_manage(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.site_manage(uuid,text,jsonb) to service_role;
