// Carioca (Chilean rules): two English decks plus four jokers, 12 cards each round.
// Each round asks for a contract: 1) 2 tríos, 2) 1 trío y 1 escala, 3) 2 escalas, 4) 3 tríos,
// 5) 2 tríos y 1 escala, 6) 1 trío y 2 escalas, 7) 3 escalas, 8) 4 tríos.
// Trío: three or more cards of the same rank. Escala: four or more consecutive cards of the same suit
// (the ace goes low or high, never around the corner). At most one joker per combination.
// On your turn draw (from the deck or the discard pile), lay down the whole contract once you have it,
// from your next turn on add cards to any combination on the table, and discard one card.
// The round ends when someone runs out of cards; the others add up what they hold
// (2-10 face value, J/Q/K 10, A 20, joker 30). Lowest total after all rounds wins.
import { GameError, shuffle, frenchDeck, nextSeat, takeCard, clone, seatOf } from './cards.js';

export const CONTRACTS = Object.freeze([
  { t: 2, e: 0 }, { t: 1, e: 1 }, { t: 0, e: 2 }, { t: 3, e: 0 },
  { t: 2, e: 1 }, { t: 1, e: 2 }, { t: 0, e: 3 }, { t: 4, e: 0 }
]);
export function contractName({ t, e }) {
  const parts = [];
  if (t) parts.push(t === 1 ? '1 trío' : `${t} tríos`);
  if (e) parts.push(e === 1 ? '1 escala' : `${e} escalas`);
  return parts.join(' y ');
}
export const meta = Object.freeze({
  id: 'carioca', name: 'Carioca', minPlayers: 2, maxPlayers: 6, allowed: [2, 3, 4, 5, 6],
  defaults: { rounds: 8 },
  sanitize(options = {}) { return { rounds: [4, 8].includes(Number(options.rounds)) ? Number(options.rounds) : 8 }; }
});

const VALUE = { A: 1, J: 11, Q: 12, K: 13 };
export const rankValue = r => VALUE[r] ?? Number(r);
export const cardPenalty = card => card.r === 'JK' ? 30 : card.r === 'A' ? 20 : ['J', 'Q', 'K'].includes(card.r) ? 10 : Number(card.r);
const isJoker = card => card.r === 'JK';

/**
 * Checks a combination. Returns { type, cards (ordered), ... } or null.
 * Escalas come back ordered low → high with the joker in the gap (or at an end) it covers.
 */
export function analyze(cards, type) {
  const jokers = cards.filter(isJoker), naturals = cards.filter(c => !isJoker(c));
  if (jokers.length > 1) return null;
  if (type === 'trio') {
    if (cards.length < 3 || naturals.length < 2) return null;
    if (!naturals.every(c => c.r === naturals[0].r)) return null;
    return { type, rank: naturals[0].r, cards: [...naturals, ...jokers] };
  }
  if (type !== 'escala' || cards.length < 4 || naturals.length < 3) return null;
  const suit = naturals[0].s;
  if (!naturals.every(c => c.s === suit)) return null;
  for (const aceHigh of [false, true]) {
    const valued = naturals.map(c => ({ card: c, v: c.r === 'A' ? (aceHigh ? 14 : 1) : rankValue(c.r) })).sort((a, b) => a.v - b.v);
    if (new Set(valued.map(x => x.v)).size !== valued.length) continue;
    const low = valued[0].v, high = valued.at(-1).v, gaps = high - low + 1 - valued.length;
    if (gaps > jokers.length) continue;
    const ordered = [];
    let joker = jokers[0] || null, start = low, end = high;
    if (joker && gaps === 0) { if (high < 14) end = high + 1; else start = low - 1; }
    if (start < 1 || end > 14) continue;
    for (let v = start, i = 0; v <= end; v++) {
      if (valued[i]?.v === v) ordered.push(valued[i++].card);
      else if (joker) { ordered.push({ ...joker, as: v }); joker = null; }
      else { ordered.length = 0; break; }
    }
    if (ordered.length === cards.length) return { type, suit, low: start, high: end, cards: ordered };
  }
  return null;
}
export const classify = cards => analyze(cards, 'trio') || analyze(cards, 'escala');

