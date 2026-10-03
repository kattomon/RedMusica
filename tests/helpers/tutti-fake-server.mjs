// Loads supabase/functions/bachillerato/index.ts in Node with an in-memory fake of the Supabase client,
// so browser tests talk to the real referee code.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function loadTuttiServer(people) {
  const fnDir = path.resolve('supabase/functions/bachillerato') + '/';
  const tables = { tutti_rooms: [], tutti_players: [], tutti_answers: [], tutti_votes: [], profiles: [], tutti_stats: [], tutti_games: [] };
  const tokens = {};
  for (const p of people) { tokens[p.token] = p.id; tables.profiles.push({ id: p.id, username: p.username, suspended: false }); }
  const keys = { tutti_players: ['room_id', 'user_id'], tutti_answers: ['game_id', 'round', 'user_id'], tutti_votes: ['game_id', 'round', 'voter_id'] };
  let roomCount = 0;
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
      let out = match; const now = new Date().toISOString();
      if (op === 'insert') {
        if (name === 'tutti_rooms' && rows.some(r => r.code === payload.code)) return { data: null, error: { message: 'dup' } };
        const row = { ...(name === 'tutti_rooms' ? { id: 'room-' + (roomCount++), created_at: now, updated_at: now + '#' + Math.random(), expires_at: new Date(Date.now() + 432e5).toISOString() } : {}), ...(name === 'tutti_players' ? { joined_at: now, last_seen: now } : {}), ...structuredClone(payload) };
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
      if (op === 'update') { match.forEach(r => Object.assign(r, structuredClone(payload), name === 'tutti_rooms' ? { updated_at: payload.updated_at + '#' + Math.random() } : {})); out = match; }
      if (op === 'delete') {
        tables[name] = rows.filter(r => !match.includes(r)); out = match;
        if (name === 'tutti_rooms') for (const t of ['tutti_players', 'tutti_answers', 'tutti_votes']) tables[t] = tables[t].filter(r => !match.some(m => m.id === r.room_id));
      }
      const data = structuredClone(out);
      if (order) data.sort((a, b) => String(a[order]).localeCompare(String(b[order])));
      if (wantOne) { if (!data.length) return maybe ? { data: null, error: null } : { data: null, error: { message: 'none' } }; return { data: data[0], error: null }; }
      return { data, error: null };
    }
    return q;
  }
  const fake = {
    from: query,
    auth: { getUser: async t => tokens[t] ? { data: { user: { id: tokens[t] } }, error: null } : { data: { user: null }, error: { message: 'bad' } } },
    rpc: async (fn, a) => {
      if (fn !== 'record_tutti_result') return { data: null, error: { code: 'nope' } };
      if (tables.tutti_games.some(g => g.id === a.p_game)) return { data: false, error: null };
      tables.tutti_games.push({ id: a.p_game, players: a.p_results.length });
      for (const r of a.p_results) { let s = tables.tutti_stats.find(x => x.user_id === r.user_id); if (!s) tables.tutti_stats.push(s = { user_id: r.user_id, games: 0, wins: 0, points: 0 }); s.games++; s.wins += r.won ? 1 : 0; s.points += r.points; }
      return { data: true, error: null };
    }
  };
  globalThis.__tuttiFake = fake;
  let handler;
  globalThis.Deno = { env: { get: k => ({ SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'x' })[k] }, serve: h => { handler = h; } };
  let src = stripTypeScriptTypes(readFileSync(fnDir + 'index.ts', 'utf8'), { mode: 'strip' });
  src = src.replace(/import \{ createClient \} from 'npm:@supabase\/supabase-js@[^']+';/, 'const createClient = () => globalThis.__tuttiFake;')
    .replace("'./logic.js'", JSON.stringify('file://' + fnDir + 'logic.js'));
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'tutti-')), 'fn.mjs'); writeFileSync(file, src);
  await import(file + '?' + Date.now());
  return { tables, handle: (token, body) => handler(new Request('http://fake/functions/v1/bachillerato', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body })) };
}
