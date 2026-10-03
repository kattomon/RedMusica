// "Adivina la canción" daily challenge. The server picks the ten songs of each day, keeps the answers
// and every try, and sends each player only the clues for the songs they have tried.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { SONGS_PER_DAY, GIVE_UP, addGuess, slotState, slotPoints, slotView, emojiFor, pickSongs, chileDay, songById } from './logic.js';

const origin = 'https://kattomon.github.io';
const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(Deno.env.get('SUPABASE_URL')!, secret!, { auth: { persistSession: false, autoRefreshToken: false } });
const actions = ['today', 'guess', 'board'];
class PlayerError extends Error {}
class Conflict extends Error {}
const fail = (message: string) => { throw new PlayerError(message); };
const random = (n: number) => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; };

async function getProfile(userId: string) {
  const { data, error } = await db.from('profiles').select('username,suspended').eq('id', userId).single();
  if (error || !data) fail('No se encontró tu perfil.');
  if (data!.suspended) fail('Tu cuenta está suspendida.');
  return data!;
}

// The songs of a day are chosen the first time someone opens it; later requests read the same row.
async function songsOf(day: string): Promise<number[]> {
  const read = async () => {
    const { data, error } = await db.from('song_days').select('songs').eq('day', day).maybeSingle();
    if (error) fail('No se pudo abrir el desafío de hoy.');
    return data?.songs as number[] | undefined;
  };
  const existing = await read();
  if (existing) return existing;
  const since = new Date(Date.parse(day + 'T12:00:00Z') - 60 * 86400e3).toISOString().slice(0, 10);
  const { data: past } = await db.from('song_days').select('songs').gte('day', since);
  const recent = new Set<number>((past || []).flatMap((row: any) => row.songs));
  const songs = pickSongs(random, { recent });
  await db.from('song_days').upsert({ day, songs }, { onConflict: 'day', ignoreDuplicates: true });
  const saved = await read();
  if (!saved) fail('No se pudo preparar el desafío de hoy.');
  return saved!;
}

async function playOf(userId: string, day: string) {
  const read = async () => {
    const { data, error } = await db.from('song_plays').select('*').eq('user_id', userId).eq('day', day).maybeSingle();
    if (error) fail('No se pudo leer tu partida.');
    return data;
  };
  const existing = await read();
  if (existing) return existing;
  await db.from('song_plays').upsert({ user_id: userId, day }, { onConflict: 'user_id,day', ignoreDuplicates: true });
  const created = await read();
  if (!created) fail('No se pudo crear tu partida.');
  return created;
}

function summary(songs: number[], guesses: number[][]) {
  const states = songs.map((id, i) => slotState(id, guesses[i]));
  return {
    score: songs.reduce((sum, id, i) => sum + slotPoints(id, guesses[i]), 0),
    solved: states.filter(s => s === 'won').length,
    finished: states.every(s => s !== 'playing'),
    line: songs.map((id, i) => emojiFor(id, guesses[i])).join('')
  };
}

function view(day: string, songs: number[], play: any, stats: any) {
  const guesses = play.guesses as number[][];
  const slots = songs.map((id, i) => slotView(id, guesses[i]));
  const s = summary(songs, guesses);
  const current = slots.findIndex(slot => slot.state === 'playing');
  return { day, slots, current, score: s.score, solved: s.solved, finished: s.finished, line: s.line, stats: stats || null };
}

async function statsOf(userId: string) {
  const { data } = await db.from('song_stats').select('days,points,best,solved,streak,best_streak,last_day').eq('user_id', userId).maybeSingle();
  return data;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 2000) return reply({ error: 'Solicitud demasiado larga.' }, 413);
    const input = JSON.parse(raw);
    if (!actions.includes(input?.action)) return reply({ error: 'Acción no válida.' }, 400);
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer /i, '');
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) return reply({ error: 'Inicia sesión para jugar al desafío del día.' }, 401);
    await getProfile(user.id);
    const day = chileDay();
    const songs = await songsOf(day);

    if (input.action === 'board') {
      const { data: links } = await db.from('friendships').select('user_a,user_b').eq('status', 'accepted').or(`user_a.eq.${user.id},user_b.eq.${user.id}`);
      const ids = [user.id, ...new Set((links || []).map((l: any) => l.user_a === user.id ? l.user_b : l.user_a))].slice(0, 300);
      const [{ data: plays }, { data: names }, { count }] = await Promise.all([
        db.from('song_plays').select('user_id,guesses').eq('day', day).in('user_id', ids),
        db.from('profiles').select('id,username').in('id', ids),
        db.from('song_plays').select('user_id', { count: 'exact', head: true }).eq('day', day)
      ]);
      const nameOf = new Map((names || []).map((p: any) => [p.id, p.username]));
      const rows = (plays || []).map((p: any) => ({ username: nameOf.get(p.user_id) || '', me: p.user_id === user.id, ...summary(songs, p.guesses) }))
        .filter((r: any) => r.username && (r.me || r.line.replace(/⬜/g, '')))
        .sort((a: any, b: any) => b.score - a.score || b.solved - a.solved || a.username.localeCompare(b.username));
      return reply({ day, rows, players: count || 0 });
    }

    if (input.action === 'today') {
      let play = await playOf(user.id, day);
      if (play.finished && !play.recorded) { await db.rpc('record_song_day', { p_user: user.id, p_day: day }); }
      return reply({ game: view(day, songs, play, await statsOf(user.id)) });
    }

    // guess
    const slot = Number(input.slot), song = Number(input.song);
    if (!Number.isInteger(slot) || slot < 0 || slot >= SONGS_PER_DAY) fail('Canción no válida.');
    if (!Number.isInteger(song) || (song !== GIVE_UP && !songById(song))) fail('Elige una canción de la lista.');
    for (let attempt = 0; attempt < 5; attempt++) {
      const play = await playOf(user.id, day);
      if (input.day && input.day !== day) fail('El desafío cambió: ya es otro día. Recarga para jugar el de hoy.');
      const guesses = structuredClone(play.guesses) as number[][];
      try { guesses[slot] = addGuess(songs[slot], guesses[slot], song); } catch (error) { fail((error as Error).message); }
      const s = summary(songs, guesses);
      const { data: saved, error } = await db.from('song_plays')
        .update({ guesses, score: s.score, solved: s.solved, finished: s.finished, updated_at: new Date().toISOString() })
        .eq('user_id', user.id).eq('day', day).eq('updated_at', play.updated_at).select('*').maybeSingle();
      if (error) fail('No se pudo guardar tu respuesta.');
      if (!saved) continue;                                   // another tab answered at the same time
      if (saved.finished && !saved.recorded) await db.rpc('record_song_day', { p_user: user.id, p_day: day });
      return reply({ game: view(day, songs, saved, saved.finished ? await statsOf(user.id) : null) });
    }
    throw new Conflict('Tu partida cambió en otra pestaña. Intenta de nuevo.');
  } catch (error) {
    if (error instanceof PlayerError || error instanceof Conflict) return reply({ error: error.message }, 400);
    console.error('cancion', error instanceof Error ? error.message : 'error');
    return reply({ error: 'No se pudo completar la jugada. Inténtalo de nuevo.' }, 400);
  }
});
