// ¡Última!: the classic colour-and-number shedding game (same rules as the well-known one).
// 108 cards: four colours with one 0, two of 1-9, two Salta, two Reversa and two +2 each,
// plus four Comodín and four Comodín +4. Seven cards each. Match the colour or the value/symbol
// of the top card, or play a comodín. If you cannot, draw one; if it fits you may play it.
// Say "¡Última!" when you are about to have one card: if someone catches you first, you draw two.
// The first to empty their hand wins the hand and scores the cards left in the others' hands.
import { GameError, shuffle, nextSeat, takeCard, clone, seatOf } from './cards.js';

export const COLORS = Object.freeze(['R', 'Y', 'G', 'B']);
export const meta = Object.freeze({
  id: 'ultima', name: '¡Última!', minPlayers: 2, maxPlayers: 10, allowed: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  defaults: { target: 0 },
  sanitize(options = {}) { return { target: [0, 200, 500].includes(Number(options.target)) ? Number(options.target) : 0 }; }
});

export function ultimaDeck() {
  const cards = [];
  const add = (c, v) => cards.push({ id: cards.length, c, v });
  for (const c of COLORS) {
    add(c, '0');
    for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'S', 'V', 'D2']) { add(c, v); add(c, v); }
  }
  for (let i = 0; i < 4; i++) { add(null, 'W'); add(null, 'W4'); }
  return cards;
}
export const cardValue = card => card.v === 'W' || card.v === 'W4' ? 50 : ['S', 'V', 'D2'].includes(card.v) ? 20 : Number(card.v);
const isWild = card => card.v === 'W' || card.v === 'W4';

/** Whether `card` may go on the pile (W4 also needs no card of the current colour in hand). */
export function playable(card, match, hand) {
  if (card.v === 'W') return true;
  if (card.v === 'W4') return !match.color || !hand.some(other => other.id !== card.id && other.c === match.color);
  if (!match.color) return true;
  return card.c === match.color || (!isWild(match.top) && card.v === match.top.v);
}

function draw(match, seat, count) {
  const got = [];
  for (let i = 0; i < count; i++) {
    if (!match.stock.length) {
      if (match.pile.length <= 1) break;                       // nothing left to reshuffle
      const top = match.pile.pop();
      match.stock = shuffle(match.pile, match.random);
      match.pile = [top];
      match.reshuffles = (match.reshuffles || 0) + 1;
    }
    const card = match.stock.shift();
    match.hands[seat].push(card); got.push(card);
  }
  return got;
}

export function deal(players, options, random, previous = null) {
  const n = players.length;
  if (n < 2 || n > 10) throw new GameError('¡Última! se juega de 2 a 10 personas.');
  let stock = shuffle(ultimaDeck(), random);
  const hands = players.map(() => []);
  for (let round = 0; round < 7; round++) for (let s = 0; s < n; s++) hands[s].push(stock.shift());
  // The first card of the pile cannot be a Comodín +4.
  let first = stock.shift();
  while (first.v === 'W4') { stock.push(first); stock = shuffle(stock, random); first = stock.shift(); }
  const handNo = previous ? previous.handNo + 1 : 1;
  const dealer = (handNo - 1) % n;
  const match = {
    game: 'ultima', players: [...players], options: meta.sanitize(options), hands, stock, pile: [first], top: first,
    color: first.c, direction: 1, turn: nextSeat(dealer, n), drawn: null, declared: [], vulnerable: null,
    scores: previous ? [...previous.scores] : players.map(() => 0), handNo, phase: 'play', seq: 0, lastAction: { type: 'start', card: first }, lastHand: previous?.lastHand || null
  };
  // The opening card acts on the first player.
  if (first.v === 'S') match.turn = nextSeat(match.turn, n);
  else if (first.v === 'V') { match.direction = -1; match.turn = dealer; }   // the dealer starts, play goes the other way
  else if (first.v === 'D2') { match.random = random; draw(match, match.turn, 2); delete match.random; match.turn = nextSeat(match.turn, n); }
  return match;
}

const advance = (match, steps = 1) => { for (let i = 0; i < steps; i++) match.turn = nextSeat(match.turn, match.players.length, match.direction); };

