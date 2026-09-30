// Shared 8-ball engine. The Edge Function runs it to decide every shot and the
// browser runs the same code only to animate the result it receives.
// The simulation uses +, -, *, / and Math.sqrt only (all exactly specified by
// IEEE 754), so both runtimes produce identical trajectories from the same input.

export const TABLE = Object.freeze({ width: 1000, height: 500, radius: 11, headX: 250, footX: 750 });
export const POCKETS = Object.freeze([
  { x: 0, y: 0, r: 25 }, { x: 500, y: -2, r: 22 }, { x: 1000, y: 0, r: 25 },
  { x: 0, y: 500, r: 25 }, { x: 500, y: 502, r: 22 }, { x: 1000, y: 500, r: 25 }
].map(Object.freeze));

const R = TABLE.radius, W = TABLE.width, H = TABLE.height;
const BALL_RESTITUTION = 0.96, RAIL_RESTITUTION = 0.78;
const ROLLING = 0.988, DRAG = 0.015, STOP = 0.04, MAX_TICKS = 2400;
const MIN_SPEED = 2, SPEED_RANGE = 26;

export const isSolid = n => n >= 1 && n <= 7;
export const isStripe = n => n >= 9 && n <= 15;
export const inGroup = (group, n) => group === 'solids' ? isSolid(n) : group === 'stripes' ? isStripe(n) : false;
export const otherGroup = group => group === 'solids' ? 'stripes' : 'solids';
const round = v => Math.round(v * 1000) / 1000;
const cloneBalls = balls => balls.map(b => ({ n: b.n, x: b.x, y: b.y, p: b.p }));
const onTable = balls => balls.filter(b => !b.p);

/** Builds a legal rack. `bytes` supplies randomness (crypto on the server). */
export function rack(bytes) {
  const rest = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = (bytes[i % bytes.length] ?? 0) % (i + 1);
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  // Back corners hold one solid and one stripe; the 8 sits in the middle of row three.
  const solid = rest.splice(rest.findIndex(isSolid), 1)[0];
  const stripe = rest.splice(rest.findIndex(isStripe), 1)[0];
  const flip = (bytes[0] ?? 0) % 2 === 1;
  const slots = [];
  const gapX = 2 * R * 0.866 + 0.2, gapY = 2 * R + 0.2;
  for (let row = 0; row < 5; row++) for (let j = 0; j <= row; j++) slots.push({ x: round(TABLE.footX + row * gapX), y: round(H / 2 + (j - row / 2) * gapY) });
  const order = new Array(15);
  order[4] = 8; order[10] = flip ? stripe : solid; order[14] = flip ? solid : stripe;
  for (let i = 0; i < 15; i++) if (order[i] === undefined) order[i] = rest.shift();
  const balls = [{ n: 0, x: TABLE.headX, y: H / 2, p: 0 }];
  order.forEach((n, i) => balls.push({ n, x: slots[i].x, y: slots[i].y, p: 0 }));
  return balls.sort((a, b) => a.n - b.n);
}

export function newGame(id, playerIds, breakerId, bytes) {
  return {
    id, players: playerIds.slice(0, 2), turn: breakerId, groups: {}, breakShot: true,
    ballInHand: 'kitchen', balls: rack(bytes), seq: 0, last: null, winner: null, reason: ''
  };
}

function nearPocket(x, y, margin = 0) {
  return POCKETS.some(p => (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) < (p.r + margin) * (p.r + margin));
}

/** Whether the cue ball may be placed at (x, y). */
export function validPlacement(balls, x, y, zone) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < R || x > W - R || y < R || y > H - R) return false;
  if (zone === 'kitchen' && x > TABLE.headX) return false;
  if (nearPocket(x, y, R)) return false;
  return onTable(balls).every(b => b.n === 0 || (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) >= 4 * R * R);
}

/**
 * Runs one shot. Returns the final balls and what happened.
 * `onTick(balls)` (optional) receives a snapshot after every tick for animation.
 */
