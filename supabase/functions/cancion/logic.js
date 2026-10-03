// "Adivina la canción": rules shared by the cancion Edge Function (daily challenge and live rooms,
// where the server is the referee) and the browser (practice, packs, bonus round, search box).
// Pure functions, no I/O.
//
// Each song is played in up to six steps, like Bandle: at every step you either guess or skip,
// and every step (a skip or a wrong guess) uncovers a new layer of clues:
//   1) year and how well known it is   2) genre and language   3) country and performer
//   4) the title as letter boxes with the first letter of each word   5) the vowels   6) the artist.
// A wrong guess also gets Wordle-style colours comparing it with the hidden song.
import { SONG_ROWS } from './songs.js';

export const MAX_STEPS = 6;
export const MAX_GUESSES = MAX_STEPS;   // kept for older callers
export const SONGS_PER_DAY = 10;
export const GIVE_UP = 0;               // stored as an action: the player gave up on that song
export const SKIP = -1;                 // stored as an action: skip to the next layer

export const GENRES = Object.freeze({
  pop: 'Pop', rock: 'Rock', metal: 'Metal', hiphop: 'Hip hop', urbano: 'Urbano latino', electro: 'Electrónica',
  rnb: 'R&B / Soul', disco: 'Disco / Funk', tropical: 'Tropical', balada: 'Balada', folk: 'Folk / Cantautor',
  regional: 'Regional mexicano', country: 'Country', jazz: 'Jazz', tango: 'Tango'
});
const RELATED = [
  ['pop', 'electro'], ['pop', 'balada'], ['pop', 'rnb'], ['pop', 'rock'], ['pop', 'disco'], ['pop', 'urbano'], ['pop', 'country'],
  ['rock', 'metal'], ['rock', 'folk'], ['hiphop', 'rnb'], ['hiphop', 'urbano'], ['urbano', 'tropical'], ['electro', 'disco'],
  ['rnb', 'disco'], ['rnb', 'jazz'], ['balada', 'folk'], ['balada', 'regional'], ['balada', 'tango'], ['regional', 'tropical'],
  ['folk', 'country'], ['folk', 'tango'], ['jazz', 'balada']
];
export const LANGS = Object.freeze({ es: 'Español', en: 'Inglés', pt: 'Portugués', it: 'Italiano', fr: 'Francés', de: 'Alemán', ko: 'Coreano', ro: 'Rumano' });
export const COUNTRIES = Object.freeze({
  CL: 'Chile', AR: 'Argentina', MX: 'México', CO: 'Colombia', PR: 'Puerto Rico', VE: 'Venezuela', PE: 'Perú', CU: 'Cuba',
  DO: 'Rep. Dominicana', PA: 'Panamá', UY: 'Uruguay', GT: 'Guatemala', BR: 'Brasil', BB: 'Barbados',
  US: 'Estados Unidos', CA: 'Canadá', GB: 'Reino Unido', IE: 'Irlanda', ES: 'España', FR: 'Francia', DE: 'Alemania',
  IT: 'Italia', SE: 'Suecia', NO: 'Noruega', DK: 'Dinamarca', FI: 'Finlandia', IS: 'Islandia', BE: 'Bélgica', RO: 'Rumania',
  MD: 'Moldavia', KR: 'Corea del Sur', AU: 'Australia', NZ: 'Nueva Zelanda'
});
const REGIONS = {
  latam: ['CL', 'AR', 'MX', 'CO', 'PR', 'VE', 'PE', 'CU', 'DO', 'PA', 'UY', 'GT', 'BR', 'BB'],
  norte: ['US', 'CA'],
  europa: ['GB', 'IE', 'ES', 'FR', 'DE', 'IT', 'SE', 'NO', 'DK', 'FI', 'IS', 'BE', 'RO', 'MD'],
  asia: ['KR'],
  oceania: ['AU', 'NZ']
};
const regionOf = code => Object.keys(REGIONS).find(region => REGIONS[region].includes(code)) || null;
export const KINDS = Object.freeze({ M: 'Solista (él)', F: 'Solista (ella)', G: 'Banda o dúo', C: 'Colaboración' });
export const TIERS = Object.freeze({ 1: 'Muy conocida', 2: 'Conocida' });
export const LAYERS = Object.freeze(['Año y fama', 'Género e idioma', 'País e intérprete', 'Forma del título', 'Vocales del título', 'Artista']);