/** Looks for a way to make `contract` with the cards in `hand`; returns groups of card ids or null. */
export function findContract(hand, contract) {
  const jokers = hand.filter(isJoker), naturals = hand.filter(c => !isJoker(c));
  const trios = [], escalas = [];
  const byRank = new Map();
  for (const c of naturals) byRank.set(c.r, [...(byRank.get(c.r) || []), c]);
  for (const cards of byRank.values()) {
    if (cards.length >= 3) trios.push(cards.slice(0, 3));
    if (cards.length >= 2 && jokers.length) trios.push([cards[0], cards[1], 'JK']);
    if (cards.length >= 6) trios.push(cards.slice(3, 6));
  }
  for (const suit of ['S', 'H', 'D', 'C']) {
    const own = naturals.filter(c => c.s === suit);
    const at = v => own.filter(c => (c.r === 'A' ? [1, 14] : [rankValue(c.r)]).includes(v));
    for (let start = 1; start <= 11; start++) {
      const slots = [0, 1, 2, 3].map(k => at(start + k));
      const missing = slots.filter(slot => !slot.length).length;
      if (missing === 0) {
        escalas.push(slots.map(slot => slot[0]));
        if (slots.some(slot => slot.length > 1)) escalas.push(slots.map(slot => slot.at(-1)));
      } else if (missing === 1) escalas.push(slots.map(slot => slot.length ? slot[0] : 'JK'));
    }
  }
  const jokerIds = jokers.map(j => j.id);
  function search(needT, needE, used, jokersLeft, chosen) {
    if (!needT && !needE) return chosen;
    const pool = needT ? trios : escalas;
    for (const option of pool) {
      const ids = option.filter(c => c !== 'JK').map(c => c.id), needJ = option.length - ids.length;
      if (needJ > jokersLeft.length || ids.some(id => used.has(id))) continue;
      const group = [...ids, ...jokersLeft.slice(0, needJ)];
      const found = search(needT ? needT - 1 : 0, needT ? needE : needE - 1, new Set([...used, ...ids]), jokersLeft.slice(needJ), [...chosen, group]);
      if (found) return found;
    }
    return null;
  }
  return search(contract.t, contract.e, new Set(), jokerIds, []);
}

export function deal(players, options, random, previous = null) {
  const n = players.length;
  if (n < 2 || n > 6) throw new GameError('El carioca se juega de 2 a 6 personas.');
  const round = previous ? previous.round + 1 : 1;
  let stock = shuffle(frenchDeck(2, 4), random);
  const hands = players.map(() => []);
  for (let k = 0; k < 12; k++) for (let s = 0; s < n; s++) hands[s].push(stock.shift());
  const pile = [stock.shift()];
  const dealer = (round - 1) % n;
  return {
    game: 'carioca', players: [...players], options: meta.sanitize(options), round, contract: CONTRACTS[round - 1],
    hands, stock, pile, melds: [], down: players.map(() => false), downAt: players.map(() => -1),
    turn: nextSeat(dealer, n), step: 'draw', turnCount: 0, totals: previous ? [...previous.totals] : players.map(() => 0),
    phase: 'play', seq: 0, lastAction: null, lastRound: previous?.lastRound || null, nextMeld: 1
  };
}

function refill(match, random) {
  if (match.stock.length) return;
  if (match.pile.length <= 1) throw new GameError('No quedan cartas para robar.');
  const top = match.pile.pop();
  match.stock = shuffle(match.pile, random); match.pile = [top];
}

export function act(input, userId, move, random) {
  const match = clone(input), seat = seatOf(match, userId);
  if (move?.type === 'next') {
    if (match.phase !== 'handOver') throw new GameError('La ronda todavía no termina.');
    return deal(match.players, match.options, random, match);
  }
  if (match.phase !== 'play') throw new GameError('La partida terminó.');
  if (match.turn !== seat) throw new GameError('Todavía no es tu turno.');
  const hand = match.hands[seat];
  if (move?.type === 'draw') {
    if (match.step !== 'draw') throw new GameError('Ya robaste en este turno.');
    if (move.from === 'pile') { if (!match.pile.length) throw new GameError('El pozo está vacío.'); hand.push(match.pile.pop()); }
    else { refill(match, random); hand.push(match.stock.shift()); }
    match.step = 'act'; match.seq++;
    match.lastAction = { seat, type: 'draw', from: move.from === 'pile' ? 'pile' : 'stock', card: move.from === 'pile' ? hand.at(-1) : null };
    return match;
  }
  if (match.step !== 'act') throw new GameError('Primero roba una carta.');
  if (move?.type === 'down') {
    if (match.down[seat]) throw new GameError('Ya te bajaste en esta ronda.');
    const groups = Array.isArray(move.groups) ? move.groups : [];
    const ids = groups.flat();
    if (new Set(ids).size !== ids.length) throw new GameError('Usaste la misma carta dos veces.');
    const cards = groups.map(group => group.map(id => { const c = hand.find(x => x.id === id); if (!c) throw new GameError('Esa carta no está en tu mano.'); return c; }));
    const melds = cards.map(group => classify(group));
    if (melds.some(m => !m)) throw new GameError('Alguna combinación no es un trío ni una escala válida.');
    const t = melds.filter(m => m.type === 'trio').length, e = melds.filter(m => m.type === 'escala').length;
    if (t !== match.contract.t || e !== match.contract.e) throw new GameError('Para bajarte necesitas exactamente ' + contractName(match.contract) + '.');
    for (const id of ids) takeCard(hand, id);
    for (const meld of melds) match.melds.push({ id: match.nextMeld++, owner: seat, ...meld });
    match.down[seat] = true; match.downAt[seat] = match.turnCount;
    match.seq++; match.lastAction = { seat, type: 'down' };
    if (!hand.length) finishRound(match, seat);
    return match;
  }
  if (move?.type === 'add') {
    if (!match.down[seat]) throw new GameError('Primero bájate con tu contrato.');
    if (match.downAt[seat] === match.turnCount) throw new GameError('Puedes pegar cartas desde tu próximo turno.');
    const meld = match.melds.find(m => m.id === Number(move.meld));
    if (!meld) throw new GameError('Elige una combinación de la mesa.');
    const ids = Array.isArray(move.cards) ? move.cards : [];
    if (!ids.length) throw new GameError('Elige las cartas que quieres pegar.');
    const added = ids.map(id => { const c = hand.find(x => x.id === id); if (!c) throw new GameError('Esa carta no está en tu mano.'); return c; });
    const merged = analyze([...meld.cards.map(({ as, ...c }) => c), ...added], meld.type);
    if (!merged) throw new GameError(meld.type === 'trio' ? 'Esa carta no sirve para ese trío.' : 'Esa carta no sigue esa escala.');
    for (const id of ids) takeCard(hand, id);
    Object.assign(meld, merged);
    match.seq++; match.lastAction = { seat, type: 'add', meld: meld.id };
    if (!hand.length) finishRound(match, seat);
    return match;
  }
  if (move?.type === 'discard') {
    const card = takeCard(hand, move.card);
    match.pile.push(card);
    match.seq++; match.lastAction = { seat, type: 'discard', card };
    if (!hand.length) { finishRound(match, seat); return match; }
    match.turn = nextSeat(seat, match.players.length); match.step = 'draw'; match.turnCount++;
    return match;
  }
  throw new GameError('Jugada no válida.');
}

