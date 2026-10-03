// "Adivina la canción". The server picks the ten songs of each day, keeps the answers and every
// step, and sends each player only the clues they have uncovered. It also runs the live rooms,
// where everybody plays the same songs at the same time.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import {
  SONGS_PER_DAY, GIVE_UP, SKIP, addGuess, slotState, slotPoints, slotView, emojiFor, solvedAt, pickSongs, chileDay, songById,
  liveCreate, liveJoin, liveLeave, liveStart, liveAdvance, liveGuess, liveView, liveResult, liveOptions, LIVE
} from './logic.js';

const origin = 'https://kattomon.github.io';
const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(Deno.env.get('SUPABASE_URL')!, secret!, { auth: { persistSession: false, autoRefreshToken: false } });
const actions = ['today', 'guess', 'board', 'archive', 'room_create', 'room_join', 'room_state', 'room_options', 'room_start', 'room_guess', 'room_advance', 'room_leave', 'room_kick'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
class PlayerError extends Error {}
class Conflict extends Error {}
const fail = (message: string): never => { throw new PlayerError(message); };
const random = (n: number) => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; };
const iso = (ms: number) => new Date(ms).toISOString();

async function getProfile(userId: string) {
  const { data, error } = await db.from('profiles').select('username,suspended').eq('id', userId).single();
  if (error || !data) fail('No se encontró tu perfil.');
  if (data!.suspended) fail('Tu cuenta está suspendida.');
  return data!;
}

// ---------- daily challenge ----------
// The songs of a day are chosen the first time someone opens it; later requests read the same row.
async function songsOf(day: string, create = true): Promise<number[] | undefined> {
  const read = async () => {
    const { data, error } = await db.from('song_days').select('songs').eq('day', day).maybeSingle();
    if (error) fail('No se pudo abrir el desafío.');
    return data?.songs as number[] | undefined;
  };
  const existing = await read();
  if (existing || !create) return existing;
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
  const dist = [0, 0, 0, 0, 0, 0, 0];
  songs.forEach((id, i) => { if (states[i] !== 'playing') dist[solvedAt(id, guesses[i]) - 1]++; });
  return {
    score: songs.reduce((sum, id, i) => sum + slotPoints(id, guesses[i]), 0),
    solved: states.filter(s => s === 'won').length,
    finished: states.every(s => s !== 'playing'),
    line: songs.map((id, i) => emojiFor(id, guesses[i])).join(''),
    dist
  };
}

function view(day: string, today: string, songs: number[], play: any, stats: any) {
  const guesses = play.guesses as number[][];
  const slots = songs.map((id, i) => slotView(id, guesses[i]));
  const s = summary(songs, guesses);
  const current = slots.findIndex(slot => slot.state === 'playing');
  return { day, archive: day !== today, slots, current, score: s.score, solved: s.solved, finished: s.finished, line: s.line, dist: s.dist, stats: stats || null };
}

async function statsOf(userId: string) {
  const { data } = await db.from('song_stats').select('days,points,best,solved,streak,best_streak,last_day,dist,live_games,live_wins').eq('user_id', userId).maybeSingle();
  return data;
}

async function record(userId: string, day: string, songs: number[], play: any) {
  if (!play.finished || play.recorded) return;
  await db.rpc('record_song_day', { p_user: userId, p_day: day, p_dist: summary(songs, play.guesses).dist });
}

