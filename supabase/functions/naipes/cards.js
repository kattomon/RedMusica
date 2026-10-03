// Shared pieces for the card games: decks, shuffling and seat order.
// Pure functions (no I/O). The server deals with a crypto-backed `random(n)`;
// tests can pass a predictable one.

export class GameError extends Error {}

export const FRENCH_RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
export const FRENCH_SUITS = Object.freeze(['S', 'H', 'D', 'C']); // picas, corazones, diamantes, tréboles
export const SPANISH_SUITS = Object.freeze(['O', 'C', 'E', 'B']); // oros, copas, espadas, bastos

/** Fisher-Yates with an injected integer source: random(n) in [0, n). */
export function shuffle(list, random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** French deck(s): { id, r: 'A'..'K', s } plus jokers { id, r: 'JK', s: '*' }. */
export function frenchDeck(copies = 1, jokers = 0) {
  const cards = [];
  for (let d = 0; d < copies; d++) for (const s of FRENCH_SUITS) for (const r of FRENCH_RANKS) cards.push({ id: cards.length, r, s });
  for (let j = 0; j < jokers; j++) cards.push({ id: cards.length, r: 'JK', s: '*' });
  return cards;
}

/** Spanish deck: 1-7, 10 (sota), 11 (caballo), 12 (rey); with 8 and 9 for six players. */
export function spanishDeck(withEightNine = false) {
  const ranks = withEightNine ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
  const cards = [];
  for (const s of SPANISH_SUITS) for (const r of ranks) cards.push({ id: cards.length, r, s });
  return cards;
}

export const nextSeat = (seat, count, direction = 1) => ((seat + direction) % count + count) % count;
export const takeCard = (hand, id) => {
  const index = hand.findIndex(card => card.id === id);
  if (index < 0) throw new GameError('Esa carta no está en tu mano.');
  return hand.splice(index, 1)[0];
};
export const clone = value => structuredClone(value);
export const seatOf = (match, userId) => {
  const seat = match.players.indexOf(userId);
  if (seat < 0) throw new GameError('No estás jugando en esta mesa.');
  return seat;
};