/** A flag emoji from a two-letter country code (built from code points, no escapes). */
export const flag = code => /^[A-Z]{2}$/.test(code || '') ? String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '';

export function toSong(row) {
  const [id, title, artists, year, country, genre, lang, kind, tier] = row;
  return { id, title, artists, year, country, genre, lang, kind: artists.length > 1 ? 'C' : kind, tier };
}
export const SONGS = Object.freeze(SONG_ROWS.map(toSong));
const BY_ID = new Map(SONGS.map(song => [song.id, song]));
export const songById = id => BY_ID.get(Number(id)) || null;

// Lowercase without accents or punctuation, for search and comparisons.
const MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
export const fold = text => String(text || '').normalize('NFD').replace(MARKS, '').toLowerCase();
const isLetter = ch => /[a-z0-9]/.test(fold(ch));
const isVowel = ch => /[aeiou]/.test(fold(ch));
const sameSet = (a, b) => a.length === b.length && a.every(x => b.map(fold).includes(fold(x)));

/** The colours for one wrong guess. Each is 'hit' (green), 'near' (yellow) or 'miss' (grey). */
export function compare(guess, answer) {
  const genre = guess.genre === answer.genre ? 'hit' : RELATED.some(([a, b]) => (a === guess.genre && b === answer.genre) || (b === guess.genre && a === answer.genre)) ? 'near' : 'miss';
  const country = guess.country === answer.country ? 'hit' : regionOf(guess.country) && regionOf(guess.country) === regionOf(answer.country) ? 'near' : 'miss';
  const shared = guess.artists.some(a => answer.artists.map(fold).includes(fold(a)));
  const artist = sameSet(guess.artists, answer.artists) ? 'hit' : shared ? 'near' : 'miss';
  const diff = answer.year - guess.year;
  const year = { state: diff === 0 ? 'hit' : Math.abs(diff) <= 3 ? 'near' : 'miss', dir: diff > 0 ? 'up' : diff < 0 ? 'down' : '' };
  const solo = k => k === 'M' || k === 'F';
  const kind = guess.kind === answer.kind ? 'hit' : solo(guess.kind) && solo(answer.kind) ? 'near' : 'miss';
  return { song: guess.id === answer.id, artist, year, country, genre, lang: guess.lang === answer.lang ? 'hit' : 'miss', kind };
}

/**
 * The answer's title as letter boxes. Hidden letters come back without the letter ({ hidden: true }),
 * so this can be sent to a player as is. Letters light up when a guess had the same letter in the
 * same word and position; `initials` and `vowels` uncover more.
 */
export function maskTitle(answer, tries, { reveal = false, initials = false, vowels = false } = {}) {
  const lettersOf = word => [...word].filter(isLetter).map(fold);
  const guessWords = tries.filter(Boolean).filter(song => song.id !== answer.id).map(song => song.title.split(/\s+/).map(lettersOf));
  return answer.title.split(/\s+/).map((word, w) => {
    let position = -1;
    return [...word].map(ch => {
      if (!isLetter(ch)) return { ch, letter: false };
      position++;
      const matched = guessWords.some(words => words[w]?.[position] === fold(ch));
      const shown = reveal || matched || (initials && position === 0) || (vowels && isVowel(ch));
      return shown ? { ch, letter: true, match: matched && !reveal } : { letter: true, hidden: true };
    });
  });
}

/** State of one song: 'won', 'lost' or 'playing', given the actions so far (ids, SKIP or GIVE_UP). */
export function slotState(answerId, actions) {
  if (actions.includes(answerId)) return 'won';
  if (actions.includes(GIVE_UP) || actions.length >= MAX_STEPS) return 'lost';
  return 'playing';
}
/** 6 points at step 1, 5 at step 2 … 1 at step 6. */
export const slotPoints = (answerId, actions) => slotState(answerId, actions) === 'won' ? MAX_STEPS - actions.indexOf(answerId) : 0;
/** Step where it was solved (1-6) or 7 when it was not. */
export const solvedAt = (answerId, actions) => slotState(answerId, actions) === 'won' ? actions.indexOf(answerId) + 1 : 7;
/** How many layers of clues are visible. */
export const layerOf = (answerId, actions) => slotState(answerId, actions) === 'playing' ? Math.min(MAX_STEPS, actions.length + 1) : MAX_STEPS;

