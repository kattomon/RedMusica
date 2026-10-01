// Shared 8-ball engine. The Edge Function runs it to decide every shot and the
// browser runs the same code only to animate the result it receives.
// The simulation uses +, -, *, / and Math.sqrt only (all exactly specified by
// IEEE 754), so both runtimes produce identical trajectories from the same input.
//
// Units: 1 table unit = 2.54 mm (the playing surface is 1000 x 500), 1 tick = 1/60 s.
// Each ball keeps its velocity (vx, vy) and the velocity its spin would roll it at
// (sx, sy). While they differ the ball slides and cloth friction pulls them together
// (a sphere ends up rolling at 5/7 of a centre-hit speed); once equal it rolls and
// only rolling resistance slows it. Balls exchange velocity on contact but keep
// their spin, which is what makes stun, follow and draw shots work.

export const TABLE = Object.freeze({ width: 1000, height: 500, radius: 11, headX: 250, footX: 750 });

const R = TABLE.radius, W = TABLE.width, H = TABLE.height;
const CORNER_GAP = 33, SIDE_GAP = 26, JAW = 16;
// Where a ball drops: its centre must enter one of these circles.
const FALL = Object.freeze([
  { x: -8, y: -8, r: 24 }, { x: 500, y: -14, r: 22 }, { x: W + 8, y: -8, r: 24 },
  { x: -8, y: H + 8, r: 24 }, { x: 500, y: H + 14, r: 22 }, { x: W + 8, y: H + 8, r: 24 }
].map(Object.freeze));
// Visible pocket openings, for drawing.
export const POCKETS = Object.freeze([
  { x: -2, y: -2, r: 26 }, { x: 500, y: -7, r: 22 }, { x: W + 2, y: -2, r: 26 },
  { x: -2, y: H + 2, r: 26 }, { x: 500, y: H + 7, r: 22 }, { x: W + 2, y: H + 2, r: 26 }
].map(Object.freeze));
// Cushion noses and pocket jaws as segments [x1, y1, x2, y2]; a ball touches one when its centre is R away.
export const CUSHIONS = Object.freeze([
  [CORNER_GAP, 0, 500 - SIDE_GAP, 0], [500 + SIDE_GAP, 0, W - CORNER_GAP, 0],
  [CORNER_GAP, H, 500 - SIDE_GAP, H], [500 + SIDE_GAP, H, W - CORNER_GAP, H],
  [0, CORNER_GAP, 0, H - CORNER_GAP], [W, CORNER_GAP, W, H - CORNER_GAP],
  // corner jaws
  [CORNER_GAP, 0, CORNER_GAP - JAW, -JAW], [0, CORNER_GAP, -JAW, CORNER_GAP - JAW],
  [W - CORNER_GAP, 0, W - CORNER_GAP + JAW, -JAW], [W, CORNER_GAP, W + JAW, CORNER_GAP - JAW],
  [CORNER_GAP, H, CORNER_GAP - JAW, H + JAW], [0, H - CORNER_GAP, -JAW, H - CORNER_GAP + JAW],
  [W - CORNER_GAP, H, W - CORNER_GAP + JAW, H + JAW], [W, H - CORNER_GAP, W + JAW, H - CORNER_GAP + JAW],
  // side jaws
  [500 - SIDE_GAP, 0, 500 - SIDE_GAP + 6, -18], [500 + SIDE_GAP, 0, 500 + SIDE_GAP - 6, -18],
  [500 - SIDE_GAP, H, 500 - SIDE_GAP + 6, H + 18], [500 + SIDE_GAP, H, 500 + SIDE_GAP - 6, H + 18]
].map(s => Object.freeze(s)));

