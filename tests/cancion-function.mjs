// Runs supabase/functions/cancion/index.ts against a fake database: daily songs, secret answers, tries, stats, friends.
import assert from 'node:assert/strict';
import { loadCancionServer } from './helpers/cancion-fake-server.mjs';
import * as L from '../supabase/functions/cancion/logic.js';

const people = ['Kattomon', 'Ana', 'Beto', 'Extraño', 'Bloqueada'].map((username, i) => ({ token: 't' + i, id: `0000000${i + 1}-0000-4000-8000-00000000000${i + 1}`, username, suspended: username === 'Bloqueada' }));
const [K, A, B, X, S] = people;
const server = await loadCancionServer(people, { friendships: [
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
assert.equal(server.tables.song_days.length, 1); assert.equal(answers.length, 10);
assert.equal(game.slots.length, 10); assert.equal(game.current, 0); assert.equal(game.score, 0);
for (const id of answers) { const s = L.songById(id); assert.ok(!JSON.stringify(game).includes(JSON.stringify(s.title)), 'answers are not sent'); }
assert.ok(game.slots.every(slot => slot.answer === null));
// Everyone gets the same songs.
r = await call(A.token, { action: 'today' }); assert.equal(server.tables.song_days.length, 1);
assert.equal(server.tables.song_plays.length, 2);

// Wrong tries give clues; the right one scores; repeated or invalid tries are refused.
const wrong = L.SONGS.find(s => !answers.includes(s.id)).id;
r = await call(K.token, { action: 'guess', slot: 0, song: wrong, day });
game = r.body.game; assert.equal(game.slots[0].tries.length, 1); assert.equal(game.slots[0].left, 5); assert.ok(game.slots[0].tries[0].clues.year.state);
r = await call(K.token, { action: 'guess', slot: 0, song: wrong, day }); assert.match(r.body.error, /Ya probaste/);
r = await call(K.token, { action: 'guess', slot: 0, song: 123456, day }); assert.match(r.body.error, /Elige una canción/);
r = await call(K.token, { action: 'guess', slot: 12, song: wrong, day }); assert.match(r.body.error, /no válida/);
r = await call(K.token, { action: 'guess', slot: 0, song: wrong, day: '1999-01-01' }); assert.match(r.body.error, /otro día/);
r = await call(K.token, { action: 'guess', slot: 0, song: answers[0], day });
game = r.body.game; assert.equal(game.slots[0].state, 'won'); assert.equal(game.slots[0].points, 5); assert.equal(game.slots[0].answer, answers[0]); assert.equal(game.current, 1);
r = await call(K.token, { action: 'guess', slot: 0, song: answers[1], day }); assert.match(r.body.error, /ya terminó/);
// Give up on one, lose another after six tries, win the rest at the first try.
r = await call(K.token, { action: 'guess', slot: 1, song: 0, day }); assert.equal(r.body.game.slots[1].state, 'lost'); assert.equal(r.body.game.slots[1].answer, answers[1]);
const others = L.SONGS.filter(s => !answers.includes(s.id)).slice(1, 7).map(s => s.id);
for (const id of others) r = await call(K.token, { action: 'guess', slot: 2, song: id, day });
assert.equal(r.body.game.slots[2].state, 'lost'); assert.equal(r.body.game.slots[2].left, 0);
for (let slot = 3; slot < 10; slot++) r = await call(K.token, { action: 'guess', slot, song: answers[slot], day });
game = r.body.game;
assert.equal(game.finished, true); assert.equal(game.score, 5 + 7 * 6); assert.equal(game.solved, 8);
assert.equal(game.line.length > 0, true); assert.ok(game.stats && game.stats.days === 1 && game.stats.points === 47);
assert.equal(server.tables.song_stats.length, 1);
r = await call(K.token, { action: 'today' }); assert.equal(server.tables.song_stats[0].days, 1, 'recorded once');

// Friends' table: accepted friends who started, never pending ones; no answers inside.
await call(B.token, { action: 'today' });
await call(X.token, { action: 'today' }); await call(X.token, { action: 'guess', slot: 0, song: answers[0], day });
r = await call(A.token, { action: 'guess', slot: 0, song: answers[0], day });
r = await call(K.token, { action: 'board' });
assert.equal(r.status, 200);
assert.deepEqual(r.body.rows.map(x => x.username), ['Kattomon', 'Ana'], 'me and Ana; Beto has not played, Extraño is not a friend');
assert.equal(r.body.players, 4); assert.ok(!JSON.stringify(r.body).includes('"slots"'));
console.log('PASS cancion function');
