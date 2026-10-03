// Runs supabase/functions/bachillerato/index.ts in Node against an in-memory fake of the Supabase client.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const fnDir = path.resolve('supabase/functions/bachillerato') + '/';
const L = await import('file://' + fnDir + 'logic.js');

// ---- fake database -------------------------------------------------------
const tables = { tutti_rooms: [], tutti_players: [], tutti_answers: [], tutti_votes: [], profiles: [], tutti_stats: [], tutti_games: [] };
const ids = n => `0000000${n}-0000-4000-8000-00000000000${n}`;
const users = {}; const names = ['Kattomon', 'Ana', 'Beto', 'Caro', 'Bloqueada'];
names.forEach((name, i) => { users['tok' + i] = ids(i + 1); tables.profiles.push({ id: ids(i + 1), username: name, suspended: name === 'Bloqueada' }); });
let clock = Date.parse('2026-10-03T15:00:00Z');
const keys = { tutti_players: ['room_id', 'user_id'], tutti_answers: ['game_id', 'round', 'user_id'], tutti_votes: ['game_id', 'round', 'voter_id'] };
function query(name) {
  const filters = []; let op = 'select', payload = null, wantOne = false, maybe = false, order = null;
  const q = {
    select() { return q; }, eq(c, v) { filters.push(r => r[c] === v); return q; }, gt(c, v) { filters.push(r => r[c] > v); return q; }, lt(c, v) { filters.push(r => r[c] < v); return q; },
    order(c) { order = c; return q; },
    insert(v) { op = 'insert'; payload = v; return q; }, upsert(v) { op = 'upsert'; payload = v; return q; }, update(v) { op = 'update'; payload = v; return q; }, delete() { op = 'delete'; return q; },
    single() { wantOne = true; return q; }, maybeSingle() { wantOne = true; maybe = true; return q; },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); }
  };
  function run() {
    const rows = tables[name]; const match = rows.filter(r => filters.every(f => f(r)));
    let out = match;
    const now = new Date(clock).toISOString();
    if (op === 'insert') {
      if (name === 'tutti_rooms' && rows.some(r => r.code === payload.code)) return { data: null, error: { message: 'dup' } };
      const row = { ...(name === 'tutti_rooms' ? { id: 'room-' + rows.length, created_at: now, updated_at: now, expires_at: new Date(clock + 432e5).toISOString() } : {}), ...(name === 'tutti_players' ? { joined_at: now, last_seen: now } : {}), ...structuredClone(payload) };
      rows.push(row); out = [row];
    }
    if (op === 'upsert') {
      out = [];
      for (const item of [].concat(payload)) {
        const k = keys[name], found = rows.find(r => k.every(c => r[c] === item[c]));
        if (found) Object.assign(found, structuredClone(item)); else rows.push({ ...(name === 'tutti_players' ? { joined_at: now, last_seen: now } : {}), ...structuredClone(item) });
        out.push(found || rows.at(-1));
      }
    }
    if (op === 'update') { match.forEach(r => Object.assign(r, structuredClone(payload))); out = match; }
    if (op === 'delete') {
      tables[name] = rows.filter(r => !match.includes(r)); out = match;
      if (name === 'tutti_rooms') for (const t of ['tutti_players', 'tutti_answers', 'tutti_votes']) tables[t] = tables[t].filter(r => !match.some(m => m.id === r.room_id));
    }
    let data = structuredClone(out);
    if (order) data.sort((a, b) => String(a[order]).localeCompare(String(b[order])));
    if (wantOne) { if (!data.length) return maybe ? { data: null, error: null } : { data: null, error: { message: 'none' } }; return { data: data[0], error: null }; }
    return { data, error: null };
  }
  return q;
}
const fakeClient = {
  from: query,
  auth: { getUser: async t => users[t] ? { data: { user: { id: users[t] } }, error: null } : { data: { user: null }, error: { message: 'bad' } } },
  rpc: async (fn, a) => {
    assert.equal(fn, 'record_tutti_result');
    if (tables.tutti_games.some(g => g.id === a.p_game)) return { data: false, error: null };
    tables.tutti_games.push({ id: a.p_game, players: a.p_results.length });
    for (const r of a.p_results) { let s = tables.tutti_stats.find(x => x.user_id === r.user_id); if (!s) tables.tutti_stats.push(s = { user_id: r.user_id, games: 0, wins: 0, points: 0 }); s.games++; s.wins += r.won ? 1 : 0; s.points += r.points; }
    return { data: true, error: null };
  }
};
globalThis.__fakeClient = fakeClient;
let handler; globalThis.Deno = { env: { get: k => ({ SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'x' })[k] }, serve: h => { handler = h; } };
const realNow = Date.now;
const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } };

let src = stripTypeScriptTypes(readFileSync(fnDir + 'index.ts', 'utf8'), { mode: 'strip' });
src = src.replace(/import \{ createClient \} from 'npm:@supabase\/supabase-js@[^']+';/, 'const createClient = () => globalThis.__fakeClient;')
  .replace("'./logic.js'", JSON.stringify('file://' + fnDir + 'logic.js'));
