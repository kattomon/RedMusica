-- Let each catalog owner fill a missing game image, including manually added games.
begin;

create or replace function public.set_game_catalog_cover(p_game_id uuid,p_cover_url text)
returns void
language plpgsql
set search_path=''
as $$
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and not suspended) then
    raise exception 'Inicia sesión con una cuenta activa.';
  end if;
  if p_game_id is null
    or coalesce(p_cover_url,'') !~ '^https://commons\.wikimedia\.org/wiki/Special:FilePath/'
       and coalesce(p_cover_url,'') !~ '^https://thumb\.wikimedia\.org/wikipedia/[a-z-]{2,12}/thumb/'
       and coalesce(p_cover_url,'') !~ '^https://cdn\.akamai\.steamstatic\.com/steam/apps/[0-9]{1,12}/library_600x900\.jpg$'
    or char_length(coalesce(p_cover_url,''))>1000 then
    raise exception 'La portada del juego no tiene una dirección válida.';
  end if;
  update public.games_catalog set cover_url=p_cover_url
    where id=p_game_id and cover_url is null and created_by=auth.uid();
end;
$$;
revoke all on function public.set_game_catalog_cover(uuid,text) from public,anon,authenticated;
grant execute on function public.set_game_catalog_cover(uuid,text) to authenticated;

commit;
