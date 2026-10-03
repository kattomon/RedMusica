// Runs supabase/functions/naipes/index.ts against a fake database: rooms, secret hands, turns, timeouts, stats.
import assert from 'node:assert/strict';
import { loadNaipesServer } from './helpers/naipes-fake-server.mjs';

let clock = Date.parse('2026-10-03T16:00:00Z');
const RealDate = Date;
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } };
const people = ['Kattomon', 'Ana', 'Beto', 'Caro', 'Bloqueada'].map((username, i) => ({ token: 't' + i, id: `0000000${i + 1}-0000-4000-8000-00000000000${i + 1}`, username, suspended: username === 'Bloqueada' }));
const server = await loadNaipesServer(people, { clock: () => clock });
const call = async (token, body) => { const res = await server.handle(token, body); return { status: res.status, body: await res.json() }; };
const [K, A, B, C, X] = people;
const idOf = p => p.id;

let r = await call('nope', { action: 'create', game: 'brisca' }); assert.equal(r.status, 401);
r = await call(X.token, { action: 'create', game: 'brisca' }); assert.match(r.body.error, /suspendida/);
r = await call(K.token, { action: 'create', game: 'ajedrez' }); assert.match(r.body.error, /Elige un juego/);
r = await call(K.token, { action: 'create', game: 'brisca', options: { target: 2 } });
assert.equal(r.status, 200); const code = r.body.room.code; assert.equal(r.body.room.options.target, 2);
r = await call(A.token, { action: 'state', code }); assert.equal(r.status, 403);
for (const p of [A, B, C]) { r = await call(p.token, { action: 'join', code }); assert.equal(r.status, 200, JSON.stringify(r.body)); }
assert.equal(r.body.room.players.length, 4);
r = await call(A.token, { action: 'start', code }); assert.match(r.body.error, /Solo quien creó/);
// Brisca with four: pairs, three cards each, nobody sees other hands.
r = await call(K.token, { action: 'start', code }); let room = r.body.room;
assert.equal(room.status, 'playing'); assert.equal(room.view.hand.length, 3); assert.deepEqual(room.view.teams, [[0, 2], [1, 3]]);
const raw = JSON.stringify(server.tables.card_rooms[0].state.match.hands);
for (const p of [K, A, B, C]) { const v = (await call(p.token, { action: 'state', code })).body.room.view; assert.equal(v.hand.length, 3); assert.ok(!JSON.stringify(v).includes('"hands"')); }
assert.ok(raw.length > 50);
r = await call(K.token, { action: 'join', code }); assert.equal(r.status, 200, 'members can re-join');
r = await call(X.token, { action: 'join', code }); assert.match(r.body.error, /suspendida/);
const outsider = { token: 'out', id: '00000009-0000-4000-8000-000000000009', username: 'Tarde' };
// Wrong turn, bad card.
const turnSeat = room.view.turn, turnPlayer = [K, A, B, C][turnSeat], other = [K, A, B, C][(turnSeat + 1) % 4];
r = await call(other.token, { action: 'play', code, move: { type: 'play', card: 1 } }); assert.match(r.body.error, /turno|no está en tu mano/);
r = await call(turnPlayer.token, { action: 'play', code, move: { type: 'play', card: 999 } }); assert.match(r.body.error, /no está en tu mano/);
// Timeout: nothing before a minute, an automatic move after.
r = await call(other.token, { action: 'timeout', code }); assert.equal(r.body.room.view.trick.length, 0);
clock += 61000;
r = await call(other.token, { action: 'timeout', code }); assert.equal(r.body.room.view.trick.length, 1, 'the late player gets an automatic card');
// Play the whole match with timeouts until someone wins two hands.
for (let i = 0; i < 400 && room.status !== 'finished'; i++) { clock += 61000; room = (await call(K.token, { action: 'timeout', code })).body.room; }
assert.equal(room.status, 'finished'); assert.equal(room.outcome.winners.length, 2);
assert.equal(server.tables.card_matches.length, 1); assert.equal(server.tables.card_stats.filter(s => s.game === 'brisca').length, 4);
r = await call(A.token, { action: 'state', code }); assert.equal(server.tables.card_matches.length, 1, 'recorded once');
// Switch game in the same room: ¡Última! with four, then Poto Sucio, then Carioca.
r = await call(A.token, { action: 'options', code, game: 'ultima' }); assert.match(r.body.error, /Solo quien creó/);
for (const game of ['ultima', 'potosucio', 'carioca']) {
  r = await call(K.token, { action: 'options', code, game, options: game === 'carioca' ? { rounds: 4 } : {} });
  assert.equal(r.body.room.game, game); assert.equal(r.body.room.status, 'lobby');
  room = (await call(K.token, { action: 'start', code })).body.room; assert.equal(room.status, 'playing', game);
  for (let i = 0; i < 6000 && room.status !== 'finished'; i++) { clock += 61000; room = (await call(K.token, { action: 'timeout', code })).body.room; }
  assert.equal(room.status, 'finished', game + ' finishes');
  assert.ok(server.tables.card_stats.some(s => s.game === game), game + ' stats');
}
assert.ok(server.tables.card_stats.some(s => s.game === 'potosucio' && s.losses === 1), 'the poto sucio gets a loss');
// Leaving in the middle cancels the game; host hands over; last one closes the room.
await call(K.token, { action: 'options', code, game: 'ultima' });
room = (await call(K.token, { action: 'start', code })).body.room; assert.equal(room.status, 'playing');
r = await call(outsider.token, { action: 'join', code }); assert.equal(r.status, 401);
r = await call(K.token, { action: 'kick', code, user_id: idOf(B) }); assert.match(r.body.error, /plena partida/);
r = await call(B.token, { action: 'leave', code }); assert.equal(r.body.left, true);
room = (await call(K.token, { action: 'state', code })).body.room; assert.equal(room.status, 'lobby'); assert.match(room.notice, /Beto salió/);
r = await call(K.token, { action: 'leave', code }); room = (await call(A.token, { action: 'state', code })).body.room; assert.equal(room.host_id, idOf(A));
// Limits per game.
await call(A.token, { action: 'options', code, game: 'brisca' }); r = await call(A.token, { action: 'start', code });
assert.equal(r.status, 200, 'brisca with two');
await call(A.token, { action: 'leave', code }); await call(C.token, { action: 'leave', code });
assert.equal(server.tables.card_rooms.length, 0);
r = await call(K.token, { action: 'create', game: 'potosucio' }); const solo = r.body.room.code;
r = await call(K.token, { action: 'start', code: solo }); assert.match(r.body.error, /se juega con/);
console.log('PASS naipes function');
