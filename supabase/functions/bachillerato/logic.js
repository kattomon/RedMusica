// Bachillerato (tutti frutti / basta / stop): rules shared by the Edge Function, which decides
// everything, and the browser, which uses them only for hints (letter check, timers).
// Pure functions without I/O so they can be tested in Node.

export const LIMITS = Object.freeze({
  minCategories: 3, maxCategories: 12, maxCategoryLength: 30, maxAnswerLength: 40,
  minRounds: 1, maxRounds: 15, maxRejects: 300
});
// Letters with few Spanish words are left out unless the room asks for them.
export const EASY_LETTERS = Object.freeze('ABCDEFGHIJLMNOPRSTUV'.split(''));
export const HARD_LETTERS = Object.freeze(['K', 'Ñ', 'Q', 'W', 'X', 'Y', 'Z']);
export const CATEGORY_PRESETS = Object.freeze([
  'Nombre', 'Apellido', 'Animal', 'Fruta o verdura', 'Color', 'País', 'Ciudad', 'Cosa', 'Comida',
  'Banda o cantante', 'Canción', 'Instrumento musical', 'Película', 'Serie', 'Libro', 'Videojuego',
  'Profesión u oficio', 'Marca', 'Deporte', 'Famoso o famosa', 'Parte del cuerpo', 'Objeto de la casa',
  'Personaje de ficción', 'Flor o planta', 'Bebida', 'Lugar de Chile', 'Verbo', 'Adjetivo'
]);
export const DEFAULT_CATEGORIES = Object.freeze(['Nombre', 'Apellido', 'Animal', 'Fruta o verdura', 'Color', 'País', 'Cosa', 'Banda o cantante', 'Película']);
export const DEFAULT_SETTINGS = Object.freeze({ categories: DEFAULT_CATEGORIES, rounds: 5, roundSeconds: 120, bastaSeconds: 10, reviewSeconds: 60, hardLetters: false });
export const ROUND_OPTIONS = Object.freeze([1, 3, 5, 8, 10]);
export const TIME_OPTIONS = Object.freeze([60, 90, 120, 180, 240]);
export const BASTA_OPTIONS = Object.freeze([0, 5, 10, 15]);
export const REVIEW_OPTIONS = Object.freeze([30, 60, 90, 120]);
export const ROULETTE_MS = 3500;      // the letter spins before typing starts
export const GRACE_MS = 3000;         // answers typed right before the bell still arrive
export const SCORES_MS = 20000;       // time to look at the round scores
export const ACTIVE_MS = 90 * 1000;   // a player who has not checked in for this long does not block votes
export const POINTS = Object.freeze({ unica: 20, original: 10, repetida: 5, vacia: 0, letra: 0, rechazada: 0 });

// Built from character codes so the source stays plain ASCII (no escape sequences to mangle).
const range = (from, to) => String.fromCharCode(from) + '-' + String.fromCharCode(to);
const CONTROL = new RegExp('[' + range(0, 31) + range(127, 159) + range(0x200b, 0x200f) + range(0x2028, 0x202e) + range(0x2066, 0x2069) + ']', 'g');
const MARKS = new RegExp('[' + range(0x300, 0x36f) + ']', 'g');
const KEEP = String.fromCharCode(1);
const ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo', 'the']);

export class GameError extends Error {}

