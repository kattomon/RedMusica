// Brisca (Chilean rules) with the Spanish deck.
// 2 or 3 players alone, 4 in pairs, 6 in teams of three (with 8s and 9s). Three cards each; the
// next card is turned up (la muestra) and sets the trump suit; it is the last card drawn.
// You do not have to follow suit. A trick goes to the highest trump, otherwise to the highest card
// of the suit led. After each trick everyone draws one card, the winner first.
// Points: As 11, Tres 10, Rey 4, Caballo 3, Sota 2 (120 in total). More than 60 wins the hand.
// La muestra can be exchanged by someone who has won a trick: with the 7 of trump if it is
// higher than a 7, otherwise with the 2.
import { GameError, shuffle, spanishDeck, nextSeat, takeCard, clone, seatOf } from './cards.js';

const ORDER = [1, 3, 12, 11, 10, 9, 8, 7, 6, 5, 4, 2];          // strongest first
const strength = card => ORDER.length - ORDER.indexOf(card.r);
export const POINTS = Object.freeze({ 1: 11, 3: 10, 12: 4, 11: 3, 10: 2 });
export const cardPoints = card => POINTS[card.r] || 0;

export const meta = Object.freeze({
  id: 'brisca', name: 'Brisca', minPlayers: 2, maxPlayers: 6, allowed: [2, 3, 4, 6],
  defaults: { target: 1 },
  sanitize(options = {}) { return { target: [1, 2, 3].includes(Number(options.target)) ? Number(options.target) : 1 }; }
});

function teamsFor(n) {
  if (n === 4) return [[0, 2], [1, 3]];
  if (n === 6) return [[0, 2, 4], [1, 3, 5]];
  return Array.from({ length: n }, (_, i) => [i]);
}
const teamOf = (match, seat) => match.teams.findIndex(team => team.includes(seat));

export function deal(players, options, random, previous = null) {
  const n = players.length;
  if (!meta.allowed.includes(n)) throw new GameError('La brisca se juega con 2, 3, 4 o 6 personas.');
  let deck = spanishDeck(n === 6);
  if (n === 3) deck = deck.filter(card => !(card.r === 2 && card.s === 'O')); // 39 cards, 13 tricks
  deck = shuffle(deck, random);
  const hands = players.map(() => []);
  for (let round = 0; round < 3; round++) for (let s = 0; s < n; s++) hands[s].push(deck.shift());
  const muestra = deck[0];
  const stock = [...deck.slice(1), muestra];               // the turned card is drawn last
  const handNo = previous ? previous.handNo + 1 : 1;
  const leader = (handNo - 1) % n;
  const teams = teamsFor(n);
  return {
    game: 'brisca', players: [...players], options: meta.sanitize(options), teams, hands, stock,
    muestra: { ...muestra }, trump: muestra.s, trick: [], leader, turn: leader, seq: 0,
    captured: teams.map(() => []), wonTrick: players.map(() => false), lastTrick: null,
    handNo, score: previous ? [...previous.score] : teams.map(() => 0), phase: 'play', lastHand: previous?.lastHandSummary || null
  };
}

function trickWinner(trick, trump) {
  let best = trick[0];
  for (const play of trick.slice(1)) {
    const a = play.card, b = best.card;
    // Same suit: the stronger card. A trump beats any non-trump. Anything else cannot win.
    if ((a.s === b.s && strength(a) > strength(b)) || (a.s === trump && b.s !== trump)) best = play;
  }
  return best.seat;
}

export function canSwap(match, seat) {
  if (match.phase !== 'play' || !match.stock.length || !match.wonTrick[seat]) return null;
  const needRank = [10, 11, 12, 1, 3].includes(match.muestra.r) ? 7 : 2;
  if (needRank === match.muestra.r) return null;
  return match.hands[seat].find(card => card.s === match.trump && card.r === needRank) || null;
}

