const assert = require('node:assert/strict');
(async () => {
  const L = await import('../supabase/functions/bachillerato/logic.js');

  // Normalization: accents, case, ñ, symbols.
  assert.equal(L.normalize('  Ñandú  Árbol!! '), 'ñandu arbol');
  assert.equal(L.normalize('Pérez'), 'perez', 'decomposed accents');
  assert.equal(L.comparable('La Uvas'), 'uva');
  assert.equal(L.comparable('Los Jaivas'), 'jaiva');
  assert.equal(L.comparable('El'), 'el', 'a lone article stays');
  assert.equal(L.startsWithLetter('Ñandú', 'Ñ'), true);
  assert.equal(L.startsWithLetter('Nandú', 'Ñ'), false);
  assert.equal(L.startsWithLetter('Árbol', 'A'), true);
  assert.equal(L.startsWithLetter('  ', 'A'), false);
  assert.equal(L.cleanText('a‮b\n  c', 10), 'ab c', 'control and bidi characters are removed');

  // Settings are sanitized.
  const s = L.sanitizeSettings({ categories: ['Animal', 'animal', ' Color ', 'x'.repeat(50), '', 'País'], rounds: 99, roundSeconds: 90, bastaSeconds: 0, hardLetters: 'yes' });
  assert.deepEqual(s.categories, ['Animal', 'Color', 'x'.repeat(30), 'País']);
  assert.equal(s.rounds, 5); assert.equal(s.roundSeconds, 90); assert.equal(s.bastaSeconds, 0); assert.equal(s.hardLetters, false);
  assert.deepEqual(L.sanitizeSettings({ categories: ['a', 'b'] }).categories, [...L.DEFAULT_CATEGORIES], 'too few categories fall back to defaults');
  assert.equal(L.sanitizeSettings({ categories: Array.from({ length: 20 }, (_, i) => 'Cat ' + i) }).categories.length, 12);

  // Letters do not repeat and hard letters are excluded by default.
  const settings = L.sanitizeSettings({ rounds: 10 });
  let seq = 0; const random = n => (seq++ * 7) % n;
  let state = { status: 'playing', settings, game: L.newGame('g1', settings, 1000, random) };
  const letters = [state.game.letter];
  for (let r = 2; r <= 10; r++) { state = L.nextRound(state, 1000, random); letters.push(state.game.letter); }
  assert.equal(new Set(letters).size, 10, 'no repeated letters');
  assert.ok(letters.every(l => !L.HARD_LETTERS.includes(l)));
  assert.equal(state.game.round, 10);

  // Basta: needs every category with the right letter; shortens the clock.
  state = { status: 'playing', settings: L.sanitizeSettings({ categories: ['Nombre', 'Animal', 'Color'], bastaSeconds: 10 }), game: null };
  state.game = L.newGame('g2', state.settings, 0, () => 0); // letter A
  assert.equal(state.game.letter, 'A');
  const start = state.game.startsAt;
  assert.throws(() => L.applyBasta(state, 'u1', ['Ana', 'Araña', 'Azul'], start - 10), /girando/);
  assert.throws(() => L.applyBasta(state, 'u1', ['Ana', '', 'Azul'], start + 1000), /completa todas/);
  assert.throws(() => L.applyBasta(state, 'u1', ['Ana', 'Perro', 'Azul'], start + 1000), /letra A/);
  const basta = L.applyBasta(state, 'u1', ['Ana', 'Araña', 'Azul'], start + 1000);
  assert.equal(basta.game.bastaBy, 'u1'); assert.equal(basta.game.endsAt, start + 11000);
  assert.equal(L.applyBasta(basta, 'u2', ['Ana', 'Araña', 'Azul'], start + 2000).game.bastaBy, 'u1', 'only the first basta counts');
  assert.equal(L.acceptsAnswers(basta, start + 11000 + L.GRACE_MS), true);
  assert.equal(L.acceptsAnswers(basta, start + 11000 + L.GRACE_MS + 1), false);
  assert.equal(L.canAdvance(basta, start + 11000), false);
  assert.equal(L.canAdvance(basta, start + 11000 + L.GRACE_MS), true);
  const review = L.toReview(basta, 50000);
  assert.equal(review.status, 'review');
  assert.equal(L.canAdvance(review, 50001), false);
  assert.equal(L.canAdvance(review, 50001, { allReady: true }), true);
  assert.equal(L.canAdvance(review, 50001, { isHost: true }), true);
  assert.equal(L.canAdvance(review, 50000 + 60000), true);

  // Scoring: 20 only answer, 10 unique, 5 repeated, 0 empty / wrong letter / rejected.
  const categories = ['Nombre', 'Animal', 'Color', 'País'];
  const answers = {
    ana: ['Andrea', 'Araña', 'Azul', 'Argentina'],
    beto: ['Alberto', 'Arañas', '', 'Alemania'],
    caro: ['Andrea', 'Perro', 'Amarillo', 'Argentína']
  };
  let r = L.scoreRound({ categories, letter: 'A', answers, voters: ['ana', 'beto', 'caro'] });
  assert.deepEqual(r.status.ana, ['repetida', 'repetida', 'original', 'repetida']);
  assert.deepEqual(r.status.beto, ['original', 'repetida', 'vacia', 'original']);
  assert.deepEqual(r.status.caro, ['repetida', 'letra', 'original', 'repetida']);
  assert.deepEqual(r.points.ana, [5, 5, 10, 5]);
  assert.equal(r.totals.beto, 10 + 5 + 0 + 10);
  // Only answer in a category gets 20.
  r = L.scoreRound({ categories: ['Animal'], letter: 'Z', answers: { a: ['Zorro'], b: [''], c: ['Perro'] }, voters: ['a', 'b', 'c'] });
  assert.deepEqual([r.points.a[0], r.points.b[0], r.points.c[0]], [20, 0, 0]);
  // Rejection needs a strict majority of the other eligible voters.
  r = L.scoreRound({ categories, letter: 'A', answers, voters: ['ana', 'beto', 'caro'], rejects: { beto: ['ana:2'] } });
  assert.equal(r.status.ana[2], 'original', 'one of two other voters is not a majority');
  r = L.scoreRound({ categories, letter: 'A', answers, voters: ['ana', 'beto', 'caro'], rejects: { beto: ['ana:2'], caro: ['ana:2', 'ana:2'] } });
  assert.equal(r.status.ana[2], 'rechazada'); assert.equal(r.rejections['ana:2'], 2);
  assert.equal(r.status.caro[2], 'unica', 'with the other one rejected, Amarillo is the only valid color');
  r = L.scoreRound({ categories, letter: 'A', answers, voters: ['ana', 'beto', 'caro'], rejects: { ana: ['ana:0'] } });
  assert.equal(r.status.ana[0], 'repetida', 'you cannot reject your own answer');
  // Two players: the other one alone decides.
  r = L.scoreRound({ categories: ['Cosa'], letter: 'M', answers: { a: ['Mesa'], b: ['Mapa'] }, voters: ['a', 'b'], rejects: { b: ['a:0'] } });
  assert.deepEqual([r.status.a[0], r.status.b[0]], ['rechazada', 'unica']);
  // Solo player: nobody can reject.
  r = L.scoreRound({ categories: ['Cosa'], letter: 'M', answers: { a: ['Mesa'] }, voters: ['a'] });
  assert.equal(r.points.a[0], 20);
  // Many players work and stay quick.
  const many = {}; for (let i = 0; i < 300; i++) many['p' + i] = ['Mesa' + (i % 40), 'Mono', '', 'Mx'];
  const t = Date.now(); r = L.scoreRound({ categories, letter: 'M', answers: many, voters: Object.keys(many) });
  assert.ok(Date.now() - t < 500); assert.equal(r.status.p0[1], 'repetida'); assert.equal(r.status.p0[0], 'repetida');

  // Finishing: winners are the top totals (ties share), nobody wins with 0.
  const fin = L.afterScoring({ status: 'review', settings, game: { ...state.game, round: 3, totalRounds: 3, history: [] } }, { round: 3 }, 0,
    L.rank([{ user_id: 'a', username: 'A', total: 30 }, { user_id: 'b', username: 'B', total: 30 }, { user_id: 'c', username: 'C', total: 5 }]));
  assert.equal(fin.status, 'finished'); assert.deepEqual(fin.game.winners, ['a', 'b']);
  const mid = L.afterScoring({ status: 'review', settings, game: { ...state.game, round: 1, totalRounds: 3, history: [] } }, { round: 1 }, 100, []);
  assert.equal(mid.status, 'scores'); assert.equal(mid.game.nextAt, 100 + L.SCORES_MS);
  assert.equal(L.afterScoring({ status: 'review', settings, game: { ...state.game, round: 1, totalRounds: 1, history: [] } }, {}, 0, [{ user_id: 'a', total: 0 }]).game.winners.length, 0);

  console.log('PASS bachillerato logic');
})().catch(error => { console.error(error); process.exit(1); });
