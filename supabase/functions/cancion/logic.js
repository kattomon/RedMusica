// "Adivina la canción": rules shared by the cancion Edge Function (daily challenge, the referee)
// and the browser (free practice, search box). Pure functions, no I/O.
// Each song is guessed in up to six tries. Every try is a song from the catalog and gets a colour
// for each clue (artist, year, country, genre, language, performer), Wordle style. The title is
// shown as letter boxes: letters in the same place as in your tries light up, after two misses the
// first letter of every word appears and after four misses the artist.
import { SONG_ROWS } from './songs.js';

export const MAX_GUESSES = 6;
export const SONGS_PER_DAY = 10;
export const GIVE_UP = 0;          // stored as a guess: the player gave up on that song

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
const sameSet = (a, b) => a.length === b.length && a.every(x => b.map(fold).includes(fold(x)));

/** The clues for one try. Each is 'hit' (green), 'near' (yellow) or 'miss' (grey). */
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
 * so this can be sent to the player as is. `tries` are the songs guessed so far.
 */
export function maskTitle(answer, tries, reveal = false) {
  const misses = tries.filter(song => song && song.id !== answer.id).length;
  const lettersOf = word => [...word].filter(isLetter).map(fold);
  const guessWords = tries.filter(Boolean).map(song => song.title.split(/\s+/).map(lettersOf));
  return answer.title.split(/\s+/).map((word, w) => {
    let position = -1;
    return [...word].map(ch => {
      if (!isLetter(ch)) return { ch, letter: false };
      position++;
      const first = position === 0 && misses >= 2;
      const matched = guessWords.some(words => words[w]?.[position] === fold(ch));
      return reveal || first || matched ? { ch, letter: true, match: matched } : { letter: true, hidden: true };
    });
  });
}

/** State of one song: 'won', 'lost' or 'playing', given the ids guessed so far (0 = gave up). */
export function slotState(answerId, guesses) {
  if (guesses.includes(answerId)) return 'won';
  if (guesses.includes(GIVE_UP) || guesses.length >= MAX_GUESSES) return 'lost';
  return 'playing';
}
export const slotPoints = (answerId, guesses) => slotState(answerId, guesses) === 'won' ? MAX_GUESSES + 1 - guesses.indexOf(answerId) - 1 : 0;

/** Checks a try. Returns the new list of guesses or throws an Error with a message for the player. */
export function addGuess(answerId, guesses, songId) {
  if (slotState(answerId, guesses) !== 'playing') throw new Error('Esa canción ya terminó.');
  const id = Number(songId);
  if (id === GIVE_UP) return [...guesses, GIVE_UP];
  if (!songById(id)) throw new Error('Elige una canción de la lista.');
  if (guesses.includes(id)) throw new Error('Ya probaste con esa canción.');
  return [...guesses, id];
}

/** Everything a player may see about one song of a game. The answer appears only when it is over. */
export function slotView(answerId, guesses) {
  const answer = songById(answerId), state = slotState(answerId, guesses);
  const tries = guesses.filter(id => id !== GIVE_UP).map(songById);
  const misses = tries.filter(song => song.id !== answerId).length;
  return {
    state, points: slotPoints(answerId, guesses),
    tries: tries.map(song => ({ id: song.id, clues: compare(song, answer) })),
    title: maskTitle(answer, tries, state !== 'playing'),
    artistHint: state === 'playing' && misses >= 4 ? answer.artists[0] : null,
    answer: state === 'playing' ? null : answer.id,
    left: MAX_GUESSES - guesses.filter(id => id !== GIVE_UP).length
  };
}

/** One emoji per song for the share text and the friends' table. */
export function emojiFor(answerId, guesses) {
  const state = slotState(answerId, guesses);
  if (state === 'playing') return guesses.length ? '🔲' : '⬜';
  if (state === 'lost') return '🟥';
  const tries = guesses.indexOf(answerId) + 1;
  return tries === 1 ? '💚' : tries <= 3 ? '🟩' : '🟨';
}

/**
 * Chooses the ten songs of a day among the very well-known ones: five in Spanish and five in other
 * languages, never two by the same artist, skipping the songs of the last days when possible.
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
  take(song => song.lang === 'es', spanish);
  take(song => song.lang !== 'es', count - chosen.length);
  take(() => true, count - chosen.length);
  for (let i = chosen.length - 1; i > 0; i--) { const j = random(i + 1); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
  return chosen.map(song => song.id);
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
