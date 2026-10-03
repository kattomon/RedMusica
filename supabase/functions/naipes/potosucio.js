// Poto Sucio (Chilean "old maid"): English deck plus one joker, dealt out completely.
// Pairs of the same rank (any suit) are put down automatically. On your turn you take one
// face-down card from the next player who still has cards; if it pairs, both go down.
// Whoever runs out of cards is safe. The last one holding the joker is the poto sucio.
import { GameError, shuffle, frenchDeck, nextSeat, clone, seatOf } from './cards.js';

export const meta = Object.freeze({
  id: 'potosucio', name: 'Poto Sucio', minPlayers: 2, maxPlayers: 8, allowed: [2, 3, 4, 5, 6, 7, 8],
  defaults: {},
  sanitize() { return {}; }
});

// Remove pairs of the same rank from a hand; returns the ranks that paired.
function dropPairs(hand) {
  const paired = [], byRank = new Map();
  for (const card of hand) {
    if (card.r === 'JK') continue;
    const other = byRank.get(card.r);
    if (other) { byRank.delete(card.r); paired.push([other, card]); } else byRank.set(card.r, card);
  }
  const gone = new Set(paired.flat().map(c => c.id));
  return { hand: hand.filter(c => !gone.has(c.id)), paired };
}

const activeSeats = match => match.players.map((_, i) => i).filter(i => match.hands[i].length);
function nextActive(match, seat) {
  for (let step = 1; step <= match.players.length; step++) {
    seat = nextSeat(seat, match.players.length, 1);
    if (match.hands[seat].length) return seat;
  }
  return -1;
}

export function deal(players, options, random) {
  const n = players.length;
  if (n < 2 || n > 8) throw new GameError('El Poto Sucio se juega de 2 a 8 personas.');
  const deck = shuffle(frenchDeck(1, 1), random);
  const hands = players.map(() => []);
  const first = random(n);
  deck.forEach((card, i) => hands[(first + i) % n].push(card));
  const discarded = [];
  const match = { game: 'potosucio', players: [...players], options: {}, hands: [], discarded, out: [], loser: null, phase: 'play', seq: 0, lastAction: null };
  match.hands = hands.map(hand => { const r = dropPairs(shuffle(hand, random)); discarded.push(...r.paired.flat()); return r.hand; });
  markOut(match);
  match.turn = match.hands[first].length ? first : nextActive(match, first);
  match.from = nextActive(match, match.turn);
  checkEnd(match);
  return match;
}

function markOut(match) {
  match.hands.forEach((hand, seat) => { if (!hand.length && !match.out.includes(seat)) match.out.push(seat); });
}
function checkEnd(match) {
  const active = activeSeats(match);
  if (active.length <= 1) {
    match.phase = 'finished';
    match.loser = active.length ? active[0] : null;
    match.turn = -1; match.from = -1;
  }
}

export function act(input, userId, move, random) {
  const match = clone(input), seat = seatOf(match, userId);
  if (match.phase !== 'play') throw new GameError('La partida terminó.');
  if (move?.type === 'shuffle') {
    if (!match.hands[seat].length) throw new GameError('Ya no tienes cartas.');
    match.hands[seat] = shuffle(match.hands[seat], random);
    match.seq++; match.lastAction = { seat, type: 'shuffle' };
    return match;
  }
  if (move?.type !== 'draw') throw new GameError('Jugada no válida.');
  if (match.turn !== seat) throw new GameError('Todavía no es tu turno.');
  const from = match.from, index = Number(move.index);
  if (!Number.isInteger(index) || index < 0 || index >= match.hands[from].length) throw new GameError('Elige una de las cartas de tu vecino.');
  const [card] = match.hands[from].splice(index, 1);
  const twin = card.r === 'JK' ? -1 : match.hands[seat].findIndex(c => c.r === card.r);
  let paired = null;
  if (twin >= 0) { const [other] = match.hands[seat].splice(twin, 1); match.discarded.push(other, card); paired = card.r; }
  else match.hands[seat].splice(random(match.hands[seat].length + 1), 0, card); // land in a random spot: others cannot track it
  match.seq++;
  match.lastAction = { seat, type: 'draw', from, paired, joker: card.r === 'JK' };
  match.lastDrawn = { seat, card: paired ? null : card.id };
  markOut(match);
  checkEnd(match);
  if (match.phase === 'play') {
    match.turn = nextActive(match, seat);
    match.from = nextActive(match, match.turn);
  }
  return match;
}

export const turnOf = match => match.phase === 'play' ? match.players[match.turn] : null;

export function view(match, userId) {
  const seat = match.players.indexOf(userId);
  return {
    game: 'potosucio', phase: match.phase, seat, players: match.players, turn: match.turn, from: match.from,
    hand: seat >= 0 ? match.hands[seat] : [], counts: match.hands.map(h => h.length),
    pairs: match.discarded.length / 2, recent: match.discarded.slice(-6), out: match.out, loser: match.loser,
    // Only the two players involved know whether the joker changed hands.
    lastAction: match.lastAction && (seat === match.lastAction.seat || seat === match.lastAction.from) ? match.lastAction : match.lastAction && { ...match.lastAction, joker: undefined },
    drawnByMe: match.lastDrawn?.seat === seat ? match.lastDrawn.card : null, seq: match.seq
  };
}

export function autoMove(match, userId, random = n => 0) {
  return { type: 'draw', index: random(match.hands[match.from].length) };
}

export function result(match) {
  if (match.phase !== 'finished') return null;
  const loser = match.loser === null ? [] : [match.players[match.loser]];
  const winners = match.out.length ? [match.players[match.out[0]]] : [];
  return { winners, losers: loser };
}