const GRAVITY = 1.073;                 // 9.81 m/s² in units per tick²
const SLIDE = 0.2 * GRAVITY;           // sliding friction of cloth
const ROLL = 0.032 * GRAVITY;          // rolling resistance (game-tuned so shots settle in a few seconds)
const CLOTH_DRAG = 0.0015;             // small speed-proportional loss
const BALL_RESTITUTION = 0.94, CUSHION_RESTITUTION = 0.8, CUSHION_GRIP = 0.94;
const MIN_SPEED = 2.5, SPEED_RANGE = 38, MAX_SPIN = 1.5, MAX_TICKS = 2400;

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


function inPocket(x, y, margin = 0) {
  return FALL.some(p => (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) < (p.r + margin) * (p.r + margin));
}

/** Whether the cue ball may be placed at (x, y). */
export function validPlacement(balls, x, y, zone) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < R || x > W - R || y < R || y > H - R) return false;
  if (zone === 'kitchen' && x > TABLE.headX) return false;
  if (inPocket(x, y, R)) return false;
  return onTable(balls).every(b => b.n === 0 || (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) >= 4 * R * R);
}

/**
 * Runs one shot. Returns the final balls and what happened.
 * shot: { dx, dy, power 0.05..1, spin -1 (draw) .. 1 (follow), optional }.
 * `onTick(balls)` (optional) receives a snapshot after every tick for animation.
 */
export function simulate(inputBalls, shot, onTick) {
  const balls = cloneBalls(inputBalls).map(b => ({ ...b, vx: 0, vy: 0, sx: 0, sy: 0 }));
  const cue = balls.find(b => b.n === 0);
  const len = Math.sqrt(shot.dx * shot.dx + shot.dy * shot.dy);
  // Gentle at the low end for touch shots, strong at the top for breaks (no Math.pow: it is not exactly specified).
  const speed = MIN_SPEED + SPEED_RANGE * (0.55 * shot.power + 0.45 * shot.power * shot.power);
  const spin = Number.isFinite(shot.spin) ? Math.max(-1, Math.min(1, shot.spin)) : 0;
  cue.vx = shot.dx / len * speed; cue.vy = shot.dy / len * speed;
  cue.sx = cue.vx * spin * MAX_SPIN; cue.sy = cue.vy * spin * MAX_SPIN;
  const events = { firstContact: null, railAfterContact: false, rails: 0, pocketed: [], ticks: 0 };
  const live = () => balls.filter(b => !b.p);
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    let fastest = 0;
    for (const b of live()) { const s = Math.sqrt(b.vx * b.vx + b.vy * b.vy); if (s > fastest) fastest = s; }
    if (fastest === 0) break;
    const steps = Math.max(1, Math.ceil(fastest / (R * 0.5)));
    for (let step = 0; step < steps; step++) {
      for (const b of live()) { b.x += b.vx / steps; b.y += b.vy / steps; }
      const moving = live();
      for (let i = 0; i < moving.length; i++) for (let j = i + 1; j < moving.length; j++) collideBalls(moving[i], moving[j], events);
      for (const b of live()) {
        for (const c of CUSHIONS) if (collideCushion(b, c)) { events.rails++; if (events.firstContact !== null) events.railAfterContact = true; }
        if (inPocket(b.x, b.y) || b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) {
          b.p = 1; b.vx = b.vy = b.sx = b.sy = 0; events.pocketed.push(b.n);
        }
      }
    }
    for (const b of live()) friction(b);
    events.ticks = tick + 1;
    if (onTick) onTick(balls.map(b => ({ n: b.n, x: b.x, y: b.y, p: b.p })));
  }
  const final = balls.map(b => ({ n: b.n, x: round(b.x), y: round(b.y), p: b.p }));
  return { balls: final, events };
}

