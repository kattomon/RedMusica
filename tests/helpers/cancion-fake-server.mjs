// Loads supabase/functions/cancion/index.ts in Node with an in-memory fake of the Supabase client.
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, readdirSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function loadCancionServer(people, { friendships = [], clock, fn = 'cancion' } = {}) {
  const now = () => (clock ? clock() : Date.now());
  const fnDir = path.resolve('supabase/functions/' + fn) + '/';
  const tables = { profiles: [], song_days: [], song_plays: [], song_stats: [], song_rooms: [], song_room_matches: [], pool_rooms: [], pool_results: [], friendships: structuredClone(friendships) };
  const tokens = {};
  for (const p of people) { tokens[p.token] = p.id; tables.profiles.push({ id: p.id, username: p.username, suspended: !!p.suspended }); }
  let stamp = 0, rooms = 0;
  const keys = { song_days: ['day'], song_plays: ['user_id', 'day'] };
  function query(name) {
    const filters = []; let op = 'select', payload = null, opts = {}, wantOne = false, maybe = false, countOnly = false;
    const q = {
      select(_cols, o = {}) { if (o.head) countOnly = true; return q; },
      eq(c, v) { filters.push(r => r[c] === v); return q; }, gte(c, v) { filters.push(r => r[c] >= v); return q; }, gt(c, v) { filters.push(r => r[c] > v); return q; }, lt(c, v) { filters.push(r => r[c] < v); return q; },
      order() { return q; }, limit() { return q; }, insert(v) { op = 'insert'; payload = v; return q; }, delete() { op = 'delete'; return q; },
      in(c, v) { filters.push(r => v.includes(r[c])); return q; },
      or(expr) { const parts = expr.split(',').map(p => p.split('.eq.')); filters.push(r => parts.some(([c, v]) => r[c] === v)); return q; },
      upsert(v, o = {}) { op = 'upsert'; payload = v; opts = o; return q; }, update(v) { op = 'update'; payload = v; return q; },
      single() { wantOne = true; return q; }, maybeSingle() { wantOne = true; maybe = true; return q; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    function run() {
      const rows = tables[name];
      if (op === 'upsert') {
        const exists = rows.find(r => keys[name].every(k => r[k] === payload[k]));
        if (!exists) rows.push({ guesses: name === 'song_plays' ? Array.from({ length: 10 }, () => []) : undefined, score: 0, solved: 0, finished: false, recorded: false, updated_at: 't' + (stamp++), ...structuredClone(payload) });
        return { data: null, error: null };
      }
      if (op === 'insert') {
        if (rows.some(r => r.code === payload.code)) return { data: null, error: { message: 'dup' } };
        const iso = new Date(now()).toISOString();
        const row = { id: 'room-' + (rooms++), created_at: iso, updated_at: iso + '#' + (stamp++), expires_at: new Date(now() + 432e5).toISOString(), ...structuredClone(payload) };
        rows.push(row);
        return wantOne ? { data: structuredClone(row), error: null } : { data: [structuredClone(row)], error: null };
      }
      const match = rows.filter(r => filters.every(f => f(r)));
      if (op === 'delete') { tables[name] = rows.filter(r => !match.includes(r)); return { data: null, error: null }; }
      if (op === 'update') match.forEach(r => Object.assign(r, structuredClone(payload), { updated_at: 't' + (stamp++) }));
      if (countOnly) return { data: null, count: match.length, error: null };
      const data = structuredClone(match);
      if (wantOne) { if (!data.length) return maybe ? { data: null, error: null } : { data: null, error: { message: 'none' } }; return { data: data[0], error: null }; }
      return { data, error: null };
    }
    return q;
  }
  const fake = {
    from: query,
    auth: { getUser: async t => tokens[t] ? { data: { user: { id: tokens[t] } }, error: null } : { data: { user: null }, error: { message: 'bad' } } },
    rpc: async (fn, a) => {
      const statsOf = id => { let s = tables.song_stats.find(x => x.user_id === id); if (!s) tables.song_stats.push(s = { user_id: id, days: 0, points: 0, best: 0, solved: 0, streak: 0, best_streak: 0, last_day: null, dist: [0, 0, 0, 0, 0, 0, 0], live_games: 0, live_wins: 0 }); return s; };
      if (fn === 'record_pool_result') { if (!tables.pool_results.some(r => r.id === a.p_match)) tables.pool_results.push({ id: a.p_match, winner: a.p_winner, loser: a.p_loser }); return { data: true, error: null }; }
      if (fn === 'record_song_room') {
        if (tables.song_room_matches.some(m => m.id === a.p_match)) return { data: false, error: null };
        tables.song_room_matches.push({ id: a.p_match, room_code: a.p_room, players: a.p_players.length });
        for (const id of a.p_players) { const s = statsOf(id); s.live_games++; if (a.p_winners.includes(id)) s.live_wins++; }
        return { data: true, error: null };
      }
      if (fn !== 'record_song_day' || !Array.isArray(a.p_dist) || a.p_dist.length !== 7) return { data: null, error: { code: 'nope' } };
      const play = tables.song_plays.find(p => p.user_id === a.p_user && p.day === a.p_day && p.finished && !p.recorded);
      if (!play) return { data: false, error: null };
      play.recorded = true;
      const s = statsOf(a.p_user);
      s.days++; s.points += play.score; s.best = Math.max(s.best, play.score); s.solved += play.solved; s.streak += 1; s.best_streak = Math.max(s.best_streak, s.streak); s.last_day = a.p_day;
      s.dist = s.dist.map((n, i) => n + a.p_dist[i]);
      return { data: true, error: null };
    }
  };
  globalThis.__cancionFake = fake;
  let handler;
  globalThis.Deno = { env: { get: k => ({ SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'x' })[k] }, serve: h => { handler = h; } };
  const dir = mkdtempSync(path.join(tmpdir(), 'cancion-'));
  for (const file of readdirSync(fnDir)) if (file.endsWith('.js')) copyFileSync(fnDir + file, path.join(dir, file));
  let src = stripTypeScriptTypes(readFileSync(fnDir + 'index.ts', 'utf8'), { mode: 'strip' });
  src = src.replace(/import \{ createClient \} from 'npm:@supabase\/supabase-js@[^']+';/, 'const createClient = () => globalThis.__cancionFake;');
  writeFileSync(path.join(dir, 'index.mjs'), src);
  await import(path.join(dir, 'index.mjs') + '?' + Date.now());
  return {
    tables,
    handle: (token, body) => handler(new Request('http://fake/functions/v1/' + fn, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }))
  };
}
