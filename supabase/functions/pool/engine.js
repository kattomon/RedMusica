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
// Contacts are wound back to the exact moment of touch, ball-to-ball friction adds a
// little throw, cushions bounce less when hit hard and keep part of the spin, and
// pocket jaws are deader than the cushions.

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
// Segments from this index on are pocket jaws.
const FIRST_JAW = 6;

const GRAVITY = 1.073;                 // 9.81 m/s² in units per tick²
const SLIDE = 0.2 * GRAVITY;           // sliding friction of cloth
const ROLL = 0.024 * GRAVITY;          // rolling resistance (game-tuned so shots settle in a few seconds)
const CLOTH_DRAG = 0.0012;             // small speed-proportional loss
const BALL_RESTITUTION = 0.95, CUSHION_GRIP = 0.94;
// Cushions bounce a little less the harder they are hit; pocket jaws are deader and grippier,
// so a ball that clips one rattles instead of sliding in.
const CUSHION_BOUNCE = 0.88, CUSHION_SOFTEN = 0.004, CUSHION_MIN = 0.7, JAW_BOUNCE = 0.62, JAW_GRIP = 0.85;
// The cushion nose sits above the ball's centre: part of the spin towards the cushion survives the
// rebound, so a rolling ball bends forward off the rail and a drawn ball comes off wider.
const CUSHION_SPIN_KEEP = 0.3;
const MIN_SPEED = 2.5, SPEED_RANGE = 48, MAX_SPIN = 1.5, MAX_TICKS = 2400;
// Side spin (english): stored as the surface speed of the vertical-axis spin; it changes
// the rebound off cushions, throws object balls a little and fades with cloth friction.
const MAX_SIDE = 0.9, SIDE_TO_RAIL = 0.28, SIDE_KEEP_RAIL = 0.45, SIDE_FADE = 0.992;
// Ball-to-ball friction ("throw"): sliding surfaces drag the object ball a few degrees off the
// line of centres; the effect is stronger on slow shots, as on a real table.
const THROW_MIN = 0.02, THROW_EXTRA = 0.06, THROW_FADE = 0.15;
export const POCKET_NAMES = Object.freeze(['esquina superior izquierda', 'centro superior', 'esquina superior derecha', 'esquina inferior izquierda', 'centro inferior', 'esquina inferior derecha']);

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
  const gapX = 2 * R * 0.866 + 0.01, gapY = 2 * R + 0.01;
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


function pocketAt(x, y, margin = 0) {
  for (let i = 0; i < FALL.length; i++) { const p = FALL[i]; if ((x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) < (p.r + margin) * (p.r + margin)) return i; }
  return -1;
}
const inPocket = (x, y, margin = 0) => pocketAt(x, y, margin) >= 0;

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
 * shot: { dx, dy, power 0.05..1, spin -1 (draw) .. 1 (follow), side -1 (left) .. 1 (right); spin and side optional }.
 * `onTick(balls)` (optional) receives a snapshot after every tick for animation.
 * `onEvent({ tick, type: 'ball' | 'rail' | 'pocket', n, strength })` (optional) reports impacts for sound.
 */