export function act(input, userId, move, random) {
  const match = clone(input), seat = seatOf(match, userId);
  if (move?.type === 'next') {
    if (match.phase !== 'handOver') throw new GameError('La mano todavía no termina.');
    return deal(match.players, match.options, random, match);
  }
  if (match.phase !== 'play') throw new GameError('La partida terminó.');
  if (move?.type === 'swap') {
    const card = canSwap(match, seat);
    if (!card) throw new GameError('No puedes cambiar la muestra ahora.');
    takeCard(match.hands[seat], card.id);
    match.hands[seat].push(match.stock.pop());
    match.stock.push(card); match.muestra = { ...card };
    match.seq++; match.lastAction = { seat, type: 'swap' };
    return match;
  }
  if (move?.type !== 'play') throw new GameError('Jugada no válida.');
  if (match.turn !== seat) throw new GameError('Todavía no es tu turno.');
  const card = takeCard(match.hands[seat], move.card);
  match.trick.push({ seat, card });
  match.seq++; match.lastAction = { seat, type: 'play', card };
  if (match.trick.length < match.players.length) { match.turn = nextSeat(seat, match.players.length); return match; }
  const winner = trickWinner(match.trick, match.trump), team = teamOf(match, winner);
  match.captured[team].push(...match.trick.map(p => p.card));
  match.wonTrick[winner] = true;
  match.lastTrick = { cards: match.trick, winner, points: match.trick.reduce((sum, p) => sum + cardPoints(p.card), 0) };
  match.trick = [];
  if (match.stock.length) for (let i = 0; i < match.players.length; i++) match.hands[(winner + i) % match.players.length].push(match.stock.shift());
  if (!match.stock.length) match.muestra = { ...match.muestra, drawn: true };
  match.leader = winner; match.turn = winner;
  if (match.hands.every(hand => !hand.length)) finishHand(match);
  return match;
}

function finishHand(match) {
  const points = match.captured.map(cards => cards.reduce((sum, card) => sum + cardPoints(card), 0));
  const top = Math.max(...points), leaders = points.flatMap((p, i) => p === top ? [i] : []);
  let winnerTeam = leaders.length === 1 ? leaders[0] : null;
  if (winnerTeam === null) {
    // Tie on points: most cards collected (Chilean rule); still tied → nobody scores.
    const counts = leaders.map(i => match.captured[i].length), most = Math.max(...counts);
    const byCards = leaders.filter((_, k) => counts[k] === most);
    winnerTeam = byCards.length === 1 ? byCards[0] : null;
  }
  if (winnerTeam !== null) match.score[winnerTeam]++;
  match.lastHandSummary = { points, winnerTeam };
  match.lastHand = match.lastHandSummary;
  const champion = match.score.findIndex(s => s >= match.options.target);
  match.phase = champion >= 0 ? 'finished' : 'handOver';
  match.champion = champion >= 0 ? champion : null;
  match.seq++;
}

export function turnOf(match) {
  if (match.phase === 'play') return match.players[match.turn];
  return null;
}

export function view(match, userId) {
  const seat = match.players.indexOf(userId);
  const over = match.phase !== 'play';
  return {
    game: 'brisca', phase: match.phase, seat, players: match.players, teams: match.teams, turn: match.turn, leader: match.leader,
    hand: seat >= 0 ? match.hands[seat] : [], counts: match.hands.map(h => h.length), stock: match.stock.length,
    muestra: match.muestra, trump: match.trump, trick: match.trick, lastTrick: match.lastTrick, captured: match.captured.map(c => c.length),
    points: over ? match.captured.map(cards => cards.reduce((s, c) => s + cardPoints(c), 0)) : null,
    myPoints: seat >= 0 ? match.captured[teamOf(match, seat)].reduce((s, c) => s + cardPoints(c), 0) : null,
    score: match.score, target: match.options.target, handNo: match.handNo, lastHand: match.lastHand,
    canSwap: seat >= 0 && !!canSwap(match, seat), champion: match.champion ?? null, seq: match.seq
  };
}

export function autoMove(match, userId) {
  if (match.phase === 'handOver') return { type: 'next' };
  const seat = match.players.indexOf(userId), hand = match.hands[seat];
  // Throw the cheapest card, keeping trumps when possible.
  const sorted = [...hand].sort((a, b) => (cardPoints(a) - cardPoints(b)) || ((a.s === match.trump) - (b.s === match.trump)) || (strength(a) - strength(b)));
  return { type: 'play', card: sorted[0].id };
}

export function result(match) {
  if (match.phase !== 'finished') return null;
  const winners = match.teams[match.champion].map(s => match.players[s]);
  return { winners, losers: match.players.filter(id => !winners.includes(id)) };
}
