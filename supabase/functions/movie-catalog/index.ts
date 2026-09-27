const allowedOrigins = new Set([
  'https://kattomon.github.io',
  'http://localhost:4174',
  'http://127.0.0.1:4174',
]);
const cache = new Map<string, { expires: number; movies: unknown[] }>();
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
  if (!allowedOrigins.has(origin)) return response({ error: 'Origin not allowed.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' } });
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405, origin);

  const now = Date.now();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const previous = hits.get(ip);
  if (previous && now - previous.start < 60_000 && previous.count >= 30) return response({ error: 'Espera un minuto antes de volver a buscar.' }, 429, origin);
  hits.set(ip, previous && now - previous.start < 60_000 ? { ...previous, count: previous.count + 1 } : { start: now, count: 1 });
  if (hits.size > 1_000) {
    for (const [address, window] of hits) if (now - window.start >= 60_000) hits.delete(address);
    while (hits.size > 1_000) hits.delete(hits.keys().next().value!);
  }

  const apiKey = Deno.env.get('TMDB_API_KEY');
  if (!apiKey) return response({ error: 'Falta configurar el catálogo de películas.' }, 503, origin);
  let body: { query?: unknown; movieId?: unknown };
  try { body = await request.json(); } catch { return response({ error: 'Solicitud inválida.' }, 400, origin); }

  const movieId = Number(body.movieId);
  const query = typeof body.query === 'string' ? body.query.trim().replace(/\s+/g, ' ') : '';
  if ((!Number.isSafeInteger(movieId) || movieId <= 0) && (query.length < 2 || query.length > 120)) return response({ error: 'Escribe entre 2 y 120 caracteres para buscar.' }, 400, origin);
  const cacheKey = Number.isSafeInteger(movieId) && movieId > 0 ? `id:${movieId}` : `q:${query.toLocaleLowerCase('es')}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > now) return response({ results: cached.movies }, 200, origin);

  const endpoint = Number.isSafeInteger(movieId) && movieId > 0
    ? `https://api.themoviedb.org/3/movie/${movieId}`
    : 'https://api.themoviedb.org/3/search/movie';
  const url = new URL(endpoint);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('language', 'es-CL');
  if (query) { url.searchParams.set('query', query); url.searchParams.set('region', 'CL'); url.searchParams.set('include_adult', 'false'); }
  if (Number.isSafeInteger(movieId) && movieId > 0) url.searchParams.set('append_to_response', 'credits');

  try {
    const upstream = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (upstream.status === 401) return response({ error: 'La clave del catálogo de películas no es válida.' }, 502, origin);
    if (!upstream.ok) return response({ error: 'El catálogo de películas no respondió. Inténtalo de nuevo.' }, 502, origin);
    const data = await upstream.json();
    const results = Array.isArray(data.results) ? data.results : data.id ? [data] : [];
    const movies = results.slice(0, 12).map((item: Record<string, unknown>) => {
      const date = typeof item.release_date === 'string' ? item.release_date : '';
      const year = Number(date.slice(0, 4));
      const poster = typeof item.poster_path === 'string' && /^\/[A-Za-z0-9._-]+$/.test(item.poster_path)
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;
      const credits = item.credits && typeof item.credits === 'object' ? item.credits as { crew?: Array<{ job?: string; name?: string }> } : {};
      const director = credits.crew?.filter(person => person.job === 'Director').map(person => person.name).filter(Boolean).join(', ') || null;
      return {
        tmdb_id: Number(item.id),
        title: String(item.title || item.original_title || '').slice(0, 500),
        director: director ? director.slice(0, 500) : null,
        year: year >= 1888 && year <= 2100 ? year : null,
        poster,
        description: String(item.overview || '').slice(0, 300),
      };
    }).filter((movie: { tmdb_id: number; title: string }) => Number.isSafeInteger(movie.tmdb_id) && movie.tmdb_id > 0 && movie.title);
    if (cache.size >= 500) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { expires: now + 6 * 60 * 60 * 1000, movies });
    return response({ results: movies }, 200, origin);
  } catch {
    return response({ error: 'No se pudo conectar con el catálogo. Inténtalo de nuevo.' }, 502, origin);
  }
});