const tmp = path.join(mkdtempSync(path.join(tmpdir(), 'tutti-')), 'fn.mjs'); writeFileSync(tmp, src); await import(tmp + '?' + realNow());

async function call(token, body) {
  const res = await handler(new Request('http://fake/functions/v1/bachillerato', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json(), cors: res.headers.get('access-control-allow-origin') };
}
const [K, A, B, C, X] = ['tok0', 'tok1', 'tok2', 'tok3', 'tok4'];

// ---- scenarios ---------------------------------------------------------------
let r = await call('nope', { action: 'create' }); assert.equal(r.status, 401);
r = await call(X, { action: 'create' }); assert.match(r.body.error, /suspendida/);
r = await call(K, { action: 'nope' }); assert.equal(r.status, 400);
r = await call(K, { action: 'create', settings: { categories: ['Nombre', 'Animal', 'Color'], rounds: 3, roundSeconds: 60, bastaSeconds: 10 } });
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.cors, 'https://kattomon.github.io');
const code = r.body.room.code; let room = r.body.room;
assert.equal(room.status, 'lobby'); assert.deepEqual(room.settings.categories, ['Nombre', 'Animal', 'Color']); assert.equal(room.players.length, 1);
r = await call(A, { action: 'state', code }); assert.equal(r.status, 403);
r = await call(A, { action: 'start', code }); assert.equal(r.status, 403);
for (const t of [A, B, C]) { r = await call(t, { action: 'join', code: code.toLowerCase() }); assert.equal(r.status, 200, JSON.stringify(r.body)); }
r = await call(A, { action: 'join', code }); assert.equal(r.body.joined, false, 'joining twice keeps one seat');
assert.equal(r.body.room.players.length, 4);
r = await call(A, { action: 'start', code }); assert.match(r.body.error, /Solo quien creó/);
r = await call(A, { action: 'settings', code, settings: {} }); assert.match(r.body.error, /Solo quien creó/);
r = await call(K, { action: 'save', code, answers: ['x'] }); assert.match(r.body.error, /no está en juego/);
r = await call(K, { action: 'start', code }); room = r.body.room;
assert.equal(room.status, 'playing'); assert.equal(room.game.round, 1); assert.equal(room.game.totalRounds, 3);
const letter = room.game.letter; const L1 = letter;
const w = s => letter + s;
// Before the roulette stops answers are not taken; Basta needs everything with the letter.
r = await call(A, { action: 'save', code, answers: [w('na'), '', ''] }); assert.equal(r.body.saved, false);
clock = room.game.startsAt + 1000;
r = await call(A, { action: 'save', code, answers: [w('na'), w('nimal'), ''] }); assert.equal(r.body.saved, true);
assert.equal(r.body.room.players.find(p => p.username === 'Ana').filled, 2, 'progress is shared');
assert.equal(r.body.room.round, undefined, 'answers stay hidden during the round');
assert.deepEqual(r.body.room.mine.answers, [w('na'), w('nimal'), ''], 'own answers come back after a reload');
r = await call(B, { action: 'basta', code, answers: [w('eto'), '', w('olor')] }); assert.match(r.body.error, /completa todas/);
r = await call(K, { action: 'save', code, answers: [w('ndrea'), w('nimal'), w('zul')] });
r = await call(C, { action: 'save', code, answers: [w('ndrea'), 'Zzz', w('maranto')] });
r = await call(A, { action: 'basta', code, answers: [w('na'), w('nimal'), w('marillo')] }); assert.equal(r.status, 200, JSON.stringify(r.body));
room = r.body.room; assert.equal(room.game.bastaBy, users[A]); assert.equal(room.game.endsAt, clock + 10000);
// Late answers: within grace they count, after it they do not.
clock = room.game.endsAt + 2000;
r = await call(B, { action: 'save', code, answers: [w('eto'), '', w('olor')] }); assert.equal(r.body.saved, true);
r = await call(B, { action: 'advance', code, expect: 'playing:1' }); assert.equal(r.body.room.status, 'playing', 'no review before the grace ends');
clock = room.game.endsAt + L.GRACE_MS + 10;
r = await call(B, { action: 'save', code, answers: ['tarde', 'tarde', 'tarde'] }); assert.equal(r.body.saved, false);
r = await call(B, { action: 'advance', code, expect: 'playing:1' }); room = r.body.room;
assert.equal(room.status, 'review'); assert.equal(room.round.answers.length, 4, 'everyone sees all answers in review');
r = await call(C, { action: 'advance', code, expect: 'playing:1' }); assert.equal(r.body.room.status, 'review', 'a second advance with an old expectation is harmless');
// Votes: three others reject Caro's color; one vote alone is not enough.
const caro = users[C];
r = await call(K, { action: 'vote', code, rejects: [caro + ':2', users[K] + ':0', 'garbage', caro + ':9'] }); assert.equal(r.status, 200);
assert.deepEqual(tables.tutti_votes.find(v => v.voter_id === users[K]).rejects, [caro + ':2'], 'own answers, junk and bad categories are dropped');
assert.notEqual(r.body.room.round.answers.find(a => a.user_id === caro).status[2], 'rechazada');
r = await call(A, { action: 'vote', code, rejects: [caro + ':2'], ready: true });
assert.equal(r.body.room.round.answers.find(a => a.user_id === caro).status[2], 'rechazada', 'two of three other voters reject it');
assert.equal(r.body.room.status, 'review');
r = await call(A, { action: 'advance', code, expect: 'review:1' }); assert.equal(r.body.room.status, 'review', 'not everyone is ready');
// Everyone ready ends the vote and scores the round.
for (const t of [K, B]) r = await call(t, { action: 'vote', code, rejects: t === K ? [caro + ':2'] : [], ready: true });
r = await call(C, { action: 'vote', code, rejects: [], ready: true }); room = r.body.room;
assert.equal(room.status, 'scores', JSON.stringify(room.status));
const pts = Object.fromEntries(room.round.answers.map(a => [tables.profiles.find(p => p.id === a.user_id).username, a.points]));
// Nombre: Andrea x2 (5), Ana (10), Beto starts with letter? only if letter is B.
assert.deepEqual(pts.Kattomon.slice(0, 2), [5, 5]); assert.deepEqual(pts.Ana.slice(0, 2), [10, 5]);
assert.equal(pts.Caro[1], 0, 'wrong letter');
assert.equal(pts.Caro[2], 0, 'rejected by vote');
const totalOf = name => room.players.find(p => p.username === name).total;
assert.equal(totalOf('Ana'), pts.Ana.reduce((a, b) => a + b, 0));
r = await call(A, { action: 'vote', code, rejects: [] }); assert.match(r.body.error, /votación ya terminó/);
// Scores → next round (by time, or the host can skip).
r = await call(A, { action: 'advance', code, expect: 'scores:1' }); assert.equal(r.body.room.status, 'scores');
r = await call(K, { action: 'advance', code, expect: 'scores:1', force: true }); room = r.body.room;
assert.equal(room.status, 'playing'); assert.equal(room.game.round, 2); assert.notEqual(room.game.letter, L1, 'letters do not repeat');
// Rounds 2 and 3 with nobody answering, by time.
for (const round of [2, 3]) {
  clock = room.game.endsAt + L.GRACE_MS + 1; r = await call(B, { action: 'advance', code, expect: 'playing:' + round }); room = r.body.room; assert.equal(room.status, 'review');
  clock = room.game.reviewEndsAt + 1; r = await call(B, { action: 'advance', code, expect: 'review:' + round }); room = r.body.room;
  if (round === 2) { assert.equal(room.status, 'scores'); clock = room.game.nextAt + 1; r = await call(B, { action: 'advance', code, expect: 'scores:2' }); room = r.body.room; }
}
assert.equal(room.status, 'finished'); assert.ok(room.game.ranking.length >= 4);
assert.deepEqual(room.game.winners, [room.game.ranking[0].user_id].concat(room.game.ranking.filter((x, i) => i && x.total === room.game.ranking[0].total).map(x => x.user_id)));
assert.equal(tables.tutti_games.length, 1); assert.equal(tables.tutti_stats.length, 4, 'everyone who answered gets the game in their stats');
r = await call(A, { action: 'state', code }); assert.equal(tables.tutti_games.length, 1, 'recorded once');
// New game from the finished screen, kicking, leaving and host hand-over.
r = await call(K, { action: 'kick', code, user_id: users[B] }); assert.equal(r.body.room.players.length, 3);
r = await call(B, { action: 'state', code }); assert.equal(r.status, 403);
r = await call(K, { action: 'settings', code, settings: { categories: ['Fruta', 'País', 'Cosa', 'Marca'], rounds: 1 } }); assert.equal(r.body.room.status, 'lobby'); assert.equal(r.body.room.settings.categories.length, 4);
r = await call(K, { action: 'leave', code }); assert.equal(r.body.left, true);
r = await call(A, { action: 'state', code }); assert.equal(r.body.room.host_id, users[A], 'the oldest remaining player becomes host');
r = await call(A, { action: 'start', code }); assert.equal(r.body.room.status, 'playing');
r = await call(A, { action: 'leave', code }); r = await call(C, { action: 'leave', code }); assert.equal(tables.tutti_rooms.length, 0, 'the last one out closes the room');
// Many players: no limit, still fine.
r = await call(K, { action: 'create' }); const big = r.body.room.code;
for (let i = 0; i < 120; i++) { const tok = 'many' + i, id = `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`; users[tok] = id; tables.profiles.push({ id, username: 'J' + i, suspended: false }); await call(tok, { action: 'join', code: big }); }
r = await call(K, { action: 'state', code: big }); assert.equal(r.body.room.players.length, 121);
console.log('PASS bachillerato function');