export function act(input, userId, move, random) {
  const match = clone(input), seat = seatOf(match, userId), n = match.players.length;
  match.random = random;
  try {
    if (move?.type === 'next') {
      if (match.phase !== 'handOver') throw new GameError('La mano todavía no termina.');
      return deal(match.players, match.options, random, match);
    }
    if (match.phase !== 'play') throw new GameError('La partida terminó.');
    if (move?.type === 'ultima') {
      if (match.hands[seat].length > 2) throw new GameError('Solo puedes decir ¡Última! con dos cartas o menos.');
      if (!match.declared.includes(seat)) match.declared.push(seat);
      if (match.vulnerable === seat) match.vulnerable = null;
      match.seq++; match.lastAction = { seat, type: 'ultima' };
      return match;
    }
    if (move?.type === 'catch') {
      const target = match.vulnerable;
      if (target === null || target === seat) throw new GameError('No hay a quién pillar.');
      draw(match, target, 2);
      match.vulnerable = null;
      match.declared = match.declared.filter(s => s !== target);
      match.seq++; match.lastAction = { seat, type: 'catch', target };
      return match;
    }
    if (match.turn !== seat) throw new GameError('Todavía no es tu turno.');
    // The chance to catch the previous player ends when the next one acts.
    if (match.vulnerable !== null && match.vulnerable !== seat) match.vulnerable = null;
    if (move?.type === 'draw') {
      if (match.drawn !== null) throw new GameError('Ya robaste: juega esa carta o pasa.');
      const [card] = draw(match, seat, 1);
      match.declared = match.declared.filter(s => s !== seat);
      match.seq++; match.lastAction = { seat, type: 'draw' };
      if (card && playable(card, match, match.hands[seat])) match.drawn = card.id;
      else advance(match);
      return match;
    }
    if (move?.type === 'pass') {
      if (match.drawn === null) throw new GameError('Primero roba una carta.');
      match.drawn = null; advance(match);
      match.seq++; match.lastAction = { seat, type: 'pass' };
      return match;
    }
    if (move?.type !== 'play') throw new GameError('Jugada no válida.');
    const hand = match.hands[seat];
    const card = hand.find(c => c.id === move.card);
    if (!card) throw new GameError('Esa carta no está en tu mano.');
    if (match.drawn !== null && card.id !== match.drawn) throw new GameError('Después de robar solo puedes jugar la carta que robaste.');
    if (!playable(card, match, hand)) throw new GameError(card.v === 'W4' ? 'El +4 solo se juega si no tienes cartas del color que va.' : 'Esa carta no calza con la de arriba.');
    if (isWild(card) && !COLORS.includes(move.color)) throw new GameError('Elige un color.');
    takeCard(hand, card.id);
    if (move.ultima && hand.length <= 1 && !match.declared.includes(seat)) match.declared.push(seat);
    match.pile.push(card); match.top = card; match.color = isWild(card) ? move.color : card.c; match.drawn = null;
    match.seq++; match.lastAction = { seat, type: 'play', card, color: match.color };
    if (hand.length === 1 && !match.declared.includes(seat)) match.vulnerable = seat;
    if (hand.length !== 1) match.declared = match.declared.filter(s => s !== seat);
    // Effects.
    if (card.v === 'V') { match.direction *= -1; if (n === 2) advance(match); }
    if (card.v === 'S') advance(match);
    if (card.v === 'D2' || card.v === 'W4') { advance(match); draw(match, match.turn, card.v === 'D2' ? 2 : 4); match.lastAction.victim = match.turn; }
    if (!hand.length) { finishHand(match, seat); return match; }
    advance(match);
    return match;
  } finally { delete match.random; }
}

function finishHand(match, winner) {
  const points = match.hands.reduce((sum, hand) => sum + hand.reduce((s, c) => s + cardValue(c), 0), 0);
  match.scores[winner] += points;
  match.lastHand = { winner, points };
  match.vulnerable = null;
  const target = match.options.target;
  match.phase = !target || match.scores[winner] >= target ? 'finished' : 'handOver';
  match.champion = match.phase === 'finished' ? winner : null;
}

export const turnOf = match => match.phase === 'play' ? match.players[match.turn] : null;

export function view(match, userId) {
  const seat = match.players.indexOf(userId), hand = seat >= 0 ? match.hands[seat] : [];
  const mine = match.phase === 'play' && match.turn === seat;
  return {
    game: 'ultima', phase: match.phase, seat, players: match.players, turn: match.turn, direction: match.direction,
    hand, playable: mine ? hand.filter(c => (match.drawn === null || c.id === match.drawn) && playable(c, match, hand)).map(c => c.id) : [],
    counts: match.hands.map(h => h.length), stock: match.stock.length, top: match.top, color: match.color, pileSize: match.pile.length,
    drawn: mine ? match.drawn : null, declared: match.declared, vulnerable: match.vulnerable,
    scores: match.scores, target: match.options.target, handNo: match.handNo, lastHand: match.lastHand, lastAction: match.lastAction,
    champion: match.champion ?? null, revealed: match.phase !== 'play' ? match.hands : undefined, seq: match.seq
  };
}

export function autoMove(match, userId) {
  if (match.phase === 'handOver') return { type: 'next' };
  const seat = match.players.indexOf(userId), hand = match.hands[seat];
  const options = hand.filter(c => (match.drawn === null || c.id === match.drawn) && playable(c, match, hand));
  if (!options.length) return match.drawn !== null ? { type: 'pass' } : { type: 'draw' };
  const card = options.find(c => !isWild(c)) || options[0];
  const counts = COLORS.map(color => hand.filter(c => c.c === color).length);
  const color = COLORS[counts.indexOf(Math.max(...counts))];
  return { type: 'play', card: card.id, color, ultima: hand.length === 2 };
}

export function result(match) {
  if (match.phase !== 'finished') return null;
  const winner = match.players[match.champion];
  return { winners: [winner], losers: match.players.filter(id => id !== winner) };
}
