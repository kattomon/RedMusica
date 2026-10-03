// Runs supabase/functions/cancion/index.ts against a fake database: daily songs, secret answers, steps,
// skips, stats, friends, archive and live rooms.
import assert from 'node:assert/strict';
import { loadCancionServer } from './helpers/cancion-fake-server.mjs';
import * as L from '../supabase/functions/cancion/logic.js';

let clock = Date.parse('2026-10-03T16:00:00Z');
const RealDate = Date;
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } };
const people = ['Kattomon', 'Ana', 'Beto', 'Extraño', 'Bloqueada'].map((username, i) => ({ token: 't' + i, id: `0000000${i + 1}-0000-4000-8000-00000000000${i + 1}`, username, suspended: username === 'Bloqueada' }));
const [K, A, B, X, S] = people;
const server = await loadCancionServer(people, { clock: () => clock, friendships: [
  { user_a: K.id, user_b: A.id, status: 'accepted' }, { user_a: B.id, user_b: K.id, status: 'accepted' }, { user_a: K.id, user_b: X.id, status: 'pending' }
] });
const call = async (token, body) => { const res = await server.handle(token, body); return { status: res.status, body: await res.json() }; };

let r = await call('nope', { action: 'today' }); assert.equal(r.status, 401);
r = await call(S.token, { action: 'today' }); assert.match(r.body.error, /suspendida/);
r = await call(K.token, { action: 'hack' }); assert.equal(r.status, 400);
r = await call(K.token, { action: 'today' });
assert.equal(r.status, 200, JSON.stringify(r.body));
let game = r.body.game;
const day = game.day, answers = server.tables.song_days[0].songs;
assert.equal(server.tables.song_days.length, 1); assert.equal(answers.length, 10); assert.equal(game.archive, false);
assert.equal(game.slots.length, 10); assert.equal(game.current, 0); assert.equal(game.score, 0);
for (const id of answers) { const s = L.songById(id); assert.ok(!JSON.stringify(game).includes(JSON.stringify(s.title)), 'answers are not sent'); }
assert.ok(game.slots.every(slot => slot.answer === null && slot.layer === 1 && slot.clues.year));
r = await call(A.token, { action: 'today' }); assert.equal(server.tables.song_days.length, 1, 'same songs for everyone');

// Skip opens a layer; a wrong guess gives colours; the right one scores by step.
r = await call(K.token, { action: 'guess', slot: 0, song: L.SKIP, day });
game = r.body.game; assert.equal(game.slots[0].layer, 2); assert.ok(game.slots[0].clues.genre); assert.equal(game.slots[0].history[0].type, 'skip');
const wrong = L.SONGS.find(s => !answers.includes(s.id)).id;
r = await call(K.token, { action: 'guess', slot: 0, song: wrong, day });
game = r.body.game; assert.equal(game.slots[0].tries.length, 1); assert.equal(game.slots[0].left, 4); assert.equal(game.slots[0].layer, 3);
r = await call(K.token, { action: 'guess', slot: 0, song: wrong, day }); assert.match(r.body.error, /Ya probaste/);
r = await call(K.token, { action: 'guess', slot: 0, song: 123456, day }); assert.match(r.body.error, /Elige una canción/);
r = await call(K.token, { action: 'guess', slot: 12, song: wrong, day }); assert.match(r.body.error, /no válida/);
r = await call(K.token, { action: 'guess', slot: 0, song: answers[0], day });
game = r.body.game; assert.equal(game.slots[0].state, 'won'); assert.equal(game.slots[0].points, 4); assert.equal(game.slots[0].answer, answers[0]); assert.equal(game.current, 1);
r = await call(K.token, { action: 'guess', slot: 0, song: answers[1], day }); assert.match(r.body.error, /ya terminó/);
// Give up on one, skip six times on another, the rest at the first step.
r = await call(K.token, { action: 'guess', slot: 1, song: 0, day }); assert.equal(r.body.game.slots[1].state, 'lost'); assert.equal(r.body.game.slots[1].answer, answers[1]);
for (let i = 0; i < 6; i++) r = await call(K.token, { action: 'guess', slot: 2, song: L.SKIP, day });
assert.equal(r.body.game.slots[2].state, 'lost'); assert.equal(r.body.game.slots[2].left, 0);
for (let slot = 3; slot < 10; slot++) r = await call(K.token, { action: 'guess', slot, song: answers[slot], day });
game = r.body.game;
assert.equal(game.finished, true); assert.equal(game.score, 4 + 7 * 6); assert.equal(game.solved, 8);
assert.deepEqual(game.dist, [7, 0, 1, 0, 0, 0, 2]);
assert.ok(game.stats && game.stats.days === 1 && game.stats.points === 46); assert.deepEqual(game.stats.dist, [7, 0, 1, 0, 0, 0, 2]);
r = await call(K.token, { action: 'today' }); assert.equal(server.tables.song_stats.find(s => s.user_id === K.id).days, 1, 'recorded once');

