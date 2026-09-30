import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const origin = 'https://kattomon.github.io';
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(Deno.env.get('SUPABASE_URL')!, secret!, { auth: { persistSession: false, autoRefreshToken: false } });

// Per-isolate rate limit; bounded to avoid untrusted users growing this map indefinitely.
const requests = new Map<string, number[]>();
function rateLimited(userId: string) {
  const now = Date.now();
  const recent = (requests.get(userId) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 20) return true;
  recent.push(now);
  if (requests.size >= 10_000 && !requests.has(userId)) requests.delete(requests.keys().next().value!);
  requests.set(userId, recent);
  return false;
}

function safeGifUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !(/(^|\.)giphy\.com$|(^|\.)giphyusercontent\.com$/i.test(url.hostname))) return null;
    if (!/\.(gif|webp)$/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.headers.get('origin') && req.headers.get('origin') !== origin) return reply({ error: 'Origen no permitido.' }, 403);
  if (req.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405);
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer /i, '');
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) return reply({ error: 'Inicia sesión para buscar GIFs.' }, 401);

    const raw = await req.text();
    if (raw.length > 512) return reply({ error: 'La búsqueda es demasiado larga.' }, 413);
    let input: { action?: unknown; key?: unknown; query?: unknown };
    try { input = JSON.parse(raw); } catch { return reply({ error: 'Solicitud no válida.' }, 400); }
    const { data: profile, error: profileError } = await db.from('profiles').select('role,suspended').eq('id', user.id).maybeSingle();
    if (profileError || !profile || profile.suspended) return reply({ error: 'La cuenta no tiene acceso a esta búsqueda.' }, 403);
    if ((input.action === 'status' || input.action === 'set_key') && profile.role !== 'owner') {
      return reply({ error: 'Solo owner puede administrar GIPHY.' }, 403);
    }
    if (input.action === 'set_key') {
      const key = typeof input.key === 'string' ? input.key.trim() : '';
      if (!key || key.length > 200) return reply({ error: 'La clave debe tener entre 1 y 200 caracteres.' }, 400);
      const { error } = await db.from('site_gif_settings').update({ api_key: key }).eq('id', true);
      if (error) return reply({ error: 'No se pudo guardar la clave.' }, 500);
      return reply({ saved: true });
    }
    if (input.action === 'status') {
      const { data: setting, error: settingError } = await db.from('site_gif_settings').select('api_key').eq('id', true).maybeSingle();
      if (settingError) return reply({ error: 'No se pudo consultar el estado.' }, 503);
      return reply({ configured: Boolean(setting?.api_key) });
    }
    const query = typeof input.query === 'string' ? input.query.trim().slice(0, 80) : '';
    if (query.length < 2) return reply({ error: 'Escribe al menos dos caracteres.' }, 400);
    if (rateLimited(user.id)) return reply({ error: 'Alcanzaste el límite temporal de búsquedas. Espera un minuto.' }, 429);
    const { data: setting, error: settingError } = await db.from('site_gif_settings').select('api_key').eq('id', true).maybeSingle();
    if (settingError || !setting?.api_key) return reply({ error: 'La búsqueda de GIFs aún no está configurada.' }, 503);

    const url = new URL('https://api.giphy.com/v1/gifs/search');
    url.searchParams.set('api_key', setting.api_key);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '18');
    url.searchParams.set('rating', 'g');
    url.searchParams.set('lang', 'es');
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return reply({ error: 'GIPHY no pudo completar la búsqueda.' }, 502);
    const payload = await response.json();
    const gifs = (Array.isArray(payload.data) ? payload.data : []).slice(0, 18).flatMap((gif: any) => {
      const original = safeGifUrl(gif.images?.original?.url);
      const preview = safeGifUrl(gif.images?.fixed_width_small?.url);
      return original && preview ? [{ url: original, preview, title: String(gif.title || 'GIF').slice(0, 120) }] : [];
    });
    return reply({ gifs });
  } catch {
    return reply({ error: 'No se pudo completar la búsqueda. Inténtalo de nuevo.' }, 502);
  }
});