/** Checks an action. Returns the new list of actions or throws an Error with a message for the player. */
export function addGuess(answerId, actions, songId) {
  if (slotState(answerId, actions) !== 'playing') throw new Error('Esa canción ya terminó.');
  const id = Number(songId);
  if (id === GIVE_UP || id === SKIP) return [...actions, id];
  if (!songById(id)) throw new Error('Elige una canción de la lista.');
  if (actions.includes(id)) throw new Error('Ya probaste con esa canción.');
  return [...actions, id];
}

/** The clue layers a player may see at `layer` (1-6). */
export function cluesFor(answer, layer, tries = [], reveal = false) {
  const clues = { layer };
  if (layer >= 1) { clues.year = answer.year; clues.tier = answer.tier; }
  if (layer >= 2) { clues.genre = answer.genre; clues.lang = answer.lang; }
  if (layer >= 3) { clues.country = answer.country; clues.kind = answer.kind; }
  if (layer >= 4 || reveal) clues.title = maskTitle(answer, tries, { reveal, initials: true, vowels: layer >= 5 });
  if (layer >= 6 || reveal) clues.artist = answer.artists[0];
  return clues;
}

/** Everything a player may see about one song of a game. The answer appears only when it is over. */
export function slotView(answerId, actions) {
  const answer = songById(answerId), state = slotState(answerId, actions);
  const tries = actions.filter(id => id > 0).map(songById);
  const layer = layerOf(answerId, actions);
  return {
    state, points: slotPoints(answerId, actions), layer, step: actions.length,
    history: actions.map(id => id === SKIP ? { type: 'skip' } : id === GIVE_UP ? { type: 'giveup' } : { type: 'guess', id, clues: compare(songById(id), answer) }),
    tries: tries.map(song => ({ id: song.id, clues: compare(song, answer) })),
    clues: cluesFor(answer, layer, tries, state !== 'playing'),
    answer: state === 'playing' ? null : answer.id,
    left: state === 'playing' ? MAX_STEPS - actions.length : 0
  };
}

/** One emoji per song for the friends' table and the share text. */
export function emojiFor(answerId, actions) {
  const state = slotState(answerId, actions);
  if (state === 'playing') return actions.length ? '🔲' : '⬜';
  if (state === 'lost') return '🟥';
  const step = actions.indexOf(answerId) + 1;
  return step === 1 ? '💚' : step <= 3 ? '🟩' : '🟨';
}
/** Bandle-style row for one song: ⬛ skipped, 🟥 wrong, 🟩 right, ⬜ not used. */
export function stepRow(answerId, actions) {
  const cells = actions.slice(0, MAX_STEPS).map(id => id === answerId ? '🟩' : id === SKIP ? '⬛' : '🟥');
  while (cells.length < MAX_STEPS) cells.push('⬜');
  return cells.join('');
}

/**
 * Chooses songs among the very well-known ones (or a pack): half in Spanish, never two by the same
 * artist, skipping the songs of the last days when possible.
 */