// Friends' table.
await call(B.token, { action: 'today' });
await call(X.token, { action: 'today' }); await call(X.token, { action: 'guess', slot: 0, song: answers[0], day });
await call(A.token, { action: 'guess', slot: 0, song: answers[0], day });
r = await call(K.token, { action: 'board' });
assert.deepEqual(r.body.rows.map(x => x.username), ['Kattomon', 'Ana'], 'me and Ana; Beto has not played, Extraño is not a friend');
assert.equal(r.body.players, 4); assert.ok(!JSON.stringify(r.body).includes('"slots"'));

// Next day: yesterday goes to the archive, can be played but does not count.
clock += 86400e3;
r = await call(A.token, { action: 'archive' });
assert.equal(r.body.days.length, 1); assert.equal(r.body.days[0].day, day); assert.equal(r.body.days[0].finished, false);
r = await call(A.token, { action: 'today', day });
assert.equal(r.body.game.archive, true); assert.equal(r.body.game.day, day);
for (let slot = 1; slot < 10; slot++) r = await call(A.token, { action: 'guess', slot, song: answers[slot], day });
assert.equal(r.body.game.finished, true);
assert.ok(!server.tables.song_stats.some(s => s.user_id === A.id && s.days > 0), 'archive does not add to the streak');
r = await call(A.token, { action: 'today', day: '2020-01-01' }); assert.match(r.body.error, /no existe/);
r = await call(A.token, { action: 'today', day: '2999-01-01' }); assert.notEqual(r.body.game.day, '2999-01-01', 'future days fall back to today');

// Live room: create, join, start, guess, rounds by time, results.
r = await call(K.token, { action: 'room_create', options: { pack: 'cl', rounds: 5, seconds: 30 } });
assert.equal(r.status, 200, JSON.stringify(r.body));
const code = r.body.room.code; assert.equal(r.body.room.status, 'lobby'); assert.deepEqual(r.body.room.options, { pack: 'cl', rounds: 5, seconds: 30 });
r = await call(A.token, { action: 'room_state', code }); assert.equal(r.status, 403);
r = await call(A.token, { action: 'room_join', code }); assert.equal(r.body.room.players.length, 2);
r = await call(B.token, { action: 'room_join', code: code.toLowerCase() }); assert.equal(r.body.room.players.length, 3);
r = await call(A.token, { action: 'room_start', code }); assert.match(r.body.error, /Solo quien creó/);
r = await call(K.token, { action: 'room_start', code }); assert.equal(r.body.room.status, 'countdown');
const room = () => server.tables.song_rooms[0].state;
assert.equal(room().songs.length, 5); assert.ok(room().songs.every(id => L.songById(id).country === 'CL'));
clock += L.LIVE.countdownMs;
r = await call(A.token, { action: 'room_state', code }); assert.equal(r.body.room.status, 'playing'); assert.equal(r.body.room.layer, 1);
assert.ok(!JSON.stringify(r.body).includes(JSON.stringify(L.songById(room().songs[0]).title)), 'answer hidden in rooms');
clock += 6000;
r = await call(A.token, { action: 'room_guess', code, song: room().songs[0] }); assert.equal(r.body.room.players.find(p => p.user_id === A.id).solved.layer, 2);
r = await call(B.token, { action: 'room_guess', code, song: wrong }); assert.equal(r.body.room.mine.length, 1);
r = await call(K.token, { action: 'room_state', code }); assert.equal(r.body.room.mine.length, 0); assert.equal(r.body.room.players.find(p => p.user_id === B.id).tries, 1);
for (let round = 0; round < 5; round++) { clock += 30000; await call(K.token, { action: 'room_advance', code }); clock += L.LIVE.revealMs; await call(K.token, { action: 'room_advance', code }); }
r = await call(B.token, { action: 'room_state', code });
assert.equal(r.body.room.status, 'finished'); assert.equal(r.body.room.history.length, 5);
assert.equal(server.tables.song_room_matches.length, 1);
assert.equal(server.tables.song_stats.find(s => s.user_id === A.id).live_wins, 1, 'Ana won the live game');
r = await call(B.token, { action: 'room_state', code }); assert.equal(server.tables.song_room_matches.length, 1, 'recorded once');
// Options between games; host hands over; last one out closes the room.
r = await call(K.token, { action: 'room_options', code, options: { pack: 'd80', rounds: 10, seconds: 60 } }); assert.equal(r.body.room.status, 'lobby');
r = await call(K.token, { action: 'room_kick', code, user_id: B.id }); assert.equal(r.body.room.players.length, 2);
r = await call(K.token, { action: 'room_leave', code }); r = await call(A.token, { action: 'room_state', code }); assert.equal(r.body.room.host_id, A.id);
await call(A.token, { action: 'room_leave', code }); assert.equal(server.tables.song_rooms.length, 0);
r = await call(A.token, { action: 'room_state', code }); assert.match(r.body.error, /No encontramos/);
console.log('PASS cancion function');