function finishRound(match, winner) {
  const penalties = match.hands.map((hand, seat) => seat === winner ? 0 : hand.reduce((sum, c) => sum + cardPenalty(c), 0));
  penalties.forEach((p, seat) => { match.totals[seat] += p; });
  match.lastRound = { round: match.round, winner, penalties };
  match.phase = match.round >= match.options.rounds ? 'finished' : 'handOver';
  if (match.phase === 'finished') {
    const best = Math.min(...match.totals);
    match.champions = match.totals.flatMap((t, s) => t === best ? [s] : []);
  }
  match.seq++;
}

export const turnOf = match => match.phase === 'play' ? match.players[match.turn] : null;

export function view(match, userId) {
  const seat = match.players.indexOf(userId);
  return {
    game: 'carioca', phase: match.phase, seat, players: match.players, turn: match.turn, step: match.step,
    hand: seat >= 0 ? match.hands[seat] : [], counts: match.hands.map(h => h.length), stock: match.stock.length,
    top: match.pile.at(-1) || null, pileSize: match.pile.length, melds: match.melds, down: match.down,
    canAdd: seat >= 0 && match.down[seat] && match.downAt[seat] !== match.turnCount,
    round: match.round, rounds: match.options.rounds, contract: match.contract, contractText: contractName(match.contract),
    totals: match.totals, lastRound: match.lastRound, lastAction: match.lastAction, champions: match.champions || null,
    revealed: match.phase !== 'play' ? match.hands : undefined, seq: match.seq
  };
}

// Automatic move (used when a player runs out of time): keeps the cards that help the contract.
function fitsTable(match, card) {
  return match.melds.some(meld => analyze([...meld.cards.map(({ as, ...c }) => c), card], meld.type));
}
function usefulness(match, seat, card, hand) {
  if (match.down[seat]) return fitsTable(match, card) ? 100 : 0;
  if (isJoker(card)) return 100;
  const others = hand.filter(c => c.id !== card.id && !isJoker(c));
  const sameRank = others.filter(c => c.r === card.r).length;
  const values = c => c.r === 'A' ? [1, 14] : [rankValue(c.r)];
  const near = others.filter(c => c.s === card.s && values(c).some(v => values(card).some(w => v !== w && Math.abs(v - w) <= 2))).length;
  return (match.contract.t ? sameRank * 3 : 0) + (match.contract.e ? near * 2 : 0);
}
export function autoMove(match, userId) {
  if (match.phase === 'handOver') return { type: 'next' };
  const seat = match.players.indexOf(userId), hand = match.hands[seat];
  if (match.step === 'draw') {
    const top = match.pile.at(-1);
    const wants = top && (match.down[seat] ? fitsTable(match, top) : !!findContract([...hand, top], match.contract) || usefulness(match, seat, top, [...hand, top]) >= 6);
    return { type: 'draw', from: wants ? 'pile' : 'stock' };
  }
  if (!match.down[seat]) { const groups = findContract(hand, match.contract); if (groups) return { type: 'down', groups }; }
  else if (match.downAt[seat] !== match.turnCount) {
    for (const card of hand) for (const meld of match.melds) {
      if (analyze([...meld.cards.map(({ as, ...c }) => c), card], meld.type)) return { type: 'add', meld: meld.id, cards: [card.id] };
    }
  }
  const worst = [...hand].sort((a, b) => usefulness(match, seat, a, hand) - usefulness(match, seat, b, hand) || cardPenalty(b) - cardPenalty(a))[0];
  return { type: 'discard', card: worst.id };
}

export function result(match) {
  if (match.phase !== 'finished') return null;
  const winners = match.champions.map(s => match.players[s]);
  return { winners, losers: match.players.filter(id => !winners.includes(id)) };
}
