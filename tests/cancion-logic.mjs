// Rules of "Adivina la canción": catalog, clues, title boxes, scoring, daily pick and search.
import assert from 'node:assert/strict';
import * as L from '../supabase/functions/cancion/logic.js';

const find = (title, artist) => L.SONGS.find(s => s.title === title && (!artist || s.artists[0] === artist));
// Catalog sanity.
assert.ok(L.SONGS.length >= 800, 'big catalog');
assert.equal(new Set(L.SONGS.map(s => s.id)).size, L.SONGS.length, 'unique ids');
for (const s of L.SONGS) {
  assert.ok(L.GENRES[s.genre] && L.LANGS[s.lang] && L.COUNTRIES[s.country] && L.KINDS[s.kind], 'labels for ' + s.title);
  assert.ok(s.year >= 1930 && s.year <= 2026, 'year of ' + s.title);
  assert.ok(L.flag(s.country).length === 4, 'flag for ' + s.country);
}
const tier1 = L.SONGS.filter(s => s.tier === 1);
assert.ok(tier1.filter(s => s.lang === 'es').length >= 60 && tier1.filter(s => s.lang !== 'es').length >= 150, 'enough well-known songs');

// Clues.
const bohemian = find('Bohemian Rhapsody'), champions = find('We Are the Champions'), pressure = find('Under Pressure');
const despacito = find('Despacito'), gasolina = find('Gasolina'), tren = find('Tren al sur'), baile = find('El baile de los que sobran');
let c = L.compare(champions, bohemian);
assert.deepEqual([c.artist, c.year.state, c.year.dir, c.country, c.genre, c.lang, c.kind], ['hit', 'near', 'down', 'hit', 'hit', 'hit', 'hit']);
c = L.compare(pressure, bohemian);
assert.equal(c.artist, 'near', 'shares Queen'); assert.equal(c.kind, 'miss', 'collaboration vs band');
c = L.compare(gasolina, despacito);
assert.deepEqual([c.artist, c.year.dir, c.country, c.genre], ['near', 'up', 'hit', 'hit']);
c = L.compare(tren, despacito);
assert.deepEqual([c.artist, c.country, c.genre, c.lang], ['miss', 'near', 'miss', 'hit'], 'Chile and Puerto Rico are both Latin America');
c = L.compare(find('Shape of You'), find('Bad Romance'));
assert.equal(c.kind, 'near', 'two soloists'); assert.equal(c.genre, 'hit'); assert.equal(c.country, 'miss');
assert.equal(L.compare(baile, baile).song, true);

// Title boxes never leak hidden letters; positional matches, initials and vowels.
const flat = mask => mask.flat();
let m = L.maskTitle(baile, []);
assert.equal(m.length, 6, 'six words'); assert.ok(flat(m).every(b => b.hidden && !('ch' in b)), 'all hidden at start');
m = L.maskTitle(baile, [find('El Rey', 'José Alfredo Jiménez')]);
assert.equal(m[0].map(b => b.ch || '_').join(''), 'El', 'same word in the same place lights up');
assert.ok(m[1].every(b => b.hidden), 'Rey has nothing in common with baile at the same positions');
m = L.maskTitle(baile, [], { initials: true });
assert.ok(m.every(word => !word[0].hidden) && m[1].slice(1).every(b => b.hidden), 'initials');
m = L.maskTitle(baile, [], { vowels: true });
assert.equal(m[1].map(b => b.ch || '_').join(''), '_ai_e', 'vowels');
m = L.maskTitle(find('Sweet Child o\' Mine'), []);
assert.ok(flat(m).some(b => b.ch === "'" && !b.letter), 'punctuation is shown');
m = L.maskTitle(find('Corazón partío'), [find('Corazón', 'Maluma')]);
assert.equal(m[0].map(b => b.ch).join(''), 'Corazón', 'accents ignored when matching, shown in the answer');