export function simulate(inputBalls, shot, onTick, onEvent) {
  const balls = cloneBalls(inputBalls).map(b => ({ ...b, vx: 0, vy: 0, sx: 0, sy: 0, e: 0 }));
  const cue = balls.find(b => b.n === 0);
  const len = Math.sqrt(shot.dx * shot.dx + shot.dy * shot.dy);
  // Gentle at the low end for touch shots, strong at the top for breaks (no Math.pow: it is not exactly specified).
  // The top of the range rises faster so a full-power break really opens the rack.
  const p = shot.power, p2 = p * p;
  const speed = MIN_SPEED + SPEED_RANGE * (0.5 * p + 0.2 * p2 + 0.3 * p2 * p2);
  const spin = Number.isFinite(shot.spin) ? Math.max(-1, Math.min(1, shot.spin)) : 0;
  cue.vx = shot.dx / len * speed; cue.vy = shot.dy / len * speed;
  cue.sx = cue.vx * spin * MAX_SPIN; cue.sy = cue.vy * spin * MAX_SPIN;
  const side = Number.isFinite(shot.side) ? Math.max(-1, Math.min(1, shot.side)) : 0;
  cue.e = side * MAX_SIDE * speed;
  const events = { firstContact: null, railAfterContact: false, rails: 0, pocketed: [], pockets: {}, ticks: 0 };
  let tickNow = 0;
  const report = onEvent ? (type, n, strength) => onEvent({ tick: tickNow, type, n, strength }) : null;
  const live = () => balls.filter(b => !b.p);
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    tickNow = tick;
    let fastest = 0;
    for (const b of live()) { const s = Math.sqrt(b.vx * b.vx + b.vy * b.vy); if (s > fastest) fastest = s; }
    if (fastest === 0) break;
    const steps = Math.max(1, Math.ceil(fastest / (R * 0.5)));
    for (let step = 0; step < steps; step++) {
      for (const b of live()) { b.x += b.vx / steps; b.y += b.vy / steps; }
      const moving = live();
      for (let i = 0; i < moving.length; i++) for (let j = i + 1; j < moving.length; j++) {
        const hit = collideBalls(moving[i], moving[j], events, 1 / steps);
        if (hit && report) report('ball', moving[i].n === 0 ? moving[j].n : moving[i].n, hit);
      }
      for (const b of live()) {
        for (let k = 0; k < CUSHIONS.length; k++) {
          const hit = collideCushion(b, CUSHIONS[k], k >= FIRST_JAW);
          if (hit) { events.rails++; if (events.firstContact !== null) events.railAfterContact = true; if (report) report('rail', b.n, hit); }
        }
        let pocket = pocketAt(b.x, b.y);
        if (pocket < 0 && (b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40)) pocket = nearestPocket(b.x, b.y);
        if (pocket >= 0) {
          const strength = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
          b.p = 1; b.vx = b.vy = b.sx = b.sy = b.e = 0; events.pocketed.push(b.n); events.pockets[b.n] = pocket;
          if (report) report('pocket', b.n, strength);
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
  b.e *= SIDE_FADE;
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
    if (next <= 0.02) { b.vx = b.vy = b.sx = b.sy = b.e = 0; return; }
    b.vx = b.vx / s * next; b.vy = b.vy / s * next;
    b.sx = b.vx; b.sy = b.vy;
  }
}

function collideBalls(a, b, events, dt) {
  let nx = b.x - a.x, ny = b.y - a.y;
  const d2 = nx * nx + ny * ny;
  if (d2 >= 4 * R * R) return 0;
  // The balls overlapped during this substep: wind both back to the moment they touched, so the
  // line of centres (and so the cut angle) is exact however fast they travel.
  const rvx = b.vx - a.vx, rvy = b.vy - a.vy, closing = nx * rvx + ny * rvy, rv2 = rvx * rvx + rvy * rvy;
  let back = 0;
  if (closing < 0 && rv2 > 1e-12) {
    const disc = closing * closing - rv2 * (d2 - 4 * R * R);
    back = (closing + Math.sqrt(disc)) / rv2;
    if (back > dt) back = dt; else if (back < 0) back = 0;
    a.x -= a.vx * back; a.y -= a.vy * back; b.x -= b.vx * back; b.y -= b.vy * back;
    nx = b.x - a.x; ny = b.y - a.y;
  }
  let d = Math.sqrt(nx * nx + ny * ny);
  if (d === 0) { nx = 1; ny = 0; } else { nx /= d; ny /= d; }
  if (events.firstContact === null) {
    if (a.n === 0) events.firstContact = b.n; else if (b.n === 0) events.firstContact = a.n;
  }
  if (d < 2 * R) {
    const push = (2 * R - d) / 2;
    a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
  }
  const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (approach <= 0) {
    a.x += a.vx * back; a.y += a.vy * back; b.x += b.vx * back; b.y += b.vy * back;
    return 0;
  }
  // Equal masses: the velocity along the line of centres is exchanged; rolling spin stays with each ball.
  const impulse = (1 + BALL_RESTITUTION) / 2 * approach;
  a.vx -= impulse * nx; a.vy -= impulse * ny; b.vx += impulse * nx; b.vy += impulse * ny;
  // Throw: the surfaces slide past each other at the contact point (cut angle and side spin);
  // friction drags the object ball along, limited by the friction cone or until they stop slipping.
  // Side spin e gives the point at direction m a surface velocity e * (my, -mx).
  const relX = a.vx - b.vx, relY = a.vy - b.vy, along = relX * nx + relY * ny;
  const slipX = relX - along * nx + (a.e + b.e) * ny, slipY = relY - along * ny - (a.e + b.e) * nx;
  const slip = Math.sqrt(slipX * slipX + slipY * slipY);
  if (slip > 1e-9) {
    const mu = THROW_MIN + THROW_EXTRA / (1 + THROW_FADE * slip);
    const tangent = Math.min(mu * impulse, slip / 7);
    const tx = slipX / slip, ty = slipY / slip;
    a.vx -= tx * tangent; a.vy -= ty * tangent; b.vx += tx * tangent; b.vy += ty * tangent;
    // The same friction spins both balls about the vertical axis (I = 2/5 m R^2).
    const turn = 2.5 * tangent * (tx * ny - ty * nx);
    a.e -= turn; b.e -= turn;
  }
  // Finish the substep with the new velocities.
  a.x += a.vx * back; a.y += a.vy * back; b.x += b.vx * back; b.y += b.vy * back;
  return approach;
}

// Ball against a cushion nose or pocket jaw. Returns the impact speed (0 when there is no contact).
function collideCushion(b, seg, jaw) {
  const [x1, y1, x2, y2] = seg;
  const ex = x2 - x1, ey = y2 - y1, len2 = ex * ex + ey * ey;
  let t = ((b.x - x1) * ex + (b.y - y1) * ey) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = x1 + ex * t, cy = y1 + ey * t;
  let nx = b.x - cx, ny = b.y - cy;
  const d2 = nx * nx + ny * ny;
  if (d2 >= R * R) return 0;
  const d = Math.sqrt(d2);
  if (d === 0) return 0;
  nx /= d; ny /= d;
  b.x = cx + nx * R; b.y = cy + ny * R;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return 0;
  const tx = b.vx - vn * nx, ty = b.vy - vn * ny;
  let bounce = jaw ? JAW_BOUNCE : CUSHION_BOUNCE + CUSHION_SOFTEN * vn;
  if (bounce < CUSHION_MIN && !jaw) bounce = CUSHION_MIN;
  const grip = jaw ? JAW_GRIP : CUSHION_GRIP;
  const spinIn = b.sx * nx + b.sy * ny;
  b.vx = tx * grip - vn * bounce * nx;
  b.vy = ty * grip - vn * bounce * ny;
  if (b.e !== 0) {
    // Side spin grips the cushion: right english (e > 0) pushes the ball to the right of
    // its incoming direction, along the cushion; part of the spin is used up.
    // The incoming direction is roughly -n, so "to its right" along the cushion is (ny, -nx) on screen (y down).
    const kick = b.e * SIDE_TO_RAIL;
    b.vx += ny * kick; b.vy -= nx * kick;
    b.e *= SIDE_KEEP_RAIL;
  }
  // Along the cushion the ball leaves rolling; across it, part of its spin into (or away from) the
  // cushion survives, and cloth friction then bends the path (a natural roll comes off shorter).
  const along = b.vx * -ny + b.vy * nx;
  b.sx = -ny * along + nx * spinIn * CUSHION_SPIN_KEEP;
  b.sy = nx * along + ny * spinIn * CUSHION_SPIN_KEEP;
  return -vn;
}

function nearestPocket(x, y) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < FALL.length; i++) { const p = FALL[i], d = (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y); if (d < bestD) { bestD = d; best = i; } }
  return best;
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
    (shot.spin === undefined || (Number.isFinite(shot.spin) && shot.spin >= -1 && shot.spin <= 1)) &&
    (shot.side === undefined || (Number.isFinite(shot.side) && shot.side >= -1 && shot.side <= 1)) &&
    (shot.call === undefined || (Number.isInteger(shot.call) && shot.call >= 0 && shot.call < FALL.length));
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
      // The 8 may drop in any pocket: no need to call it.
      const lost = foul || !group || ownLeft > 0;
      game.winner = lost ? opponent : playerId;
      game.reason = !lost ? 'Metió la bola 8 y ganó la partida.'
        : (!group || ownLeft > 0) ? 'Metió la bola 8 antes de terminar su grupo.'
        : 'Metió la bola 8 con falta.';
      summary.eightPocket = events.pockets[8];
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
  const replay = { dx: shot.dx, dy: shot.dy, power: shot.power };
  if (shot.spin) replay.spin = shot.spin;
  if (shot.side) replay.side = shot.side;
  if (shot.call !== undefined) replay.call = shot.call;
  game.last = { seq: game.seq, by: playerId, before, shot: replay, summary };
  return game;
}

/** The player in turn ran out of time: foul, the opponent (`claimantId`) gets ball in hand. */
export function applyTimeout(input, claimantId) {
  if (input.winner) throw new Error('La partida ya terminó.');
  if (input.turn === claimantId || !input.players.includes(claimantId)) throw new Error('Todavía no es tu turno.');
  const game = structuredClone(input);
  const late = game.turn;
  game.turn = claimantId;
  game.ballInHand = game.breakShot ? 'kitchen' : 'table';
  game.seq += 1;
  game.last = { seq: game.seq, by: late, timeout: true, before: cloneBalls(game.balls), shot: null,
    summary: { by: late, pocketed: [], scratch: false, foul: 'Se acabó el tiempo para tirar.', firstContact: null, assigned: null, continued: false, breakShot: game.breakShot } };
  return game;
}

/** Whether `playerId` is shooting at the 8 (the pocket no longer has to be called). */
export function onTheEight(game, playerId) {
  const group = game.groups?.[playerId];
  return !game.breakShot && !!group && !game.balls.some(b => !b.p && inGroup(group, b.n));
}
/** Kept for older pages: calling a pocket is no longer required. */
export function mustCallEight() {
  return false;
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
