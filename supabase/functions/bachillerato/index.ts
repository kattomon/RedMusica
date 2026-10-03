// Bachillerato (tutti frutti) online. This function is the referee: it draws letters, keeps the
// clock, hides answers until the round ends, counts votes and scores. Browsers only send input.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import * as L from './logic.js';

const origin = 'https://kattomon.github.io';
const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(Deno.env.get('SUPABASE_URL')!, secret!, { auth: { persistSession: false, autoRefreshToken: false } });
const actions = ['create', 'join', 'state', 'settings', 'start', 'save', 'basta', 'vote', 'advance', 'kick', 'leave'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class Conflict extends Error {}
const fail = (message: string) => { throw new L.GameError(message); };

function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}
const random = (n: number) => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; };
const iso = (ms: number) => new Date(ms).toISOString();
const must = <T>(result: { data: T; error: unknown }, message: string): T => { if (result.error) { console.error(message, (result.error as { code?: string }).code); fail(message); } return result.data; };

async function getProfile(userId: string) {
  const { data, error } = await db.from('profiles').select('username,suspended').eq('id', userId).single();
  if (error || !data) fail('No se encontró tu perfil.');
  if (data!.suspended) fail('Tu cuenta está suspendida.');
  return data!;
}
async function findRoom(roomCode: string) {
  const data = must(await db.from('tutti_rooms').select('*').eq('code', roomCode).gt('expires_at', iso(Date.now())).maybeSingle(), 'La sala no se pudo abrir.');
  if (!data) fail('No encontramos esa sala. Comprueba el código.');
  return data as any;
}
async function saveRoom(room: any, state: any, hostId = room.host_id) {
  const { data, error } = await db.from('tutti_rooms').update({ state, host_id: hostId, updated_at: iso(Date.now()), expires_at: iso(Date.now() + 12 * 3600e3) }).eq('id', room.id).eq('updated_at', room.updated_at).select('*').maybeSingle();
  if (error) fail('La sala no se pudo actualizar.');
  if (!data) throw new Conflict('La sala cambió al mismo tiempo. Intenta de nuevo.');
  return data;
}
const loadPlayers = async (roomId: string) => must(await db.from('tutti_players').select('user_id,username,joined_at,last_seen').eq('room_id', roomId).order('joined_at', { ascending: true }), 'No se pudieron cargar los jugadores.') as any[];
const loadAnswers = async (gameId: string) => must(await db.from('tutti_answers').select('user_id,round,answers,points,status,score').eq('game_id', gameId), 'No se pudieron cargar las respuestas.') as any[];
const loadVotes = async (game: any) => must(await db.from('tutti_votes').select('voter_id,rejects,ready').eq('game_id', game.id).eq('round', game.round), 'No se pudieron cargar los votos.') as any[];
const isActive = (p: any, now: number) => now - Date.parse(p.last_seen) < L.ACTIVE_MS;

function totalsOf(rows: any[]) {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.user_id, (totals.get(row.user_id) || 0) + (row.score || 0));
  return totals;
}
function allReady(players: any[], votes: any[], now: number) {
  const active = players.filter(p => isActive(p, now));
  const ready = new Set(votes.filter(v => v.ready).map(v => v.voter_id));
  return active.length > 0 && active.every(p => ready.has(p.user_id));
}