// Steps: skip or guess; every step opens a layer; points 6..1.
const id = bohemian.id;
assert.equal(L.slotState(id, []), 'playing'); assert.equal(L.layerOf(id, []), 1);
assert.equal(L.slotPoints(id, [id]), 6); assert.equal(L.slotPoints(id, [L.SKIP, 3, id]), 4);
assert.equal(L.solvedAt(id, [L.SKIP, id]), 2); assert.equal(L.solvedAt(id, [L.GIVE_UP]), 7);
assert.equal(L.slotState(id, [L.SKIP, L.SKIP, L.SKIP, L.SKIP, L.SKIP, L.SKIP]), 'lost');
assert.equal(L.slotState(id, [2, L.GIVE_UP]), 'lost');
assert.throws(() => L.addGuess(id, [2], 2), /Ya probaste/);
assert.deepEqual(L.addGuess(id, [L.SKIP], L.SKIP), [L.SKIP, L.SKIP], 'skips can repeat');
assert.throws(() => L.addGuess(id, [id], 3), /ya terminó/);
assert.throws(() => L.addGuess(id, [], 999999), /Elige una canción/);
let v = L.slotView(id, []);
assert.deepEqual(Object.keys(v.clues).sort(), ['layer', 'tier', 'year'], 'layer 1: year and fame');
v = L.slotView(id, [L.SKIP]); assert.ok(v.clues.genre && v.clues.lang && !v.clues.country, 'layer 2');
v = L.slotView(id, [L.SKIP, 2]); assert.ok(v.clues.country && v.clues.kind && !v.clues.title, 'layer 3');
assert.equal(v.history[1].type, 'guess'); assert.equal(v.history[0].type, 'skip'); assert.equal(v.tries[0].clues.artist, 'hit');
v = L.slotView(id, [L.SKIP, 2, L.SKIP]); assert.ok(v.clues.title && !v.clues.artist, 'layer 4: title shape');
assert.equal(v.answer, null, 'no answer while playing'); assert.equal(v.left, 3);
assert.ok(!JSON.stringify(v).includes('Bohemian') && !JSON.stringify(v).includes('Rhapsody'), 'view does not leak the title');
v = L.slotView(id, [L.SKIP, 2, L.SKIP, L.SKIP, L.SKIP]); assert.equal(v.clues.artist, 'Queen', 'layer 6: artist');
v = L.slotView(id, [L.SKIP, id]);
assert.equal(v.answer, id); assert.equal(v.points, 5); assert.ok(v.clues.title.flat().every(b => !b.hidden));
assert.equal(L.emojiFor(id, [id]), '💚'); assert.equal(L.emojiFor(id, [2, 3, id]), '🟩'); assert.equal(L.emojiFor(id, [2, 3, 4, id]), '🟨'); assert.equal(L.emojiFor(id, [0]), '🟥');
assert.equal(L.stepRow(id, [L.SKIP, 2, id]), '⬛🟥🟩⬜⬜⬜');

// Daily pick: ten well-known songs, five in Spanish, different artists, avoiding recent ones.
let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
for (let day = 0; day < 200; day++) {
  const ids = L.pickSongs(rnd);
  const songs = ids.map(L.songById);
  assert.equal(ids.length, 10); assert.equal(new Set(ids).size, 10);
  assert.equal(songs.filter(s => s.lang === 'es').length, 5);
  assert.ok(songs.every(s => s.tier === 1));
  assert.equal(new Set(songs.map(s => L.fold(s.artists[0]))).size, 10, 'different artists');
}
const recent = new Set(tier1.slice(0, 150).map(s => s.id));
assert.ok(L.pickSongs(rnd, { recent }).every(id => !recent.has(id)), 'skips recent songs');
assert.equal(L.pickSongs(rnd, { recent: new Set(tier1.map(s => s.id)) }).length, 10, 'falls back when everything is recent');

