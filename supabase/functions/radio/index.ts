import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const origin = 'https://kattomon.github.io';
const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const url = Deno.env.get('SUPABASE_URL')!;
const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(url, secret!, { auth: { persistSession: false, autoRefreshToken: false } });
async function rpc(name: string, args = {}) {
 const { data, error } = await db.rpc(name, args);
 if (error) throw new Error(error.message);
 return data;
}
async function youtube(path: string, params: Record<string,string>) {
 const key = Deno.env.get('YOUTUBE_API_KEY');
 if (!key) throw new Error('La búsqueda todavía no está configurada.');
 const target = new URL('https://www.googleapis.com/youtube/v3/' + path);
 Object.entries(params).forEach(([k,v]) => target.searchParams.set(k,v));
 // Keep the API key out of URLs and logs.
 const response = await fetch(target, { headers: { 'X-Goog-Api-Key': key }, signal: AbortSignal.timeout(12000) });
 if (!response.ok) throw new Error(response.status === 403 ? 'YouTube no permite más consultas en este momento. Prueba mañana.' : 'YouTube no responde. Inténtalo de nuevo.');
 return await response.json();
}
async function removeBlocked(songs: any[]) {
 if (!songs.length) return songs;
 const ids=songs.map(item=>item.video_id).filter(Boolean);
 const {data,error}=await db.from('radio_blocklist').select('video_id').in('video_id',ids);
 if(error) throw new Error('No se pudo comprobar la lista de canciones retiradas.');
 const blocked=new Set((data||[]).map((item:any)=>item.video_id));
 return songs.filter(item=>!blocked.has(item.video_id));
}
function song(item: any) {
 const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(item.contentDetails?.duration || '');
 const duration = m ? Number(m[1] || 0)*3600+Number(m[2] || 0)*60+Number(m[3] || 0) : 0;
 const restriction = item.contentDetails?.regionRestriction;
 if (duration<20 || duration>1200 || !item.status?.embeddable || item.status?.privacyStatus!=='public' || item.snippet?.liveBroadcastContent!=='none' || restriction?.blocked?.includes('CL') || (restriction?.allowed && !restriction.allowed.includes('CL'))) return null;
 const thumbnails = item.snippet?.thumbnails || {};
 const thumbnail = thumbnails.maxres?.url || thumbnails.standard?.url || thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url || null;
 return { video_id:item.id, title:item.snippet.title.slice(0,300), channel:item.snippet.channelTitle.slice(0,200), duration, thumbnail };
}
Deno.serve(async req => {
 if (req.method==='OPTIONS') return new Response(null, { headers });
 if (req.method!=='POST') return reply({ error:'Método no permitido.' },405);
 try {
  const raw = await req.text();
  if (raw.length>1024) return reply({ error:'Solicitud demasiado larga.' },413);
  const input = JSON.parse(raw);
  if (input.action==='state') return reply(await rpc('radio_state'));
  if (!['search','request'].includes(input.action)) return reply({ error:'Acción no válida.' },400);
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer /i,'');
  const { data:{ user }, error } = await db.auth.getUser(token);
  if (error || !user) return reply({ error:'Inicia sesión para buscar y pedir canciones.' },401);
  const account = await db.from('profiles').select('suspended').eq('id',user.id).single();
  if(account.error || account.data.suspended) return reply({error:'Tu cuenta está suspendida.'},403);
  if (input.action==='search') {
   const query = typeof input.query==='string' ? input.query.trim().replace(/\s+/g,' ') : '';
   if (query.length<2 || query.length>160) return reply({ error:'Escribe el artista y/o la canción (2 a 160 caracteres).' },400);
   const cacheKey = query.toLocaleLowerCase('es');
   const limit = await rpc('radio_limit',{ p_user:user.id,p_action:'search',p_query:cacheKey });
   if (limit.cached) return reply({ songs:await removeBlocked(limit.cached) });
   const found = await youtube('search',{ part:'snippet',q:query,type:'video',videoEmbeddable:'true',videoSyndicated:'true',regionCode:'CL',maxResults:'10' });
   const ids = found.items.map((v:any)=>v.id.videoId).filter(Boolean).join(',');
   const videos = ids ? await youtube('videos',{ part:'snippet,contentDetails,status',id:ids }) : { items:[] };
   const songs = videos.items.map(song).filter(Boolean);
   const saved = await db.from('radio_cache').upsert({ query:cacheKey,result:songs,expires_at:new Date(Date.now()+86400000).toISOString() });
   if (saved.error) throw new Error('No se pudo guardar la búsqueda.');
   return reply({ songs:await removeBlocked(songs) });
  }
  if (typeof input.video_id!=='string' || !/^[A-Za-z0-9_-]{11}$/.test(input.video_id)) return reply({ error:'Canción no válida.' },400);
  await rpc('radio_limit',{ p_user:user.id,p_action:'request' });
  const details = await youtube('videos',{ part:'snippet,contentDetails,status',id:input.video_id });
  const selected = details.items[0] && song(details.items[0]);
  if (!selected) return reply({ error:'Este video no se puede reproducir aquí. Elige otra versión de entre 20 segundos y 20 minutos.' },400);
  await rpc('radio_enqueue',{ p_user:user.id,p_video:selected.video_id,p_title:selected.title,p_channel:selected.channel,p_duration:selected.duration });
  return reply(await rpc('radio_state'));
 } catch (error) {
  const message = error instanceof Error ? error.message : '';
  const safe = /^(Límite|Inicia|Ya tienes|Esta canción|Este video|La cola|YouTube|La búsqueda|No se pudo)/.test(message) ? message : 'No se pudo completar la solicitud. Inténtalo de nuevo.';
  return reply({ error:safe },400);
 }
});
