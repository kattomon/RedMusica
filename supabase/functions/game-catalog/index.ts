const allowedOrigins = new Set([
  'https://kattomon.github.io',
  'http://localhost:4174',
  'http://127.0.0.1:4174',
]);
const cache = new Map<string, { expires: number; games: unknown[] }>();
const hits = new Map<string, { start: number; count: number }>();

function response(data: unknown, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
      'Cache-Control': 'no-store',
    },
  });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin') || '';
  if (!allowedOrigins.has(origin)) return response({ error: 'Origen no permitido.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' } });
  if (request.method !== 'POST') return response({ error: 'Método no permitido.' }, 405, origin);

  const now = Date.now();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const previous = hits.get(ip);
  if (previous && now - previous.start < 60_000 && previous.count >= 30) return response({ error: 'Espera un minuto antes de volver a buscar.' }, 429, origin);
  hits.set(ip, previous && now - previous.start < 60_000 ? { ...previous, count: previous.count + 1 } : { start: now, count: 1 });
  if (hits.size > 1_000) {
    for (const [address, window] of hits) if (now - window.start >= 60_000) hits.delete(address);
    while (hits.size > 1_000) hits.delete(hits.keys().next().value!);
  }

  let body: { query?: unknown };
  try { body = await request.json(); } catch { return response({ error: 'Solicitud inválida.' }, 400, origin); }
  const query = typeof body.query === 'string' ? body.query.trim().replace(/\s+/g, ' ') : '';
  if (query.length < 2 || query.length > 80) return response({ error: 'Escribe entre 2 y 80 caracteres para buscar.' }, 400, origin);
  const key = query.toLocaleLowerCase('es');
  const cached = cache.get(key);
  if (cached && cached.expires > now) return response({ results: cached.games }, 200, origin);

  try {
    const url = new URL('https://store.steampowered.com/api/storesearch/');
    url.searchParams.set('term', query);
    url.searchParams.set('l', 'english');
    url.searchParams.set('cc', 'us');
    const upstream = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) return response({ error: 'Steam no respondió. Inténtalo de nuevo.' }, 502, origin);
    const data = await upstream.json();
    const games = (Array.isArray(data.items) ? data.items : []).slice(0, 12).flatMap((item: Record<string, unknown>) => {
      const id = Number(item.id);
      const title = typeof item.name === 'string' ? item.name.trim().slice(0, 120) : '';
      if (!Number.isSafeInteger(id) || id <= 0 || !title) return [];
      return [{ title, steam_id: id, cover: `https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_600x900.jpg` }];
    });
    if (cache.size >= 500) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: now + 6 * 60 * 60 * 1000, games });
    return response({ results: games }, 200, origin);
  } catch {
    return response({ error: 'No se pudo conectar con el catálogo de juegos.' }, 502, origin);
  }
});
