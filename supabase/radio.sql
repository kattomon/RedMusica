-- YouTube room. Only the authenticated Edge Function may write or schedule songs.
create table public.radio_queue (
 id uuid primary key default gen_random_uuid(),
 video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
 title text not null check (length(title) between 1 and 300),
 channel text not null check (length(channel) <= 200),
 duration integer not null check (duration between 20 and 1200),
 user_id uuid references public.profiles(id) on delete set null,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 created_at timestamptz not null default now(),
 check (ends_at > starts_at)
);
create index radio_queue_end_idx on public.radio_queue(ends_at);
create index radio_queue_user_idx on public.radio_queue(user_id);
create table public.radio_cache (query text primary key, result jsonb not null, expires_at timestamptz not null);
create table public.radio_usage (bucket text primary key, count integer not null default 0);
alter table public.radio_queue enable row level security;
alter table public.radio_cache enable row level security;
alter table public.radio_usage enable row level security;
revoke all on public.radio_queue, public.radio_cache, public.radio_usage from anon, authenticated;
grant all on public.radio_queue, public.radio_cache, public.radio_usage to service_role;
create policy radio_queue_server on public.radio_queue to service_role using (true) with check (true);
create policy radio_cache_server on public.radio_cache to service_role using (true) with check (true);
create policy radio_usage_server on public.radio_usage to service_role using (true) with check (true);

create function public.radio_limit(p_user uuid, p_action text, p_query text default '') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_day text := to_char(now() at time zone 'America/Los_Angeles','YYYY-MM-DD'); v_key text; v_limit int; v_cache jsonb;
begin
 if p_user is null or p_action not in ('search','request') then raise exception 'Invalid operation'; end if;
 perform pg_advisory_xact_lock(834271);
 if p_action = 'search' then
  select result into v_cache from public.radio_cache where query=p_query and expires_at>now();
  if v_cache is not null then return jsonb_build_object('cached',v_cache); end if;
 end if;
 foreach v_key in array array[v_day||':'||p_action||':'||p_user, v_day||':'||p_action||':all'] loop
  v_limit := case when v_key like '%:all' then case when p_action='search' then 90 else 300 end else case when p_action='search' then 10 else 30 end end;
  if coalesce((select count from public.radio_usage where bucket=v_key),0)>=v_limit then raise exception 'Límite diario alcanzado. Inténtalo mañana.'; end if;
  insert into public.radio_usage values(v_key,1) on conflict(bucket) do update set count=public.radio_usage.count+1;
 end loop;
 delete from public.radio_usage where left(bucket,10)<to_char(now()-interval '3 days','YYYY-MM-DD');
 delete from public.radio_cache where expires_at<now();
 return '{}'::jsonb;
end $$;

create function public.radio_enqueue(p_user uuid,p_video text,p_title text,p_channel text,p_duration integer) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_start timestamptz; v_id uuid;
begin
 perform pg_advisory_xact_lock(834272);
 if p_user is null or not exists(select 1 from public.profiles where id=p_user) then raise exception 'Inicia sesión para pedir una canción.'; end if;
 if (select count(*) from public.radio_queue where ends_at>now())>=20 then raise exception 'La cola está llena. Espera a que termine una canción.'; end if;
 if (select count(*) from public.radio_queue where user_id=p_user and ends_at>now())>=3 then raise exception 'Ya tienes tres canciones en la cola.'; end if;
 if exists(select 1 from public.radio_queue where video_id=p_video and ends_at>now()) then raise exception 'Esta canción ya está en la cola.'; end if;
 select greatest(now()+interval '3 seconds',coalesce(max(ends_at),now())) into v_start from public.radio_queue;
 insert into public.radio_queue(video_id,title,channel,duration,user_id,starts_at,ends_at)
 values(p_video,p_title,p_channel,p_duration,p_user,v_start,v_start+make_interval(secs=>p_duration)) returning id into v_id;
 return v_id;
end $$;

create function public.radio_state() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_song public.radio_queue; v_last text; v_now timestamptz := now(); v_rows jsonb;
begin
 perform pg_advisory_xact_lock(834272);
 -- A short-lived rotation keeps the room playing between requests, without retaining API data indefinitely.
 delete from public.radio_queue where ends_at<v_now-interval '7 days';
 if not exists(select 1 from public.radio_queue where ends_at>v_now) then
  select video_id into v_last from public.radio_queue order by ends_at desc limit 1;
  select * into v_song from public.radio_queue where user_id is not null order by (video_id=v_last),random() limit 1;
  if v_song.id is not null then
   insert into public.radio_queue(video_id,title,channel,duration,starts_at,ends_at)
   values(v_song.video_id,v_song.title,v_song.channel,v_song.duration,v_now,v_now+make_interval(secs=>v_song.duration));
  end if;
 end if;
 select coalesce(jsonb_agg(x order by x.starts_at),'[]'::jsonb) into v_rows from (
  select q.id,q.video_id,q.title,q.channel,q.duration,q.starts_at,q.ends_at,p.username
  from public.radio_queue q left join public.profiles p on p.id=q.user_id
  where q.ends_at>v_now order by q.starts_at limit 20
 ) x;
 return jsonb_build_object('now',v_now,'queue',v_rows);
end $$;
revoke all on function public.radio_limit(uuid,text,text),public.radio_enqueue(uuid,text,text,text,integer),public.radio_state() from public,anon,authenticated;
grant execute on function public.radio_limit(uuid,text,text),public.radio_enqueue(uuid,text,text,text,integer),public.radio_state() to service_role;