/** Lowercase, without accents (keeps ñ), only letters, digits and single spaces. */
export function normalize(value) {
  return String(value ?? '').normalize('NFC').toLowerCase()
    .replace(/ñ/g, KEEP)
    .normalize('NFD').replace(MARKS, '')
    .split(KEEP).join('ñ')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Key used to find repeated answers: no leading article, no spaces, singular-ish. */
export function comparable(value) {
  const words = normalize(value).split(' ').filter(Boolean);
  while (words.length > 1 && ARTICLES.has(words[0])) words.shift();
  let key = words.join('');
  if (key.length > 3 && key.endsWith('s')) key = key.slice(0, -1);
  return key;
}

export function startsWithLetter(answer, letter) {
  const text = normalize(answer), wanted = normalize(letter);
  return Boolean(text && wanted) && text[0] === wanted[0];
}

export function cleanText(value, max) {
  return String(value ?? '').replace(CONTROL, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function cleanAnswers(list, count) {
  const source = Array.isArray(list) ? list : [];
  return Array.from({ length: count }, (_, i) => cleanText(source[i], LIMITS.maxAnswerLength));
}

const pick = (value, options, fallback) => options.includes(Number(value)) ? Number(value) : fallback;

export function sanitizeSettings(input = {}) {
  const seen = new Set(), categories = [];
  for (const raw of Array.isArray(input.categories) ? input.categories : []) {
    const name = cleanText(raw, LIMITS.maxCategoryLength), key = normalize(name);
    if (!key || seen.has(key)) continue;
    seen.add(key); categories.push(name);
    if (categories.length === LIMITS.maxCategories) break;
  }
  return {
    categories: categories.length >= LIMITS.minCategories ? categories : [...DEFAULT_CATEGORIES],
    rounds: pick(input.rounds, ROUND_OPTIONS, DEFAULT_SETTINGS.rounds),
    roundSeconds: pick(input.roundSeconds, TIME_OPTIONS, DEFAULT_SETTINGS.roundSeconds),
    bastaSeconds: pick(input.bastaSeconds, BASTA_OPTIONS, DEFAULT_SETTINGS.bastaSeconds),
    reviewSeconds: pick(input.reviewSeconds, REVIEW_OPTIONS, DEFAULT_SETTINGS.reviewSeconds),
    hardLetters: input.hardLetters === true
  };
}

export const lettersFor = settings => settings.hardLetters ? [...EASY_LETTERS, ...HARD_LETTERS] : [...EASY_LETTERS];

/** `random(n)` returns an integer in [0, n). Letters do not repeat within a game. */
export function drawLetter(settings, used, random) {
  const pool = lettersFor(settings).filter(letter => !used.includes(letter));
  const choices = pool.length ? pool : lettersFor(settings);
  return choices[random(choices.length)];
}

function roundAt(game, settings, round, now, random) {
  const letter = drawLetter(settings, game.usedLetters, random);
  const startsAt = now + ROULETTE_MS;
  return {
    ...game, round, letter, usedLetters: [...game.usedLetters, letter],
    startsAt, endsAt: startsAt + settings.roundSeconds * 1000, bastaBy: null, bastaAt: null,
    reviewEndsAt: null, nextAt: null
  };
}

export function newGame(id, settings, now, random) {
  return roundAt({ id, round: 0, totalRounds: settings.rounds, usedLetters: [], history: [], winners: [] }, settings, 1, now, random);
}

/** Every category answered with the right letter: needed to call ¡Basta! */
export function canCallBasta(answers, letter, count) {
  return answers.length === count && answers.every(answer => startsWithLetter(answer, letter));
}

export function applyBasta(state, userId, answers, now) {
  const game = state.game, settings = state.settings;
  if (state.status !== 'playing' || !game) throw new GameError('La ronda no está en juego.');
  if (now < game.startsAt) throw new GameError('Todavía está girando la letra.');
  if (now > game.endsAt) throw new GameError('La ronda ya terminó.');
  if (game.bastaBy) return state;
  if (!canCallBasta(answers, game.letter, settings.categories.length)) throw new GameError('Para decir ¡Basta! completa todas las categorías con la letra ' + game.letter + '.');
  const endsAt = Math.min(game.endsAt, now + settings.bastaSeconds * 1000);
  return { ...state, game: { ...game, bastaBy: userId, bastaAt: now, endsAt } };
}

export const acceptsAnswers = (state, now) => state.status === 'playing' && !!state.game && now >= state.game.startsAt - 1000 && now <= state.game.endsAt + GRACE_MS;

/**
 * Whether the game may move on. `ctx`: { isHost, allReady }.
 * playing -> review after the bell; review -> scores when time is up, everyone is ready or the host says so;
 * scores -> next round when time is up or the host says so.
 */
export function canAdvance(state, now, ctx = {}) {
  const game = state.game;
  if (!game) return false;
  if (state.status === 'playing') return now >= game.endsAt + GRACE_MS;
  if (state.status === 'review') return now >= game.reviewEndsAt || !!ctx.allReady || !!ctx.isHost;
  if (state.status === 'scores') return now >= game.nextAt || !!ctx.isHost;
  return false;
}

export function toReview(state, now) {
  return { ...state, status: 'review', game: { ...state.game, reviewEndsAt: now + state.settings.reviewSeconds * 1000 } };
}

/** After scoring: last round finishes the game, otherwise the scores screen comes next. */
export function afterScoring(state, roundSummary, now, ranking) {
  const game = { ...state.game, history: [...state.game.history, roundSummary] };
  if (game.round >= game.totalRounds) {
    const top = ranking.length ? ranking[0].total : 0;
    game.winners = top > 0 ? ranking.filter(row => row.total === top).map(row => row.user_id) : [];
    return { ...state, status: 'finished', game };
  }
  return { ...state, status: 'scores', game: { ...game, nextAt: now + SCORES_MS } };
}

export function nextRound(state, now, random) {
  return { ...state, status: 'playing', game: roundAt(state.game, state.settings, state.game.round + 1, now, random) };
}

/**
 * Scores one round.
 * answers: { userId: string[] }, rejects: { voterId: string[] of "userId:categoryIndex" },
 * voters: ids allowed to vote (active players). An answer is thrown out when more than half
 * of the other eligible voters reject it. Valid answers: 20 if nobody else has a valid answer
 * in that category, 10 if no one repeated it, 5 if repeated.
 */
export function scoreRound({ categories, letter, answers, rejects = {}, voters = [] }) {
  const ids = Object.keys(answers), eligible = new Set(voters);
  for (const voter of Object.keys(rejects)) if ((rejects[voter] || []).length) eligible.add(voter);
  const against = new Map();
  for (const [voter, list] of Object.entries(rejects)) {
    if (!eligible.has(voter)) continue;
    for (const key of new Set(list || [])) {
      const author = String(key).split(':')[0];
      if (author === voter) continue;
      against.set(key, (against.get(key) || 0) + 1);
    }
  }
  const status = {}, points = {}, totals = {}, rejections = {};
  for (const id of ids) { status[id] = []; points[id] = []; totals[id] = 0; }
  categories.forEach((_, c) => {
    const valid = [];
    for (const id of ids) {
      const answer = cleanText(answers[id]?.[c], LIMITS.maxAnswerLength), key = id + ':' + c;
      const votes = against.get(key) || 0, voterCount = eligible.size - (eligible.has(id) ? 1 : 0);
      if (votes) rejections[key] = votes;
      if (!answer) status[id][c] = 'vacia';
      else if (!startsWithLetter(answer, letter)) status[id][c] = 'letra';
      else if (voterCount > 0 && votes * 2 > voterCount) status[id][c] = 'rechazada';
      else { status[id][c] = null; valid.push({ id, key: comparable(answer) }); }
    }
    const groups = new Map();
    for (const row of valid) groups.set(row.key, (groups.get(row.key) || 0) + 1);
    for (const row of valid) status[row.id][c] = valid.length === 1 ? 'unica' : groups.get(row.key) > 1 ? 'repetida' : 'original';
    for (const id of ids) { points[id][c] = POINTS[status[id][c]]; totals[id] += points[id][c]; }
  });
  return { status, points, totals, rejections };
}

export function rank(rows) {
  return [...rows].sort((a, b) => b.total - a.total || String(a.username).localeCompare(String(b.username), 'es'));
}
