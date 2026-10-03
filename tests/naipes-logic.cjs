const assert = require('node:assert/strict');
(async () => {
  const { GAMES } = await import('../supabase/functions/naipes/games.js');
  const B = GAMES.brisca, P = GAMES.potosucio, C = GAMES.carioca, U = GAMES.ultima;
  const seeded = seed => { let x = seed >>> 0 || 1; return n => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; }; };
  const ids = n => Array.from({ length: n }, (_, i) => 'p' + i);

  // Plays a whole game with automatic moves, checking cards are never lost or duplicated.
  function playOut(mod, n, seed, options = {}, total) {
    const random = seeded(seed);
    let match = mod.deal(ids(n), options, random), steps = 0;
    while (!mod.result(match)) {
      if (++steps > 60000) throw new Error(mod.meta.id + ' did not finish (seed ' + seed + ')');
      const who = mod.turnOf(match) || match.players[0];
      match = mod.act(match, who, mod.autoMove(match, who, random), random);
      if (total) assert.equal(total(match), total === null ? 0 : total(match));
    }
    return { match, steps };
  }
  const count = (...lists) => lists.flat(2).length;

  // ---------- Brisca ----------
  for (const n of [2, 3, 4, 6]) for (let seed = 1; seed <= 40; seed++) {
    const deckSize = n === 6 ? 48 : n === 3 ? 39 : 40;
    const { match } = playOut(B, n, seed * 7 + n, { target: 2 }, m => {
      const cards = count(m.hands, m.stock, m.trick.map(p => p.card), m.captured);
      if (m.phase === 'play') assert.equal(cards, deckSize, 'brisca keeps every card');
      return 0;
    });
    assert.ok(match.score.some(s => s >= 2));
    assert.ok(B.result(match).winners.length === (n === 4 ? 2 : n === 6 ? 3 : 1));
  }
  {
    let m = B.deal(['a', 'b'], {}, seeded(3));
    assert.equal(m.hands[0].length, 3); assert.equal(m.stock.length, 34); assert.equal(m.stock.at(-1).id, m.muestra.id, 'la muestra is drawn last');
    assert.throws(() => B.act(m, 'b', { type: 'play', card: m.hands[1][0].id }), /turno/);
    // Trick rules: trump beats, otherwise highest of the suit led wins; 3 beats rey.
    m.trump = 'O'; m.hands[0] = [{ id: 900, r: 12, s: 'C' }]; m.hands[1] = [{ id: 901, r: 3, s: 'C' }];
    m = B.act(m, 'a', { type: 'play', card: 900 }); m = B.act(m, 'b', { type: 'play', card: 901 });
    assert.equal(m.lastTrick.winner, 1); assert.equal(m.lastTrick.points, 14); assert.equal(m.turn, 1, 'the winner leads');
    assert.equal(m.hands[1].length, 1, 'everyone draws after the trick');
    let t = B.deal(['a', 'b'], {}, seeded(4)); t.trump = 'O'; t.hands[0] = [{ id: 910, r: 1, s: 'E' }]; t.hands[1] = [{ id: 911, r: 2, s: 'O' }];
    t = B.act(t, 'a', { type: 'play', card: 910 }); t = B.act(t, 'b', { type: 'play', card: 911 });
    assert.equal(t.lastTrick.winner, 1, 'the 2 of trump beats the ace of another suit');
    let o = B.deal(['a', 'b'], {}, seeded(5)); o.hands[0] = [{ id: 920, r: 1, s: 'E' }]; o.hands[1] = [{ id: 921, r: 3, s: 'B' }]; o.trump = 'O';
    o = B.act(o, 'a', { type: 'play', card: 920 }); o = B.act(o, 'b', { type: 'play', card: 921 });
    assert.equal(o.lastTrick.winner, 0, 'a different non-trump suit cannot win');
    // Swapping la muestra needs a won trick and the right card.
    let s = B.deal(['a', 'b'], {}, seeded(6)); s.muestra = { id: 930, r: 1, s: 'O' }; s.stock[s.stock.length - 1] = s.muestra; s.trump = 'O';
    s.hands[0] = [{ id: 931, r: 7, s: 'O' }, ...s.hands[0].slice(1)];
    assert.throws(() => B.act(s, 'a', { type: 'swap' }), /No puedes/);
    s.wonTrick[0] = true; s = B.act(s, 'a', { type: 'swap' });
    assert.ok(s.hands[0].some(c => c.id === 930)); assert.equal(s.muestra.id, 931); assert.equal(s.stock.at(-1).id, 931);
    const v = B.view(s, 'b'); assert.equal(v.hand.length, 3); assert.equal(v.points, null, 'points stay hidden during the hand');
    assert.ok(!JSON.stringify(v).includes('"hands"'), 'other hands are not sent');
  }

  // ---------- Poto Sucio ----------
  for (const n of [2, 3, 5, 8]) for (let seed = 1; seed <= 40; seed++) {
    const { match } = playOut(P, n, seed * 13 + n, {}, m => { assert.equal(count(m.hands, m.discarded), 53); return 0; });
    assert.equal(match.hands[match.loser].length, 1); assert.equal(match.hands[match.loser][0].r, 'JK', 'the poto sucio keeps the joker');
    assert.ok(match.hands.every(h => new Set(h.filter(c => c.r !== 'JK').map(c => c.r)).size === h.filter(c => c.r !== 'JK').length), 'no pairs left in any hand');
  }
  {
    const m = P.deal(['a', 'b', 'c'], {}, seeded(9));
    for (const hand of m.hands) { const ranks = hand.filter(c => c.r !== 'JK').map(c => c.r); assert.equal(new Set(ranks).size, ranks.length, 'pairs are put down at the start'); }
    const v = P.view(m, 'a'); assert.ok(!JSON.stringify(v).includes('"hands"'));
    const drawer = m.players[m.turn], victim = m.players[m.from], third = m.players.find(id => id !== drawer && id !== victim);
    const jk = m.hands[m.from].findIndex(c => c.r === 'JK');
    if (jk >= 0) { const after = P.act(m, drawer, { type: 'draw', index: jk }, seeded(2)); assert.equal(P.view(after, drawer).lastAction.joker, true); assert.equal(P.view(after, third).lastAction.joker, undefined, 'others do not learn where the joker went'); }
    assert.throws(() => P.act(m, m.players[m.from], { type: 'draw', index: 0 }), /turno/);
    assert.throws(() => P.act(m, m.players[m.turn], { type: 'draw', index: 99 }), /Elige/);
  }

  // ---------- ¡Última! ----------
  assert.equal(U.ultimaDeck().length, 108);
  for (const n of [2, 3, 4, 7, 10]) for (let seed = 1; seed <= 40; seed++) {
    const { match } = playOut(U, n, seed * 17 + n, { target: n <= 4 ? 200 : 0 }, m => { assert.equal(count(m.hands, m.stock, m.pile), 108); return 0; });
    assert.ok(U.result(match).winners.length === 1);
  }
  {
    let m = U.deal(['a', 'b', 'c'], {}, seeded(21));
    m.top = { id: 500, c: 'R', v: '5' }; m.color = 'R'; m.turn = 0; m.drawn = null; m.direction = 1;
    m.hands[0] = [{ id: 501, c: 'G', v: '5' }, { id: 502, c: 'B', v: '7' }, { id: 503, c: null, v: 'W4' }, { id: 504, c: 'R', v: 'S' }];
    assert.throws(() => U.act(m, 'a', { type: 'play', card: 502 }), /no calza/);
    assert.throws(() => U.act(m, 'a', { type: 'play', card: 503, color: 'B' }), /\+4 solo/, 'the +4 needs no card of the current colour');
    const skip = U.act(m, 'a', { type: 'play', card: 504 }); assert.equal(skip.turn, 2, 'Salta skips the next player');
    const same = U.act(m, 'a', { type: 'play', card: 501 }); assert.equal(same.color, 'G', 'matching the number changes the colour');
    // Reversa, +2 and wild colour.
    let r = U.act({ ...m, hands: [[{ id: 510, c: 'R', v: 'V' }, { id: 511, c: 'R', v: '1' }], ...m.hands.slice(1)] }, 'a', { type: 'play', card: 510 });
    assert.equal(r.direction, -1); assert.equal(r.turn, 2);
    const before = m.hands[1].length;
    let d = U.act({ ...m, hands: [[{ id: 520, c: 'R', v: 'D2' }, { id: 521, c: 'B', v: '1' }], ...m.hands.slice(1)] }, 'a', { type: 'play', card: 520 });
    assert.equal(d.hands[1].length, before + 2); assert.equal(d.turn, 2, '+2 makes the next player draw and lose the turn');
    let w = U.act({ ...m, hands: [[{ id: 530, c: null, v: 'W' }, { id: 531, c: 'B', v: '1' }], ...m.hands.slice(1)] }, 'a', { type: 'play', card: 530, color: 'Y' });
    assert.equal(w.color, 'Y');
    assert.throws(() => U.act({ ...m, hands: [[{ id: 540, c: null, v: 'W' }], ...m.hands.slice(1)] }, 'a', { type: 'play', card: 540 }), /Elige un color/);
    // ¡Última! and catching.
    let u = { ...m, hands: [[{ id: 550, c: 'R', v: '1' }, { id: 551, c: 'B', v: '2' }], ...m.hands.slice(1)] };
    let caught = U.act(u, 'a', { type: 'play', card: 550 });
    assert.equal(caught.vulnerable, 0, 'forgot to say ¡Última!');
    caught = U.act(caught, 'c', { type: 'catch' }); assert.equal(caught.hands[0].length, 3, 'caught: draws two');
    let safe = U.act(u, 'a', { type: 'play', card: 550, ultima: true }); assert.equal(safe.vulnerable, null);
    assert.throws(() => U.act(safe, 'c', { type: 'catch' }), /No hay a quién/);
    let late = U.act(u, 'a', { type: 'play', card: 550 }); late = U.act(late, 'b', { type: 'draw' });
    assert.equal(late.vulnerable, null, 'the chance to catch ends when the next player acts');
    // Drawing: a playable drawn card can be played or kept.
    let dr = { ...m, stock: [{ id: 560, c: 'R', v: '9' }, ...m.stock] };
    dr = U.act(dr, 'a', { type: 'draw' }); assert.equal(dr.drawn, 560); assert.equal(dr.turn, 0);
    assert.throws(() => U.act(dr, 'a', { type: 'play', card: 504 }), /solo puedes jugar la carta que robaste/);
    const passed = U.act(dr, 'a', { type: 'pass' }); assert.equal(passed.turn, 1);
    const view = U.view(dr, 'a'); assert.deepEqual(view.playable, [560]);
    assert.ok(!JSON.stringify(U.view(m, 'b')).includes('"hands"'));
  }

  // ---------- Carioca ----------
  const card = (r, s, id) => ({ id, r, s });
  const JK = id => ({ id, r: 'JK', s: '*' });
  assert.ok(C.analyze([card('7', 'S', 1), card('7', 'H', 2), card('7', 'D', 3)], 'trio'));
  assert.ok(C.analyze([card('7', 'S', 1), card('7', 'H', 2), JK(3)], 'trio'));
  assert.equal(C.analyze([card('7', 'S', 1), JK(2), JK(3)], 'trio'), null, 'one joker at most');
  assert.equal(C.analyze([card('7', 'S', 1), card('8', 'S', 2), card('7', 'D', 3)], 'trio'), null);
  assert.ok(C.analyze([card('9', 'H', 1), card('10', 'H', 2), card('J', 'H', 3), card('Q', 'H', 4)], 'escala'));
  assert.ok(C.analyze([card('Q', 'H', 1), card('K', 'H', 2), card('A', 'H', 3), card('J', 'H', 4)], 'escala'), 'ace high');
  assert.ok(C.analyze([card('A', 'H', 1), card('2', 'H', 2), card('3', 'H', 3), card('4', 'H', 4)], 'escala'), 'ace low');
  assert.equal(C.analyze([card('K', 'H', 1), card('A', 'H', 2), card('2', 'H', 3), card('3', 'H', 4)], 'escala'), null, 'no wrapping');
  const gap = C.analyze([card('5', 'C', 1), JK(2), card('7', 'C', 3), card('8', 'C', 4)], 'escala');
  assert.equal(gap.cards[1].as, 6, 'the joker fills the gap');
  assert.equal(C.analyze([card('5', 'C', 1), card('6', 'H', 2), card('7', 'C', 3), card('8', 'C', 4)], 'escala'), null, 'same suit');
  const hand = [card('4', 'S', 1), card('4', 'H', 2), card('4', 'D', 3), card('9', 'C', 4), card('9', 'S', 5), JK(6), card('5', 'H', 7), card('6', 'H', 8), card('7', 'H', 9), card('K', 'D', 10)];
  const found = C.findContract(hand, { t: 2, e: 0 }); assert.equal(found.length, 2);
  assert.ok(C.findContract(hand, { t: 1, e: 1 }), 'trío + escala with the joker');
  assert.equal(C.findContract(hand, { t: 0, e: 2 }), null);
  for (const n of [2, 3, 4, 6]) for (let seed = 1; seed <= 12; seed++) {
    const { match } = playOut(C, n, seed * 29 + n, { rounds: 4 }, m => {
      if (m.phase === 'play') assert.equal(count(m.hands, m.stock, m.pile, m.melds.map(x => x.cards)), 108, 'carioca keeps every card');
      return 0;
    });
    assert.ok(match.champions.length >= 1);
  }
  {
    let m = C.deal(['a', 'b'], {}, seeded(41)); m.turn = 0;
    m.hands[0] = [card('4', 'S', 901), card('4', 'H', 902), card('4', 'D', 903), card('9', 'C', 904), card('9', 'S', 905), JK(906), card('2', 'C', 907)];
    assert.throws(() => C.act(m, 'a', { type: 'discard', card: 907 }), /Primero roba/);
    m = C.act(m, 'a', { type: 'draw', from: 'stock' });
    assert.throws(() => C.act(m, 'a', { type: 'down', groups: [[901, 902, 903]] }), /exactamente 2 tríos/);
    m = C.act(m, 'a', { type: 'down', groups: [[901, 902, 903], [904, 905, 906]] });
    assert.equal(m.melds.length, 2); assert.equal(m.down[0], true);
    assert.throws(() => C.act(m, 'a', { type: 'add', meld: m.melds[0].id, cards: [907] }), /próximo turno/);
    m = C.act(m, 'a', { type: 'discard', card: m.hands[0][0].id });
    assert.equal(m.turn, 1); assert.equal(m.step, 'draw');
    const v = C.view(m, 'b'); assert.ok(!JSON.stringify(v).includes('"hands"')); assert.equal(v.contractText, '2 tríos');
  }

  console.log('PASS naipes logic');
})().catch(error => { console.error(error); process.exit(1); });