// Scores the round in review, stores points and moves to the scores screen or the end of the game.
async function scoreRound(room: any, players: any[], now: number) {
  const state = room.state, game = state.game;
  const rows = (await loadAnswers(game.id)).filter(r => r.round === game.round), votes = await loadVotes(game);
  const answers = Object.fromEntries(rows.map(r => [r.user_id, r.answers]));
  const rejects = Object.fromEntries(votes.map(v => [v.voter_id, v.rejects]));
  const voters = players.filter(p => isActive(p, now)).map(p => p.user_id);
  const result = L.scoreRound({ categories: state.settings.categories, letter: game.letter, answers, rejects, voters });
  if (rows.length) {
    must(await db.from('tutti_answers').upsert(rows.map(r => ({
      game_id: game.id, round: game.round, user_id: r.user_id, room_id: room.id, answers: r.answers,
      points: result.points[r.user_id], status: result.status[r.user_id], score: result.totals[r.user_id], updated_at: iso(now)
    })), { onConflict: 'game_id,round,user_id' }), 'No se pudo guardar el puntaje.');
  }
  const totals = totalsOf(await loadAnswers(game.id));
  const known = new Map(players.map(p => [p.user_id, p.username]));
  for (const ranked of game.ranking || []) if (!known.has(ranked.user_id)) known.set(ranked.user_id, ranked.username);
  const ranking = L.rank([...new Set([...known.keys(), ...totals.keys()])].map(id => ({ user_id: id, username: known.get(id) || 'Jugador', total: totals.get(id) || 0 })));
  const summary = { round: game.round, letter: game.letter, bastaBy: game.bastaBy || null };
  const next = L.afterScoring(state, summary, now, ranking);
  next.game.ranking = ranking.slice(0, 500);
  return saveRoom(room, next);
}
// Adds the finished game to everyone's statistics once (only games with two or more players count).
async function recordResult(room: any) {
  const state = room.state, game = state.game;
  if (state.status !== 'finished' || !game || state.recorded) return room;
  const totals = totalsOf(await loadAnswers(game.id));
  if (totals.size >= 2) {
    const results = [...totals].map(([user_id, points]) => ({ user_id, points, won: (game.winners || []).includes(user_id) }));
    const { error } = await db.rpc('record_tutti_result', { p_game: game.id, p_room: room.code, p_results: results });
    if (error) { console.error('record_tutti_result failed', error.code); return room; }
  }
  try { return await saveRoom(room, { ...state, recorded: true }); } catch { return room; }
}

