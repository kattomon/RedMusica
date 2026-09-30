-- Accept Wikimedia-generated thumbnails returned by Wikipedia and Commons APIs.
begin;

alter table public.games_catalog drop constraint games_catalog_cover_url_check;
alter table public.games_catalog add constraint games_catalog_cover_url_check
  check (cover_url is null or (
    char_length(cover_url) <= 1000
    and cover_url ~ '^https://commons\.wikimedia\.org/wiki/Special:FilePath/'
    or char_length(cover_url) <= 1000
    and cover_url ~ '^https://thumb\.wikimedia\.org/wikipedia/[a-z-]{2,12}/thumb/'
  ));

create or replace function public.add_external_game_catalog(
  p_wikidata_id text,
  p_title text,
  p_platforms text,
  p_genre text,
  p_external_url text,
  p_cover_url text,
  p_release_year integer,
  p_summary text
) returns uuid
language plpgsql
set search_path=''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
  v_owner uuid;
begin
  if v_user is null or not exists(select 1 from public.profiles where id=v_user and not suspended) then
    raise exception 'Inicia sesión con una cuenta activa.';
  end if;
  if not (select accept_posts from public.site_settings where id=1) then raise exception 'Las publicaciones están pausadas.'; end if;
  if coalesce(p_wikidata_id,'') !~ '^Q[1-9][0-9]{0,11}$'
    or char_length(btrim(coalesce(p_title,''))) not between 1 and 120
    or char_length(btrim(coalesce(p_platforms,''))) not between 1 and 120
    or char_length(coalesce(p_genre,'')) > 60
    or coalesce(p_external_url,'') <> 'https://www.wikidata.org/wiki/'||p_wikidata_id
    or (p_cover_url is not null and (char_length(p_cover_url)>1000 or p_cover_url !~ '^https://commons\.wikimedia\.org/wiki/Special:FilePath/' and p_cover_url !~ '^https://thumb\.wikimedia\.org/wikipedia/[a-z-]{2,12}/thumb/'))
    or (p_release_year is not null and p_release_year not between 1950 and 2100)
    or char_length(coalesce(p_summary,''))>500 then
    raise exception 'La ficha del juego no tiene datos válidos.';
  end if;

  select id,created_by into v_id,v_owner from public.games_catalog
    where wikidata_id=p_wikidata_id or lower(btrim(title))=lower(btrim(p_title))
    order by (wikidata_id=p_wikidata_id) desc limit 1;
  if v_id is not null then
    if v_owner=v_user then
      update public.games_catalog set
        wikidata_id=coalesce(wikidata_id,p_wikidata_id),
        cover_url=coalesce(cover_url,p_cover_url),
        release_year=coalesce(release_year,p_release_year),
        summary=case when summary='' then coalesce(p_summary,'') else summary end,
        external_url=case when external_url='' then p_external_url else external_url end
      where id=v_id;
    end if;
    return v_id;
  end if;
  if (select count(*) from public.games_catalog where created_by=v_user)>=300 then
    raise exception 'Ya añadiste el máximo de juegos al catálogo.';
  end if;
  insert into public.games_catalog(title,platforms,genre,external_url,created_by,wikidata_id,cover_url,release_year,summary)
    values(btrim(p_title),btrim(p_platforms),left(btrim(coalesce(p_genre,'')),60),p_external_url,v_user,p_wikidata_id,p_cover_url,p_release_year,btrim(coalesce(p_summary,'')))
    on conflict do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.games_catalog
      where wikidata_id=p_wikidata_id or lower(btrim(title))=lower(btrim(p_title)) limit 1;
  end if;
  if v_id is null then raise exception 'Ese juego no está disponible.'; end if;
  return v_id;
end;
$$;

revoke all on function public.add_external_game_catalog(text,text,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.add_external_game_catalog(text,text,text,text,text,text,integer,text) to authenticated;

create or replace function public.set_game_catalog_cover(p_wikidata_id text,p_cover_url text)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and not suspended) then
    raise exception 'Inicia sesión con una cuenta activa.';
  end if;
  if coalesce(p_wikidata_id,'') !~ '^Q[1-9][0-9]{0,11}$'
    or coalesce(p_cover_url,'') !~ '^https://commons\.wikimedia\.org/wiki/Special:FilePath/'
       and coalesce(p_cover_url,'') !~ '^https://thumb\.wikimedia\.org/wikipedia/[a-z-]{2,12}/thumb/'
    or char_length(coalesce(p_cover_url,''))>1000 then
    raise exception 'La portada del juego no tiene una dirección válida.';
  end if;
  update public.games_catalog set cover_url=p_cover_url
    where wikidata_id=p_wikidata_id and cover_url is null;
end;
$$;
revoke all on function public.set_game_catalog_cover(text,text) from public,anon,authenticated;
grant execute on function public.set_game_catalog_cover(text,text) to authenticated;

commit;