// ---------- live rooms ----------
function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}
async function findRoom(roomCode: string) {
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) fail('El código debe tener seis caracteres.');
  const { data, error } = await db.from('song_rooms').select('*').eq('code', roomCode).gt('expires_at', iso(Date.now())).maybeSingle();
  if (error) fail('La sala no se pudo abrir.');
  if (!data) fail('No encontramos esa sala. Comprueba el código.');
  return data as any;
}
async function saveRoom(room: any, state: any, hostId = room.host_id) {
  const { data, error } = await db.from('song_rooms').update({ state, host_id: hostId, updated_at: iso(Date.now()), expires_at: iso(Date.now() + 12 * 3600e3) })
    .eq('id', room.id).eq('updated_at', room.updated_at).select('*').maybeSingle();
  if (error) fail('La sala no se pudo actualizar.');
  if (!data) throw new Conflict('La sala cambió al mismo tiempo. Intenta de nuevo.');
  return data;
}
// Re-reads the room and retries when two players act at the same moment. Deadlines are applied first.
async function mutate(roomCode: string, now: number, change: (room: any, state: any) => { state: any; hostId?: string } | null) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const room = await findRoom(roomCode);
    const advanced = liveAdvance(room.state, now);
    const next = change(room, advanced);
    if (!next && advanced === room.state) return room;
    try { return await saveRoom(room, next ? next.state : advanced, next?.hostId ?? room.host_id); } catch (error) { if (!(error instanceof Conflict)) throw error; }
  }
  fail('La sala está muy ocupada. Intenta de nuevo.');
}
async function recordRoom(room: any) {
  const state = room.state, result = liveResult(state);
  if (!result || state.recorded || !state.matchId) return room;
  if (result.players.length >= 2) {
    const { error } = await db.rpc('record_song_room', { p_match: state.matchId, p_room: room.code, p_players: result.players, p_winners: result.winners });
    if (error) { console.error('record_song_room failed', error.code); return room; }
  }
  try { return await saveRoom(room, { ...state, recorded: true }); } catch { return room; }
}
const roomView = (room: any, userId: string, now: number) => ({ code: room.code, host_id: room.host_id, now, notice: room.state.notice || null, ...liveView(room.state, userId, now) });

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
    if (authError || !user) return reply({ error: 'Inicia sesión para jugar.' }, 401);
    const profile = await getProfile(user.id);
    const now = Date.now();
    const today = chileDay(now);

    // ----- live rooms -----
    if (input.action.startsWith('room_')) {
      if (input.action === 'room_create') {
        await db.from('song_rooms').delete().lt('expires_at', iso(now));
        const state = liveCreate({ id: user.id, username: profile.username }, input.options || {});
        for (let attempt = 0; attempt < 5; attempt++) {
          const { data, error } = await db.from('song_rooms').insert({ code: code(), host_id: user.id, state }).select('*').single();
          if (!error && data) return reply({ room: roomView(data, user.id, now) });
        }
        return reply({ error: 'La sala no se pudo crear. Inténtalo otra vez.' }, 503);
      }
      const roomCode = typeof input.code === 'string' ? input.code.toUpperCase() : '';
      let room = await findRoom(roomCode);
      const member = (r: any) => r.state.players.some((p: any) => p.user_id === user.id);
      if (input.action === 'room_join') {
        room = await mutate(roomCode, now, (_r, state) => {
          if (state.players.some((p: any) => p.user_id === user.id)) return null;
          try { return { state: { ...liveJoin(state, { id: user.id, username: profile.username }), notice: null } }; } catch (error) { return fail((error as Error).message); }
        });
        return reply({ room: roomView(room, user.id, now) });
      }
      if (!member(room)) return reply({ error: 'No formas parte de esta sala.' }, 403);
      if (input.action === 'room_leave') {
        const left = await mutate(roomCode, now, (r, state) => {
          const next = liveLeave(state, user.id);
          const hostId = r.host_id === user.id && next.players.length ? next.players[0].user_id : r.host_id;
          return { state: next, hostId };
        });
        if (!left.state.players.length) await db.from('song_rooms').delete().eq('id', left.id);
        return reply({ left: true });
      }
      const host = room.host_id === user.id;
      if (input.action === 'room_kick') {
        if (!host) fail('Solo quien creó la sala puede sacar jugadores.');
        if (typeof input.user_id !== 'string' || !UUID.test(input.user_id) || input.user_id === user.id) fail('Elige a otra persona.');
        room = await mutate(roomCode, now, (_r, state) => ({ state: liveLeave(state, input.user_id) }));
      } else if (input.action === 'room_options') {
        if (!host) fail('Solo quien creó la sala puede cambiar las opciones.');
        room = await mutate(roomCode, now, (_r, state) => {
          if (!['lobby', 'finished'].includes(state.status)) fail('Las opciones se cambian entre partidas.');
          return { state: { ...state, status: 'lobby', options: liveOptions(input.options || {}), seq: state.seq + 1 } };
        });
      } else if (input.action === 'room_start') {
        if (!host) fail('Solo quien creó la sala puede empezar.');
        room = await mutate(roomCode, now, (_r, state) => {
          try { return { state: { ...liveStart(state, random, now), matchId: crypto.randomUUID(), recorded: false, notice: null } }; } catch (error) { return fail((error as Error).message); }
        });
      } else if (input.action === 'room_guess') {
        room = await mutate(roomCode, now, (_r, state) => {
          try { return { state: { ...liveGuess(state, user.id, input.song, now), matchId: state.matchId, recorded: state.recorded } }; } catch (error) { return fail((error as Error).message); }
        });
      } else {
        // room_state / room_advance: deadlines are applied by mutate.
        room = await mutate(roomCode, now, () => null);
      }
      if (room.state.status === 'finished' && !room.state.recorded) room = await recordRoom(room);
      return reply({ room: roomView(room, user.id, now) });
    }

    // ----- daily challenge -----
    if (input.action === 'board') {
      const songs = (await songsOf(today))!;
      const { data: links } = await db.from('friendships').select('user_a,user_b').eq('status', 'accepted').or(`user_a.eq.${user.id},user_b.eq.${user.id}`);
      const ids = [user.id, ...new Set((links || []).map((l: any) => l.user_a === user.id ? l.user_b : l.user_a))].slice(0, 300);
      const [{ data: plays }, { data: names }, { count }] = await Promise.all([
        db.from('song_plays').select('user_id,guesses').eq('day', today).in('user_id', ids),
        db.from('profiles').select('id,username').in('id', ids),
        db.from('song_plays').select('user_id', { count: 'exact', head: true }).eq('day', today)
      ]);
      const nameOf = new Map((names || []).map((p: any) => [p.id, p.username]));
      const rows = (plays || []).map((p: any) => { const s = summary(songs, p.guesses); return { username: nameOf.get(p.user_id) || '', me: p.user_id === user.id, score: s.score, solved: s.solved, finished: s.finished, line: s.line }; })
        .filter((r: any) => r.username && (r.me || r.line.replace(/⬜/g, '')))
        .sort((a: any, b: any) => b.score - a.score || b.solved - a.solved || a.username.localeCompare(b.username));
      return reply({ day: today, rows, players: count || 0 });
    }

    if (input.action === 'archive') {
      const { data: days } = await db.from('song_days').select('day').lt('day', today).order('day', { ascending: false }).limit(60);
      const list = (days || []).map((d: any) => d.day);
      const { data: plays } = list.length ? await db.from('song_plays').select('day,score,finished').eq('user_id', user.id).in('day', list) : { data: [] };
      const mine = new Map((plays || []).map((p: any) => [p.day, p]));
      return reply({ today, days: list.map((day: string) => ({ day, score: mine.get(day)?.score ?? null, finished: !!mine.get(day)?.finished })) });
    }

    // The day being played: today, or a past day from the archive (those do not count for the streak).
    const day = typeof input.day === 'string' && DAY.test(input.day) && input.day <= today ? input.day : today;
    const songs = await songsOf(day, day === today);
    if (!songs) fail('Ese desafío no existe.');

    if (input.action === 'today') {
      const play = await playOf(user.id, day);
      if (day === today) await record(user.id, day, songs!, play);
      return reply({ game: view(day, today, songs!, play, await statsOf(user.id)) });
    }

    // guess (a song id, SKIP or GIVE_UP)
    const slot = Number(input.slot), song = Number(input.song);
    if (!Number.isInteger(slot) || slot < 0 || slot >= SONGS_PER_DAY) fail('Canción no válida.');
    if (!Number.isInteger(song) || (song !== GIVE_UP && song !== SKIP && !songById(song))) fail('Elige una canción de la lista.');
    for (let attempt = 0; attempt < 5; attempt++) {
      const play = await playOf(user.id, day);
      const guesses = structuredClone(play.guesses) as number[][];
      try { guesses[slot] = addGuess(songs![slot], guesses[slot], song); } catch (error) { fail((error as Error).message); }
      const s = summary(songs!, guesses);
      const { data: saved, error } = await db.from('song_plays')
        .update({ guesses, score: s.score, solved: s.solved, finished: s.finished, updated_at: new Date().toISOString() })
        .eq('user_id', user.id).eq('day', day).eq('updated_at', play.updated_at).select('*').maybeSingle();
      if (error) fail('No se pudo guardar tu respuesta.');
      if (!saved) continue;                                   // another tab answered at the same time
      if (day === today) await record(user.id, day, songs!, saved);
      return reply({ game: view(day, today, songs!, saved, saved.finished ? await statsOf(user.id) : null) });
    }
    throw new Conflict('Tu partida cambió en otra pestaña. Intenta de nuevo.');
  } catch (error) {
    if (error instanceof PlayerError || error instanceof Conflict) return reply({ error: error.message }, 400);
    console.error('cancion', error instanceof Error ? error.message : 'error');
    return reply({ error: 'No se pudo completar la jugada. Inténtalo de nuevo.' }, 400);
  }
});