export function pickSongs(random, { recent = new Set(), count = SONGS_PER_DAY, pool = SONGS.filter(s => s.tier === 1), spanish = Math.ceil(count / 2) } = {}) {
  const chosen = [], artists = new Set();
  const take = (filter, n) => {
    for (const strict of [true, false]) {
      const options = pool.filter(song => filter(song) && !chosen.includes(song) && !artists.has(fold(song.artists[0])) && (!strict || !recent.has(song.id)));
      while (n > 0 && options.length) {
        const [song] = options.splice(random(options.length), 1);
        if (artists.has(fold(song.artists[0]))) continue;
        chosen.push(song); artists.add(fold(song.artists[0])); n--;
      }
      if (!n) return;
    }
  };
  take(song => song.lang === 'es', Math.min(spanish, count));
  take(song => song.lang !== 'es', count - chosen.length);
  take(() => true, count - chosen.length);
  for (let i = chosen.length - 1; i > 0; i--) { const j = random(i + 1); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
  return chosen.map(song => song.id);
}

/** Song packs, like Bandle's: by genre, by decade and by origin. `spanish` = how many in Spanish out of 10. */
export const PACKS = Object.freeze([
  { id: 'mix', name: 'Mezcla', icon: '🎲', filter: () => true, spanish: 5 },
  { id: 'cl', name: 'Chilenas', icon: '🇨🇱', filter: s => s.country === 'CL', spanish: 10 },
  { id: 'latinas', name: 'Latinas', icon: '💃', filter: s => s.lang === 'es', spanish: 10 },
  { id: 'ingles', name: 'En inglés', icon: '🌎', filter: s => s.lang === 'en', spanish: 0 },
  { id: 'rock', name: 'Rock y metal', icon: '🎸', filter: s => s.genre === 'rock' || s.genre === 'metal', spanish: 4 },
  { id: 'pop', name: 'Pop', icon: '✨', filter: s => s.genre === 'pop', spanish: 4 },
  { id: 'urbano', name: 'Urbano y hip hop', icon: '🔥', filter: s => s.genre === 'urbano' || s.genre === 'hiphop', spanish: 6 },
  { id: 'baile', name: 'Para bailar', icon: '🪩', filter: s => ['electro', 'disco', 'tropical'].includes(s.genre), spanish: 4 },
  { id: 'romanticas', name: 'Románticas', icon: '💘', filter: s => s.genre === 'balada' || s.genre === 'rnb', spanish: 5 },
  { id: 'd60', name: 'Antes de los 80', icon: '📻', filter: s => s.year < 1980, spanish: 3 },
  { id: 'd80', name: 'Años 80', icon: '📼', filter: s => s.year >= 1980 && s.year < 1990, spanish: 4 },
  { id: 'd90', name: 'Años 90', icon: '💿', filter: s => s.year >= 1990 && s.year < 2000, spanish: 4 },
  { id: 'd00', name: 'Años 2000', icon: '📀', filter: s => s.year >= 2000 && s.year < 2010, spanish: 4 },
  { id: 'd10', name: 'Años 2010', icon: '📱', filter: s => s.year >= 2010 && s.year < 2020, spanish: 4 },
  { id: 'd20', name: 'Desde 2020', icon: '🎧', filter: s => s.year >= 2020, spanish: 4 }
]);
export const packById = id => PACKS.find(p => p.id === id) || PACKS[0];
export function pickPack(random, packId, count = 10, { tierOne = false } = {}) {
  const pack = packById(packId);
  const pool = SONGS.filter(s => pack.filter(s) && (!tierOne || s.tier === 1));
  return pickSongs(random, { pool, count, spanish: Math.round(pack.spanish * count / 10) });
}

/** Bonus round: quick multiple-choice questions built from the catalog. */
export function makeTrivia(random, count = 5, pool = SONGS.filter(s => s.tier === 1)) {
  const pickOne = list => list[random(list.length)];
  const shuffle = list => { const out = [...list]; for (let i = out.length - 1; i > 0; i--) { const j = random(i + 1); [out[i], out[j]] = [out[j], out[i]]; } return out; };
  const kinds = ['year', 'artist', 'country', 'first', 'genre'];
  const questions = [], used = new Set();
  for (let n = 0; questions.length < count && n < count * 20; n++) {
    const kind = kinds[questions.length % kinds.length], song = pickOne(pool);
    if (used.has(song.id)) continue;
    let prompt, options, answer;
    if (kind === 'year') {
      const offsets = shuffle([-6, -3, 3, 5, 8, -9]).slice(0, 3);
      options = shuffle([song.year, ...offsets.map(o => song.year + o).filter(y => y <= 2026)]).map(String);
      prompt = `¿En qué año salió «${song.title}» de ${song.artists[0]}?`; answer = String(song.year);
    } else if (kind === 'artist') {
      const others = shuffle([...new Set(pool.filter(s => fold(s.artists[0]) !== fold(song.artists[0]) && s.lang === song.lang).map(s => s.artists[0]))]).slice(0, 3);
      options = shuffle([song.artists[0], ...others]); prompt = `¿Quién canta «${song.title}»?`; answer = song.artists[0];
    } else if (kind === 'country') {
      const others = shuffle(Object.keys(COUNTRIES).filter(c => c !== song.country)).slice(0, 3);
      options = shuffle([song.country, ...others]).map(c => COUNTRIES[c]); prompt = `¿De dónde es ${song.artists[0]}?`; answer = COUNTRIES[song.country];
    } else if (kind === 'first') {
      const other = pickOne(pool.filter(s => Math.abs(s.year - song.year) >= 3 && s.id !== song.id));
      const older = other.year < song.year ? other : song;
      options = shuffle([`«${song.title}» (${song.artists[0]})`, `«${other.title}» (${other.artists[0]})`]); prompt = '¿Cuál salió primero?';
      answer = `«${older.title}» (${older.artists[0]})`; used.add(other.id);
    } else {
      const others = shuffle(Object.keys(GENRES).filter(g => g !== song.genre)).slice(0, 3);
      options = shuffle([song.genre, ...others]).map(g => GENRES[g]); prompt = `¿Qué género es «${song.title}» de ${song.artists[0]}?`; answer = GENRES[song.genre];
    }
    used.add(song.id);
    questions.push({ kind, prompt, options, answer, song: song.id });
  }
  return questions;
}

/** Search for the guess box: every word typed must appear in the title or the artists. */
export function search(text, limit = 8, exclude = []) {
  const words = fold(text).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  const results = [];
  for (const song of SONGS) {
    if (exclude.includes(song.id)) continue;
    const title = fold(song.title), haystack = title + ' ' + fold(song.artists.join(' '));
    if (!words.every(w => haystack.includes(w))) continue;
    const score = (title.startsWith(words.join(' ')) ? 0 : title.includes(words[0]) ? 1 : 2) + (song.tier === 1 ? 0 : 0.5);
    results.push({ song, score });
  }
  return results.sort((a, b) => a.score - b.score || a.song.title.localeCompare(b.song.title, 'es')).slice(0, limit).map(r => r.song);
}

/** Today's date in Chile (the daily challenge changes at midnight, Santiago time). */
export const chileDay = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

// ---------------------------------------------------------------------------------------------
// Live rooms: everybody hears (sees) the same song at the same time. Layers open by themselves as
// the clock runs; guess earlier for more points. Three tries per song.
export const LIVE = Object.freeze({ maxPlayers: 30, tries: 3, countdownMs: 4000, revealMs: 7000, rounds: [5, 10, 15], seconds: [30, 45, 60] });
export function liveOptions(options = {}) {
  return {
    pack: PACKS.some(p => p.id === options.pack) ? options.pack : 'mix',
    rounds: LIVE.rounds.includes(Number(options.rounds)) ? Number(options.rounds) : 10,
    seconds: LIVE.seconds.includes(Number(options.seconds)) ? Number(options.seconds) : 45
  };
}
export function liveCreate(user, options) {
  return { status: 'lobby', options: liveOptions(options), players: [{ user_id: user.id, username: user.username, score: 0 }], round: -1, songs: [], phaseAt: 0, guesses: {}, solved: {}, history: [], seq: 0 };
}
export function liveJoin(state, user) {
  if (state.players.some(p => p.user_id === user.id)) return state;
  if (state.players.length >= LIVE.maxPlayers) throw new Error(`La sala ya tiene ${LIVE.maxPlayers} jugadores.`);
  const next = structuredClone(state);
  next.players.push({ user_id: user.id, username: user.username, score: 0, late: state.status !== 'lobby' && state.status !== 'finished' });
  next.seq++;
  return next;
}
export function liveLeave(state, userId) {
  const next = structuredClone(state);
  next.players = next.players.filter(p => p.user_id !== userId);
  delete next.guesses[userId]; delete next.solved[userId];
  next.seq++;
  return next;
}
export function liveStart(state, random, now) {
  if (state.status === 'playing' || state.status === 'countdown' || state.status === 'reveal') throw new Error('La partida ya empezó.');
  const next = structuredClone(state);
  next.songs = pickPack(random, next.options.pack, next.options.rounds, { tierOne: true });
  if (next.songs.length < next.options.rounds) next.songs = pickPack(random, next.options.pack, next.options.rounds);
  next.players.forEach(p => { p.score = 0; delete p.late; });
  Object.assign(next, { status: 'countdown', round: 0, phaseAt: now, guesses: {}, solved: {}, history: [], matchId: null });
  next.seq++;
  return next;
}
const roundMs = state => state.options.seconds * 1000;
/** Layer visible in the current round (1-6), opening one every seconds/6. */
export function liveLayer(state, now) {
  if (state.status !== 'playing') return state.status === 'reveal' || state.status === 'finished' ? MAX_STEPS : 1;
  return Math.min(MAX_STEPS, 1 + Math.floor((now - state.phaseAt) / (roundMs(state) / MAX_STEPS)));
}
const roundDone = state => state.players.every(p => state.solved[p.user_id] || (state.guesses[p.user_id] || []).length >= LIVE.tries);
function closeRound(state, now) {
  const answer = state.songs[state.round];
  state.history.push({ song: answer, results: Object.fromEntries(state.players.map(p => [p.user_id, state.solved[p.user_id] || null])) });
  state.status = 'reveal'; state.phaseAt = now; state.seq++;
}
/** Moves the room forward when a deadline has passed. Returns the same object when nothing changes. */
export function liveAdvance(state, now) {
  if (state.status === 'countdown' && now - state.phaseAt >= LIVE.countdownMs) {
    const next = structuredClone(state); Object.assign(next, { status: 'playing', phaseAt: now, guesses: {}, solved: {} }); next.seq++; return next;
  }
  if (state.status === 'playing' && (now - state.phaseAt >= roundMs(state) || roundDone(state))) {
    const next = structuredClone(state); closeRound(next, now); return next;
  }
  if (state.status === 'reveal' && now - state.phaseAt >= LIVE.revealMs) {
    const next = structuredClone(state);
    if (next.round + 1 >= next.songs.length) { next.status = 'finished'; next.phaseAt = now; }
    else Object.assign(next, { status: 'playing', round: next.round + 1, phaseAt: now, guesses: {}, solved: {} });
    next.seq++;
    return next;
  }
  return state;
}
/** A guess in the current round. Points: 100 per unopened layer plus up to 100 for speed. */
export function liveGuess(state, userId, songId, now) {
  if (state.status !== 'playing') throw new Error('Espera a que empiece la canción.');
  if (now - state.phaseAt >= roundMs(state)) throw new Error('Se acabó el tiempo de esta canción.');
  const player = state.players.find(p => p.user_id === userId);
  if (!player) throw new Error('No estás en esta sala.');
  if (state.solved[userId]) throw new Error('Ya la adivinaste.');
  const mine = state.guesses[userId] || [];
  if (mine.length >= LIVE.tries) throw new Error('Ya usaste tus 3 intentos en esta canción.');
  const id = Number(songId);
  if (!songById(id)) throw new Error('Elige una canción de la lista.');
  if (mine.includes(id)) throw new Error('Ya probaste con esa canción.');
  const next = structuredClone(state);
  next.guesses[userId] = [...mine, id];
  if (id === state.songs[state.round]) {
    const layer = liveLayer(state, now), left = Math.max(0, roundMs(state) - (now - state.phaseAt));
    const points = 100 * (MAX_STEPS + 1 - layer) + Math.round(100 * left / roundMs(state));
    next.solved[userId] = { layer, points, ms: now - state.phaseAt };
    next.players.find(p => p.user_id === userId).score += points;
  }
  next.seq++;
  return roundDone(next) ? (closeRound(next, now), next) : next;
}
/** Deadline of the current phase (ms since epoch) or null. */
export function liveDeadline(state) {
  if (state.status === 'countdown') return state.phaseAt + LIVE.countdownMs;
  if (state.status === 'playing') return state.phaseAt + roundMs(state);
  if (state.status === 'reveal') return state.phaseAt + LIVE.revealMs;
  return null;
}
/** What one player may see: the answer only after the round, other players' tries only as counts. */
export function liveView(state, userId, now) {
  const answerId = state.songs[state.round];
  const answer = answerId ? songById(answerId) : null;
  const layer = liveLayer(state, now);
  const mine = (state.guesses[userId] || []).map(songById);
  const open = state.status === 'reveal' || state.status === 'finished';
  return {
    status: state.status, options: state.options, round: state.round, rounds: state.songs.length || state.options.rounds,
    phaseAt: state.phaseAt, deadline: liveDeadline(state), layer, seq: state.seq,
    players: state.players.map(p => ({ user_id: p.user_id, username: p.username, score: p.score, late: !!p.late,
      tries: (state.guesses[p.user_id] || []).length, solved: state.solved[p.user_id] ? { layer: state.solved[p.user_id].layer, points: state.solved[p.user_id].points } : null })),
    clues: answer && state.status !== 'countdown' ? cluesFor(answer, layer, mine, open) : null,
    mine: mine.map(song => ({ id: song.id, clues: compare(song, answer) })),
    answer: open && answer ? answer.id : null,
    history: state.history.map(h => ({ song: h.song, mine: h.results[userId] || null }))
  };
}
/** Final ranking: winners are the top score (ties share the win). */
export function liveResult(state) {
  if (state.status !== 'finished' || !state.players.length) return null;
  const best = Math.max(...state.players.map(p => p.score));
  return { winners: state.players.filter(p => p.score === best && best > 0).map(p => p.user_id), players: state.players.map(p => p.user_id) };
}
