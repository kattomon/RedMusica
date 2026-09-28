begin;

drop policy if exists push_subscriptions_deny_clients on public.push_subscriptions;
create policy push_subscriptions_deny_clients on public.push_subscriptions
for all to anon, authenticated using (false) with check (false);

commit;
