// Online 8-ball pool inside the Juegos section, plus the win counter on profiles.
// The pool Edge Function decides every shot; this file only draws the table,
// replays the server's result with the shared engine and sends the player's aim.
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const section = $('poolJuegos');
    const config = window.REDMUSICA_CONFIG;
    const db = config && window.supabase ? window.redmusicaClient || window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
    const ENGINE_URL = './supabase/functions/pool/engine.js?v=20260930-1';
    const TURN_LIMIT_MS = 5 * 60 * 1000;
    const RAIL = 34;
    const COLORS = { 1: '#e3b22f', 2: '#2b4f9e', 3: '#c23b30', 4: '#5c3b86', 5: '#dd7430', 6: '#2e7445', 7: '#7c2733', 8: '#1f1c1f' };
    const GROUP_NAMES = { solids: 'lisas (1–7)', stripes: 'rayadas (9–15)' };

    setupProfileStats();
    if (!section) return;

    const canvas = $('poolCanvas'), ctx = canvas.getContext('2d'), frame = $('poolLienzo');
    const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    let E = null, user = null, roomCode = '', room = null, busy = false, timer = null, animating = false, queued = null;
    let shownGame = null, shownSeq = -1, balls = [], aim = { dx: 1, dy: 0 }, pendingCue = null, placing = false, dragging = false;
    let view = { portrait: false, scale: 1, width: 0, height: 0 };

    const enginePromise = import(ENGINE_URL).then(module => { E = module; draw(); return module; });

    // ---------- server ----------
    async function request(action, extra = {}) {
        if (!db) throw new Error('No se pudo iniciar el juego. Recarga la página.');
        const { data: { session } } = await db.auth.getSession();
        if (!session) throw new Error('Inicia sesión para jugar al pool.');
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
        busy = true; status('Un momento…'); updateControls();
        try {
            const result = await request(action, extra);
            if (result.left) { leaveView(); status('Saliste de la sala. Puedes crear otra o unirte con un código.'); return; }
            status('');
            await show(result.room);
        } catch (error) {
            status(error.message);
            if (/No encontramos esa sala|No formas parte/.test(error.message) && action !== 'join') leaveView();
        } finally { busy = false; updateControls(); schedule(); }
    }
    async function refresh() {
        if (!roomCode || busy || animating || document.hidden || !visible()) { schedule(); return; }
        try { await show((await request('state')).room); }
        catch (error) { status(error.message); if (/No encontramos esa sala|No formas parte/.test(error.message)) leaveView(); }
        finally { schedule(); }
    }
    function schedule() {
        clearTimeout(timer); timer = null;
        if (!roomCode) return;
        const mine = room && room.status === 'playing' && room.game && room.game.turn === user?.id;
        timer = setTimeout(refresh, !visible() || document.hidden ? 6000 : mine ? 10000 : 3000);
    }
    const visible = () => !$('seccionJuegos') || !$('seccionJuegos').hidden;

    // ---------- state ----------
    async function show(next) {
        if (animating) { queued = next; return; }
        room = next; roomCode = next.code;
        $('poolEntrada').hidden = true; $('poolMesa').hidden = false;
        $('poolCodigoSala').textContent = next.code;
        rememberInvite();
        await enginePromise;
        const game = next.game;
        if (game && (!shownGame || shownGame !== game.id)) {
            shownGame = game.id; shownSeq = game.seq; balls = game.balls; pendingCue = null; placing = false;
            aim = { dx: 1, dy: 0 };
        } else if (game && game.seq !== shownSeq) {
            const last = game.last;
            if (last && last.seq === game.seq && game.seq === shownSeq + 1 && !reduceMotion.matches) await animate(last);
            shownSeq = game.seq; balls = game.balls; pendingCue = null;
            if (last) status(describe(last.summary, game));
        }
        if (game && game.ballInHand && game.turn === user?.id && cue()?.p) placing = true;
        if (!game?.ballInHand) placing = false;
        renderPanel(); draw(); updateControls();
        if (queued) { const again = queued; queued = null; await show(again); }
    }
    function leaveView() {
        room = null; roomCode = ''; shownGame = null; shownSeq = -1; balls = []; pendingCue = null; placing = false;
        clearTimeout(timer); timer = null;
        $('poolEntrada').hidden = false; $('poolMesa').hidden = true;
        const url = new URL(location.href);
        if (url.searchParams.has('pool')) { url.searchParams.delete('pool'); history.replaceState(null, '', url); }
    }
    function rememberInvite() {
        const url = new URL(location.href);
        if (url.searchParams.get('pool') === roomCode) return;
        url.searchParams.set('seccion', 'juegos'); url.searchParams.set('pool', roomCode);
        history.replaceState(null, '', url);
    }
    const nameOf = id => room?.players.find(p => p.user_id === id)?.username || 'Rival';
    const cue = () => balls.find(b => b.n === 0);
    const myTurn = () => !!(room && room.status === 'playing' && room.game && room.game.turn === user?.id && !room.game.winner);
    function describe(summary, game) {
        if (!summary) return '';
        const who = summary.by === user?.id ? 'Tú' : nameOf(summary.by);
        const parts = [];
        const list = summary.pocketed || [];
        if (list.length) parts.push(`${who} ${summary.by === user?.id ? 'metiste' : 'metió'} ${list.length === 1 ? 'la ' + list[0] : 'las ' + list.slice(0, -1).join(', ') + ' y ' + list.at(-1)}.`);
        else if (!summary.foul) parts.push(`${who}: ninguna bola entró.`);
        if (summary.respotted) parts.push('La 8 entró en el saque y volvió a su lugar.');
        if (summary.assigned) parts.push(`${summary.by === user?.id ? 'Juegas' : nameOf(summary.by) + ' juega'} con las ${GROUP_NAMES[summary.assigned]}.`);
        if (summary.foul) parts.push('Falta: ' + summary.foul + ' ' + (game.turn === user?.id ? 'Tienes bola en mano.' : nameOf(game.turn) + ' tiene bola en mano.'));
        else if (summary.continued && !game.winner) parts.push(summary.by === user?.id ? 'Sigues tirando.' : 'Sigue tirando.');
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
            const name = document.createElement('strong');
            name.textContent = player.username + (player.user_id === user?.id ? ' (tú)' : '');
            const detail = document.createElement('span');
            const group = game?.groups?.[player.user_id];
            const left = group ? balls.filter(b => !b.p && (group === 'solids' ? b.n >= 1 && b.n <= 7 : b.n >= 9)).length : null;
            detail.textContent = !game ? 'En la sala' : group ? `${GROUP_NAMES[group]} · ${left ? 'quedan ' + left : 'va por la 8'}` : 'Mesa abierta';
            li.append(name, detail);
            if (group) {
                const dots = document.createElement('span'); dots.className = 'pool-restantes'; dots.setAttribute('aria-hidden', 'true');
                balls.filter(b => !b.p && (group === 'solids' ? b.n >= 1 && b.n <= 7 : b.n >= 9)).forEach(b => { const d = document.createElement('i'); d.style.setProperty('--bola', COLORS[b.n > 8 ? b.n - 8 : b.n]); if (b.n > 8) d.className = 'rayada'; dots.append(d); });
                li.append(dots);
            }
            list.append(li);
        }
        if (room.players.length < 2) { const li = document.createElement('li'); li.className = 'pool-jugador pool-esperando'; li.textContent = 'Esperando rival…'; list.append(li); }
        const turn = $('poolTurno');
        if (room.status === 'lobby' || !game) turn.textContent = `Comparte el código ${room.code} o el enlace de invitación para que alguien se una.`;
        else if (game.winner) turn.textContent = (game.winner === user?.id ? '¡Ganaste! ' : `Ganó ${nameOf(game.winner)}. `) + (game.reason || '');
        else if (myTurn()) turn.textContent = game.ballInHand ? (game.ballInHand === 'kitchen' ? 'Saque: puedes mover la blanca detrás de la línea y luego tirar.' : 'Bola en mano: coloca la blanca donde quieras y tira.') : 'Te toca. Toca o arrastra sobre la mesa para apuntar y elige la fuerza.';
        else turn.textContent = `Turno de ${nameOf(game.turn)}.`;
        const finished = room.status === 'finished';
        $('poolFinal').hidden = !finished;
        const rematch = $('poolRevancha'), votes = room.rematch || [];
        rematch.hidden = !finished || room.players.length < 2;
        rematch.disabled = votes.includes(user?.id);
        rematch.textContent = votes.includes(user?.id) ? 'Esperando respuesta…' : votes.length ? 'Aceptar revancha' : 'Pedir revancha';
        $('poolResultado').textContent = finished && room.players.length < 2 ? 'Tu rival salió. Puedes esperar a que alguien más se una con el código.' : '';
        const claimable = room.status === 'playing' && game && !myTurn() && Number.isFinite(room.turn_started_at) && Date.now() - room.turn_started_at >= TURN_LIMIT_MS;
        $('poolReclamar').hidden = !claimable;
    }
    function updateControls() {
        const active = myTurn() && !busy && !animating && !!E;
        $('poolControles').hidden = !(room && room.status === 'playing');
        for (const id of ['poolTirar', 'poolGirarIzq', 'poolGirarDer', 'poolFuerza']) $(id).disabled = !active;
        const hand = active && !!room.game.ballInHand;
        $('poolMoverBlanca').hidden = !hand;
        $('poolMoverBlanca').setAttribute('aria-pressed', String(placing));
        $('poolMoverBlanca').textContent = placing ? 'Listo, ahora apunta' : 'Mover la blanca';
        frame.classList.toggle('pool-interactivo', active);
        canvas.setAttribute('aria-label', tableDescription());
    }
    function tableDescription() {
        if (!room?.game) return 'Mesa de pool vacía';
        const onTable = balls.filter(b => !b.p && b.n).map(b => b.n);
        return `Mesa de pool. Bolas en la mesa: ${onTable.join(', ') || 'ninguna'}. ${myTurn() ? 'Usa las flechas izquierda y derecha para apuntar, arriba y abajo para la fuerza, y Enter para tirar.' : ''}`;
    }
    function status(message) { $('poolEstado').textContent = message; }

    // ---------- geometry ----------
    function resize() {
        const width = frame.clientWidth;
        if (!width) return;
        view.portrait = width < 560;
        const worldW = view.portrait ? 500 + 2 * RAIL : 1000 + 2 * RAIL, worldH = view.portrait ? 1000 + 2 * RAIL : 500 + 2 * RAIL;
        let cssW = width;
        if (view.portrait) cssW = Math.min(width, Math.max(240, window.innerHeight * 0.74) * worldW / worldH);
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
    function draw(list = balls) {
        if (!view.width) return;
        const s = view.scale;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, view.width, view.height);
        const [ox, oy] = toScreen(0, 0), [fx, fy] = toScreen(1000, 500);
        const left = Math.min(ox, fx), top = Math.min(oy, fy), w = Math.abs(fx - ox), h = Math.abs(fy - oy);
        const wood = ctx.createLinearGradient(0, 0, view.width, view.height);
        wood.addColorStop(0, '#7a4f35'); wood.addColorStop(1, '#5a3727');
        roundRect(0, 0, view.width, view.height, 18 * s); ctx.fillStyle = wood; ctx.fill();
        ctx.fillStyle = '#2f6a58'; ctx.fillRect(left - 8 * s, top - 8 * s, w + 16 * s, h + 16 * s);
        const felt = ctx.createRadialGradient(left + w / 2, top + h / 2, 10, left + w / 2, top + h / 2, Math.max(w, h) * 0.7);
        felt.addColorStop(0, '#3f8a72'); felt.addColorStop(1, '#2f6f5c');
        ctx.fillStyle = felt; ctx.fillRect(left, top, w, h);
        // Diamonds on the rails.
        ctx.fillStyle = '#e9dcc2';
        for (let i = 1; i < 8; i++) if (i !== 4) for (const y of [-RAIL / 2, 500 + RAIL / 2]) dot(...toScreen(i * 125, y), 2.4 * s);
        for (let i = 1; i < 4; i++) for (const x of [-RAIL / 2, 1000 + RAIL / 2]) dot(...toScreen(x, i * 125), 2.4 * s);
        // Head string and foot spot.
        ctx.strokeStyle = '#ffffff33'; ctx.lineWidth = Math.max(1, s); ctx.beginPath(); ctx.moveTo(...toScreen(250, 0)); ctx.lineTo(...toScreen(250, 500)); ctx.stroke();
        ctx.fillStyle = '#ffffff55'; dot(...toScreen(750, 250), 2.5 * s);
        ctx.fillStyle = '#141112';
        for (const p of (E?.POCKETS || [])) dot(...toScreen(p.x, p.y), (p.r - 2) * s);
        if (!list.length) { drawEmpty(left, top, w, h); return; }
        const game = room?.game;
        const showAim = myTurn() && !animating && !busy && !placing && E;
        const cueBall = pendingCue ? { n: 0, x: pendingCue.x, y: pendingCue.y, p: 0 } : list.find(b => b.n === 0);
        const shown = list.map(b => b.n === 0 && pendingCue ? cueBall : b);
        if (showAim && cueBall && !cueBall.p) drawAim(shown, cueBall);
        for (const b of shown) if (!b.p) drawBall(b);
        if (placing && game?.ballInHand && pendingCue) {
            const ok = E.validPlacement(list, pendingCue.x, pendingCue.y, game.ballInHand);
            ctx.strokeStyle = ok ? '#fffdf9' : '#ff8a7a'; ctx.lineWidth = 2 * s; ctx.setLineDash([4 * s, 3 * s]);
            ctx.beginPath(); ctx.arc(...toScreen(pendingCue.x, pendingCue.y), (E.TABLE.radius + 5) * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
        if (placing && game?.ballInHand === 'kitchen') { ctx.fillStyle = '#ffffff14'; const [kx, ky] = toScreen(0, 0), [kx2, ky2] = toScreen(250, 500); ctx.fillRect(Math.min(kx, kx2), Math.min(ky, ky2), Math.abs(kx2 - kx), Math.abs(ky2 - ky)); }
        if (showAim && cueBall && !cueBall.p) drawCue(cueBall);
    }
    function drawEmpty(left, top, w, h) {
        ctx.fillStyle = '#ffffffcc'; ctx.font = `${Math.max(12, 18 * view.scale)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(room ? 'Esperando rival…' : 'RedMusica Pool', left + w / 2, top + h / 2);
    }
    function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function dot(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    function drawBall(b) {
        const s = view.scale, r = (E?.TABLE.radius || 11) * s, [x, y] = toScreen(b.x, b.y);
        ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
        const color = b.n === 0 ? '#f7f3ea' : COLORS[b.n > 8 ? b.n - 8 : b.n];
        ctx.fillStyle = b.n > 8 ? '#f7f3ea' : color; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
        if (b.n > 8) { ctx.fillStyle = color; if (view.portrait) ctx.fillRect(x - r * 0.55, y - r, r * 1.1, 2 * r); else ctx.fillRect(x - r, y - r * 0.55, 2 * r, r * 1.1); }
        const shade = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.05);
        shade.addColorStop(0, '#ffffff55'); shade.addColorStop(0.5, '#ffffff00'); shade.addColorStop(1, '#00000055');
        ctx.fillStyle = shade; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
        ctx.restore();
        if (b.n && r >= 5.5) {
            ctx.fillStyle = '#fffdf9'; dot(x, y, r * 0.5);
            ctx.fillStyle = '#1f1c1f'; ctx.font = `700 ${Math.max(6, r * 0.7)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(b.n), x, y + r * 0.04);
        }
    }
    function drawAim(list, cueBall) {
        const s = view.scale, guide = E.aimGuide(list, aim.dx, aim.dy);
        if (!guide) return;
        ctx.strokeStyle = '#fffdf9bb'; ctx.lineWidth = 1.5 * s; ctx.setLineDash([6 * s, 5 * s]);
        ctx.beginPath(); ctx.moveTo(...toScreen(cueBall.x, cueBall.y)); ctx.lineTo(...toScreen(guide.point.x, guide.point.y)); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = '#fffdf988'; ctx.beginPath(); ctx.arc(...toScreen(guide.point.x, guide.point.y), E.TABLE.radius * s, 0, Math.PI * 2); ctx.stroke();
        if (guide.ball) {
            const dx = guide.ball.x - guide.point.x, dy = guide.ball.y - guide.point.y, len = Math.hypot(dx, dy) || 1;
            ctx.strokeStyle = '#f6d58caa'; ctx.lineWidth = 2 * s;
            ctx.beginPath(); ctx.moveTo(...toScreen(guide.ball.x, guide.ball.y)); ctx.lineTo(...toScreen(guide.ball.x + dx / len * 70, guide.ball.y + dy / len * 70)); ctx.stroke();
        }
    }
    function drawCue(cueBall) {
        const s = view.scale, len = Math.hypot(aim.dx, aim.dy) || 1, ux = aim.dx / len, uy = aim.dy / len;
        const pull = 16 + Number($('poolFuerza').value) * 0.5, start = E.TABLE.radius + pull, end = start + 300;
        const [x1, y1] = toScreen(cueBall.x - ux * start, cueBall.y - uy * start), [x2, y2] = toScreen(cueBall.x - ux * end, cueBall.y - uy * end);
        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, '#f2ead9'); grad.addColorStop(0.04, '#d9b98a'); grad.addColorStop(0.7, '#9b6a3f'); grad.addColorStop(1, '#3a2419');
        ctx.strokeStyle = grad; ctx.lineCap = 'round'; ctx.lineWidth = 6 * s;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.lineCap = 'butt';
    }
    function animate(last) {
        const frames = [];
        E.simulate(last.before, last.shot, snapshot => frames.push(snapshot));
        if (!frames.length) return Promise.resolve();
        animating = true; updateControls();
        const perFrame = frames.length > 360 ? 3 : frames.length > 180 ? 2 : 1;
        return new Promise(resolve => {
            let i = 0;
            const step = () => {
                draw(frames[Math.min(i, frames.length - 1)]);
                i += perFrame;
                if (i < frames.length) requestAnimationFrame(step);
                else { animating = false; resolve(); }
            };
            requestAnimationFrame(step);
        });
    }

    // ---------- input ----------
    function pointAt(event) {
        if (!myTurn() || busy || animating || !E) return;
        const p = toWorld(event), game = room.game, r = E.TABLE.radius;
        if (placing && game.ballInHand) {
            const maxX = game.ballInHand === 'kitchen' ? E.TABLE.headX : 1000 - r;
            pendingCue = { x: Math.round(Math.min(maxX, Math.max(r, p.x)) * 10) / 10, y: Math.round(Math.min(500 - r, Math.max(r, p.y)) * 10) / 10 };
        } else {
            const c = pendingCue || cue();
            if (!c || c.p) { status('Primero coloca la blanca: toca «Mover la blanca».'); return; }
            const dx = p.x - c.x, dy = p.y - c.y;
            if (Math.hypot(dx, dy) > 2) aim = { dx, dy };
        }
        draw();
    }
    canvas.addEventListener('pointerdown', event => { if (!myTurn()) return; dragging = true; canvas.setPointerCapture?.(event.pointerId); pointAt(event); });
    canvas.addEventListener('pointermove', event => { if (dragging) pointAt(event); });
    canvas.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('pointercancel', () => { dragging = false; });
    function rotate(degrees) {
        const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        aim = { dx: aim.dx * c - aim.dy * s, dy: aim.dx * s + aim.dy * c }; draw();
    }
    function setPower(value) { const input = $('poolFuerza'); input.value = String(Math.max(5, Math.min(100, value))); $('poolFuerzaValor').textContent = input.value + '%'; draw(); }
    canvas.addEventListener('keydown', event => {
        if (!myTurn() || busy || animating) return;
        const big = event.shiftKey ? 5 : 1;
        if (event.key === 'ArrowLeft') rotate(-big); else if (event.key === 'ArrowRight') rotate(big);
        else if (event.key === 'ArrowUp') setPower(Number($('poolFuerza').value) + 5); else if (event.key === 'ArrowDown') setPower(Number($('poolFuerza').value) - 5);
        else if (event.key === 'Enter' || event.key === ' ') shoot(); else return;
        event.preventDefault();
    });
    function shoot() {
        if (!myTurn() || busy || animating) return;
        const game = room.game;
        if (placing && !pendingCue) { status('Toca la mesa para colocar la blanca.'); return; }
        if (pendingCue && !E.validPlacement(balls, pendingCue.x, pendingCue.y, game.ballInHand)) { status(game.ballInHand === 'kitchen' ? 'La blanca debe quedar detrás de la línea, sin tocar otras bolas.' : 'La blanca debe quedar en un espacio libre.'); return; }
        if (!pendingCue && cue()?.p) { status('Coloca la blanca antes de tirar.'); return; }
        placing = false;
        const len = Math.hypot(aim.dx, aim.dy) || 1;
        run('shoot', { dx: aim.dx / len, dy: aim.dy / len, power: Number($('poolFuerza').value) / 100, ...(pendingCue ? { cue: pendingCue } : {}) });
    }

    // ---------- buttons ----------
    $('poolCrear').addEventListener('click', () => run('create', { code: '' }));
    $('poolUnirse').addEventListener('submit', event => { event.preventDefault(); run('join', { code: $('poolCodigo').value.trim().toUpperCase() }); });
    $('poolTirar').addEventListener('click', shoot);
    $('poolGirarIzq').addEventListener('click', () => rotate(-1));
    $('poolGirarDer').addEventListener('click', () => rotate(1));
    $('poolFuerza').addEventListener('input', () => setPower(Number($('poolFuerza').value)));
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
    let confirmLeave = null;
    $('poolSalir').addEventListener('click', () => {
        const button = $('poolSalir');
        // Ask twice whenever a rival is seated: the local view may lag behind a rematch that already started.
        if (room && room.players.length === 2 && !confirmLeave) {
            button.textContent = room.status === 'finished' ? 'Confirmar salida' : 'Confirmar: perderás la partida';
            confirmLeave = setTimeout(() => { confirmLeave = null; button.textContent = 'Salir'; }, 5000);
            return;
        }
        clearTimeout(confirmLeave); confirmLeave = null; button.textContent = 'Salir';
        run('leave');
    });
    $('poolInvitar').addEventListener('click', async () => {
        const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('seccion', 'juegos'); url.searchParams.set('pool', roomCode);
        try { await navigator.clipboard.writeText(url.href); status('Enlace de invitación copiado.'); } catch { status('Comparte este código: ' + roomCode); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && roomCode) refresh(); });
    let resizeFrame = 0;
    const scheduleResize = () => {
        if (resizeFrame) return;
        resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; resize(); });
    };
    if (window.ResizeObserver) new ResizeObserver(scheduleResize).observe(frame); else window.addEventListener('resize', scheduleResize);
    window.addEventListener('resize', resize);

    // ---------- session ----------
    function joinInvite() {
        const invited = new URLSearchParams(location.search).get('pool');
        if (user && invited && /^[A-Z0-9]{6}$/i.test(invited) && invited.toUpperCase() !== roomCode) run('join', { code: invited.toUpperCase() });
    }
    function setUser(next) {
        user = next;
        $('poolAcceso').hidden = Boolean(user);
        $('poolEntrada').hidden = !user || Boolean(roomCode);
        if (!user && roomCode) { leaveView(); $('poolEntrada').hidden = true; status('Inicia sesión desde Inicio para volver a jugar.'); }
    }
    resize();
    if (!db) { status('El pool requiere una cuenta de RedMusica.'); $('poolEntrada').hidden = true; return; }
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