// One tick of cloth friction: sliding until the spin matches the motion, then rolling.
function friction(b) {
  const slipX = b.vx - b.sx, slipY = b.vy - b.sy;
  const slip = Math.sqrt(slipX * slipX + slipY * slipY);
  if (slip > 3.5 * SLIDE) {
    const ux = slipX / slip, uy = slipY / slip;
    b.vx -= ux * SLIDE; b.vy -= uy * SLIDE;
    b.sx += ux * 2.5 * SLIDE; b.sy += uy * 2.5 * SLIDE;
  } else if (slip > 0) {
    // Natural roll reached this tick: v = (5v + 2s) / 7 conserves angular momentum about the contact point.
    const rx = (5 * b.vx + 2 * b.sx) / 7, ry = (5 * b.vy + 2 * b.sy) / 7;
    b.vx = b.sx = rx; b.vy = b.sy = ry;
  } else {
    const s = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (s === 0) return;
    const next = s * (1 - CLOTH_DRAG) - ROLL;
    if (next <= 0.02) { b.vx = b.vy = b.sx = b.sy = 0; return; }
    b.vx = b.vx / s * next; b.vy = b.vy / s * next;
    b.sx = b.vx; b.sy = b.vy;
  }
}

function collideBalls(a, b, events) {
  let nx = b.x - a.x, ny = b.y - a.y;
  const d2 = nx * nx + ny * ny;
  if (d2 >= 4 * R * R) return;
  let d = Math.sqrt(d2);
  if (d === 0) { nx = 1; ny = 0; } else { nx /= d; ny /= d; }
  if (events.firstContact === null) {
    if (a.n === 0) events.firstContact = b.n; else if (b.n === 0) events.firstContact = a.n;
  }
  const push = (2 * R - d) / 2;
  a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
  const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (approach <= 0) return;
  // Equal masses, smooth balls: only the velocity along the line of centres changes; spin stays.
  const impulse = (1 + BALL_RESTITUTION) / 2 * approach;
  a.vx -= impulse * nx; a.vy -= impulse * ny; b.vx += impulse * nx; b.vy += impulse * ny;
}

// Ball against a cushion nose or pocket jaw. Returns true on contact.
function collideCushion(b, seg) {
  const [x1, y1, x2, y2] = seg;
  const ex = x2 - x1, ey = y2 - y1, len2 = ex * ex + ey * ey;
  let t = ((b.x - x1) * ex + (b.y - y1) * ey) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = x1 + ex * t, cy = y1 + ey * t;
  let nx = b.x - cx, ny = b.y - cy;
  const d2 = nx * nx + ny * ny;
  if (d2 >= R * R) return false;
  const d = Math.sqrt(d2);
  if (d === 0) return false;
  nx /= d; ny /= d;
  b.x = cx + nx * R; b.y = cy + ny * R;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return false;
  const tx = b.vx - vn * nx, ty = b.vy - vn * ny;
  b.vx = tx * CUSHION_GRIP - vn * CUSHION_RESTITUTION * nx;
  b.vy = ty * CUSHION_GRIP - vn * CUSHION_RESTITUTION * ny;
  // The cushion grips the ball above its centre: it leaves rolling along the new path.
  b.sx = b.vx; b.sy = b.vy;
  return true;
}

function respotEight(balls) {
  const eight = balls.find(b => b.n === 8);
  eight.p = 0; eight.y = H / 2;
  for (let x = TABLE.footX; x > R; x -= 1) if (validPlacement(balls.filter(b => b.n !== 8), x, H / 2, 'table')) { eight.x = x; return; }
  eight.x = TABLE.footX;
}

export function validShot(shot) {
  return shot && Number.isFinite(shot.dx) && Number.isFinite(shot.dy) && Math.abs(shot.dx) <= 1e6 && Math.abs(shot.dy) <= 1e6 &&
    Math.sqrt(shot.dx * shot.dx + shot.dy * shot.dy) > 1e-6 && Number.isFinite(shot.power) && shot.power >= 0.05 && shot.power <= 1 &&
    (shot.spin === undefined || (Number.isFinite(shot.spin) && shot.spin >= -1 && shot.spin <= 1));
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
  game.last = { seq: game.seq, by: playerId, before, shot: { dx: shot.dx, dy: shot.dy, power: shot.power, ...(shot.spin ? { spin: shot.spin } : {}) }, summary };
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