// Search.
assert.equal(L.search('despa')[0].title, 'Despacito');
assert.equal(L.search('baile sobran')[0].title, 'El baile de los que sobran');
assert.ok(L.search('prisioneros', 20).length >= 8, 'by artist');
assert.equal(L.search('corazon parti')[0].title, 'Corazón partío', 'accents ignored');
assert.ok(!L.search('despacito', 8, [despacito.id]).some(s => s.id === despacito.id), 'exclude tried songs');
assert.deepEqual(L.search('   '), []);
assert.match(L.chileDay(Date.parse('2026-10-04T02:30:00Z')), /^2026-10-03$/, 'still the 3rd in Santiago');
// Packs.
for (const pack of L.PACKS) {
  const ids = L.pickPack(rnd, pack.id, 10);
  assert.equal(ids.length, 10, 'pack ' + pack.id);
  assert.ok(ids.map(L.songById).every(pack.filter), 'pack songs match ' + pack.id);
}
assert.ok(L.pickPack(rnd, 'cl', 10).map(L.songById).every(s => s.country === 'CL'));
// Bonus round.
for (let n = 0; n < 50; n++) {
  const qs = L.makeTrivia(rnd, 5);
  assert.equal(qs.length, 5);
  for (const q of qs) { assert.ok(q.options.includes(q.answer), q.prompt); assert.equal(new Set(q.options).size, q.options.length, 'distinct options'); }
}
// Live rooms.
const A = { id: 'a', username: 'Ana' }, B = { id: 'b', username: 'Beto' };
let room = L.liveCreate(A, { pack: 'rock', rounds: 5, seconds: 30 });
assert.deepEqual(room.options, { pack: 'rock', rounds: 5, seconds: 30 });
assert.deepEqual(L.liveOptions({ pack: 'nope', rounds: 7, seconds: 1 }), { pack: 'mix', rounds: 10, seconds: 45 });
room = L.liveJoin(room, B); room = L.liveJoin(room, B); assert.equal(room.players.length, 2);
let t = 1000;
room = L.liveStart(room, rnd, t); assert.equal(room.status, 'countdown'); assert.equal(room.songs.length, 5);
assert.throws(() => L.liveGuess(room, 'a', room.songs[0], t), /Espera/);
assert.equal(L.liveAdvance(room, t + 100), room, 'nothing yet');
room = L.liveAdvance(room, t += L.LIVE.countdownMs); assert.equal(room.status, 'playing');
let view = L.liveView(room, 'b', t);
assert.equal(view.layer, 1); assert.equal(view.answer, null); assert.ok(!JSON.stringify(view).includes(JSON.stringify(L.songById(room.songs[0]).title)));
assert.equal(L.liveLayer(room, t + 5000), 2, 'a layer every 5 s with 30 s');
const wrongId = L.SONGS.find(s => !room.songs.includes(s.id)).id;
room = L.liveGuess(room, 'b', wrongId, t + 1000);
assert.equal(L.liveView(room, 'b', t + 1000).mine.length, 1); assert.equal(L.liveView(room, 'a', t + 1000).mine.length, 0, 'others only see counts');
assert.equal(L.liveView(room, 'a', t + 1000).players.find(p => p.user_id === 'b').tries, 1);
room = L.liveGuess(room, 'a', room.songs[0], t + 1500);
assert.equal(room.players[0].score, 600 + 95, 'layer 1 + speed');
assert.throws(() => L.liveGuess(room, 'a', room.songs[0], t + 1600), /Ya la adivinaste/);
room = L.liveGuess(room, 'b', room.songs[0], t + 12000);
assert.equal(room.status, 'reveal', 'everyone solved: reveal'); assert.equal(room.players[1].score, 400 + 60);
assert.equal(L.liveView(room, 'b', t + 12000).answer, room.songs[0]);
// Next rounds by time only.
for (let r = 1; r < 5; r++) {
  room = L.liveAdvance(room, t += L.LIVE.revealMs + 12000); assert.equal(room.status, 'playing'); assert.equal(room.round, r);
  room = L.liveAdvance(room, t += 30000); assert.equal(room.status, 'reveal');
}
room = L.liveAdvance(room, t += L.LIVE.revealMs); assert.equal(room.status, 'finished');
assert.deepEqual(L.liveResult(room).winners, ['a']);
assert.equal(L.liveView(room, 'a', t).history.length, 5);
room = L.liveLeave(room, 'b'); assert.equal(room.players.length, 1);
console.log(`PASS cancion logic (${L.SONGS.length} canciones)`);
