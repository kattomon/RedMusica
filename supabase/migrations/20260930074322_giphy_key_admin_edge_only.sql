-- Key management now runs only through the authenticated, owner-checked Edge Function.
revoke all on function public.set_giphy_api_key(text) from public, anon, authenticated;