export function simulate(inputBalls, shot, onTick) {
  const balls = cloneBalls(inputBalls).map(b => ({ ...b, vx: 0, vy: 0 }));
  const cue = balls.find(b => b.n === 0);
  const len = Math.sqrt(shot.dx * shot.dx + shot.dy * shot.dy);
  const speed = MIN_SPEED + SPEED_RANGE * shot.power;
  cue.vx = shot.dx / len * speed; cue.vy = shot.dy / len * speed;
  const events = { firstContact: null, railAfterContact: false, pocketed: [], ticks: 0 };
  const live = () => balls.filter(b => !b.p);
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    let fastest = 0;
    for (const b of live()) { const s = Math.sqrt(b.vx * b.vx + b.vy * b.vy); if (s > fastest) fastest = s; }
    if (fastest === 0) break;
    const steps = Math.max(1, Math.ceil(fastest / (R * 0.8)));
    for (let step = 0; step < steps; step++) {
      for (const b of live()) { b.x += b.vx / steps; b.y += b.vy / steps; }
      const moving = live();
      for (let i = 0; i < moving.length; i++) for (let j = i + 1; j < moving.length; j++) collide(moving[i], moving[j], events);
      for (const b of live()) {
        if (nearPocket(b.x, b.y)) { b.p = 1; b.vx = 0; b.vy = 0; events.pocketed.push(b.n); continue; }
        let rail = false;
        if (b.x < R) { b.x = 2 * R - b.x; b.vx = -b.vx * RAIL_RESTITUTION; rail = true; }
        else if (b.x > W - R) { b.x = 2 * (W - R) - b.x; b.vx = -b.vx * RAIL_RESTITUTION; rail = true; }
        if (b.y < R) { b.y = 2 * R - b.y; b.vy = -b.vy * RAIL_RESTITUTION; rail = true; }
        else if (b.y > H - R) { b.y = 2 * (H - R) - b.y; b.vy = -b.vy * RAIL_RESTITUTION; rail = true; }
        if (rail && events.firstContact !== null) events.railAfterContact = true;
      }
    }
    for (const b of live()) {
      const s = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (s < STOP) { b.vx = 0; b.vy = 0; continue; }
      const next = Math.max(0, s * ROLLING - DRAG);
      b.vx = b.vx / s * next; b.vy = b.vy / s * next;
    }
    events.ticks = tick + 1;
    if (onTick) onTick(balls.map(b => ({ n: b.n, x: b.x, y: b.y, p: b.p })));
  }
  const final = balls.map(b => ({ n: b.n, x: round(b.x), y: round(b.y), p: b.p }));
  return { balls: final, events };
}

function collide(a, b, events) {
  let nx = b.x - a.x, ny = b.y - a.y;
  const d2 = nx * nx + ny * ny;
  if (d2 >= 4 * R * R) return;
  let d = Math.sqrt(d2);
  if (d === 0) { nx = 1; ny = 0; d = 1; } else { nx /= d; ny /= d; }
  if (events.firstContact === null) {
    if (a.n === 0) events.firstContact = b.n; else if (b.n === 0) events.firstContact = a.n;
  }
  const push = (2 * R - (d2 === 0 ? 0 : d)) / 2;
  a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
  const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (approach <= 0) return;
  const impulse = (1 + BALL_RESTITUTION) / 2 * approach;
  a.vx -= impulse * nx; a.vy -= impulse * ny; b.vx += impulse * nx; b.vy += impulse * ny;
}

function respotEight(balls) {
  const eight = balls.find(b => b.n === 8);
  eight.p = 0; eight.y = H / 2;
  for (let x = TABLE.footX; x > R; x -= 1) if (validPlacement(balls.filter(b => b.n !== 8), x, H / 2, 'table')) { eight.x = x; return; }
  eight.x = TABLE.footX;
}

export function validShot(shot) {
  return shot && Number.isFinite(shot.dx) && Number.isFinite(shot.dy) && Math.abs(shot.dx) <= 1e6 && Math.abs(shot.dy) <= 1e6 &&
    Math.sqrt(shot.dx * shot.dx + shot.dy * shot.dy) > 1e-6 && Number.isFinite(shot.power) && shot.power >= 0.05 && shot.power <= 1;
}

