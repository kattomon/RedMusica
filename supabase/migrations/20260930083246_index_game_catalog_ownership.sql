-- Keep one normalized title index and cover the catalogue owner foreign key/cap query.
begin;
drop index if exists public.games_catalog_search_title_idx;
create index if not exists games_catalog_created_by_idx on public.games_catalog(created_by);
commit;
