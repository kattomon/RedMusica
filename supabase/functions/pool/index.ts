import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { applyShot, applyTimeout, newGame } from './engine.js';
import { claimAllowed, finishByForfeit, joinRoom, leaveRoom, newRoomState, publicState, requestRematch, timeoutAllowed } from './rooms.js';

const origin = 'https://kattomon.github.io';
const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(Deno.env.get('SUPABASE_URL')!, secret!, { auth: { persistSession: false, autoRefreshToken: false } });
const actions = ['create', 'join', 'state', 'shoot', 'rematch', 'claim', 'timeout', 'leave'];
const safeErrors = /^(Inicia|No se encontró|Tu cuenta|No encontramos|El código|La sala|La partida|La mesa|No formas|Todavía|El tiro|Coloca|Solo puedes|Tu rival|Esperando|Elige)/;

function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}
const randomBytes = () => Array.from(crypto.getRandomValues(new Uint8Array(32)));
const startGame = (state: any, breakerId: string) => newGame(crypto.randomUUID(), state.players.map((p: any) => p.user_id), breakerId, randomBytes());

async function getProfile(userId: string) {
  const { data, error } = await db.from('profiles').select('username,suspended').eq('id', userId).single();
  if (error || !data) throw new Error('No se encontró tu perfil.');
  if (data.suspended) throw new Error('Tu cuenta está suspendida.');
  return data;
}
async function findRoom(roomCode: string) {
  const { data, error } = await db.from('pool_rooms').select('*').eq('code', roomCode).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error) throw new Error('La sala no se pudo abrir.');
  if (!data) throw new Error('No encontramos esa sala. Comprueba el código.');
  return data;
}
async function saveRoom(room: any, state: any, hostId = room.host_id) {
  const { data, error } = await db.from('pool_rooms').update({ state, host_id: hostId, updated_at: new Date().toISOString() }).eq('id', room.id).eq('updated_at', room.updated_at).select('*').maybeSingle();
  if (error) throw new Error('La mesa no se pudo actualizar.');
  if (!data) throw new Error('La mesa cambió al mismo tiempo. Intenta de nuevo.');
  return data;
}
// Stores the result once per game; a failure is retried on the next request for that room.
async function recordResult(room: any) {
  const state = room.state, game = state.game;
  if (state.status !== 'finished' || !game?.winner || state.recorded) return room;
  const loser = game.players.find((id: string) => id !== game.winner);
  const { error } = await db.rpc('record_pool_result', { p_match: game.id, p_room: room.code, p_winner: game.winner, p_loser: loser, p_reason: game.reason || '' });
  if (error) { console.error('record_pool_result failed', error.code); return room; }
  try { return await saveRoom(room, { ...state, recorded: true }); } catch { return room; }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 2048) return reply({ error: 'Solicitud demasiado larga.' }, 413);
    const input = JSON.parse(raw);
    if (!actions.includes(input?.action)) return reply({ error: 'Acción no válida.' }, 400);
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer /i, '');
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) return reply({ error: 'Inicia sesión para jugar al pool.' }, 401);
    const profile = await getProfile(user.id);
    const now = Date.now();

    if (input.action === 'create') {
      await db.from('pool_rooms').delete().lt('expires_at', new Date().toISOString());
      await db.from('pool_rooms').delete().eq('host_id', user.id).eq('state->>status', 'lobby');
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await db.from('pool_rooms').insert({ code: code(), host_id: user.id, state: newRoomState(user.id, profile.username) }).select('*').single();
        if (!error && data) return reply({ room: publicState(data) });
      }
      return reply({ error: 'La sala no se pudo crear. Inténtalo otra vez.' }, 503);
    }

    const roomCode = typeof input.code === 'string' ? input.code.toUpperCase() : '';
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) return reply({ error: 'El código debe tener seis caracteres.' }, 400);
    let room = await findRoom(roomCode);
    const member = room.state.players.some((p: any) => p.user_id === user.id);

    if (input.action === 'join') {
      if (member) return reply({ room: publicState(await recordResult(room)) });
      const state = joinRoom(room.state, user.id, profile.username, now);
      state.game = startGame(state, room.host_id);
      room = await saveRoom(room, state);
      return reply({ room: publicState(room) });
    }
    if (!member) return reply({ error: 'No formas parte de esta sala.' }, 403);
    if (input.action === 'state') return reply({ room: publicState(await recordResult(room)) });

    if (input.action === 'leave') {
      const { state, hostId } = leaveRoom(room.state, user.id, room.host_id, now);
      if (!state.players.length) {
        const { error } = await db.from('pool_rooms').delete().eq('id', room.id).eq('updated_at', room.updated_at);
        if (error) return reply({ error: 'La sala no se pudo cerrar.' }, 500);
        return reply({ left: true });
      }
      room = await saveRoom(room, state, hostId);
      await recordResult(room);
      return reply({ left: true });
    }

    let state = structuredClone(room.state);
    if (input.action === 'shoot') {
      if (state.status !== 'playing') throw new Error('La partida no está en curso.');
      const shot: any = { dx: Number(input.dx), dy: Number(input.dy), power: Number(input.power) };
      if (input.spin !== undefined && input.spin !== null && Number(input.spin) !== 0) shot.spin = Number(input.spin);
      if (input.side !== undefined && input.side !== null && Number(input.side) !== 0) shot.side = Number(input.side);
      if (input.call !== undefined && input.call !== null) shot.call = Number(input.call);
      if (input.cue && typeof input.cue === 'object') shot.cue = { x: Number(input.cue.x), y: Number(input.cue.y) };
      state.game = applyShot(state.game, user.id, shot);
      state.turn_started_at = now; // the shot clock restarts after every shot
      if (state.game.winner) state.status = 'finished';
    } else if (input.action === 'timeout') {
      if (!timeoutAllowed(state, user.id, now)) throw new Error('Tu rival todavía tiene tiempo para tirar.');
      state.game = applyTimeout(state.game, user.id);
      state.turn_started_at = now;
    } else if (input.action === 'claim') {
      if (!claimAllowed(state, user.id, now)) throw new Error('Tu rival todavía tiene tiempo para tirar.');
      finishByForfeit(state, user.id, 'Su rival no tiró durante cinco minutos.', now);
    } else if (input.action === 'rematch') {
      const breaker = requestRematch(state, user.id);
      if (breaker) { state.game = startGame(state, breaker); state.status = 'playing'; state.turn_started_at = now; state.recorded = false; state.rematch = []; }
    }
    room = await saveRoom(room, state);
    room = await recordResult(room);
    return reply({ room: publicState(room) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return reply({ error: safeErrors.test(message) ? message : 'No se pudo completar la jugada. Inténtalo de nuevo.' }, 400);
  }
});
