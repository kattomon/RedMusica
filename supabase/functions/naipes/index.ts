// Card game rooms (brisca, poto sucio, carioca, ¡Última!). The server shuffles, deals and keeps
// every hand; each player only receives their own cards. Moves are checked by the game rules here.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { GameError } from './cards.js';
import { gameOf } from './games.js';

const origin = 'https://kattomon.github.io';
const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(Deno.env.get('SUPABASE_URL')!, secret!, { auth: { persistSession: false, autoRefreshToken: false } });
const actions = ['create', 'join', 'state', 'options', 'start', 'play', 'timeout', 'kick', 'leave'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TURN_MS = 60 * 1000;      // a player who does not move in time gets an automatic move
const BREAK_MS = 25 * 1000;     // between hands / rounds
class Conflict extends Error {}
const fail = (message: string) => { throw new GameError(message); };

function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}
const random = (n: number) => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; };
const iso = (ms: number) => new Date(ms).toISOString();

async function getProfile(userId: string) {
  const { data, error } = await db.from('profiles').select('username,suspended').eq('id', userId).single();
  if (error || !data) fail('No se encontró tu perfil.');
  if (data!.suspended) fail('Tu cuenta está suspendida.');
  return data!;
}
async function findRoom(roomCode: string) {
  const { data, error } = await db.from('card_rooms').select('*').eq('code', roomCode).gt('expires_at', iso(Date.now())).maybeSingle();
  if (error) fail('La mesa no se pudo abrir.');
  if (!data) fail('No encontramos esa mesa. Comprueba el código.');
  return data as any;
}
async function saveRoom(room: any, state: any, hostId = room.host_id) {
  const { data, error } = await db.from('card_rooms').update({ state, host_id: hostId, updated_at: iso(Date.now()), expires_at: iso(Date.now() + 12 * 3600e3) }).eq('id', room.id).eq('updated_at', room.updated_at).select('*').maybeSingle();
  if (error) fail('La mesa no se pudo actualizar.');
  if (!data) throw new Conflict('La mesa cambió al mismo tiempo. Intenta de nuevo.');
  return data;
}
// Re-reads the room and retries when two players act at the same moment.
async function mutate(roomCode: string, change: (room: any) => { state: any; hostId?: string } | null) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const room = await findRoom(roomCode);
    const next = change(room);
    if (!next) return room;
    try { return await saveRoom(room, next.state, next.hostId ?? room.host_id); } catch (error) { if (!(error instanceof Conflict)) throw error; }
  }
  fail('La mesa está muy ocupada. Intenta de nuevo.');
}

const waitingFor = (state: any) => {
  const mod = gameOf(state.game);
  return state.status === 'playing' && state.match ? mod.turnOf(state.match) : null;
};
function afterMove(state: any, before: any, now: number) {
  const mod = gameOf(state.game);
  if (mod.result(state.match)) { state.status = 'finished'; state.recorded = false; }
  if (!before || before.seq !== state.match.seq || before.phase !== state.match.phase) state.turnStartedAt = now;
}

async function recordResult(room: any) {
  const state = room.state, mod = gameOf(state.game);
  if (state.status !== 'finished' || state.recorded || !state.match) return room;
  const outcome = mod.result(state.match);
  if (outcome && state.match.players.length >= 2) {
    const results = state.match.players.map((id: string) => ({ user_id: id, won: outcome.winners.includes(id), lost: outcome.losers.includes(id) }));
    const { error } = await db.rpc('record_card_result', { p_match: state.matchId, p_game: state.game, p_room: room.code, p_results: results });
    if (error) { console.error('record_card_result failed', error.code); return room; }
  }
  try { return await saveRoom(room, { ...state, recorded: true }); } catch { return room; }
}

