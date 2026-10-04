// 8-ball pool in its own section, plus the win counter on profiles.
// Online games: the pool Edge Function decides every shot; this file draws the table,
// replays the server's result with the shared engine and sends the player's aim.
// Games against the computer and practice run the same engine locally (they are not recorded).
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const section = $('poolJuegos');
    const config = window.REDMUSICA_CONFIG;
    const db = config && window.supabase ? window.redmusicaClient || window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
    const ENGINE_URL = './supabase/functions/pool/engine.js?v=20261003-1';
    const TURN_LIMIT_MS = 5 * 60 * 1000, SHOT_CLOCK_MS = 60 * 1000;
    const RAIL = 34;
    const COLORS = { 1: '#e3b22f', 2: '#2b4f9e', 3: '#c23b30', 4: '#5c3b86', 5: '#dd7430', 6: '#2e7445', 7: '#7c2733', 8: '#1f1c1f' };
    const GROUP_NAMES = { solids: 'lisas (1–7)', stripes: 'rayadas (9–15)' };
    const CPU = 'maquina', PRACTICE = 'practica', LOCAL_ME = 'tu';
    const LEVEL_NAMES = { facil: 'fácil', normal: 'normal', dificil: 'difícil' };
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    setupProfileStats();
    if (!section) return;

    const canvas = $('poolCanvas'), ctx = canvas.getContext('2d'), frame = $('poolLienzo');
    const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };
    let E = null, user = null, roomCode = '', room = null, busy = false, timer = null, animating = false, queued = null;
    let shownGame = null, shownSeq = -1, balls = [], aim = { dx: 1, dy: 0 }, pendingCue = null, placing = false, dragging = false, placementValid = null;
    let striking = false, cueStroke = 0, channel = null, channelCode = '', subscribed = false, broadcastTimer = null, lastBroadcastFetch = 0;
    let sound = null, ringTimer = null, gutterSignature = '', statusTimer = null, drawQueued = 0;
    let calledPocket = null, timeoutSentFor = null, drops = [], spin = 0, side = 0, callPulse = 0, aimDrag = null;
    // Watching a full table, and the live cue of whoever is shooting (sent over Realtime, cosmetic only).
    let spectating = false, remote = null, remoteFrame = 0, lastAimSig = '', pendingAim = null, aimTimer = null, lastAimSent = 0;
    // Local games (computer or practice).
    let mode = 'online', local = null, cpuLevel = 'normal', cpuTimer = null, cpuBusy = false, cpuPreview = null;
    // Full-screen game mode.
    let gameMode = false, wakeLock = null, titleAlert = '';
    const orient = new Map(), lastSpot = new Map(), sprites = new Map();
    const avatarCache = new Map();
    const prefs = { muted: false, vibrate: true, full: true };
    try {
        prefs.muted = localStorage.getItem('redmusica-pool-muted') === 'true';
        prefs.vibrate = localStorage.getItem('redmusica-pool-vibrar') !== 'false';
        prefs.full = localStorage.getItem('redmusica-pool-completa') !== 'false';
    } catch { /* Storage can be unavailable. */ }
    const savePref = (key, value) => { try { localStorage.setItem(key, String(value)); } catch { /* This visit only. */ } };
    let view = { portrait: false, scale: 1, width: 0, height: 0 };

    const enginePromise = import(ENGINE_URL).then(module => { E = module; bgKey = ''; draw(); return module; });

    const me = () => user?.id || LOCAL_ME;
    const online = () => mode === 'online';

    // ---------- server ----------
    async function request(action, extra = {}) {
        if (!online()) return localRequest(action, extra);
        if (spectating && action === 'leave') return { left: true };
        if (spectating && action === 'state') action = 'watch';
        if (!db) throw new Error('El juego en línea no está disponible. Recarga la página.');
        const { data: { session } } = await db.auth.getSession();
        if (!session) throw new Error('Inicia sesión para jugar en línea.');
        const response = await fetch(config.supabaseUrl + '/functions/v1/pool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: config.supabasePublishableKey, Authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify({ action, code: extra.code ?? roomCode, ...extra }),
            signal: AbortSignal.timeout(12000)
        });
        let result = {};
        try { result = await response.json(); } catch { /* handled below */ }
        if (!response.ok) throw new Error(result.error || (response.status === 404 ? 'El pool todavía no está disponible. Inténtalo más tarde.' : 'No se pudo actualizar la mesa.'));
        return result;
    }
    async function run(action, extra) {
        if (busy) return;
        busy = true; status(online() ? 'Un momento…' : ''); updateControls();
        try {
            const result = await request(action, extra);
            if (result.left) {
                if (online() && !spectating) await broadcastChange(roomCode, action, 'left');
                leaveView(); status(''); return;
            }
            if (action === 'join' || action === 'create') {
                spectating = !!result.spectator;
                if (spectating) status('La mesa ya tiene dos jugadores: estás mirando la partida en vivo.');
            }
            if ((online() || action !== 'shoot') && !(spectating && action === 'join')) status('');
            if (online() && action !== 'state' && action !== 'create') void broadcastChange(result.room.code, action, result.room.updated_at);
            await show(result.room);
        } catch (error) {
            status(error.message);
            if (!roomCode) exitFullscreen();
            if (/No encontramos esa sala|No formas parte/.test(error.message) && action !== 'join') leaveView();
        } finally { busy = false; updateControls(); schedule(); maybeCpu(); }
    }
    async function refresh(force = false) {
        if (!roomCode || !online() || busy || animating || (!force && (document.hidden || !visible()))) { schedule(); return; }
        try { await show((await request('state')).room); }
        catch (error) { status(error.message); if (/No encontramos esa sala|No formas parte/.test(error.message)) leaveView(); }
        finally { schedule(); }
    }
    function schedule() {
        clearTimeout(timer); timer = null;
        if (!roomCode || !online()) return;
        const mine = room && room.status === 'playing' && room.game && room.game.turn === me();
        timer = setTimeout(refresh, !visible() || document.hidden ? 6000 : mine ? 10000 : 3000);
    }
    const visible = () => !$('seccionPool') || !$('seccionPool').hidden;

    // Broadcast carries no game state. The server remains authoritative and polling remains a fallback.
    function subscribeRoom(code) {
        if (channel && channelCode === code) return;
        if (channel && db?.removeChannel) db.removeChannel(channel);
        clearTimeout(broadcastTimer); channel = null; channelCode = ''; subscribed = false;
        if (!db?.channel) return;
        channelCode = code;
        channel = db.channel('pool:' + code, { config: { broadcast: { self: false, ack: false } } });
        channel.on('broadcast', { event: 'changed' }, ({ payload }) => {
            if (!payload || payload.code !== roomCode || payload.sender === user?.id || payload.revision === room?.updated_at) return;
            clearTimeout(broadcastTimer);
            broadcastTimer = setTimeout(() => {
                if (Date.now() - lastBroadcastFetch < 500) return;
                lastBroadcastFetch = Date.now(); refresh(true);
            }, 60);
        }).on('broadcast', { event: 'aim' }, ({ payload }) => onRemoteAim(payload, false))
            .on('broadcast', { event: 'strike' }, ({ payload }) => onRemoteAim(payload, true))
            .subscribe(state => { subscribed = state === 'SUBSCRIBED'; if (subscribed) { lastAimSig = ''; requestDraw(); } });
    }
    function sendLive(event, payload) {
        if (!subscribed || !channel) return;
        try { Promise.resolve(channel.send({ type: 'broadcast', event, payload })).catch(() => {}); } catch { /* cosmetic */ }
    }

    // ---------- live cue: the shooter shares aim, power, spin and the cue ball in hand ----------
    // A few updates per second at most (only when something changed); the other screens glide between them.
    const AIM_EVERY_MS = 150;
    function aimPayload() {
        const c = pendingCue;
        return {
            code: roomCode, sender: user?.id, seq: room.game.seq,
            a: Math.round(Math.atan2(aim.dy, aim.dx) * 1000) / 1000, p: Number($('poolFuerza').value), s: spin, e: side,
            cue: c ? { x: Math.round(c.x), y: Math.round(c.y) } : null, hand: placing, call: calledPocket
        };
    }
    function queueAim() {
        if (!online() || spectating || !subscribed || animating || !room?.game || !myTurn()) return;
        const payload = aimPayload(), sig = JSON.stringify(payload);
        if (sig === lastAimSig) return;
        lastAimSig = sig; pendingAim = payload;
        if (!aimTimer) aimTimer = setTimeout(flushAim, Math.max(0, AIM_EVERY_MS - (Date.now() - lastAimSent)));
    }
    function flushAim() {
        aimTimer = null;
        if (!pendingAim || !myTurn() || animating) { pendingAim = null; return; }
        lastAimSent = Date.now(); sendLive('aim', pendingAim); pendingAim = null;
    }
    function sendStrike(shot) {
        if (!online() || spectating || !subscribed || !room?.game) return;
        clearTimeout(aimTimer); aimTimer = null; pendingAim = null;
        const payload = aimPayload();
        payload.a = Math.round(Math.atan2(shot.dy, shot.dx) * 1000) / 1000; payload.p = Math.round(shot.power * 100);
        payload.cue = shot.cue ? { x: Math.round(shot.cue.x), y: Math.round(shot.cue.y) } : null; payload.hand = false;
        sendLive('strike', payload);
    }
    const finite = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
    function onRemoteAim(payload, strike) {
        const game = room?.game;
        if (!payload || !game || payload.code !== roomCode || payload.sender === me() || payload.sender !== game.turn || payload.seq !== game.seq || animating) return;
        if (!finite(payload.a, -4, 4) || !finite(payload.p, 0, 100)) return;
        const cueSpot = payload.cue && finite(payload.cue.x, 0, 1000) && finite(payload.cue.y, 0, 500) ? { x: payload.cue.x, y: payload.cue.y } : null;
        const target = {
            a: payload.a, p: payload.p, s: finite(payload.s, -1, 1) ? payload.s : 0, e: finite(payload.e, -1, 1) ? payload.e : 0,
            cue: cueSpot, hand: payload.hand === true, call: Number.isInteger(payload.call) && payload.call >= 0 && payload.call < 6 ? payload.call : null
        };
        const now = performance.now();
        if (!remote || remote.seq !== payload.seq || remote.sender !== payload.sender) remote = { seq: payload.seq, sender: payload.sender, shown: { a: target.a, p: target.p, x: cueSpot?.x, y: cueSpot?.y } };
        remote.target = target; remote.at = now;
        if (strike) { remote.shown = { a: target.a, p: target.p, x: cueSpot?.x, y: cueSpot?.y }; remote.strike = now; }
        else remote.strike = null;
        updateControls();
        if (!remoteFrame) remoteFrame = requestAnimationFrame(remoteStep);
    }
    let remoteLast = 0;
    function remoteStep(now) {
        remoteFrame = 0;
        if (!remote || animating) { remoteLast = 0; return; }
        const dt = remoteLast ? Math.min(100, now - remoteLast) : 16;
        remoteLast = now;
        const k = 1 - Math.exp(-dt / 70), t = remote.target, sh = remote.shown;
        let da = t.a - sh.a;
        if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
        sh.a += da * k; sh.p += (t.p - sh.p) * k;
        if (t.cue) {
            if (!Number.isFinite(sh.x)) { sh.x = t.cue.x; sh.y = t.cue.y; }
            sh.x += (t.cue.x - sh.x) * k; sh.y += (t.cue.y - sh.y) * k;
        } else { sh.x = undefined; sh.y = undefined; }
        const moving = Math.abs(da) > 0.0005 || Math.abs(t.p - sh.p) > 0.2 || (t.cue && Math.hypot(t.cue.x - sh.x, t.cue.y - sh.y) > 0.3);
        const striking = remote.strike && now - remote.strike < 1200;
        draw();
        if (moving || striking) remoteFrame = requestAnimationFrame(remoteStep); else remoteLast = 0;
    }
    // Cue offset for the stroke animation (same curve as your own shot).
    function strokeAt(elapsed) {
        const t = Math.min(1, elapsed / 255);
        return t < 0.55 ? 78 * (t / 0.55) : 78 - (78 + 60) * ((t - 0.55) / 0.45);
    }
    function remoteView() {
        const game = room?.game;
        if (!remote || animating || !game || game.winner || remote.seq !== game.seq || game.turn !== remote.sender) return null;
        return remote;
    }
    async function broadcastChange(code, action, revision) {
        if (!subscribed || !channel || !code) return;
        try {
            await Promise.race([
                channel.send({ type: 'broadcast', event: 'changed', payload: { code, action, revision, sender: user?.id } }),
                new Promise(resolve => setTimeout(resolve, 700))
            ]);
        } catch { /* Polling still synchronizes both players. */ }
    }

    // ---------- local games: same engine, same rules, no server ----------
    const randomBytes = () => Array.from(crypto.getRandomValues(new Uint8Array(32)));
    async function startLocal(kind, level) {
        if (busy) return;
        prepareFullscreen();
        await enginePromise;
        if (roomCode) leaveView();
        mode = kind; cpuLevel = level || 'normal';
        const players = [{ user_id: me(), username: 'Tú' }];
        if (kind === 'cpu') players.push({ user_id: CPU, username: 'Máquina · ' + LEVEL_NAMES[cpuLevel] });
        local = { code: kind === 'cpu' ? 'MAQUINA' : 'PRACTICA', kind, host_id: me(), status: 'playing', players, rematch: [], turn_started_at: null, updated_at: '1', history: [], game: null };
        newLocalGame(me());
        status('');
        await show(localRoom());
        maybeCpu();
    }
    function newLocalGame(breaker) {
        local.game = E.newGame('local-' + Date.now(), [me(), local.kind === 'cpu' ? CPU : PRACTICE], breaker, randomBytes());
        local.status = 'playing'; local.history = []; local.updated_at = String(Date.now());
    }
    const localRoom = () => structuredClone({ code: local.code, host_id: local.host_id, status: local.status, players: local.players, game: local.game, rematch: [], turn_started_at: null, updated_at: local.updated_at });
    function afterLocalShot() {
        const g = local.game;
        // Practice: always your turn; fouls still give ball in hand so you can place the cue ball.
        if (local.kind === 'practice' && !g.winner && g.turn !== me()) g.turn = me();
        if (g.winner) local.status = 'finished';
        local.updated_at = String(Date.now());
    }
    async function localRequest(action, extra = {}) {
        await enginePromise;
        if (!local) throw new Error('La mesa ya no está disponible.');
        if (action === 'leave') { local = null; return { left: true }; }
        if (action === 'rematch') {
            const g = local.game;
            newLocalGame(local.kind === 'cpu' && g?.winner === me() ? CPU : me());
        } else if (action === 'undo') {
            if (local.history.length) { local.game = local.history.pop(); local.game.last = null; local.status = 'playing'; local.updated_at = String(Date.now()); }
        } else if (action === 'shoot') {
            const shot = { dx: Number(extra.dx), dy: Number(extra.dy), power: Number(extra.power) };
            if (extra.spin) shot.spin = Number(extra.spin);
            if (extra.side) shot.side = Number(extra.side);
            if (extra.call !== undefined && extra.call !== null) shot.call = Number(extra.call);
            if (extra.cue) shot.cue = { x: Number(extra.cue.x), y: Number(extra.cue.y) };
            const before = local.game;
            local.game = E.applyShot(before, me(), shot);
            if (local.kind === 'practice') { local.history.push(before); if (local.history.length > 40) local.history.shift(); }
            afterLocalShot();
        }
        return { room: localRoom() };
    }
    function maybeCpu() {
        if (mode !== 'cpu' || !local || cpuTimer || cpuBusy || busy) return;
        const g = local.game;
        if (!g || g.winner || g.turn !== CPU) return;
        cpuTimer = setTimeout(cpuTurn, animating ? 400 : 650);
    }
    async function cpuTurn() {
        cpuTimer = null;
        if (mode !== 'cpu' || !local || animating || busy) { maybeCpu(); return; }
        const game = local.game;
        if (game.winner || game.turn !== CPU) return;
        cpuBusy = true; renderPanel(); updateControls();
        try {
            const plan = await planCpuShot(game, CPU, cpuLevel);
            if (!local || local.game !== game) return;
            await showCpuAim(plan);
            if (!local || local.game !== game) return;
            local.game = E.applyShot(game, CPU, plan);
            afterLocalShot();
        } catch (error) {
            // Should not happen: fall back to a gentle legal-looking shot so the game never stalls.
            console.error('pool cpu', error);
            if (!local || local.game !== game) return;
            const target = game.balls.find(b => !b.p && b.n) || { x: 750, y: 250 }, c = game.balls.find(b => b.n === 0);
            const shot = { dx: target.x - (c.p ? 250 : c.x), dy: target.y - (c.p ? 250 : c.y) || 0.001, power: 0.4, ...(c.p ? { cue: { x: 250, y: 250 } } : {}), ...(E.mustCallEight(game, CPU) ? { call: 0 } : {}) };
            try { local.game = E.applyShot(game, CPU, shot); afterLocalShot(); } catch { local.game = { ...game, turn: me(), ballInHand: 'table' }; }
        } finally { cpuBusy = false; cpuPreview = null; }
        if (local) await show(localRoom());
        maybeCpu();
    }
    // The computer turns its cue onto the chosen line before shooting, so you can follow it.
    function showCpuAim(plan) {
        const cueBall = plan.cue || game0Cue();
        const target = Math.atan2(plan.dy, plan.dx);
        if (reduceMotion.matches || document.hidden || !visible()) return Promise.resolve();
        const from = target + (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.5);
        return new Promise(resolve => {
            const start = performance.now(), turn = 520, hold = 420;
            const step = now => {
                if (!local) { cpuPreview = null; resolve(); return; }
                const t = Math.min(1, (now - start) / turn), ease = 1 - (1 - t) * (1 - t);
                const a = from + (target - from) * ease;
                const pull = now - start > turn ? Math.min(1, (now - start - turn) / hold) : 0;
                cpuPreview = { cue: cueBall, dx: Math.cos(a), dy: Math.sin(a), power: plan.power, pull };
                draw();
                if (now - start < turn + hold) requestAnimationFrame(step); else resolve();
            };
            requestAnimationFrame(step);
        });
        function game0Cue() { const c = local.game.balls.find(b => b.n === 0); return { x: c.x, y: c.y }; }
    }

    // ---------- computer player ----------
    // It looks for straight-in shots (ghost ball on the line to a pocket), checks the paths are
    // clear, simulates the best candidates with the real engine, scores the outcome and then
    // shoots with a little human error that depends on the level.
    const LEVELS = {
        facil: { candidates: 8, noise: 2.6, powerNoise: 0.12, variants: 1, lookAhead: false, budget: 700, nudges: [0] },
        normal: { candidates: 12, noise: 0.9, powerNoise: 0.06, variants: 2, lookAhead: true, budget: 1300, nudges: [0, 0.03, -0.03] },
        dificil: { candidates: 16, noise: 0.25, powerNoise: 0.03, variants: 4, lookAhead: true, budget: 2000, nudges: [0, 0.02, -0.02, 0.045, -0.045] }
    };
    const POCKET_AIMS = [[0, 0], [500, -8], [1000, 0], [0, 500], [500, 508], [1000, 500]];
    const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const pause = () => new Promise(resolve => setTimeout(resolve, 0));
    function segmentClear(list, ax, ay, bx, by, ignore, width) {
        const ex = bx - ax, ey = by - ay, len2 = ex * ex + ey * ey || 1;
        for (const b of list) {
            if (ignore.includes(b.n)) continue;
            let t = ((b.x - ax) * ex + (b.y - ay) * ey) / len2; t = Math.max(0, Math.min(1, t));
            const dx = ax + ex * t - b.x, dy = ay + ey * t - b.y;
            if (dx * dx + dy * dy < width * width) return false;
        }
        return true;
    }
    // Straight-in options from a cue position: [{ target, pocket, dx, dy, cost }].
    function shotOptions(list, cuePos, targets) {
        const R = E.TABLE.radius, out = [];
        for (const t of targets) for (let i = 0; i < 6; i++) {
            const [px, py] = POCKET_AIMS[i];
            let ux = px - t.x, uy = py - t.y; const toPocket = Math.hypot(ux, uy); ux /= toPocket; uy /= toPocket;
            if ((i === 1 || i === 4) && Math.abs(uy) < 0.5) continue; // too shallow for a side pocket
            const gx = t.x - ux * 2 * R, gy = t.y - uy * 2 * R;
            const vx = gx - cuePos.x, vy = gy - cuePos.y, toGhost = Math.hypot(vx, vy);
            if (toGhost < 1) continue;
            const cut = (vx * ux + vy * uy) / toGhost;
            if (cut < 0.25) continue;
            if (!segmentClear(list, cuePos.x, cuePos.y, gx, gy, [0, t.n], 2 * R - 0.5)) continue;
            if (!segmentClear(list, t.x, t.y, px, py, [0, t.n], 2 * R - 1)) continue;
            out.push({ target: t, pocket: i, dx: vx, dy: vy, cost: toGhost * 0.6 + toPocket + (1 - cut) * 520, toGhost, toPocket });
        }
        return out.sort((a, b) => a.cost - b.cost);
    }
    function targetsFor(game, id) {
        const live = game.balls.filter(b => !b.p && b.n);
        const group = game.groups[id];
        if (!group) return live.filter(b => b.n !== 8);
        const own = live.filter(b => E.inGroup(group, b.n));
        return own.length ? own : live.filter(b => b.n === 8);
    }
    async function planCpuShot(game, id, level) {
        await enginePromise;
        const cfg = LEVELS[level] || LEVELS.normal, R = E.TABLE.radius, started = performance.now();
        const cueBall = game.balls.find(b => b.n === 0);
        if (game.breakShot) {
            let cuePos = { x: 250, y: 250 + Math.round((Math.random() - 0.5) * 120) };
            if (!E.validPlacement(game.balls, cuePos.x, cuePos.y, 'kitchen')) cuePos = { x: 250, y: 250 };
            const apex = game.balls.filter(b => !b.p && b.n).reduce((a, b) => (b.x < a.x ? b : a));
            const power = level === 'facil' ? 0.82 : level === 'normal' ? 0.93 : 1;
            return { dx: apex.x - cuePos.x, dy: apex.y - cuePos.y + gauss() * 1.5, power, cue: cuePos };
        }
        const list = game.balls.filter(b => !b.p && b.n);
        const targets = targetsFor(game, id), mustCall = E.mustCallEight(game, id);
        const candidates = [];
        if (game.ballInHand) {
            // Place the cue ball behind a ghost ball for a straight shot.
            for (const t of targets) for (let i = 0; i < 6; i++) {
                const [px, py] = POCKET_AIMS[i];
                let ux = px - t.x, uy = py - t.y; const d = Math.hypot(ux, uy); ux /= d; uy /= d;
                if ((i === 1 || i === 4) && Math.abs(uy) < 0.5) continue;
                if (!segmentClear(list, t.x, t.y, px, py, [t.n], 2 * R - 1)) continue;
                for (const back of [90, 160, 240]) {
                    const cue = { x: Math.round((t.x - ux * (2 * R + back)) * 10) / 10, y: Math.round((t.y - uy * (2 * R + back)) * 10) / 10 };
                    if (!E.validPlacement(game.balls, cue.x, cue.y, game.ballInHand)) continue;
                    const options = shotOptions(list, cue, [t]).filter(o => o.pocket === i);
                    if (options.length) { candidates.push({ ...options[0], cue }); break; }
                }
            }
            candidates.sort((a, b) => a.cost - b.cost);
        } else if (cueBall && !cueBall.p) candidates.push(...shotOptions(list, cueBall, targets));
        const tries = [];
        for (const c of candidates.slice(0, cfg.candidates)) {
            const base = Math.max(0.18, Math.min(0.9, 0.16 + (c.toGhost + c.toPocket * 1.25) / 1500));
            const variants = [[base, 0], [base * 1.3, 0], [base, -0.5], [base * 0.85, 0.5]].slice(0, cfg.variants);
            // Small angle nudges let better players allow for throw on cut shots.
            for (const [power, spinValue] of variants) for (const turn of cfg.nudges) {
                const cs = Math.cos(turn), sn = Math.sin(turn);
                tries.push({ dx: c.dx * cs - c.dy * sn, dy: c.dx * sn + c.dy * cs, power: Math.min(1, power), spin: spinValue, cue: c.cue, call: c.pocket });
            }
        }
        // Nothing straight: hit an own ball directly (or anything legal) and hope for the best.
        if (!tries.length) {
            const from = game.ballInHand ? null : cueBall;
            for (const t of targets.slice(0, 8)) {
                let cue = null, origin = from;
                if (!origin) {
                    for (const [ox, oy] of [[-120, 0], [120, 0], [0, -120], [0, 120], [-80, -80], [80, 80]]) {
                        const spot = { x: t.x + ox, y: t.y + oy };
                        if (E.validPlacement(game.balls, spot.x, spot.y, game.ballInHand)) { cue = spot; origin = spot; break; }
                    }
                }
                if (!origin) continue;
                for (const power of [0.35, 0.6]) tries.push({ dx: t.x - origin.x, dy: t.y - origin.y, power, cue, call: nearestPocketIndex(t) });
            }
            for (let k = 0; tries.length < 6 && k < 12; k++) {
                const a = Math.random() * Math.PI * 2;
                let cue = null;
                if (game.ballInHand) { cue = { x: 250, y: 120 + Math.random() * 260 }; if (!E.validPlacement(game.balls, cue.x, cue.y, game.ballInHand)) continue; }
                tries.push({ dx: Math.cos(a), dy: Math.sin(a), power: 0.5, cue, call: 0 });
            }
        }
        let scored = [];
        for (let i = 0; i < tries.length; i++) {
            const t = tries[i];
            const shot = { dx: t.dx, dy: t.dy, power: t.power, ...(t.spin ? { spin: t.spin } : {}), ...(mustCall ? { call: t.call ?? 0 } : {}), ...(t.cue ? { cue: t.cue } : {}) };
            let next;
            try { next = E.applyShot(game, id, shot); } catch { continue; }
            scored.push({ shot, score: scoreOutcome(next, id, cfg) + Math.random() });
            if (i % 3 === 2) { await pause(); if (performance.now() - started > cfg.budget) break; }
        }
        if (!scored.length) return { dx: 1, dy: 0.01, power: 0.5, ...(game.ballInHand ? { cue: { x: 200, y: 250 } } : {}), ...(mustCall ? { call: 0 } : {}) };
        scored.sort((a, b) => b.score - a.score);
        let pick = scored[0];
        if (level === 'facil') { const close = scored.filter(s => s.score > pick.score - 350).slice(0, 3); pick = close[Math.floor(Math.random() * close.length)]; }
        // Human error: a small angle and power wobble.
        const angle = Math.atan2(pick.shot.dy, pick.shot.dx) + gauss() * cfg.noise * Math.PI / 180;
        const power = Math.max(0.08, Math.min(1, pick.shot.power * (1 + gauss() * cfg.powerNoise)));
        await new Promise(resolve => setTimeout(resolve, Math.max(0, 350 - (performance.now() - started))));
        return { ...pick.shot, dx: Math.cos(angle), dy: Math.sin(angle), power };
    }
    function nearestPocketIndex(b) {
        let best = 0, bestD = Infinity;
        POCKET_AIMS.forEach(([x, y], i) => { const d = Math.hypot(x - b.x, y - b.y); if (d < bestD) { bestD = d; best = i; } });
        return best;
    }
    function scoreOutcome(next, id, cfg) {
        if (next.winner) return next.winner === id ? 100000 : -100000;
        const s = next.last.summary, mine = next.groups[id];
        let value = 0;
        if (s.foul) value -= 450;
        for (const n of s.pocketed) {
            if (n === 8) continue;
            value += !mine || E.inGroup(mine, n) ? 230 : -60;
        }
        if (s.continued) {
            value += 260;
            if (cfg.lookAhead) {
                const c = next.balls.find(b => b.n === 0);
                if (c && !c.p) value += Math.min(4, shotOptions(next.balls.filter(b => !b.p && b.n), c, targetsFor(next, id)).length) * 55;
            }
        } else if (!s.foul && cfg.lookAhead) {
            // Leaving the rival without an easy shot is worth something.
            const rival = next.players.find(p => p !== id), c = next.balls.find(b => b.n === 0);
            if (c && !c.p) value -= Math.min(3, shotOptions(next.balls.filter(b => !b.p && b.n), c, targetsFor(next, rival)).length) * 35;
        }
        return value;
    }

    // ---------- state ----------
    async function show(next) {
        if (animating) { queued = next; return; }
        const entering = !roomCode;
        const wasMyTurn = myTurn();
        room = next; roomCode = next.code;
        if (online()) { subscribeRoom(next.code); rememberInvite(); }
        $('poolEntrada').hidden = true; $('poolMesa').hidden = false;
        $('poolCodigoSala').textContent = online() ? next.code : '';
        $('poolMirando').hidden = !(online() && spectating);
        $('poolMesa').classList.toggle('pool-espectador', online() && spectating);
        if (entering && wantsGameMode()) enterGameMode();
        await enginePromise;
        const game = next.game;
        if (game && (!shownGame || shownGame !== game.id)) {
            shownGame = game.id; shownSeq = game.seq; balls = game.balls; pendingCue = null; placing = false; placementValid = null;
            orient.clear(); lastSpot.clear(); sprites.clear(); calledPocket = null; drops = [];
            aim = { dx: 1, dy: 0 }; remote = null; lastAimSig = '';
        } else if (game && game.seq !== shownSeq) {
            const last = game.last;
            remote = null; lastAimSig = '';
            if (last && last.shot && last.seq === game.seq && game.seq === shownSeq + 1 && !reduceMotion.matches && !document.hidden && visible()) await animate(last);
            shownSeq = game.seq; balls = game.balls; pendingCue = null; calledPocket = null;
            if (last) status(describe(last.summary, game));
        }
        if (game && game.ballInHand && game.turn === me() && cue()?.p) placing = true;
        if (!game?.ballInHand) placing = false;
        renderPanel(); renderGutter(); draw(); updateControls(); loadAvatars(next.players);
        if (!ringTimer) ringTimer = setInterval(updateTurnRing, 1000);
        updateTurnRing();
        if (!entering && !wasMyTurn && myTurn() && online()) { vibrate(40); alertTurn(); }
        if (entering || (!wasMyTurn && myTurn())) scrollPoolIntoView();
        if (queued) { const again = queued; queued = null; await show(again); }
    }
    function scrollPoolIntoView() {
        if (gameMode || window.innerWidth >= 560 || document.hidden || !visible()) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!roomCode || !visible() || gameMode) return;
            const stickyBottom = Math.max(
                document.querySelector('.cabecera-sitio')?.getBoundingClientRect().bottom || 0,
                document.querySelector('.sidebar-nav')?.getBoundingClientRect().bottom || 0
            ) + 5;
            const top = $('poolBarra').getBoundingClientRect().top + window.scrollY - stickyBottom;
            window.scrollTo(0, Math.max(0, top));
        }));
    }
    function leaveView() {
        const wasOnline = online();
        room = null; roomCode = ''; shownGame = null; shownSeq = -1; balls = []; pendingCue = null; placing = false; placementValid = null;
        clearTimeout(cpuTimer); cpuTimer = null; cpuPreview = null; local = null; mode = 'online';
        spectating = false; remote = null; lastAimSig = ''; clearTimeout(aimTimer); aimTimer = null; pendingAim = null;
        $('poolMirando').hidden = true; $('poolMesa').classList.remove('pool-espectador');
        if (channel && db?.removeChannel) db.removeChannel(channel);
        channel = null; channelCode = ''; subscribed = false;
        clearTimeout(broadcastTimer); broadcastTimer = null;
        clearInterval(ringTimer); ringTimer = null;
        gutterSignature = ''; $('poolCanaleta').replaceChildren();
        clearTimeout(timer); timer = null;
        closeSpinPanel();
        exitGameMode(false);
        $('poolEntrada').hidden = false; $('poolMesa').hidden = true;
        if (wasOnline) {
            const url = new URL(location.href);
            if (url.searchParams.has('pool')) { url.searchParams.delete('pool'); history.replaceState(null, '', url); }
        }
        loadRecord();
    }
    function rememberInvite() {
        const url = new URL(location.href);
        if (url.searchParams.get('pool') === roomCode) return;
        url.searchParams.set('seccion', 'pool'); url.searchParams.set('pool', roomCode);
        history.replaceState(history.state, '', url);
    }
    const nameOf = id => id === CPU ? 'la máquina' : room?.players.find(p => p.user_id === id)?.username || 'Rival';
    const cue = () => balls.find(b => b.n === 0);
    const myTurn = () => !!(room && room.status === 'playing' && room.game && room.game.turn === me() && !room.game.winner && !cpuBusy);
    function describe(summary, game) {
        if (!summary) return '';
        const mine = summary.by === me();
        const who = mine ? 'Tú' : summary.by === CPU ? 'La máquina' : nameOf(summary.by);
        const parts = [];
        const list = summary.pocketed || [];
        if (list.length) parts.push(`${who} ${mine ? 'metiste' : 'metió'} ${list.length === 1 ? 'la ' + list[0] : 'las ' + list.slice(0, -1).join(', ') + ' y ' + list.at(-1)}.`);
        else if (!summary.foul) parts.push(`${who}: ninguna bola entró.`);
        if (summary.respotted) parts.push('La 8 entró en el saque y volvió a su lugar.');
        if (summary.assigned) parts.push(`${mine ? 'Juegas' : (summary.by === CPU ? 'La máquina' : nameOf(summary.by)) + ' juega'} con las ${GROUP_NAMES[summary.assigned]}.`);
        if (summary.foul) parts.push('Falta: ' + summary.foul + ' ' + (game.turn === me() ? 'Tienes bola en mano.' : (game.turn === CPU ? 'La máquina' : nameOf(game.turn)) + ' tiene bola en mano.'));
        else if (summary.continued && !game.winner) parts.push(mine ? 'Sigues tirando.' : 'Sigue tirando.');
        return parts.join(' ');
    }

    // ---------- panel ----------
    function renderPanel() {
        const game = room.game, list = $('poolJugadores');
        list.replaceChildren();
        for (const player of room.players) {
            const li = document.createElement('li');
            li.className = 'pool-jugador';
            if (game && game.turn === player.user_id && room.status === 'playing') li.classList.add('pool-turno-activo');
            const avatar = document.createElement('span'); avatar.className = 'pool-avatar'; avatar.setAttribute('aria-hidden', 'true');
            const face = document.createElement('span'); face.className = 'pool-avatar-cara';
            face.textContent = player.user_id === CPU ? '🤖' : player.username.slice(0, 1).toUpperCase();
            if (player.user_id === CPU) face.classList.add('pool-avatar-cpu');
            const updated = avatarCache.get(player.user_id);
            if (updated && UUID.test(player.user_id) && config?.supabaseUrl) {
                const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
                img.src = config.supabaseUrl + '/storage/v1/object/public/avatars/' + player.user_id + '/avatar.jpg?v=' + encodeURIComponent(updated);
                img.addEventListener('error', () => img.remove()); face.append(img);
            }
            avatar.append(face);
            const identity = document.createElement('span'); identity.className = 'pool-jugador-datos';
            const name = document.createElement('strong');
            name.textContent = player.username + (online() && player.user_id === me() ? ' (tú)' : '');
            const detail = document.createElement('span');
            const group = game?.groups?.[player.user_id];
            const left = group ? balls.filter(b => !b.p && (group === 'solids' ? b.n >= 1 && b.n <= 7 : b.n >= 9)).length : null;
            detail.textContent = !game ? 'En la sala' : group ? `${GROUP_NAMES[group]} · ${left ? 'quedan ' + left : 'va por la 8'}` : mode === 'practice' ? 'Práctica libre' : 'Mesa abierta';
            identity.append(name, detail);
            if (group) {
                const dots = document.createElement('span'); dots.className = 'pool-restantes'; dots.setAttribute('aria-hidden', 'true');
                balls.filter(b => !b.p && (group === 'solids' ? b.n >= 1 && b.n <= 7 : b.n >= 9)).forEach(b => { const d = document.createElement('i'); d.style.setProperty('--bola', COLORS[b.n > 8 ? b.n - 8 : b.n]); if (b.n > 8) d.className = 'rayada'; dots.append(d); });
                identity.append(dots);
            }
            li.append(avatar, identity);
            list.append(li);
        }
        if (online() && room.players.length < 2) { const li = document.createElement('li'); li.className = 'pool-jugador pool-esperando'; li.textContent = 'Esperando rival…'; list.append(li); }
        const tableName = $('poolNombreMesa').firstChild;
        tableName.nodeValue = online() ? 'Sala ' : mode === 'cpu' ? 'Contra la máquina · ' + LEVEL_NAMES[cpuLevel] : 'Práctica libre';
        $('poolInvitar').hidden = !online();
        const turn = $('poolTurno');
        const won = game?.winner === me();
        if (room.status === 'lobby' || !game) turn.textContent = `Comparte el código ${room.code} o el enlace de invitación para que alguien se una.`;
        else if (game.winner) turn.textContent = mode === 'practice' ? 'Mesa terminada. ' + (game.reason || '') : (won ? '¡Ganaste! ' : `Ganó ${game.winner === CPU ? 'la máquina' : nameOf(game.winner)}. `) + (game.reason || '');
        else if (myTurn()) turn.textContent = game.ballInHand ? (game.ballInHand === 'kitchen' ? 'Saque: puedes mover la blanca detrás de la línea y luego tirar.' : 'Bola en mano: coloca la blanca donde quieras y tira.') : needsCall() ? 'Vas por la 8: toca la tronera donde la meterás y luego tira.' : 'Te toca. ' + (coarse.matches ? 'Desliza por la mesa para apuntar y baja la barra de fuerza.' : 'Toca o arrastra sobre la mesa para apuntar y elige la fuerza.');
        else if (game.turn === CPU) turn.textContent = cpuBusy ? 'La máquina está pensando…' : 'Turno de la máquina.';
        else turn.textContent = `Turno de ${nameOf(game.turn)}.`;
        turn.dataset.base = turn.textContent;
        $('poolCantar').hidden = !needsCall();
        const finished = room.status === 'finished';
        $('poolFinal').hidden = !finished;
        if (finished && game) {
            $('poolFinalTitulo').textContent = mode === 'practice' ? (won ? '¡Mesa limpia!' : 'Mesa terminada') : won ? '¡Ganaste!' : 'Perdiste';
        }
        const rematch = $('poolRevancha'), votes = room.rematch || [];
        rematch.hidden = !finished || spectating || (online() && room.players.length < 2);
        rematch.disabled = online() && votes.includes(me());
        rematch.textContent = !online() ? (mode === 'practice' ? 'Nueva mesa' : 'Jugar otra vez') : votes.includes(me()) ? 'Esperando respuesta…' : votes.length ? 'Aceptar revancha' : 'Pedir revancha';
        $('poolResultado').textContent = finished && online() && room.players.length < 2 ? 'Tu rival salió. Puedes esperar a que alguien más se una con el código.' : finished ? (game?.reason || '') : '';
        const claimable = online() && !spectating && room.status === 'playing' && game && !myTurn() && Number.isFinite(room.turn_started_at) && Date.now() - room.turn_started_at >= TURN_LIMIT_MS;
        $('poolReclamar').hidden = !claimable;
    }
    async function loadAvatars(players) {
        const ids = players.map(p => p.user_id).filter(id => UUID.test(id) && !avatarCache.has(id));
        if (!ids.length || !db?.from) return;
        ids.forEach(id => avatarCache.set(id, null));
        try {
            const query = db.from('profiles').select('id,avatar_updated_at');
            if (typeof query.in !== 'function') return;
            const { data, error } = await query.in('id', ids);
            if (error || !data) return;
            data.forEach(profile => avatarCache.set(profile.id, profile.avatar_updated_at || null));
            if (room && data.some(profile => room.players.some(p => p.user_id === profile.id))) { renderPanel(); updateTurnRing(); }
        } catch { /* Initials are the fallback. */ }
    }
    // 60-second shot clock (online only): the ring empties, the last 15 s are shown, and when the
    // opponent runs out this page asks the server for the timeout foul (the server checks the time itself).
    function updateTurnRing() {
        const avatar = $('poolJugadores').querySelector('.pool-turno-activo .pool-avatar');
        if (!online() || !room?.turn_started_at || room.status !== 'playing' || !room.game || room.game.winner) return;
        const elapsed = Math.max(0, Date.now() - Number(room.turn_started_at)), left = Math.ceil((SHOT_CLOCK_MS - elapsed) / 1000);
        if (avatar) avatar.style.setProperty('--turn-progress', Math.max(0, 100 - elapsed / SHOT_CLOCK_MS * 100) + '%');
        const turn = $('poolTurno'), base = turn.dataset.base || turn.textContent;
        turn.textContent = left <= 15 && left > 0 && !animating ? `${base} · ${left} s` : base;
        turn.classList.toggle('pool-turno-urgente', left <= 10 && left > 0);
        if (myTurn() && left === 10) vibrate(25);
        const recent = timeoutSentFor && timeoutSentFor.seq === room.game.seq && Date.now() - timeoutSentFor.at < 10000;
        if (!myTurn() && !spectating && elapsed >= SHOT_CLOCK_MS + 1500 && !recent && !busy && !animating) {
            // Clocks can differ a little; the server has the final word and a refusal is retried later.
            timeoutSentFor = { seq: room.game.seq, at: Date.now() };
            request('timeout').then(result => { void broadcastChange(result.room.code, 'timeout', result.room.updated_at); return show(result.room); }).catch(() => {});
        }
    }
    function renderGutter(list = balls) {
        const pocketed = list.filter(b => b.n && b.p).map(b => b.n).sort((a, b) => a - b);
        const signature = pocketed.join(',');
        if (signature === gutterSignature) return;
        gutterSignature = signature;
        const holder = $('poolCanaleta'); holder.replaceChildren();
        holder.parentElement.setAttribute('aria-label', pocketed.length ? 'Bolas metidas: ' + pocketed.join(', ') : 'Todavía no hay bolas metidas');
        for (const n of pocketed) {
            const item = document.createElement('span'); item.className = 'pool-bola-metida' + (n > 8 ? ' rayada' : '');
            item.style.setProperty('--bola', COLORS[n > 8 ? n - 8 : n]); item.textContent = String(n); item.setAttribute('aria-hidden', 'true');
            holder.append(item);
        }
    }
    function updateControls() {
        const active = myTurn() && !busy && !animating && !striking && !!E;
        $('poolControles').hidden = !(room && room.status === 'playing') || spectating;
        for (const id of ['poolTirar', 'poolGirarIzq', 'poolGirarDer', 'poolFuerza']) $(id).disabled = !active;
        for (const id of ['poolRueda', 'poolPotencia', 'poolEfecto']) { $(id).setAttribute('aria-disabled', String(!active)); $(id).tabIndex = active ? 0 : -1; }
        const hand = active && !!room.game.ballInHand;
        $('poolMoverBlanca').hidden = !hand;
        $('poolMoverBlanca').setAttribute('aria-pressed', String(placing));
        $('poolMoverBlanca').textContent = placing ? 'Listo, ahora apunta' : 'Mover la blanca';
        $('poolDeshacer').hidden = !(mode === 'practice' && local?.history.length);
        $('poolDeshacer').disabled = busy || animating || striking;
        frame.classList.toggle('pool-interactivo', active);
        canvas.setAttribute('aria-label', tableDescription());
        if (!active) closeSpinPanel();
    }
    function tableDescription() {
        if (!room?.game) return 'Mesa de pool vacía';
        const onTable = balls.filter(b => !b.p && b.n).map(b => b.n);
        const watching = remoteView() ? `${nameOf(remote.sender)} está apuntando.` : '';
        return `Mesa de pool. Bolas en la mesa: ${onTable.join(', ') || 'ninguna'}. ${myTurn() ? 'Usa las flechas izquierda y derecha para apuntar, arriba y abajo para la fuerza, y Enter para tirar.' : watching}`;
    }
    function status(message) {
        const el = $('poolEstado');
        el.textContent = message;
        el.classList.remove('pool-estado-oculto');
        clearTimeout(statusTimer);
        if (gameMode && message) statusTimer = setTimeout(() => el.classList.add('pool-estado-oculto'), 4200);
    }
    function alertTurn() {
        if (!document.hidden || document.title.startsWith('🎱')) return;
        titleAlert = document.title; document.title = '🎱 ¡Te toca! · ' + titleAlert;
    }

    // ---------- full-screen game mode ----------
    const fullscreenSupported = () => !!(document.documentElement.requestFullscreen && document.fullscreenEnabled !== false);
    const wantsGameMode = () => coarse.matches && prefs.full;
    function prepareFullscreen() {
        // Called from a tap, so the browser allows full screen; the layout switches when the table appears.
        if (wantsGameMode() && fullscreenSupported() && !document.fullscreenElement) {
            document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
        }
    }
    function exitFullscreen() { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); }
    function enterGameMode(requestFull = false) {
        if (!gameMode) {
            gameMode = true;
            document.body.classList.add('pool-modo-juego');
            // The Android back gesture leaves the game view first instead of the page.
            try { if (!history.state?.poolJuego) history.pushState({ ...(history.state || {}), poolJuego: true }, '', location.href); } catch { /* optional */ }
        }
        if (requestFull && fullscreenSupported() && !document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
        keepAwake(); updateGameButtons(); scheduleResize();
    }
    function exitGameMode(popHistory = true) {
        if (!gameMode) { exitFullscreen(); return; }
        gameMode = false;
        document.body.classList.remove('pool-modo-juego');
        exitFullscreen();
        try { screen.orientation?.unlock?.(); } catch { /* optional */ }
        if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
        if (history.state?.poolJuego) {
            if (popHistory) history.back();
            else { const { poolJuego, ...rest } = history.state; history.replaceState(Object.keys(rest).length ? rest : null, '', location.href); }
        }
        $('poolEstado').classList.remove('pool-estado-oculto');
        updateGameButtons(); scheduleResize(); scrollPoolIntoView();
    }
    async function keepAwake() {
        if (!gameMode || document.hidden || wakeLock || !navigator.wakeLock) return;
        try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener?.('release', () => { wakeLock = null; }); } catch { /* optional */ }
    }
    function updateGameButtons() {
        const full = !!document.fullscreenElement, button = $('poolPantalla');
        const leave = gameMode && (full || !fullscreenSupported());
        button.setAttribute('aria-pressed', String(gameMode));
        button.setAttribute('aria-label', leave ? 'Salir de pantalla completa' : 'Pantalla completa');
        button.querySelector('.pool-accion-icono').textContent = leave ? '⇲' : '⛶';
        button.querySelector('.pool-accion-texto').textContent = leave ? 'Salir de pantalla completa' : 'Pantalla completa';
        $('poolGirar').hidden = !(gameMode && full && screen.orientation?.lock);
    }
    $('poolPantalla').addEventListener('click', () => {
        if (!gameMode) enterGameMode(true);
        else if (!document.fullscreenElement && fullscreenSupported()) enterGameMode(true);
        else exitGameMode();
    });
    $('poolGirar').addEventListener('click', () => {
        const landscape = (screen.orientation?.type || '').startsWith('landscape');
        screen.orientation.lock(landscape ? 'portrait' : 'landscape').catch(() => status('Este teléfono no permite girar la pantalla desde aquí.'));
    });
    document.addEventListener('fullscreenchange', () => { updateGameButtons(); scheduleResize(); });
    window.addEventListener('popstate', () => { if (gameMode && !history.state?.poolJuego) exitGameMode(false); });

    // ---------- geometry ----------
    function resize() {
        const width = frame.clientWidth;
        if (!width) return;
        let availableH = Infinity;
        if (gameMode) {
            availableH = frame.clientHeight;
            view.portrait = availableH > width * 1.05;
        } else {
            view.portrait = width < 560;
            if (view.portrait) {
                const heightLimit = parseFloat(getComputedStyle(frame).maxHeight);
                availableH = Math.max(320, Number.isFinite(heightLimit) ? heightLimit : window.innerHeight - 205);
            }
        }
        const worldW = view.portrait ? 500 + 2 * RAIL : 1000 + 2 * RAIL, worldH = view.portrait ? 1000 + 2 * RAIL : 500 + 2 * RAIL;
        const cssW = Math.max(180, Math.min(width, availableH * worldW / worldH));
        const cssH = cssW * worldH / worldW, dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cssWidth = cssW + 'px', cssHeight = cssH + 'px';
        if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
        if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
        const pixelWidth = Math.round(cssW * dpr), pixelHeight = Math.round(cssH * dpr);
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
        view.scale = canvas.width / worldW; view.width = canvas.width; view.height = canvas.height; view.dpr = dpr;
        draw();
    }
    // World (0..1000, 0..500) to canvas pixels; portrait turns the table so the rack is at the bottom.
    const toScreen = (x, y) => view.portrait ? [(RAIL + y) * view.scale, (RAIL + x) * view.scale] : [(RAIL + x) * view.scale, (RAIL + y) * view.scale];
    function toWorld(event) {
        const rect = canvas.getBoundingClientRect();
        const sx = (event.clientX - rect.left) * canvas.width / rect.width / view.scale - RAIL, sy = (event.clientY - rect.top) * canvas.height / rect.height / view.scale - RAIL;
        return view.portrait ? { x: sy, y: sx } : { x: sx, y: sy };
    }

    // ---------- drawing ----------
    // The table itself only changes with the size, so it is drawn once into its own canvas.
    const bg = document.createElement('canvas'), bgCtx = bg.getContext('2d');
    let bgKey = '';
    function paintTable() {
        const key = [view.width, view.height, view.portrait, !!E].join(':');
        if (key === bgKey) return;
        bgKey = key; bg.width = view.width; bg.height = view.height;
        const c = bgCtx, s = view.scale;
        const [ox, oy] = toScreen(0, 0), [fx, fy] = toScreen(1000, 500);
        const left = Math.min(ox, fx), top = Math.min(oy, fy), w = Math.abs(fx - ox), h = Math.abs(fy - oy);
        const wood = c.createLinearGradient(0, 0, view.width, view.height);
        wood.addColorStop(0, '#7a4f35'); wood.addColorStop(1, '#5a3727');
        roundRect(c, 0, 0, view.width, view.height, 18 * s); c.fillStyle = wood; c.fill();
        c.strokeStyle = '#ffffff1a'; c.lineWidth = Math.max(1, 2 * s); roundRect(c, 3 * s, 3 * s, view.width - 6 * s, view.height - 6 * s, 16 * s); c.stroke();
        c.fillStyle = '#2f6a58'; c.fillRect(left - 8 * s, top - 8 * s, w + 16 * s, h + 16 * s);
        const felt = c.createRadialGradient(left + w / 2, top + h / 2, 10, left + w / 2, top + h / 2, Math.max(w, h) * 0.7);
        felt.addColorStop(0, '#3f8a72'); felt.addColorStop(1, '#2f6f5c');
        c.fillStyle = felt; c.fillRect(left, top, w, h);
        c.fillStyle = '#e9dcc2';
        for (let i = 1; i < 8; i++) if (i !== 4) for (const y of [-RAIL / 2, 500 + RAIL / 2]) dot(c, ...toScreen(i * 125, y), 2.4 * s);
        for (let i = 1; i < 4; i++) for (const x of [-RAIL / 2, 1000 + RAIL / 2]) dot(c, ...toScreen(x, i * 125), 2.4 * s);
        c.strokeStyle = '#255a4b'; c.lineWidth = Math.max(2, 5 * s); c.lineCap = 'round';
        for (const [x1, y1, x2, y2] of (E?.CUSHIONS || [])) { c.beginPath(); c.moveTo(...toScreen(x1, y1)); c.lineTo(...toScreen(x2, y2)); c.stroke(); }
        c.lineCap = 'butt';
        c.strokeStyle = '#ffffff33'; c.lineWidth = Math.max(1, s); c.beginPath(); c.moveTo(...toScreen(250, 0)); c.lineTo(...toScreen(250, 500)); c.stroke();
        c.fillStyle = '#ffffff55'; dot(c, ...toScreen(750, 250), 2.5 * s);
        for (const p of (E?.POCKETS || [])) {
            const [px, py] = toScreen(p.x, p.y), r = (p.r - 2) * s;
            const hole = c.createRadialGradient(px, py, r * 0.2, px, py, r);
            hole.addColorStop(0, '#050404'); hole.addColorStop(1, '#221a1b');
            c.fillStyle = hole; dot(c, px, py, r);
        }
    }
    function requestDraw() { if (!drawQueued) drawQueued = requestAnimationFrame(() => { drawQueued = 0; draw(); }); }
    function draw(list = balls) {
        if (!view.width) return;
        const s = view.scale;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        paintTable();
        ctx.clearRect(0, 0, view.width, view.height);
        ctx.drawImage(bg, 0, 0);
        if (E && room?.game && needsCall() && !animating) {
            const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 260);
            E.POCKETS.forEach((p, i) => {
                const [px, py] = toScreen(p.x, p.y), chosen = i === calledPocket;
                ctx.strokeStyle = chosen ? '#f2c14e' : `rgba(242, 193, 78, ${calledPocket === null ? 0.35 + 0.4 * pulse : 0.22})`;
                ctx.lineWidth = (chosen ? 4 : 2) * s; ctx.setLineDash(chosen ? [] : [4 * s, 4 * s]);
                ctx.beginPath(); ctx.arc(px, py, (p.r + 6) * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
                if (chosen) { ctx.fillStyle = '#f2c14e'; ctx.font = `700 ${Math.max(10, 15 * s)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('8', px, py); }
            });
            if (calledPocket === null && !callPulse) callPulse = requestAnimationFrame(() => { callPulse = 0; draw(); });
        }
        if (!list.length) { drawEmpty(); return; }
        const game = room?.game;
        const showAim = myTurn() && !animating && !busy && !placing && E;
        const preview = cpuPreview && E && !animating ? cpuPreview : null;
        const rival = E && !preview ? remoteView() : null;
        const rivalCue = rival && Number.isFinite(rival.shown.x) ? { x: rival.shown.x, y: rival.shown.y } : null;
        const moved = preview?.cue || rivalCue || pendingCue;
        const cueBall = moved ? { n: 0, x: moved.x, y: moved.y, p: 0 } : list.find(b => b.n === 0);
        const shown = list.map(b => b.n === 0 && moved ? cueBall : b);
        if (showAim && cueBall && !cueBall.p) drawAim(shown, cueBall);
        const rivalDir = rival ? { dx: Math.cos(rival.shown.a), dy: Math.sin(rival.shown.a) } : null;
        if (rival && !rival.target.hand && !rival.strike && cueBall && !cueBall.p) drawAim(shown, cueBall, rivalDir, rival.target.s, 0.55);
        if (rival && rival.target.call !== null) {
            const p = E.POCKETS[rival.target.call], [px, py] = toScreen(p.x, p.y);
            ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.arc(px, py, (p.r + 6) * s, 0, Math.PI * 2); ctx.stroke();
        }
        for (const b of shown) if (!b.p) drawShadow(b);
        drawDrops();
        for (const b of shown) if (!b.p) drawBall(b);
        if (placing && game?.ballInHand && pendingCue) {
            const ok = E.validPlacement(list, pendingCue.x, pendingCue.y, game.ballInHand);
            ctx.strokeStyle = ok ? '#fffdf9' : '#ff6a60'; ctx.lineWidth = 3 * s; ctx.setLineDash([4 * s, 3 * s]);
            ctx.beginPath(); ctx.arc(...toScreen(pendingCue.x, pendingCue.y), (E.TABLE.radius + 6) * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
            const [hx, hy] = toScreen(pendingCue.x, pendingCue.y);
            ctx.fillStyle = ok ? '#fffdf9' : '#ff6a60'; ctx.font = `${Math.max(15, 24 * s)}px system-ui, sans-serif`; ctx.textAlign = 'center';
            ctx.fillText('✋', hx + 20 * s, hy - 17 * s);
        }
        if (placing && game?.ballInHand === 'kitchen') { ctx.fillStyle = '#ffffff14'; const [kx, ky] = toScreen(0, 0), [kx2, ky2] = toScreen(250, 500); ctx.fillRect(Math.min(kx, kx2), Math.min(ky, ky2), Math.abs(kx2 - kx), Math.abs(ky2 - ky)); }
        if (showAim && cueBall && !cueBall.p) drawCue(cueBall, aim, Number($('poolFuerza').value) / 100, cueStroke);
        else if (preview && cueBall && !cueBall.p) drawCue(cueBall, preview, preview.power, 28 * preview.pull);
        else if (rival && cueBall && !cueBall.p) {
            if (rival.target.hand) {
                const [hx, hy] = toScreen(cueBall.x, cueBall.y);
                ctx.strokeStyle = '#fffdf9aa'; ctx.lineWidth = 2 * s; ctx.setLineDash([4 * s, 3 * s]);
                ctx.beginPath(); ctx.arc(hx, hy, (E.TABLE.radius + 6) * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
                ctx.fillStyle = '#fffdf9'; ctx.font = `${Math.max(15, 24 * s)}px system-ui, sans-serif`; ctx.textAlign = 'center';
                ctx.fillText('✋', hx + 20 * s, hy - 17 * s);
            } else {
                const stroke = rival.strike ? strokeAt(performance.now() - rival.strike) : 0;
                drawCue(cueBall, rivalDir, rival.shown.p / 100, stroke);
                drawPowerTag(cueBall, rivalDir, rival.shown.p, rival.target);
            }
        }
        if (showAim && cueBall && !cueBall.p) drawPowerTag(cueBall, aim, Number($('poolFuerza').value), { s: spin, e: side });
        queueAim();
    }
    // A small label behind the cue: power and the spin dot, so everyone can read the shot being prepared.
    function drawPowerTag(cueBall, direction, power, spinInfo) {
        if (!coarse.matches && myTurn() && direction === aim) return; // the desktop controls already show it
        const s = view.scale, len = Math.hypot(direction.dx, direction.dy) || 1, ux = direction.dx / len, uy = direction.dy / len;
        const back = E.TABLE.radius + 16 + power / 100 * 50 + 120;
        let [x, y] = toScreen(cueBall.x - ux * back, cueBall.y - uy * back);
        x = Math.max(34 * s, Math.min(view.width - 34 * s, x)); y = Math.max(16 * s, Math.min(view.height - 16 * s, y));
        const w = 64 * s, h = 22 * s;
        ctx.fillStyle = 'rgba(16, 24, 20, 0.72)'; roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
        ctx.fillStyle = power > 85 ? '#ff9a7a' : '#f6d58c'; ctx.font = `700 ${Math.max(9, 12 * s)}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(Math.round(power) + '%', x - 9 * s, y + 0.5 * s);
        const r = 7 * s, cx = x + 20 * s;
        ctx.fillStyle = '#f6f2e9'; ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c4302c'; ctx.beginPath(); ctx.arc(cx + (spinInfo.e || 0) * r * 0.6, y - (spinInfo.s || 0) * r * 0.6, 2 * s, 0, Math.PI * 2); ctx.fill();
    }
    function drawEmpty() {
        const [cx, cy] = toScreen(500, 250), s = view.scale;
        ctx.fillStyle = '#ffffffd9'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `600 ${Math.max(13, 22 * s)}px system-ui, sans-serif`;
        ctx.fillText(room ? 'Esperando rival…' : 'RedMusica Pool', cx, cy - (room && online() ? 16 * s : 0));
        if (room && online()) {
            ctx.font = `800 ${Math.max(16, 34 * s)}px system-ui, sans-serif`; ctx.fillStyle = '#f6d58c';
            ctx.fillText(room.code, cx, cy + 22 * s);
        }
    }
    function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
    function dot(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
    // ---------- 3D balls ----------
    // Each ball keeps an orientation (3x3 matrix, body -> screen) that turns as it rolls,
    // so numbers, stripes and the cue ball's dots move like on a real table.
    // Each ball's shaded picture is cached until it rolls or the table is resized.
    const LIGHT = (() => { const l = [-0.45, -0.55, 0.7], n = Math.hypot(...l); return l.map(v => v / n); })();
    const HALF = (() => { const h = [LIGHT[0], LIGHT[1], LIGHT[2] + 1], n = Math.hypot(...h); return h.map(v => v / n); })();
    function startOrientation(n) {
        const a = n * 0.9 + 0.3, b = n * 1.7 + 0.5, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
        return [cb, sa * sb, ca * sb, 0, ca, -sa, -sb, sa * cb, ca * cb];
    }
    function orientationOf(n) { let m = orient.get(n); if (!m) { m = startOrientation(n); orient.set(n, m); } return m; }
    function rollBall(n, sx, sy, radiusPx) {
        const prev = lastSpot.get(n);
        lastSpot.set(n, [sx, sy]);
        if (!prev || !animating) return;
        const dx = sx - prev[0], dy = sy - prev[1], d = Math.hypot(dx, dy);
        if (d < 0.01 || d > radiusPx * 6) return;
        // Rolling on the cloth: rotation axis = up x direction, angle = distance / radius.
        const ax = -dy / d, ay = dx / d, angle = d / radiusPx, c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
        const r = [t * ax * ax + c, t * ax * ay, s * ay, t * ax * ay, t * ay * ay + c, -s * ax, -s * ay, s * ax, c];
        const m = orientationOf(n), out = new Array(9);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = r[i * 3] * m[j] + r[i * 3 + 1] * m[3 + j] + r[i * 3 + 2] * m[6 + j];
        orient.set(n, out);
    }
    const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const IVORY = [246, 242, 233], INK = '#1f1c1f';
    function ballSprite(n, radiusPx) {
        const m = orientationOf(n);
        let entry = sprites.get(n);
        if (entry && entry.m === m && entry.r === radiusPx) return entry;
        if (!entry) { const c = document.createElement('canvas'); entry = { canvas: c, ctx: c.getContext('2d') }; sprites.set(n, entry); }
        const size = Math.ceil(radiusPx * 2) + 2, c = size / 2;
        if (entry.canvas.width !== size) { entry.canvas.width = size; entry.canvas.height = size; }
        const image = entry.ctx.createImageData(size, size), data = image.data;
        const color = n === 0 ? IVORY : hex(COLORS[n > 8 ? n - 8 : n]), stripe = n > 8;
        for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
            const x = (px + 0.5 - c) / radiusPx, y = (py + 0.5 - c) / radiusPx, d2 = x * x + y * y;
            if (d2 > 1.06) continue;
            const z = Math.sqrt(Math.max(0, 1 - d2));
            // Body-space normal = M^T * view normal.
            const bx = m[0] * x + m[3] * y + m[6] * z, by = m[1] * x + m[4] * y + m[7] * z, bz = m[2] * x + m[5] * y + m[8] * z;
            let base;
            if (n === 0) base = Math.max(Math.abs(bx), Math.abs(by), Math.abs(bz)) > 0.965 ? [196, 48, 44] : IVORY;
            else if (stripe) base = Math.abs(bx) > 0.9 ? IVORY : Math.abs(bz) < 0.42 ? color : IVORY;
            else base = Math.abs(bz) > 0.87 ? IVORY : color;
            const diffuse = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]);
            const spec = Math.pow(Math.max(0, x * HALF[0] + y * HALF[1] + z * HALF[2]), 40) * 150;
            const light = 0.42 + 0.68 * diffuse, i = (py * size + px) * 4;
            data[i] = Math.min(255, base[0] * light + spec); data[i + 1] = Math.min(255, base[1] * light + spec); data[i + 2] = Math.min(255, base[2] * light + spec);
            data[i + 3] = d2 <= 1 ? 255 : Math.max(0, 255 * (1.06 - d2) / 0.06);
        }
        entry.ctx.putImageData(image, 0, 0);
        entry.m = m; entry.r = radiusPx; entry.size = size;
        return entry;
    }
    function drawBall(b, scale = 1, alpha = 1) {
        const r = (E?.TABLE.radius || 11) * view.scale * scale, [x, y] = toScreen(b.x, b.y);
        rollBall(b.n, x, y, r);
        const { canvas: picture, size, m } = ballSprite(b.n, r);
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.drawImage(picture, x - size / 2, y - size / 2);
        if (b.n && r >= 5.5) {
            // Number on the spot that faces the viewer most (two spots per ball).
            const axis = b.n > 8 ? [m[0], m[3], m[6]] : [m[2], m[5], m[8]];
            const sign = axis[2] >= 0 ? 1 : -1, vx = axis[0] * sign, vy = axis[1] * sign, vz = axis[2] * sign;
            if (vz > 0.5) {
                ctx.globalAlpha = alpha * Math.min(1, (vz - 0.5) * 3);
                ctx.fillStyle = INK; ctx.font = `700 ${Math.max(6, r * 0.62 * Math.sqrt(vz))}px system-ui, sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(String(b.n), x + vx * r * 0.93, y + vy * r * 0.93 + r * 0.03);
            }
        }
        ctx.restore();
    }
    function drawShadow(b) {
        const r = (E?.TABLE.radius || 11) * view.scale, [x, y] = toScreen(b.x, b.y);
        ctx.fillStyle = 'rgba(8, 24, 18, 0.32)';
        ctx.beginPath(); ctx.ellipse(x + r * 0.22, y + r * 0.3, r * 1.02, r * 0.92, 0, 0, Math.PI * 2); ctx.fill();
    }
    function drawDrops(now = performance.now()) {
        drops = drops.filter(drop => now - drop.start < 320);
        for (const drop of drops) {
            const t = (now - drop.start) / 320, ease = t * t;
            const ball = { n: drop.n, x: drop.x + (drop.px - drop.x) * ease, y: drop.y + (drop.py - drop.y) * ease, p: 0 };
            drawBall(ball, 1 - 0.55 * ease, 1 - ease);
        }
    }
    function drawAim(list, cueBall, direction = aim, spinValue = spin, alpha = 1) {
        const s = view.scale, guide = E.aimGuide(list, direction.dx, direction.dy);
        if (!guide) return;
        const R = E.TABLE.radius, line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(...toScreen(x1, y1)); ctx.lineTo(...toScreen(x2, y2)); ctx.stroke(); };
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#fffdf9cc'; ctx.lineWidth = Math.max(1.2, 1.6 * s); ctx.setLineDash([6 * s, 5 * s]);
        line(cueBall.x, cueBall.y, guide.point.x, guide.point.y); ctx.setLineDash([]);
        ctx.strokeStyle = '#fffdf999'; ctx.beginPath(); ctx.arc(...toScreen(guide.point.x, guide.point.y), R * s, 0, Math.PI * 2); ctx.stroke();
        const incoming = Math.hypot(direction.dx, direction.dy) || 1, ux = direction.dx / incoming, uy = direction.dy / incoming;
        if (guide.ball) {
            const dx = guide.ball.x - guide.point.x, dy = guide.ball.y - guide.point.y, len = Math.hypot(dx, dy) || 1;
            const nx = dx / len, ny = dy / len, along = ux * nx + uy * ny;
            // Object ball line: longer for fuller hits, which send it further.
            ctx.strokeStyle = '#f6d58cdd'; ctx.lineWidth = 2 * s;
            line(guide.ball.x, guide.ball.y, guide.ball.x + nx * (40 + 90 * along), guide.ball.y + ny * (40 + 90 * along));
            // Cue ball path after impact (an estimate for aiming; the real shot is simulated):
            // it leaves along the tangent, bent forward by follow or back by draw.
            const bend = along * (0.25 + 0.6 * spinValue);
            const tx = ux - along * nx + nx * bend, ty = uy - along * ny + ny * bend, tangent = Math.hypot(tx, ty);
            if (tangent > 0.06) {
                ctx.strokeStyle = '#c9efe1cc'; ctx.lineWidth = Math.max(1.2, 1.6 * s); ctx.setLineDash([4 * s, 4 * s]);
                line(guide.point.x, guide.point.y, guide.point.x + tx / tangent * 68, guide.point.y + ty / tangent * 68); ctx.setLineDash([]);
            }
        } else {
            // Nothing in the way: show the first bounce off the cushion.
            const vertical = guide.point.x <= R + 0.5 || guide.point.x >= E.TABLE.width - R - 0.5;
            const rx = vertical ? -ux : ux, ry = vertical ? uy : -uy;
            ctx.strokeStyle = '#fffdf966'; ctx.setLineDash([3 * s, 6 * s]);
            line(guide.point.x, guide.point.y, guide.point.x + rx * 110, guide.point.y + ry * 110); ctx.setLineDash([]);
        }
        ctx.restore();
    }
    function drawCue(cueBall, direction, power, stroke = 0) {
        const s = view.scale, len = Math.hypot(direction.dx, direction.dy) || 1, ux = direction.dx / len, uy = direction.dy / len;
        const pull = 16 + power * 50, start = Math.max(E.TABLE.radius + 2, E.TABLE.radius + pull + stroke), end = start + 300;
        const [x1, y1] = toScreen(cueBall.x - ux * start, cueBall.y - uy * start), [x2, y2] = toScreen(cueBall.x - ux * end, cueBall.y - uy * end);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)'; ctx.lineCap = 'round'; ctx.lineWidth = 7 * s;
        ctx.beginPath(); ctx.moveTo(x1 + 3 * s, y1 + 4 * s); ctx.lineTo(x2 + 3 * s, y2 + 4 * s); ctx.stroke();
        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, '#f2ead9'); grad.addColorStop(0.04, '#d9b98a'); grad.addColorStop(0.7, '#9b6a3f'); grad.addColorStop(1, '#3a2419');
        ctx.strokeStyle = grad; ctx.lineWidth = 6 * s;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.lineCap = 'butt';
    }

    // ---------- sound and touch feedback ----------
    // Sounds are synthesized once, the first time sound is allowed, from how real balls ring:
    // phenolic-resin balls give a bright, very short "clack" (modes around 2.5-10 kHz that die in
    // a few hundredths of a second), the leather tip a softer "tock", the rubber cushion a dull thud,
    // and a pocketed ball a thunk followed by its roll down the return channel. Each kind has a few
    // variants so repeated hits never sound identical, and every hit is panned to where it happens.
    let kit = null, rollGain = null;
    function primeSound() {
        if (prefs.muted) return;
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        try {
            sound ||= new Audio();
            if (sound.state === 'suspended') sound.resume().catch(() => {});
            if (!kit) kit = buildKit(sound);
        } catch { /* Audio may be unavailable. */ }
    }
    function buildKit(ac) {
        const rate = ac.sampleRate, rnd = (a, b) => a + Math.random() * (b - a);
        const buffer = (seconds, fill, channels = 1) => {
            const b = ac.createBuffer(channels, Math.ceil(seconds * rate), rate);
            for (let c = 0; c < channels; c++) fill(b.getChannelData(c), c);
            return b;
        };
        // Sum of decaying partials plus an optional noise transient (all times in seconds).
        const modal = (seconds, modes, noise) => buffer(seconds, data => {
            const phases = modes.map(() => Math.random() * Math.PI * 2);
            let lp = 0, hp = 0, prev = 0;
            for (let i = 0; i < data.length; i++) {
                const t = i / rate;
                let v = 0;
                for (let m = 0; m < modes.length; m++) { const [f, a, d] = modes[m]; v += a * Math.exp(-t / d) * Math.sin(phases[m] + 2 * Math.PI * f * t); }
                if (noise) {
                    const white = Math.random() * 2 - 1;
                    lp += (white - lp) * noise.tone; // one-pole filters shape the transient's colour
                    hp = noise.high ? lp - prev : lp; prev = lp;
                    v += noise.gain * hp * Math.exp(-t / noise.decay);
                }
                const attack = Math.min(1, t / 0.0004);
                data[i] = v * attack;
            }
            normalize(data, 0.9);
        });
        const normalize = (data, peak) => { let m = 0; for (const v of data) m = Math.max(m, Math.abs(v)); if (m) for (let i = 0; i < data.length; i++) data[i] *= peak / m; };
        const variants = (n, make) => Array.from({ length: n }, make);
        const ball = variants(6, () => modal(0.09, [
            [rnd(2550, 2800), 1, rnd(0.022, 0.03)], [rnd(3700, 4050), 0.75, rnd(0.016, 0.022)], [rnd(5000, 5500), 0.5, rnd(0.011, 0.015)],
            [rnd(6900, 7500), 0.28, rnd(0.007, 0.01)], [rnd(9400, 10400), 0.16, rnd(0.004, 0.006)], [rnd(1250, 1400), 0.18, rnd(0.012, 0.02)]
        ], { tone: 0.9, high: true, gain: 1.4, decay: 0.0012 }));
        const cue = variants(4, () => modal(0.12, [
            [rnd(820, 920), 1, rnd(0.02, 0.028)], [rnd(1650, 1800), 0.6, rnd(0.014, 0.02)], [rnd(2600, 2900), 0.42, rnd(0.01, 0.014)],
            [rnd(150, 180), 0.5, rnd(0.03, 0.04)]
        ], { tone: 0.45, high: false, gain: 1.1, decay: 0.003 }));
        const rail = variants(5, () => modal(0.22, [
            [rnd(95, 125), 1, rnd(0.05, 0.07)], [rnd(210, 260), 0.45, rnd(0.03, 0.045)], [rnd(430, 520), 0.25, rnd(0.015, 0.025)]
        ], { tone: 0.12, high: false, gain: 1.3, decay: 0.018 }));
        // Pocket: a thunk in the leather/plastic, then the ball rolling down the return and knocking the others.
        const pocket = variants(3, () => buffer(1.35, data => {
            const thunk = [[rnd(140, 175), 1, 0.07], [rnd(320, 380), 0.5, 0.035], [rnd(900, 1100), 0.2, 0.012]];
            const knock = 0.85 + Math.random() * 0.25;
            let lp = 0, lp2 = 0;
            for (let i = 0; i < data.length; i++) {
                const t = i / rate;
                let v = 0;
                for (const [f, a, d] of thunk) v += a * Math.exp(-t / d) * Math.sin(2 * Math.PI * f * t);
                // Rolling in the return channel: low rumble with a wobble, fading in and out.
                const white = Math.random() * 2 - 1;
                lp += (white - lp) * 0.08; lp2 += (lp - lp2) * 0.08;
                const roll = t > 0.12 && t < knock ? Math.sin(Math.PI * (t - 0.12) / (knock - 0.12)) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 23 * t)) : 0;
                v += lp2 * 3.2 * roll;
                // The soft clack when it meets the balls already in the return.
                if (t >= knock) { const k = t - knock; v += 0.32 * Math.exp(-k / 0.018) * (Math.sin(2 * Math.PI * 2650 * k) + 0.6 * Math.sin(2 * Math.PI * 3900 * k)); }
                data[i] = v * Math.min(1, t / 0.0008);
            }
            normalize(data, 0.85);
        }));
        // A loop of soft cloth rumble for balls rolling.
        const cloth = buffer(2, data => {
            let a = 0, b = 0;
            for (let i = 0; i < data.length; i++) { const w = Math.random() * 2 - 1; a += (w - a) * 0.06; b = 0.995 * b + a * 0.1; data[i] = a * 0.6 + b; }
            normalize(data, 0.8);
        });
        // A small room so hits have a little air around them.
        const room = buffer(0.6, (data) => { for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / rate / 0.12); }, 2);
        const master = ac.createGain(); master.gain.value = 0.9;
        const limiter = ac.createDynamicsCompressor();
        limiter.threshold.value = -10; limiter.knee.value = 6; limiter.ratio.value = 8; limiter.attack.value = 0.002; limiter.release.value = 0.12;
        master.connect(limiter).connect(ac.destination);
        const reverb = ac.createConvolver(); reverb.buffer = room;
        const wet = ac.createGain(); wet.gain.value = 0.14;
        reverb.connect(wet).connect(master);
        const loop = ac.createBufferSource(); loop.buffer = cloth; loop.loop = true;
        const rollFilter = ac.createBiquadFilter(); rollFilter.type = 'lowpass'; rollFilter.frequency.value = 520;
        rollGain = ac.createGain(); rollGain.gain.value = 0;
        loop.connect(rollFilter).connect(rollGain).connect(master); loop.start();
        return { ball, cue, rail, pocket, master, reverb, last: {} };
    }
    // kind: 'cue' | 'ball' | 'rail' | 'pocket'; strength 0..1; pan -1 (left) .. 1 (right).
    function playSound(kind, strength = 1, pan = 0) {
        if (prefs.muted || strength <= 0.02) return;
        primeSound();
        if (!sound || sound.state !== 'running' || !kit) return;
        try {
            const k = kind === 'hit' ? 'cue' : kind, set = kit[k];
            if (!set) return;
            const at = sound.currentTime;
            // Many touches in the same instant (a break) blend into one instead of piling up.
            if (kit.last[k] && at - kit.last[k] < 0.012) return;
            kit.last[k] = at;
            const source = sound.createBufferSource();
            source.buffer = set[Math.floor(Math.random() * set.length)];
            source.playbackRate.value = (k === 'ball' ? 0.94 + 0.12 * strength : 0.96 + 0.08 * strength) * (0.98 + Math.random() * 0.04);
            // Soft touches are duller as well as quieter, as on a real table.
            const tone = sound.createBiquadFilter(); tone.type = 'lowpass';
            tone.frequency.value = k === 'ball' ? 2200 + 15000 * strength : k === 'cue' ? 1500 + 6000 * strength : 900 + 5000 * strength;
            const volume = sound.createGain();
            const curve = Math.sqrt(strength) * strength * 0.35 + strength * 0.65;
            volume.gain.value = { ball: 0.95, cue: 0.7, rail: 0.75, pocket: 0.7 }[k] * Math.min(1, 0.08 + curve);
            let node = source.connect(tone).connect(volume);
            if (sound.createStereoPanner) { const p = sound.createStereoPanner(); p.pan.value = Math.max(-0.7, Math.min(0.7, pan)); node = node.connect(p); }
            node.connect(kit.master);
            if (k !== 'pocket') { const send = sound.createGain(); send.gain.value = 0.5; node.connect(send).connect(kit.reverb); }
            source.start(at);
        } catch { /* Sound is optional. */ }
    }
    // Rolling level 0..1 (follows the total speed of the balls while a shot plays).
    function setRolling(level) {
        if (!rollGain || !sound || sound.state !== 'running') return;
        try { rollGain.gain.setTargetAtTime(prefs.muted ? 0 : Math.min(0.22, level * 0.22), sound.currentTime, 0.05); } catch { /* optional */ }
    }
    // Pan for a point on the table, as it appears on screen.
    const panAt = (x, y) => { const [sx] = toScreen(x, y); return view.width ? (sx / view.width) * 2 - 1 : 0; };
    function vibrate(ms = 12) { if (prefs.vibrate && !reduceMotion.matches) try { navigator.vibrate?.(ms); } catch { /* optional */ } }
    function animateStrike() {
        if (reduceMotion.matches || document.hidden) return Promise.resolve();
        return new Promise(resolve => {
            const start = performance.now(), duration = 255;
            let finished = false;
            const finish = () => { if (finished) return; finished = true; clearTimeout(fallback); cueStroke = 0; draw(); resolve(); };
            const fallback = setTimeout(finish, duration + 100);
            const frameStep = now => {
                if (finished) return;
                const t = Math.min(1, (now - start) / duration);
                cueStroke = t < 0.55 ? 78 * (t / 0.55) : 78 - (78 + 60) * ((t - 0.55) / 0.45);
                draw();
                if (t < 1) requestAnimationFrame(frameStep); else finish();
            };
            requestAnimationFrame(frameStep);
        });
    }
    function animate(last) {
        let frames = [], ticks = 0;
        const impacts = [];
        E.simulate(last.before, last.shot, snapshot => {
            if (ticks++ % 2 === 0) frames.push(snapshot);
        }, event => impacts.push(event));
        if (!frames.length) return Promise.resolve();
        animating = true; updateControls();
        // Real time (1 tick = 1/60 s) so rolling, spin and cushions look natural; very long shots play faster.
        const duration = Math.min(5200, Math.max(500, ticks * 1000 / 60));
        const startCue = last.before.find(b => b.n === 0);
        if (last.by !== me()) { playSound('cue', 0.3 + 0.7 * (last.shot.power || 0.5), startCue ? panAt(startCue.x, startCue.y) : 0); vibrate(); }
        for (const b of last.before) if (!b.p) { const [x, y] = toScreen(b.x, b.y); lastSpot.set(b.n, [x, y]); }
        return new Promise(resolve => {
            const started = performance.now();
            let finished = false, played = 0, previous = frames[0];
            const finish = () => {
                if (finished) return; finished = true; clearTimeout(fallback); animating = false; setRolling(0);
                // Let the last drops finish falling.
                if (drops.length) requestAnimationFrame(function settle() { draw(); if (drops.length) requestAnimationFrame(settle); });
                resolve();
            };
            const fallback = setTimeout(finish, duration + 350);
            const step = now => {
                if (finished) return;
                const progress = Math.max(0, Math.min(1, (now - started) / duration));
                const at = progress * (frames.length - 1), index = Math.min(frames.length - 1, Math.floor(at)), mix = at - index;
                const from = frames[index], to = frames[Math.min(frames.length - 1, index + 1)];
                const snapshot = mix > 0 ? from.map((b, i) => b.p || to[i].p ? to[i] : { n: b.n, p: 0, x: b.x + (to[i].x - b.x) * mix, y: b.y + (to[i].y - b.y) * mix }) : from;
                // Balls that just dropped slide into the pocket and shrink.
                snapshot.forEach((b, i) => {
                    if (b.p && previous[i] && !previous[i].p) {
                        let best = E.POCKETS[0], bestD = Infinity;
                        for (const p of E.POCKETS) { const d = Math.hypot(p.x - previous[i].x, p.y - previous[i].y); if (d < bestD) { bestD = d; best = p; } }
                        drops.push({ n: b.n, x: previous[i].x, y: previous[i].y, px: best.x, py: best.y, start: now });
                        if (b.n) vibrate(18);
                    }
                });
                // Cloth rumble follows how fast the balls are rolling right now.
                let rolling = 0;
                snapshot.forEach((b, i) => { const p = previous[i]; if (!b.p && p && !p.p) rolling += Math.sqrt(Math.hypot(b.x - p.x, b.y - p.y)); });
                setRolling(rolling / 9);
                previous = snapshot;
                // Impacts play at the moment they happen, louder for harder hits (a few per frame at most).
                const tickNow = at * 2;
                let voices = 0;
                while (played < impacts.length && impacts[played].tick <= tickNow) {
                    const hit = impacts[played++];
                    const where = frames[Math.min(frames.length - 1, Math.floor(hit.tick / 2))]?.find(b => b.n === hit.n);
                    if (voices++ < 5) playSound(hit.type, Math.min(1, hit.strength / (hit.type === 'pocket' ? 14 : hit.type === 'rail' ? 18 : 20)), where ? panAt(where.x, where.y) : 0);
                }
                draw(snapshot); renderGutter(snapshot);
                if (progress < 1) requestAnimationFrame(step);
                else finish();
            };
            requestAnimationFrame(step);
        });
    }

    // ---------- input ----------
    const canAct = () => myTurn() && !busy && !animating && !striking && !!E;
    function pointAt(event) {
        if (!canAct()) return;
        const p = toWorld(event), game = room.game;
        if (placing && game.ballInHand) {
            pendingCue = { x: Math.round(Math.min(1000, Math.max(0, p.x)) * 10) / 10, y: Math.round(Math.min(500, Math.max(0, p.y)) * 10) / 10 };
            const valid = E.validPlacement(balls, pendingCue.x, pendingCue.y, game.ballInHand);
            if (valid !== placementValid) status(valid ? 'Posición válida. Suelta la blanca para apuntar.' : 'Posición no válida para la blanca. Mueve la mano a otro lugar.');
            placementValid = valid;
        } else {
            const c = pendingCue || cue();
            if (!c || c.p) { status('Primero coloca la blanca: toca «Mover la blanca».'); return; }
            const dx = p.x - c.x, dy = p.y - c.y;
            if (Math.hypot(dx, dy) > 2) { aim = { dx, dy }; updateWheel(); }
        }
        requestDraw();
    }
    canvas.addEventListener('pointerdown', event => {
        if (!canAct()) return;
        const p = toWorld(event), white = pendingCue || cue();
        if (needsCall() && !placing) { const pocket = pocketNear(p); if (pocket >= 0) { setCall(pocket); vibrate(10); return; } }
        if (room.game.ballInHand && (!white || white.p || placing || Math.hypot(p.x - white.x, p.y - white.y) < (event.pointerType === 'touch' ? 60 : 45))) placing = true;
        dragging = true; canvas.setPointerCapture?.(event.pointerId);
        // Touch: the finger turns the cue around the cue ball (like a dial), so it never covers what you aim at.
        // A quick tap still aims straight at the tapped spot.
        if (!placing && event.pointerType === 'touch' && white && !white.p) {
            aimDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, angle: Math.atan2(p.y - white.y, p.x - white.x), moved: false };
            event.preventDefault();
            return;
        }
        pointAt(event); updateControls();
    });
    canvas.addEventListener('pointermove', event => {
        if (aimDrag && aimDrag.id === event.pointerId) {
            if (!canAct()) { aimDrag = null; return; }
            if (!aimDrag.moved && Math.hypot(event.clientX - aimDrag.x, event.clientY - aimDrag.y) < 8) return;
            aimDrag.moved = true;
            const p = toWorld(event), white = pendingCue || cue();
            const angle = Math.atan2(p.y - white.y, p.x - white.x);
            let delta = angle - aimDrag.angle;
            if (delta > Math.PI) delta -= 2 * Math.PI; else if (delta < -Math.PI) delta += 2 * Math.PI;
            aimDrag.angle = angle;
            // Close to the ball a small finger move is a big turn, so it is damped there.
            const distance = Math.hypot(p.x - white.x, p.y - white.y);
            rotateRadians(delta * (distance < 70 ? 0.3 : distance < 160 ? 0.6 : 0.85));
            event.preventDefault();
            return;
        }
        if (dragging) pointAt(event);
    });
    canvas.addEventListener('pointerup', event => {
        dragging = false;
        if (aimDrag && aimDrag.id === event.pointerId) {
            const tapped = !aimDrag.moved;
            aimDrag = null;
            if (tapped) pointAt(event);
            return;
        }
        if (placing && pendingCue && room?.game?.ballInHand && E.validPlacement(balls, pendingCue.x, pendingCue.y, room.game.ballInHand)) {
            placing = false; status('Blanca colocada. Ahora apunta y tira.'); vibrate(10); updateControls(); draw();
        }
    });
    canvas.addEventListener('pointercancel', () => { dragging = false; aimDrag = null; });
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    function rotateRadians(a) {
        const c = Math.cos(a), s = Math.sin(a);
        aim = { dx: aim.dx * c - aim.dy * s, dy: aim.dx * s + aim.dy * c }; updateWheel(); requestDraw();
    }
    const rotate = degrees => rotateRadians(degrees * Math.PI / 180);
    function updateWheel() {
        const degrees = Math.round(Math.atan2(aim.dy, aim.dx) * 180 / Math.PI);
        $('poolRueda').setAttribute('aria-valuenow', String(degrees));
        $('poolRueda').setAttribute('aria-valuetext', degrees + ' grados');
        $('poolRueda').style.setProperty('--rueda-angulo', degrees + 'deg');
    }
    function setPower(value) {
        const input = $('poolFuerza'); input.value = String(Math.round(Math.max(5, Math.min(100, value))));
        $('poolFuerzaValor').textContent = input.value + '%';
        $('poolPotencia').setAttribute('aria-valuenow', input.value);
        $('poolPotencia').style.setProperty('--power', input.value + '%');
        $('poolPotenciaLleno').style.height = input.value + '%';
        requestDraw();
    }
    canvas.addEventListener('keydown', event => {
        if (!myTurn() || busy || animating) return;
        const big = event.shiftKey ? 5 : 1;
        if (event.key === 'ArrowLeft') rotate(-big); else if (event.key === 'ArrowRight') rotate(big);
        else if (event.key === 'ArrowUp') setPower(Number($('poolFuerza').value) + 5); else if (event.key === 'ArrowDown') setPower(Number($('poolFuerza').value) - 5);
        else if (event.key === 'Enter' || event.key === ' ') shoot(); else return;
        event.preventDefault();
    });
    function needsCall() { return !!(E && room?.game && myTurn() && E.mustCallEight(room.game, me())); }
    async function shoot() {
        if (!canAct()) return;
        const game = room.game;
        if (placing && !pendingCue) { status('Toca la mesa para colocar la blanca.'); return; }
        if (pendingCue && !E.validPlacement(balls, pendingCue.x, pendingCue.y, game.ballInHand)) { status(game.ballInHand === 'kitchen' ? 'La blanca debe quedar detrás de la línea, sin tocar otras bolas.' : 'La blanca debe quedar en un espacio libre.'); return; }
        if (!pendingCue && cue()?.p) { status('Coloca la blanca antes de tirar.'); return; }
        if (needsCall() && calledPocket === null) { status('Vas por la 8: toca la tronera donde la meterás (o elígela en la lista).'); draw(); if (!gameMode || !coarse.matches) $('poolTronera').focus(); return; }
        const len = Math.hypot(aim.dx, aim.dy) || 1, power = Number($('poolFuerza').value) / 100;
        const shot = { dx: aim.dx / len, dy: aim.dy / len, power, ...(spin ? { spin } : {}), ...(side ? { side } : {}), ...(needsCall() ? { call: calledPocket } : {}), ...(pendingCue ? { cue: pendingCue } : {}) };
        primeSound(); placing = false; striking = true; updateControls();
        sendStrike(shot);
        try { await animateStrike(); } finally { striking = false; updateControls(); }
        const from = pendingCue || cue();
        playSound('cue', 0.3 + 0.7 * power, from ? panAt(from.x, from.y) : 0); vibrate(power > 0.8 ? 30 : 15);
        setSpin(0, 0);
        await run('shoot', shot);
    }

    // ---------- spin: up/down = follow/draw, left/right = side (english) ----------
    const SIDE_WORDS = v => v > 0 ? 'derecha ' + Math.round(v * 100) + '%' : 'izquierda ' + Math.round(-v * 100) + '%';
    function setSpin(vertical, horizontal = side) {
        const snap = v => Math.max(-1, Math.min(1, Math.round(v * 4) / 4));
        spin = snap(vertical); side = snap(horizontal);
        // Keep the tip on the cue ball: no more than full spin in total.
        const total = Math.hypot(spin, side);
        if (total > 1) { spin = Math.round(spin / total * 4) / 4; side = Math.round(side / total * 4) / 4; }
        const words = [spin > 0 ? 'seguir ' + Math.round(spin * 100) + '%' : spin < 0 ? 'retroceso ' + Math.round(-spin * 100) + '%' : '', side ? SIDE_WORDS(side) : ''].filter(Boolean);
        for (const el of [$('poolEfecto'), $('poolEfectoGrande')]) { el.style.setProperty('--efecto', String(spin)); el.style.setProperty('--efecto-x', String(side)); }
        const el = $('poolEfecto');
        el.setAttribute('aria-valuenow', String(Math.round(spin * 100)));
        el.setAttribute('aria-valuetext', words.length ? words.join(', ') : 'Golpe al centro');
        el.title = words.length ? 'Efecto: ' + words.join(', ') : 'Efecto: golpe al centro';
        $('poolEfectoTexto').textContent = words.length ? words.join(' · ') : 'Golpe al centro';
        requestDraw();
    }
    function spinPicker(el, onPick) {
        let pressing = false, last = '';
        const pick = event => {
            if (!canAct()) return;
            const r = el.getBoundingClientRect();
            setSpin((0.5 - (event.clientY - r.top) / r.height) * 2.4, ((event.clientX - r.left) / r.width - 0.5) * 2.4);
            const now = spin + ',' + side;
            if (now !== last) { last = now; onPick?.(); }
        };
        el.addEventListener('pointerdown', event => {
            if (el.id === 'poolEfecto' && event.pointerType === 'touch') { event.preventDefault(); openSpinPanel(); return; }
            pressing = true; el.setPointerCapture?.(event.pointerId); pick(event); event.preventDefault();
        });
        el.addEventListener('pointermove', event => { if (pressing) pick(event); });
        el.addEventListener('pointerup', () => { pressing = false; });
        el.addEventListener('pointercancel', () => { pressing = false; });
        el.addEventListener('dblclick', () => setSpin(0, 0));
    }
    spinPicker($('poolEfecto'));
    spinPicker($('poolEfectoGrande'), () => vibrate(6));
    $('poolEfecto').addEventListener('keydown', event => {
        if (!canAct()) return;
        if (event.key === 'ArrowUp') setSpin(spin + 0.25); else if (event.key === 'ArrowDown') setSpin(spin - 0.25);
        else if (event.key === 'ArrowRight') setSpin(spin, side + 0.25); else if (event.key === 'ArrowLeft') setSpin(spin, side - 0.25);
        else if (event.key === 'Home') setSpin(0, 0);
        else if (event.key === 'Enter' || event.key === ' ') openSpinPanel();
        else return;
        event.preventDefault();
    });
    function openSpinPanel() {
        if (!canAct()) return;
        $('poolEfectoPanel').hidden = false;
        setSpin(spin, side);
        $('poolEfectoListo').focus();
    }
    function closeSpinPanel() {
        const panel = $('poolEfectoPanel');
        if (panel.hidden) return;
        panel.hidden = true;
        if (!coarse.matches) $('poolEfecto').focus?.();
    }
    $('poolEfectoListo').addEventListener('click', closeSpinPanel);
    $('poolEfectoCentro').addEventListener('click', () => setSpin(0, 0));
    $('poolEfectoPanel').addEventListener('click', event => { if (event.target === event.currentTarget) closeSpinPanel(); });
    $('poolEfectoPanel').addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeSpinPanel(); } });

    // ---------- calling the pocket for the 8 ----------
    function setCall(index) {
        calledPocket = Number.isInteger(index) && index >= 0 && index < 6 ? index : null;
        $('poolTronera').value = calledPocket === null ? '' : String(calledPocket);
        if (calledPocket !== null) status('Tronera cantada: ' + E.POCKET_NAMES[calledPocket] + '.');
        draw();
    }
    $('poolTronera').addEventListener('change', () => setCall($('poolTronera').value === '' ? null : Number($('poolTronera').value)));
    function pocketNear(p) {
        if (!E) return -1;
        let best = -1, bestD = 60;
        E.POCKETS.forEach((pocket, i) => { const d = Math.hypot(pocket.x - p.x, pocket.y - p.y); if (d < bestD) { bestD = d; best = i; } });
        return best;
    }

    // ---------- menu and buttons ----------
    $('poolCrear').addEventListener('click', () => { if (!user) { status('Inicia sesión para jugar en línea.'); return; } mode = 'online'; prepareFullscreen(); run('create', { code: '' }); });
    $('poolUnirse').addEventListener('submit', event => {
        event.preventDefault();
        if (!user) { status('Inicia sesión para jugar en línea.'); return; }
        mode = 'online'; prepareFullscreen(); run('join', { code: $('poolCodigo').value.trim().toUpperCase() });
    });
    for (const button of section.querySelectorAll('.pool-niveles button')) button.addEventListener('click', () => startLocal('cpu', button.dataset.nivel));
    $('poolPractica').addEventListener('click', () => startLocal('practice'));
    $('poolTirar').addEventListener('click', shoot);
    $('poolGirarIzq').addEventListener('click', () => rotate(-1));
    $('poolGirarDer').addEventListener('click', () => rotate(1));
    $('poolFuerza').addEventListener('input', () => setPower(Number($('poolFuerza').value)));
    $('poolDeshacer').addEventListener('click', () => { if (!busy && !animating) { run('undo').then(() => status('Tiro deshecho.')); } });
    function updateSoundButton() {
        $('poolSilencio').setAttribute('aria-pressed', String(prefs.muted));
        $('poolSilencio').setAttribute('aria-label', prefs.muted ? 'Activar sonidos del pool' : 'Silenciar sonidos del pool');
        $('poolSilencio').querySelector('.pool-accion-icono').textContent = prefs.muted ? '♪̸' : '♫';
        $('poolSilencio').querySelector('.pool-accion-texto').textContent = prefs.muted ? 'Sonido: no' : 'Sonido: sí';
        $('poolPrefSonido').checked = !prefs.muted;
    }
    function setMuted(value) {
        prefs.muted = value; savePref('redmusica-pool-muted', value);
        updateSoundButton(); if (value) setRolling(0);
        if (!value) primeSound();
    }
    updateSoundButton();
    $('poolPrefVibrar').checked = prefs.vibrate;
    $('poolPrefCompleta').checked = prefs.full;
    $('poolSilencio').addEventListener('click', () => setMuted(!prefs.muted));
    $('poolPrefSonido').addEventListener('change', event => setMuted(!event.target.checked));
    $('poolPrefVibrar').addEventListener('change', event => { prefs.vibrate = event.target.checked; savePref('redmusica-pool-vibrar', prefs.vibrate); vibrate(20); });
    $('poolPrefCompleta').addEventListener('change', event => { prefs.full = event.target.checked; savePref('redmusica-pool-completa', prefs.full); });
    const wheel = $('poolRueda'), powerBar = $('poolPotencia');
    let wheelPointer = null, wheelY = 0, powerPointer = null, powerY = 0, powerMoved = false, powerTravel = 0, powerBefore = 60;
    wheel.addEventListener('pointerdown', event => {
        if (!canAct()) return;
        wheelPointer = event.pointerId; wheelY = event.clientY; wheel.setPointerCapture?.(event.pointerId); event.preventDefault();
    });
    wheel.addEventListener('pointermove', event => {
        if (wheelPointer !== event.pointerId) return;
        const delta = event.clientY - wheelY; wheelY = event.clientY;
        rotate(delta * 0.2); event.preventDefault();
    });
    const endWheel = () => { wheelPointer = null; };
    wheel.addEventListener('pointerup', endWheel); wheel.addEventListener('pointercancel', endWheel);
    wheel.addEventListener('wheel', event => { if (!canAct()) return; event.preventDefault(); rotate(Math.sign(event.deltaY) * 0.5); }, { passive: false });
    wheel.addEventListener('keydown', event => {
        if (!canAct()) return;
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') rotate(event.shiftKey ? 5 : 0.5);
        else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') rotate(event.shiftKey ? -5 : -0.5);
        else return;
        event.preventDefault();
    });
    // Power: pull the bar down and let go to shoot; slide back to the top to cancel.
    powerBar.addEventListener('pointerdown', event => {
        if (!canAct()) return;
        primeSound(); powerPointer = event.pointerId; powerY = event.clientY; powerMoved = false; powerTravel = 0; powerBefore = Number($('poolFuerza').value);
        powerBar.setPointerCapture?.(event.pointerId); powerBar.classList.add('pool-cargando'); event.preventDefault();
    });
    powerBar.addEventListener('pointermove', event => {
        if (powerPointer !== event.pointerId) return;
        powerTravel = Math.max(0, event.clientY - powerY);
        if (powerTravel > 8) powerMoved = true;
        if (powerMoved) setPower(5 + powerTravel / Math.max(80, powerBar.clientHeight - 20) * 95);
        event.preventDefault();
    });
    powerBar.addEventListener('pointerup', event => {
        if (powerPointer !== event.pointerId) return;
        powerPointer = null; powerBar.classList.remove('pool-cargando');
        if (powerMoved && powerTravel >= 10) shoot();
        else if (powerMoved) { setPower(powerBefore); status('Tiro cancelado.'); }
        else status('Arrastra la barra hacia abajo y suéltala para tirar.');
        event.preventDefault();
    });
    powerBar.addEventListener('pointercancel', () => { powerPointer = null; powerBar.classList.remove('pool-cargando'); setPower(powerBefore); });
    powerBar.addEventListener('keydown', event => {
        if (!canAct()) return;
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') setPower(Number($('poolFuerza').value) + 5);
        else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') setPower(Number($('poolFuerza').value) - 5);
        else if (event.key === 'Enter' || event.key === ' ') shoot();
        else return;
        event.preventDefault();
    });
    $('poolMoverBlanca').addEventListener('click', () => {
        placing = !placing;
        if (placing && !pendingCue && cue() && !cue().p) pendingCue = { x: cue().x, y: cue().y };
        const invalid = !placing && pendingCue && !E.validPlacement(balls, pendingCue.x, pendingCue.y, room.game.ballInHand);
        status(placing ? 'Toca la mesa donde quieras dejar la blanca.' : invalid ? 'Esa posición no es válida; toca otro lugar de la mesa.' : '');
        if (invalid) placing = true;
        updateControls(); draw();
    });
    $('poolRevancha').addEventListener('click', () => run('rematch'));
    $('poolReclamar').addEventListener('click', () => run('claim'));
    $('poolVolverMenu').addEventListener('click', () => { if (!busy) run('leave'); });
    let confirmLeave = null;
    $('poolSalir').addEventListener('click', () => {
        const button = $('poolSalir');
        const setLabel = label => { button.setAttribute('aria-label', label); button.querySelector('.pool-accion-texto').textContent = label; };
        // Online with a rival seated: ask twice (the local view may lag behind a rematch that already started).
        const risky = online() ? !spectating && room && room.players.length === 2 : room && room.status === 'playing' && room.game?.seq > 0;
        if (risky && !confirmLeave) {
            setLabel(!online() ? 'Confirmar: dejarás la mesa' : room.status === 'finished' ? 'Confirmar salida' : 'Confirmar: perderás la partida');
            status(online() && room.status !== 'finished' ? 'Toca otra vez para salir: perderás la partida.' : 'Toca otra vez para salir.');
            confirmLeave = setTimeout(() => { confirmLeave = null; setLabel('Salir'); }, 5000);
            return;
        }
        clearTimeout(confirmLeave); confirmLeave = null; setLabel('Salir');
        run('leave');
    });
    $('poolInvitar').addEventListener('click', async () => {
        const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('seccion', 'pool'); url.searchParams.set('pool', roomCode);
        const text = `Juguemos pool bola 8 en RedMusica. Código de sala: ${roomCode}`;
        if (navigator.share && coarse.matches) {
            try { await navigator.share({ title: 'Pool en RedMusica', text, url: url.href }); return; } catch (error) { if (error?.name === 'AbortError') return; }
        }
        try { await navigator.clipboard.writeText(url.href); status('Enlace de invitación copiado.'); } catch { status('Comparte este código: ' + roomCode); }
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            if (titleAlert && document.title.startsWith('🎱')) document.title = titleAlert;
            titleAlert = '';
            keepAwake();
            if (roomCode && online()) { refresh(); if (myTurn()) scrollPoolIntoView(); }
        }
    });
    const resumePool = () => setTimeout(() => { if (roomCode && visible() && online()) { refresh(true); scrollPoolIntoView(); } }, 0);
    document.addEventListener('click', event => { if (event.target.closest?.('#poolNav')) resumePool(); });
    window.addEventListener('popstate', resumePool);
    let resizeFrame = 0;
    function scheduleResize() {
        if (resizeFrame) return;
        resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; resize(); });
    }
    if (window.ResizeObserver) new ResizeObserver(scheduleResize).observe(frame); else window.addEventListener('resize', scheduleResize);
    window.addEventListener('resize', scheduleResize);
    window.addEventListener('orientationchange', () => setTimeout(scheduleResize, 200));

    // ---------- session ----------
    function joinInvite() {
        const invited = new URLSearchParams(location.search).get('pool');
        if (user && invited && /^[A-Z0-9]{6}$/i.test(invited) && invited.toUpperCase() !== roomCode && !local) { mode = 'online'; run('join', { code: invited.toUpperCase() }); }
    }
    function setUser(next) {
        const changed = (next?.id || null) !== (user?.id || null);
        user = next;
        $('poolAcceso').hidden = Boolean(user) || !db;
        $('poolCrear').disabled = !user; $('poolUnirse').querySelector('button').disabled = !user; $('poolCodigo').disabled = !user;
        $('poolEntrada').hidden = Boolean(roomCode);
        if (!user && roomCode && online()) { leaveView(); status('Inicia sesión desde Inicio para volver a jugar en línea.'); }
        if (changed) loadRecord();
    }
    async function loadRecord() {
        const line = $('poolRecord');
        if (!user || !db?.from) { line.hidden = true; return; }
        try {
            const { data, error } = await db.from('pool_stats').select('wins,losses').eq('user_id', user.id).maybeSingle();
            if (error || !data || (!data.wins && !data.losses)) { line.hidden = true; return; }
            line.textContent = `Tu récord en línea: ${data.wins} ${data.wins === 1 ? 'victoria' : 'victorias'} · ${data.losses} ${data.losses === 1 ? 'derrota' : 'derrotas'}`;
            line.hidden = false;
        } catch { line.hidden = true; }
    }
    resize();
    if (!db) {
        setUser(null);
        $('poolCrear').disabled = true;
        status('El juego en línea no está disponible ahora; puedes jugar contra la máquina o practicar.');
        return;
    }
    db.auth.onAuthStateChange((_event, session) => { setUser(session?.user || null); setTimeout(joinInvite, 0); });
    db.auth.getSession().then(({ data: { session } }) => { setUser(session?.user || null); joinInvite(); });

    // ---------- profile wins ----------
    function setupProfileStats() {
        const presence = $('presenciaPerfil'), line = $('poolPerfil');
        if (!presence || !line || !db) return;
        let current = '';
        const load = async () => {
            const id = presence.dataset.userId || '';
            if (id === current) return;
            current = id; line.hidden = true; line.textContent = '';
            if (!id) return;
            const { data, error } = await db.from('pool_stats').select('wins,losses').eq('user_id', id).maybeSingle();
            if (error || !data || id !== current || (!data.wins && !data.losses)) return;
            line.textContent = `Pool bola 8: ${data.wins} ${data.wins === 1 ? 'victoria' : 'victorias'} · ${data.losses} ${data.losses === 1 ? 'derrota' : 'derrotas'}`;
            line.hidden = false;
        };
        new MutationObserver(load).observe(presence, { attributes: true, attributeFilter: ['data-user-id'] });
        load();
    }
})();
