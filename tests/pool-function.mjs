// Runs supabase/functions/pool/index.ts against a fake database: rooms, shots and spectators.
import assert from 'node:assert/strict';
import { loadCancionServer } from './helpers/cancion-fake-server.mjs';

const people = ['Kattomon', 'Ana', 'Mirón'].map((username, i) => ({ token: 't' + i, id: `0000000${i + 1}-0000-4000-8000-00000000000${i + 1}`, username }));
const [K, A, M] = people;
const server = await loadCancionServer(people, { fn: 'pool' });
const call = async (token, body) => { const res = await server.handle(token, body); return { status: res.status, body: await res.json() }; };

let r = await call(K.token, { action: 'create' });
assert.equal(r.status, 200, JSON.stringify(r.body));
const code = r.body.room.code;
r = await call(M.token, { action: 'state', code }); assert.equal(r.status, 403, 'state is for members');
r = await call(A.token, { action: 'join', code }); assert.equal(r.body.room.status, 'playing'); assert.equal(r.body.spectator, undefined);
// A third person joining a full table watches instead.
r = await call(M.token, { action: 'join', code });
assert.equal(r.status, 200); assert.equal(r.body.spectator, true); assert.equal(r.body.room.players.length, 2, 'spectators do not take a seat');
r = await call(M.token, { action: 'watch', code }); assert.equal(r.body.spectator, true); assert.ok(r.body.room.game);
r = await call(K.token, { action: 'watch', code }); assert.equal(r.body.spectator, false);
r = await call(M.token, { action: 'shoot', code, dx: 1, dy: 0, power: 1 }); assert.equal(r.status, 403, 'spectators cannot shoot');
r = await call(K.token, { action: 'shoot', code, dx: 1, dy: 0.004, power: 1 }); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.room.game.seq, 1);
r = await call(M.token, { action: 'watch', code }); assert.equal(r.body.room.game.seq, 1, 'spectators follow the game');
r = await call(M.token, { action: 'watch', code: 'ZZZZZZ' }); assert.match(r.body.error, /No encontramos/);
console.log('PASS pool function');