function publicState(room: any, userId: string, now: number) {
  const state = room.state, mod = gameOf(state.game);
  return {
    code: room.code, host_id: room.host_id, status: state.status, game: state.game, options: state.options,
    players: state.players, now, turnStartedAt: state.turnStartedAt || null, turnMs: TURN_MS, breakMs: BREAK_MS,
    waitingFor: waitingFor(state), notice: state.notice || null,
    view: state.match ? mod.view(state.match, userId) : null,
    outcome: state.status === 'finished' && state.match ? mod.result(state.match) : null,
    limits: { min: mod.meta.minPlayers, max: mod.meta.maxPlayers, allowed: mod.meta.allowed }
  };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 8000) return reply({ error: 'Solicitud demasiado larga.' }, 413);
    const input = JSON.parse(raw);
    if (!actions.includes(input?.action)) return reply({ error: 'Acción no válida.' }, 400);
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer /i, '');
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) return reply({ error: 'Inicia sesión para jugar a las cartas.' }, 401);
    const profile = await getProfile(user.id);
    const now = Date.now();

    if (input.action === 'create') {
      const mod = gameOf(input.game);
      if (!mod) fail('Elige un juego.');
      await db.from('card_rooms').delete().lt('expires_at', iso(now));
      const state = { status: 'lobby', game: mod.meta.id, options: mod.meta.sanitize(input.options || {}), players: [{ user_id: user.id, username: profile.username }], match: null };
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await db.from('card_rooms').insert({ code: code(), host_id: user.id, state }).select('*').single();
        if (!error && data) return reply({ room: publicState(data, user.id, now) });
      }
      return reply({ error: 'La mesa no se pudo crear. Inténtalo otra vez.' }, 503);
    }

    const roomCode = typeof input.code === 'string' ? input.code.toUpperCase() : '';
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) return reply({ error: 'El código debe tener seis caracteres.' }, 400);
    let room = await findRoom(roomCode);
    const member = room.state.players.some((p: any) => p.user_id === user.id);

    if (input.action === 'join') {
      if (!member) room = await mutate(roomCode, current => {
        const state = structuredClone(current.state), mod = gameOf(state.game);
        if (state.players.some((p: any) => p.user_id === user.id)) return null;
        if (state.status === 'playing') fail('La partida ya empezó. Espera a que termine para entrar.');
        if (state.players.length >= mod.meta.maxPlayers) fail(`La mesa ya tiene ${mod.meta.maxPlayers} jugadores.`);
        state.players.push({ user_id: user.id, username: profile.username });
        state.notice = null;
        return { state };
      });
      return reply({ room: publicState(room, user.id, now) });
    }
    if (!member) return reply({ error: 'No formas parte de esta mesa.' }, 403);

    if (input.action === 'state') {
      if (room.state.status === 'finished' && !room.state.recorded) room = await recordResult(room);
    } else if (input.action === 'leave') {
      const result = await mutate(roomCode, current => {
        const state = structuredClone(current.state);
        state.players = state.players.filter((p: any) => p.user_id !== user.id);
        if (state.status === 'playing') {
          // The game cannot continue with a missing hand: back to the room, nothing recorded.
          state.status = 'lobby'; state.match = null; state.recorded = true;
          state.notice = `${profile.username} salió de la mesa y la partida se canceló.`;
        }
        const hostId = current.host_id === user.id && state.players.length ? state.players[0].user_id : current.host_id;
        return { state, hostId };
      });
      if (!result.state.players.length) await db.from('card_rooms').delete().eq('id', result.id);
      return reply({ left: true });
    } else if (input.action === 'kick') {
      if (room.host_id !== user.id) fail('Solo quien creó la mesa puede sacar jugadores.');
      if (typeof input.user_id !== 'string' || !UUID.test(input.user_id) || input.user_id === user.id) fail('Elige a otra persona.');
      room = await mutate(roomCode, current => {
        const state = structuredClone(current.state);
        if (state.status === 'playing') fail('No puedes sacar a nadie en plena partida.');
        state.players = state.players.filter((p: any) => p.user_id !== input.user_id);
        return { state };
      });
    } else if (input.action === 'options') {
      if (room.host_id !== user.id) fail('Solo quien creó la mesa puede cambiar el juego.');
      room = await mutate(roomCode, current => {
        const state = structuredClone(current.state);
        if (state.status === 'playing') fail('El juego se cambia entre partidas.');
        const mod = gameOf(input.game || state.game);
        if (!mod) fail('Elige un juego.');
        if (state.players.length > mod.meta.maxPlayers) fail(`${mod.meta.name} es para ${mod.meta.maxPlayers} jugadores como máximo.`);
        Object.assign(state, { status: 'lobby', game: mod.meta.id, options: mod.meta.sanitize(input.options || {}), match: null, notice: null });
        return { state };
      });
    } else if (input.action === 'start') {
      if (room.host_id !== user.id) fail('Solo quien creó la mesa puede repartir.');
      room = await mutate(roomCode, current => {
        const state = structuredClone(current.state), mod = gameOf(state.game);
        if (state.status === 'playing') fail('La partida ya empezó.');
        if (!mod.meta.allowed.includes(state.players.length)) fail(`${mod.meta.name} se juega con ${mod.meta.allowed.join(', ').replace(/, (\d+)$/, ' o $1')} personas.`);
        state.match = mod.deal(state.players.map((p: any) => p.user_id), state.options, random);
        Object.assign(state, { status: 'playing', matchId: crypto.randomUUID(), turnStartedAt: now, recorded: false, notice: null });
        afterMove(state, null, now);
        return { state };
      });
    } else if (input.action === 'play') {
      if (!input.move || typeof input.move !== 'object') fail('Jugada no válida.');
      room = await mutate(roomCode, current => {
        const state = structuredClone(current.state), mod = gameOf(state.game);
        if (state.status !== 'playing') fail('No hay una partida en curso.');
        const before = state.match;
        state.match = mod.act(state.match, user.id, input.move, random);
        afterMove(state, before, now);
        return { state };
      });
    } else if (input.action === 'timeout') {
      // Anyone at the table may ask once the clock runs out; the late player gets an automatic move.
      room = await mutate(roomCode, current => {
        const state = structuredClone(current.state), mod = gameOf(state.game);
        if (state.status !== 'playing') return null;
        const late = mod.turnOf(state.match);
        const limit = late ? TURN_MS : BREAK_MS;
        if (now - (state.turnStartedAt || now) < limit) return null;
        const who = late || state.match.players[0];
        const before = state.match;
        state.match = mod.act(state.match, who, mod.autoMove(state.match, who, random), random);
        afterMove(state, before, now);
        return { state };
      });
    }
    if (room.state.status === 'finished' && !room.state.recorded) room = await recordResult(room);
    return reply({ room: publicState(room, user.id, now) });
  } catch (error) {
    if (error instanceof GameError || error instanceof Conflict) return reply({ error: error.message }, 400);
    console.error('naipes', error instanceof Error ? error.message : 'error');
    return reply({ error: 'No se pudo completar la jugada. Inténtalo de nuevo.' }, 400);
  }
});