async function publicState(room: any, userId: string, now: number, players?: any[]) {
  players ||= await loadPlayers(room.id);
  const state = room.state, game = state.game;
  const rows = game ? await loadAnswers(game.id) : [];
  const totals = totalsOf(rows), current = game ? rows.filter(r => r.round === game.round) : [];
  const byUser = new Map(current.map(r => [r.user_id, r]));
  const showAnswers = ['review', 'scores', 'finished'].includes(state.status) && !!game;
  const votes = state.status === 'review' && game ? await loadVotes(game) : [];
  const ready = new Set(votes.filter(v => v.ready).map(v => v.voter_id));
  const out: any = {
    code: room.code, host_id: room.host_id, status: state.status, settings: state.settings, now, updated_at: room.updated_at,
    game: game ? { id: game.id, round: game.round, totalRounds: game.totalRounds, letter: game.letter, startsAt: game.startsAt, endsAt: game.endsAt, bastaBy: game.bastaBy, reviewEndsAt: game.reviewEndsAt, nextAt: game.nextAt, history: game.history, winners: game.winners, ranking: state.status === 'finished' ? game.ranking : undefined } : null,
    players: players.map(p => ({
      user_id: p.user_id, username: p.username, active: isActive(p, now), total: totals.get(p.user_id) || 0,
      filled: state.status === 'playing' ? (byUser.get(p.user_id)?.answers || []).filter((a: string) => a).length : undefined,
      ready: state.status === 'review' ? ready.has(p.user_id) : undefined
    })),
    mine: { answers: byUser.get(userId)?.answers || [] }
  };
  if (showAnswers) {
    let status: any = null, points: any = null, rejections: any = {};
    if (state.status === 'review') {
      // Provisional result with the votes so far, so everyone sees repeated and invalid answers while voting.
      const preview = L.scoreRound({ categories: state.settings.categories, letter: game.letter, answers: Object.fromEntries(current.map(r => [r.user_id, r.answers])), rejects: Object.fromEntries(votes.map(v => [v.voter_id, v.rejects])), voters: players.filter(p => isActive(p, now)).map(p => p.user_id) });
      status = preview.status; points = preview.points; rejections = preview.rejections;
    }
    out.round = {
      answers: current.map(r => ({ user_id: r.user_id, answers: r.answers, status: status ? status[r.user_id] : r.status, points: points ? points[r.user_id] : r.points, score: status ? undefined : r.score })),
      rejections, myRejects: votes.find(v => v.voter_id === userId)?.rejects || [], ready: ready.size, voters: players.filter(p => isActive(p, now)).length
    };
  }
  return out;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 20000) return reply({ error: 'Solicitud demasiado larga.' }, 413);
    const input = JSON.parse(raw);
    if (!actions.includes(input?.action)) return reply({ error: 'Acción no válida.' }, 400);
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer /i, '');
    const { data: { user }, error: authError } = await db.auth.getUser(token);
    if (authError || !user) return reply({ error: 'Inicia sesión para jugar al bachillerato.' }, 401);
    const profile = await getProfile(user.id);
    const now = Date.now();

    if (input.action === 'create') {
      await db.from('tutti_rooms').delete().lt('expires_at', iso(now));
      const state = { status: 'lobby', settings: L.sanitizeSettings(input.settings || {}), game: null };
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await db.from('tutti_rooms').insert({ code: code(), host_id: user.id, state }).select('*').single();
        if (error || !data) continue;
        must(await db.from('tutti_players').insert({ room_id: data.id, user_id: user.id, username: profile.username }), 'La sala no se pudo crear. Inténtalo otra vez.');
        return reply({ room: await publicState(data, user.id, now) });
      }
      return reply({ error: 'La sala no se pudo crear. Inténtalo otra vez.' }, 503);
    }

    const roomCode = typeof input.code === 'string' ? input.code.toUpperCase() : '';
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) return reply({ error: 'El código debe tener seis caracteres.' }, 400);
    let room = await findRoom(roomCode);
    let players = await loadPlayers(room.id);
    let me = players.find(p => p.user_id === user.id);

    if (input.action === 'join') {
      if (!me) {
        must(await db.from('tutti_players').upsert({ room_id: room.id, user_id: user.id, username: profile.username, last_seen: iso(now) }, { onConflict: 'room_id,user_id' }), 'No pudiste entrar a la sala. Inténtalo otra vez.');
        players = await loadPlayers(room.id);
      }
      return reply({ room: await publicState(room, user.id, now, players), joined: !me });
    }
    if (!me) return reply({ error: 'No formas parte de esta sala.' }, 403);
    if (now - Date.parse(me.last_seen) > 20000) {
      await db.from('tutti_players').update({ last_seen: iso(now) }).eq('room_id', room.id).eq('user_id', user.id);
      me.last_seen = iso(now);
    }
    const isHost = room.host_id === user.id;
    const state = room.state, game = state.game;
    let extra: Record<string, unknown> = {};

    if (input.action === 'state') {
      if (state.status === 'finished' && !state.recorded) room = await recordResult(room);
    } else if (input.action === 'leave') {
      must(await db.from('tutti_players').delete().eq('room_id', room.id).eq('user_id', user.id), 'No se pudo salir de la sala.');
      const rest = players.filter(p => p.user_id !== user.id);
      if (!rest.length) { await db.from('tutti_rooms').delete().eq('id', room.id); return reply({ left: true }); }
      if (isHost) for (let attempt = 0; attempt < 3; attempt++) {
        try { await saveRoom(room, room.state, rest[0].user_id); break; } catch (error) { if (!(error instanceof Conflict)) throw error; room = await findRoom(roomCode); }
      }
      return reply({ left: true });
    } else if (input.action === 'kick') {
      if (!isHost) fail('Solo quien creó la sala puede sacar jugadores.');
      if (typeof input.user_id !== 'string' || !UUID.test(input.user_id) || input.user_id === user.id) fail('Elige a otra persona.');
      await db.from('tutti_players').delete().eq('room_id', room.id).eq('user_id', input.user_id);
      players = players.filter(p => p.user_id !== input.user_id);
    } else if (input.action === 'settings') {
      if (!isHost) fail('Solo quien creó la sala puede cambiar las reglas.');
      if (!['lobby', 'finished'].includes(state.status)) fail('Las reglas se cambian entre partidas.');
      room = await saveRoom(room, { ...state, status: 'lobby', settings: L.sanitizeSettings(input.settings || {}) });
    } else if (input.action === 'start') {
      if (!isHost) fail('Solo quien creó la sala puede empezar.');
      if (!['lobby', 'finished'].includes(state.status)) fail('La partida ya empezó.');
      const settings = L.sanitizeSettings(input.settings || state.settings);
      room = await saveRoom(room, { status: 'playing', settings, game: L.newGame(crypto.randomUUID(), settings, now, random), recorded: false });
    } else if (input.action === 'save' || input.action === 'basta') {
      if (!game || state.status !== 'playing') fail('La ronda no está en juego.');
      const answers = L.cleanAnswers(input.answers, state.settings.categories.length);
      if (L.acceptsAnswers(state, now)) {
        must(await db.from('tutti_answers').upsert({ game_id: game.id, round: game.round, user_id: user.id, room_id: room.id, answers, updated_at: iso(now) }, { onConflict: 'game_id,round,user_id' }), 'No se pudieron guardar tus respuestas.');
        extra.saved = true;
      } else extra.saved = false;
      if (input.action === 'basta') {
        for (let attempt = 0; attempt < 3; attempt++) {
          const next = L.applyBasta(room.state, user.id, answers, now);
          if (next === room.state) break;
          try { room = await saveRoom(room, next); break; } catch (error) { if (!(error instanceof Conflict)) throw error; room = await findRoom(roomCode); }
        }
      }
    } else if (input.action === 'vote') {
      if (!game || state.status !== 'review') fail('La votación ya terminó.');
      const ids = new Set(players.map(p => p.user_id)), count = state.settings.categories.length;
      const rejects = [...new Set((Array.isArray(input.rejects) ? input.rejects : []).filter((key: unknown) => {
        if (typeof key !== 'string') return false;
        const [id, cat] = key.split(':');
        return UUID.test(id) && id !== user.id && ids.has(id) && /^\d{1,2}$/.test(cat) && Number(cat) < count;
      }))].slice(0, L.LIMITS.maxRejects);
      must(await db.from('tutti_votes').upsert({ game_id: game.id, round: game.round, voter_id: user.id, room_id: room.id, rejects, ready: input.ready === true, updated_at: iso(now) }, { onConflict: 'game_id,round,voter_id' }), 'No se pudo guardar tu voto.');
      if (input.ready === true && allReady(players, await loadVotes(game), now)) {
        try { room = await scoreRound(room, players, now); } catch (error) { if (!(error instanceof Conflict)) throw error; room = await findRoom(roomCode); }
      }
    } else if (input.action === 'advance') {
      // Any player may ask once their clock passes a deadline; the server checks the time itself.
      const expected = typeof input.expect === 'string' ? input.expect : '';
      if (game && expected === state.status + ':' + game.round) {
        const ready = state.status === 'review' ? allReady(players, await loadVotes(game), now) : false;
        const hostSkip = isHost && input.force === true;
        if (L.canAdvance(state, now, { isHost: hostSkip, allReady: ready })) {
          try {
            if (state.status === 'playing') room = await saveRoom(room, L.toReview(state, now));
            else if (state.status === 'review') room = await scoreRound(room, players, now);
            else if (state.status === 'scores') room = await saveRoom(room, L.nextRound(state, now, random));
          } catch (error) { if (!(error instanceof Conflict)) throw error; room = await findRoom(roomCode); }
        }
      }
      if (room.state.status === 'finished') room = await recordResult(room);
    }
    return reply({ room: await publicState(room, user.id, now, players), ...extra });
  } catch (error) {
    if (error instanceof L.GameError || error instanceof Conflict) return reply({ error: error.message }, 400);
    console.error('bachillerato', error instanceof Error ? error.message : 'error');
    return reply({ error: 'No se pudo completar la jugada. Inténtalo de nuevo.' }, 400);
  }
});