/** Applies a shot by `playerId` and returns the updated game (the input is not modified). */
export function applyShot(input, playerId, shot) {
  if (input.winner) throw new Error('La partida ya terminó.');
  if (input.turn !== playerId) throw new Error('Todavía no es tu turno.');
  if (!validShot(shot)) throw new Error('El tiro no es válido. Ajusta la dirección y la fuerza.');
  const game = structuredClone(input);
  const cue = game.balls.find(b => b.n === 0);
  if (shot.cue) {
    if (!game.ballInHand) throw new Error('Solo puedes mover la blanca cuando tienes bola en mano.');
    const x = Number(shot.cue.x), y = Number(shot.cue.y);
    if (!validPlacement(game.balls, x, y, game.ballInHand)) throw new Error(game.ballInHand === 'kitchen' ? 'Coloca la blanca detrás de la línea de salida, sin tocar otras bolas.' : 'Coloca la blanca en un espacio libre de la mesa.');
    cue.x = round(x); cue.y = round(y); cue.p = 0;
  } else if (cue.p) throw new Error('Coloca la bola blanca antes de tirar.');
  const opponent = game.players.find(id => id !== playerId);
  const before = cloneBalls(game.balls);
  const group = game.groups[playerId] || null;
  const ownLeft = group ? before.filter(b => !b.p && inGroup(group, b.n)).length : null;
  const { balls, events } = simulate(before, shot);
  game.balls = balls;
  const pocketed = events.pocketed.filter(n => n !== 0);
  const scratch = events.pocketed.includes(0);
  let foul = '';
  if (scratch) foul = 'La blanca cayó en una tronera.';
  else if (events.firstContact === null) foul = 'La blanca no tocó ninguna bola.';
  else if (!game.breakShot && !group && events.firstContact === 8) foul = 'Con la mesa abierta no puedes tocar primero la bola 8.';
  else if (group && ownLeft > 0 && !inGroup(group, events.firstContact)) foul = 'Primero debías tocar una bola de tu grupo.';
  else if (group && ownLeft === 0 && events.firstContact !== 8) foul = 'Primero debías tocar la bola 8.';
  else if (!game.breakShot && !pocketed.length && !events.railAfterContact) foul = 'Ninguna bola tocó una banda después del contacto.';

  const summary = { by: playerId, pocketed, scratch, foul, firstContact: events.firstContact, assigned: null, continued: false, breakShot: game.breakShot };
  if (pocketed.includes(8)) {
    if (game.breakShot) { respotEight(game.balls); summary.respotted = true; }
    else {
      const lost = foul || !group || ownLeft > 0;
      game.winner = lost ? opponent : playerId;
      game.reason = !lost ? 'Metió la bola 8 y ganó la partida.' : (!group || ownLeft > 0) ? 'Metió la bola 8 antes de terminar su grupo.' : 'Metió la bola 8 con falta.';
    }
  }
  if (!game.winner) {
    const objectBalls = pocketed.filter(n => n !== 8);
    if (!game.breakShot && !group && !foul && objectBalls.length) {
      const first = isSolid(objectBalls[0]) ? 'solids' : 'stripes';
      game.groups = { [playerId]: first, [opponent]: otherGroup(first) };
      summary.assigned = first;
    }
    const mine = game.groups[playerId];
    summary.continued = !foul && (mine ? objectBalls.some(n => inGroup(mine, n)) : objectBalls.length > 0);
    if (!summary.continued) game.turn = opponent;
    game.ballInHand = foul ? 'table' : null;
    if (scratch) { const c = game.balls.find(b => b.n === 0); c.p = 1; }
  } else game.ballInHand = null;
  game.breakShot = false;
  game.seq += 1;
  game.last = { seq: game.seq, by: playerId, before, shot: { dx: shot.dx, dy: shot.dy, power: shot.power }, summary };
  return game;
}

/**
 * First object hit along the aim line from the cue ball, for the aiming guide.
 * Returns { point, ball } where point is the cue-ball centre at contact.
 */
export function aimGuide(balls, dx, dy) {
  const cue = balls.find(b => b.n === 0 && !b.p);
  if (!cue) return null;
  const len = Math.sqrt(dx * dx + dy * dy); if (!len) return null;
  const ux = dx / len, uy = dy / len;
  let best = Infinity, hit = null;
  for (const b of balls) {
    if (b.n === 0 || b.p) continue;
    const ox = b.x - cue.x, oy = b.y - cue.y, along = ox * ux + oy * uy;
    if (along <= 0) continue;
    const off2 = ox * ox + oy * oy - along * along, reach = 4 * R * R - off2;
    if (reach < 0) continue;
    const t = along - Math.sqrt(reach);
    if (t < best) { best = t; hit = b; }
  }
  const tx = ux > 0 ? (W - R - cue.x) / ux : ux < 0 ? (R - cue.x) / ux : Infinity;
  const ty = uy > 0 ? (H - R - cue.y) / uy : uy < 0 ? (R - cue.y) / uy : Infinity;
  const wall = Math.min(tx, ty);
  const t = Math.min(best, wall);
  return { point: { x: cue.x + ux * t, y: cue.y + uy * t }, ball: best <= wall ? hit : null };
}
