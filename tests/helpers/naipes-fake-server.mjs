// Loads supabase/functions/naipes/index.ts in Node with an in-memory fake of the Supabase client.
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, readdirSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function loadNaipesServer(people, { clock } = {}) {
  const fnDir = path.resolve('supabase/functions/naipes') + '/';
  const now = () => (clock ? clock() : Date.now());
  const tables = { card_rooms: [], profiles: [], card_stats: [], card_matches: [] };
  const tokens = {};
  for (const p of people) { tokens[p.token] = p.id; tables.profiles.push({ id: p.id, username: p.username, suspended: !!p.suspended }); }
  let rooms = 0, stamp = 0;
  function query(name) {
    const filters = []; let op = 'select', payload = null, wantOne = false, maybe = false;
    const q = {
      select() { return q; }, eq(c, v) { filters.push(r => r[c] === v); return q; }, gt(c, v) { filters.push(r => r[c] > v); return q; }, lt(c, v) { filters.push(r => r[c] < v); return q; },
      insert(v) { op = 'insert'; payload = v; return q; }, update(v) { op = 'update'; payload = v; return q; }, delete() { op = 'delete'; return q; },
      single() { wantOne = true; return q; }, maybeSingle() { wantOne = true; maybe = true; return q; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    function run() {
      const rows = tables[name]; const match = rows.filter(r => filters.every(f => f(r)));
      let out = match; const iso = new Date(now()).toISOString();
      if (op === 'insert') {
        if (rows.some(r => r.code === payload.code)) return { data: null, error: { message: 'dup' } };
        const row = { id: 'room-' + (rooms++), created_at: iso, updated_at: iso + '#' + (stamp++), expires_at: new Date(now() + 432e5).toISOString(), ...structuredClone(payload) };
        rows.push(row); out = [row];
      }
      if (op === 'update') { match.forEach(r => Object.assign(r, structuredClone(payload), { updated_at: payload.updated_at + '#' + (stamp++) })); out = match; }
      if (op === 'delete') { tables[name] = rows.filter(r => !match.includes(r)); out = match; }
      const data = structuredClone(out);
      if (wantOne) { if (!data.length) return maybe ? { data: null, error: null } : { data: null, error: { message: 'none' } }; return { data: data[0], error: null }; }
      return { data, error: null };
    }
    return q;
  }
  const fake = {
    from: query,
    auth: { getUser: async t => tokens[t] ? { data: { user: { id: tokens[t] } }, error: null } : { data: { user: null }, error: { message: 'bad' } } },
    rpc: async (fn, a) => {
      if (fn !== 'record_card_result') return { data: null, error: { code: 'nope' } };
      if (tables.card_matches.some(m => m.id === a.p_match)) return { data: false, error: null };
      tables.card_matches.push({ id: a.p_match, game: a.p_game, players: a.p_results.length });
      for (const r of a.p_results) {
        let s = tables.card_stats.find(x => x.user_id === r.user_id && x.game === a.p_game);
        if (!s) tables.card_stats.push(s = { user_id: r.user_id, game: a.p_game, games: 0, wins: 0, losses: 0 });
        s.games++; s.wins += r.won ? 1 : 0; s.losses += r.lost ? 1 : 0;
      }
      return { data: true, error: null };
    }
  };
  globalThis.__naipesFake = fake;
  let handler;
  globalThis.Deno = { env: { get: k => ({ SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'x' })[k] }, serve: h => { handler = h; } };
  // Copy the modules next to the stripped entry point so relative imports keep working.
  const dir = mkdtempSync(path.join(tmpdir(), 'naipes-'));
  for (const file of readdirSync(fnDir)) if (file.endsWith('.js')) copyFileSync(fnDir + file, path.join(dir, file));
  let src = stripTypeScriptTypes(readFileSync(fnDir + 'index.ts', 'utf8'), { mode: 'strip' });
  src = src.replace(/import \{ createClient \} from 'npm:@supabase\/supabase-js@[^']+';/, 'const createClient = () => globalThis.__naipesFake;');
  writeFileSync(path.join(dir, 'index.mjs'), src);
  await import(path.join(dir, 'index.mjs') + '?' + Date.now());
  return {
    tables,
    handle: (token, body) => handler(new Request('http://fake/functions/v1/naipes', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }))
  };
}
