-- Tighten exposed tables and function privileges while keeping server features intact.
begin;

-- Community chat is only available to signed-in accounts.
revoke all on public.chat_messages from anon;
grant select on public.chat_messages to authenticated;
drop policy if exists chat_read on public.chat_messages;
drop policy if exists chat_visible on public.chat_messages;
create policy chat_read on public.chat_messages for select to authenticated using (not hidden);

-- Never expose the GIPHY credential through the public Data API.
revoke all on public.site_gif_settings from anon, authenticated;
grant all on public.site_gif_settings to service_role;
drop policy if exists gif_settings_read on public.site_gif_settings;
create policy gif_settings_server on public.site_gif_settings to service_role using (true) with check (true);

-- Clients need only know whether a video is blocked through server-controlled radio paths.
revoke all on function public.radio_video_blocked(text) from public, anon, authenticated;
grant execute on function public.radio_video_blocked(text) to service_role;
revoke all on function public.set_giphy_api_key(text) from public, anon, authenticated;

-- Remove permissive legacy insert/update/delete policies that bypassed the active-account
-- and owner-controlled post switch policies installed by admin.sql.
drop policy if exists posts_create on public.posts;
drop policy if exists posts_edit on public.posts;
drop policy if exists posts_delete on public.posts;

-- Blackjack room state is accessed only by the authenticated Edge Function using service_role.
create policy blackjack_rooms_server on public.blackjack_rooms to service_role using (true) with check (true);

commit;
