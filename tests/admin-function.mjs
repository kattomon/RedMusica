// Runs supabase/functions/admin/index.ts (the owner's password-reset link) against a fake database.
import assert from 'node:assert/strict';
import { loadCancionServer } from './helpers/cancion-fake-server.mjs';

const people = [['Kattomon', 'owner'], ['Ana', 'admin'], ['Luis', 'member'], ['Susp', 'owner', true]].map(([username, role, suspended], i) => ({ token: 't' + i, id: `0000000${i + 1}-0000-4000-8000-00000000000${i + 1}`, username, role, suspended: !!suspended }));
const [K, A, L, S] = people;
const server = await loadCancionServer(people, { fn: 'admin' });
const call = async (token, body) => { const res = await server.handle(token, body); return { status: res.status, body: await res.json() }; };

let r = await call('nope', { action: 'recovery_link', data: { id: L.id } }); assert.equal(r.status, 401);
r = await call(A.token, { action: 'recovery_link', data: { id: L.id } }); assert.equal(r.status, 403, 'admins cannot make reset links'); assert.match(r.body.error, /owner/);
r = await call(S.token, { action: 'recovery_link', data: { id: L.id } }); assert.equal(r.status, 403, 'a suspended owner cannot');
r = await call(K.token, { action: 'recovery_link', data: { id: 'no-es-uuid' } }); assert.equal(r.status, 400);
r = await call(K.token, { action: 'recovery_link', data: { id: '00000009-0000-4000-8000-000000000009' } }); assert.equal(r.status, 404);
r = await call(K.token, { action: 'recovery_link', data: { id: L.id } });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.link, 'https://kattomon.github.io/RedMusica/#recuperar=hashed-luis', 'the token goes after # on the site');
assert.deepEqual(server.tables.generated_links, [{ type: 'recovery', email: 'luis@example.test' }]);
assert.deepEqual(server.tables.admin_audit.map(x => [x.action, x.target]), [['recovery_link', L.id]], 'the owner action is logged');
assert.ok(!JSON.stringify(r.body).includes('@'), 'the e-mail is not sent back');
console.log('PASS admin function');
