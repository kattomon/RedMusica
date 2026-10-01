// Online 8-ball pool in its own section, plus the win counter on profiles.
// The pool Edge Function decides every shot; this file only draws the table,
// replays the server's result with the shared engine and sends the player's aim.
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const section = $('poolJuegos');
    const config = window.REDMUSICA_CONFIG;
    const db = config && window.supabase ? window.redmusicaClient || window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
    const ENGINE_URL = './supabase/functions/pool/engine.js?v=20261001-5';
    const TURN_LIMIT_MS = 5 * 60 * 1000, SHOT_CLOCK_MS = 60 * 1000;
    const RAIL = 34;
    const COLORS = { 1: '#e3b22f', 2: '#2b4f9e', 3: '#c23b30', 4: '#5c3b86', 5: '#dd7430', 6: '#2e7445', 7: '#7c2733', 8: '#1f1c1f' };
    const GROUP_NAMES = { solids: 'lisas (1–7)', stripes: 'rayadas (9–15)' };

    setupProfileStats();
    if (!section) return;

    const canvas = $('poolCanvas'), ctx = canvas.getContext('2d'), frame = $('poolLienzo');
    const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    let E = null, user = null, roomCode = '', room = null, busy = false, timer = null, animating = false, queued = null;
    let shownGame = null, shownSeq = -1, balls = [], aim = { dx: 1, dy: 0 }, pendingCue = null, placing = false, dragging = false, placementValid = null;
    let striking = false, cueStroke = 0, channel = null, channelCode = '', subscribed = false, broadcastTimer = null, lastBroadcastFetch = 0;
    let sound = null, muted = false, ringTimer = null, gutterSignature = '';
    let calledPocket = null, timeoutSentFor = null, drops = [], spin = 0, side = 0, callPulse = 0;
    const orient = new Map(), lastSpot = new Map(), sprite = document.createElement('canvas'), spriteCtx = sprite.getContext('2d');
    const avatarCache = new Map();
    try { muted = localStorage.getItem('redmusica-pool-muted') === 'true'; } catch { /* Storage can be unavailable. */ }
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
            if (result.left) {
                await broadcastChange(roomCode, action, 'left');
                leaveView(); status('Saliste de la sala. Puedes crear otra o unirte con un código.'); return;
            }
            status('');
            if (action !== 'state' && action !== 'create') void broadcastChange(result.room.code, action, result.room.updated_at);
            await show(result.room);
        } catch (error) {
            status(error.message);
            if (/No encontramos esa sala|No formas parte/.test(error.message) && action !== 'join') leaveView();
        } finally { busy = false; updateControls(); schedule(); }
    }
    async function refresh(force = false) {
        if (!roomCode || busy || animating || (!force && (document.hidden || !visible()))) { schedule(); return; }
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
        }).subscribe(state => { subscribed = state === 'SUBSCRIBED'; });
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

    // ---------- state ----------
    async function show(next) {
        if (animating) { queued = next; return; }
        const entering = !roomCode;
        const wasMyTurn = myTurn();
        room = next; roomCode = next.code;
        subscribeRoom(next.code);
        $('poolEntrada').hidden = true; $('poolMesa').hidden = false;
        $('poolCodigoSala').textContent = next.code;
        rememberInvite();
        await enginePromise;
        const game = next.game;
        if (game && (!shownGame || shownGame !== game.id)) {
            shownGame = game.id; shownSeq = game.seq; balls = game.balls; pendingCue = null; placing = false; placementValid = null;
            orient.clear(); lastSpot.clear(); calledPocket = null;
            aim = { dx: 1, dy: 0 };
        } else if (game && game.seq !== shownSeq) {
            const last = game.last;
            if (last && last.shot && last.seq === game.seq && game.seq === shownSeq + 1 && !reduceMotion.matches && !document.hidden && visible()) await animate(last);
            shownSeq = game.seq; balls = game.balls; pendingCue = null; calledPocket = null;
            if (last) status(describe(last.summary, game));
        }
        if (game && game.ballInHand && game.turn === user?.id && cue()?.p) placing = true;
        if (!game?.ballInHand) placing = false;
        renderPanel(); renderGutter(); draw(); updateControls(); loadAvatars(next.players);
        if (!ringTimer) ringTimer = setInterval(updateTurnRing, 1000);
        updateTurnRing();
        if (entering || (!wasMyTurn && myTurn())) scrollPoolIntoView();
        if (queued) { const again = queued; queued = null; await show(again); }
    }
    function scrollPoolIntoView() {
        if (window.innerWidth >= 560 || document.hidden || !visible()) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!roomCode || !visible()) return;
            const stickyBottom = Math.max(
                document.querySelector('.cabecera-sitio')?.getBoundingClientRect().bottom || 0,
                document.querySelector('.sidebar-nav')?.getBoundingClientRect().bottom || 0
            ) + 5;
            const top = $('poolBarra').getBoundingClientRect().top + window.scrollY - stickyBottom;
            window.scrollTo(0, Math.max(0, top));
        }));
    }
    function leaveView() {
        room = null; roomCode = ''; shownGame = null; shownSeq = -1; balls = []; pendingCue = null; placing = false; placementValid = null;
        if (channel && db?.removeChannel) db.removeChannel(channel);
        channel = null; channelCode = ''; subscribed = false;
        clearTimeout(broadcastTimer); broadcastTimer = null;
        clearInterval(ringTimer); ringTimer = null;
        gutterSignature = ''; $('poolCanaleta').replaceChildren();
        clearTimeout(timer); timer = null;
        $('poolEntrada').hidden = false; $('poolMesa').hidden = true;
        const url = new URL(location.href);
        if (url.searchParams.has('pool')) { url.searchParams.delete('pool'); history.replaceState(null, '', url); }
    }
    function rememberInvite() {
        const url = new URL(location.href);
        if (url.searchParams.get('pool') === roomCode) return;
        url.searchParams.set('seccion', 'pool'); url.searchParams.set('pool', roomCode);
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
            const avatar = document.createElement('span'); avatar.className = 'pool-avatar'; avatar.setAttribute('aria-hidden', 'true');
            const face = document.createElement('span'); face.className = 'pool-avatar-cara'; face.textContent = player.username.slice(0, 1).toUpperCase();
            const updated = avatarCache.get(player.user_id);
            if (updated && /^[0-9a-f-]{36}$/i.test(player.user_id)) {
                const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
                img.src = config.supabaseUrl + '/storage/v1/object/public/avatars/' + player.user_id + '/avatar.jpg?v=' + encodeURIComponent(updated);
                img.addEventListener('error', () => img.remove()); face.append(img);
            }
            avatar.append(face);
            const identity = document.createElement('span'); identity.className = 'pool-jugador-datos';
            const name = document.createElement('strong');
            name.textContent = player.username + (player.user_id === user?.id ? ' (tú)' : '');
            const detail = document.createElement('span');
            const group = game?.groups?.[player.user_id];
            const left = group ? balls.filter(b => !b.p && (group === 'solids' ? b.n >= 1 && b.n <= 7 : b.n >= 9)).length : null;
            detail.textContent = !game ? 'En la sala' : group ? `${GROUP_NAMES[group]} · ${left ? 'quedan ' + left : 'va por la 8'}` : 'Mesa abierta';
            identity.append(name, detail);
            if (group) {
                const dots = document.createElement('span'); dots.className = 'pool-restantes'; dots.setAttribute('aria-hidden', 'true');
                balls.filter(b => !b.p && (group === 'solids' ? b.n >= 1 && b.n <= 7 : b.n >= 9)).forEach(b => { const d = document.createElement('i'); d.style.setProperty('--bola', COLORS[b.n > 8 ? b.n - 8 : b.n]); if (b.n > 8) d.className = 'rayada'; dots.append(d); });
                identity.append(dots);
            }
            li.append(avatar, identity);
            list.append(li);
        }
        if (room.players.length < 2) { const li = document.createElement('li'); li.className = 'pool-jugador pool-esperando'; li.textContent = 'Esperando rival…'; list.append(li); }
        const turn = $('poolTurno');
        if (room.status === 'lobby' || !game) turn.textContent = `Comparte el código ${room.code} o el enlace de invitación para que alguien se una.`;
        else if (game.winner) turn.textContent = (game.winner === user?.id ? '¡Ganaste! ' : `Ganó ${nameOf(game.winner)}. `) + (game.reason || '');
        else if (myTurn()) turn.textContent = game.ballInHand ? (game.ballInHand === 'kitchen' ? 'Saque: puedes mover la blanca detrás de la línea y luego tirar.' : 'Bola en mano: coloca la blanca donde quieras y tira.') : needsCall() ? 'Vas por la 8: toca la tronera donde la meterás y luego tira.' : 'Te toca. Toca o arrastra sobre la mesa para apuntar y elige la fuerza.';
        else turn.textContent = `Turno de ${nameOf(game.turn)}.`;
        turn.dataset.base = turn.textContent;
        $('poolCantar').hidden = !needsCall();
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
    async function loadAvatars(players) {
        const ids = players.map(p => p.user_id).filter(id => !avatarCache.has(id));
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
    // 60-second shot clock: the ring empties, the last 15 s are shown, and when the opponent
    // runs out this page asks the server for the timeout foul (the server checks the time itself).
    function updateTurnRing() {
        const avatar = $('poolJugadores').querySelector('.pool-turno-activo .pool-avatar');
        if (!room?.turn_started_at || room.status !== 'playing' || !room.game || room.game.winner) return;
        const elapsed = Math.max(0, Date.now() - Number(room.turn_started_at)), left = Math.ceil((SHOT_CLOCK_MS - elapsed) / 1000);
        if (avatar) avatar.style.setProperty('--turn-progress', Math.max(0, 100 - elapsed / SHOT_CLOCK_MS * 100) + '%');
        const turn = $('poolTurno'), base = turn.dataset.base || turn.textContent;
        turn.textContent = left <= 15 && left > 0 && !animating ? `${base} · ${left} s` : base;
        turn.classList.toggle('pool-turno-urgente', left <= 10 && left > 0);
        const recent = timeoutSentFor && timeoutSentFor.seq === room.game.seq && Date.now() - timeoutSentFor.at < 10000;
        if (!myTurn() && elapsed >= SHOT_CLOCK_MS + 1500 && !recent && !busy && !animating) {
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
        $('poolControles').hidden = !(room && room.status === 'playing');
        for (const id of ['poolTirar', 'poolGirarIzq', 'poolGirarDer', 'poolFuerza']) $(id).disabled = !active;
        for (const id of ['poolRueda', 'poolPotencia', 'poolEfecto']) { $(id).setAttribute('aria-disabled', String(!active)); $(id).tabIndex = active ? 0 : -1; }
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
        if (view.portrait) {
            const heightLimit = parseFloat(getComputedStyle(frame).maxHeight);
            cssW = Math.min(width, Math.max(240, Number.isFinite(heightLimit) ? heightLimit : window.innerHeight - 205) * worldW / worldH);
        }
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
        // Cushion noses and pocket jaws, from the same geometry the physics uses.
        ctx.strokeStyle = '#255a4b'; ctx.lineWidth = Math.max(2, 5 * s); ctx.lineCap = 'round';
        for (const [x1, y1, x2, y2] of (E?.CUSHIONS || [])) { ctx.beginPath(); ctx.moveTo(...toScreen(x1, y1)); ctx.lineTo(...toScreen(x2, y2)); ctx.stroke(); }
        ctx.lineCap = 'butt';
        // Head string and foot spot.
        ctx.strokeStyle = '#ffffff33'; ctx.lineWidth = Math.max(1, s); ctx.beginPath(); ctx.moveTo(...toScreen(250, 0)); ctx.lineTo(...toScreen(250, 500)); ctx.stroke();
        ctx.fillStyle = '#ffffff55'; dot(...toScreen(750, 250), 2.5 * s);
        ctx.fillStyle = '#141112';
        for (const p of (E?.POCKETS || [])) dot(...toScreen(p.x, p.y), (p.r - 2) * s);
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
        if (!list.length) { drawEmpty(left, top, w, h); return; }
        const game = room?.game;
        const showAim = myTurn() && !animating && !busy && !placing && E;
        const cueBall = pendingCue ? { n: 0, x: pendingCue.x, y: pendingCue.y, p: 0 } : list.find(b => b.n === 0);
        const shown = list.map(b => b.n === 0 && pendingCue ? cueBall : b);
        if (showAim && cueBall && !cueBall.p) drawAim(shown, cueBall);
        for (const b of shown) if (!b.p) drawShadow(b);
        drawDrops();
        for (const b of shown) if (!b.p) drawBall(b);
        if (placing && game?.ballInHand && pendingCue) {
            const ok = E.validPlacement(list, pendingCue.x, pendingCue.y, game.ballInHand);
            ctx.strokeStyle = ok ? '#fffdf9' : '#ff6a60'; ctx.lineWidth = 3 * s; ctx.setLineDash([4 * s, 3 * s]);
            ctx.beginPath(); ctx.arc(...toScreen(pendingCue.x, pendingCue.y), (E.TABLE.radius + 5) * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
            const [hx, hy] = toScreen(pendingCue.x, pendingCue.y);
            ctx.fillStyle = ok ? '#fffdf9' : '#ff6a60'; ctx.font = `${Math.max(15, 24 * s)}px system-ui, sans-serif`; ctx.textAlign = 'center';
            ctx.fillText('✋', hx + 20 * s, hy - 17 * s);
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
    // ---------- 3D balls ----------
    // Each ball keeps an orientation (3x3 matrix, body -> screen) that turns as it rolls,
    // so numbers, stripes and the cue ball's dots move like on a real table.
    const LIGHT = (() => { const l = [-0.45, -0.55, 0.7], n = Math.hypot(...l); return l.map(v => v / n); })();
    const HALF = (() => { const h = [LIGHT[0], LIGHT[1], LIGHT[2] + 1], n = Math.hypot(...h); return h.map(v => v / n); })();
    function startOrientation(n) {
        const a = n * 0.9 + 0.3, b = n * 1.7 + 0.5, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
        // Rotation about x by a, then about y by b.
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
    function paintBall(n, radiusPx) {
        const size = Math.ceil(radiusPx * 2) + 2, c = size / 2, m = orientationOf(n);
        if (sprite.width !== size) { sprite.width = size; sprite.height = size; }
        const image = spriteCtx.createImageData(size, size), data = image.data;
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
        spriteCtx.putImageData(image, 0, 0);
        return { size, m };
    }
    function drawBall(b, scale = 1, alpha = 1) {
        const r = (E?.TABLE.radius || 11) * view.scale * scale, [x, y] = toScreen(b.x, b.y);
        rollBall(b.n, x, y, r);
        const { size, m } = paintBall(b.n, r);
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, x - size / 2, y - size / 2);
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
            // Cue ball path after impact (an estimate for aiming; the server decides the real shot):
            // it leaves along the tangent, bent forward by follow or back by draw.
            const incoming = Math.hypot(aim.dx, aim.dy) || 1, ux = aim.dx / incoming, uy = aim.dy / incoming;
            const nx = dx / len, ny = dy / len, along = ux * nx + uy * ny;
            const bend = along * (0.25 + 0.6 * spin);
            const tx = ux - along * nx + nx * bend, ty = uy - along * ny + ny * bend, tangent = Math.hypot(tx, ty);
            if (tangent > 0.06) {
                ctx.strokeStyle = '#c9efe1cc'; ctx.setLineDash([4 * s, 4 * s]);
                ctx.beginPath(); ctx.moveTo(...toScreen(guide.point.x, guide.point.y));
                ctx.lineTo(...toScreen(guide.point.x + tx / tangent * 68, guide.point.y + ty / tangent * 68)); ctx.stroke(); ctx.setLineDash([]);
            }
        }
    }
    function drawCue(cueBall) {
        const s = view.scale, len = Math.hypot(aim.dx, aim.dy) || 1, ux = aim.dx / len, uy = aim.dy / len;
        const pull = 16 + Number($('poolFuerza').value) * 0.5, start = Math.max(E.TABLE.radius + 2, E.TABLE.radius + pull + cueStroke), end = start + 300;
        const [x1, y1] = toScreen(cueBall.x - ux * start, cueBall.y - uy * start), [x2, y2] = toScreen(cueBall.x - ux * end, cueBall.y - uy * end);
        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, '#f2ead9'); grad.addColorStop(0.04, '#d9b98a'); grad.addColorStop(0.7, '#9b6a3f'); grad.addColorStop(1, '#3a2419');
        ctx.strokeStyle = grad; ctx.lineCap = 'round'; ctx.lineWidth = 6 * s;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.lineCap = 'butt';
    }
    function primeSound() {
        if (muted) return;
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        try {
            sound ||= new Audio();
            if (sound.state === 'suspended') sound.resume().catch(() => {});
        } catch { /* Audio may be unavailable. */ }
    }
    // Short synthesized clicks: ball-on-ball is bright and short, cushions are dull, pockets rattle.
    function playSound(kind, strength = 1) {
        if (muted || strength <= 0.02) return;
        primeSound();
        if (!sound || sound.state !== 'running') return;
        try {
            const at = sound.currentTime, tone = sound.createOscillator(), volume = sound.createGain();
            const k = kind === 'hit' ? 'cue' : kind;
            const shape = { cue: ['triangle', 900, 260, 0.05], ball: ['sine', 1900, 1200, 0.045], rail: ['triangle', 160, 80, 0.12], pocket: ['sine', 260, 90, 0.22] }[k] || ['triangle', 400, 200, 0.08];
            const loud = Math.min(0.28, 0.02 + 0.26 * strength) * (k === 'rail' ? 0.7 : 1);
            tone.type = shape[0];
            tone.frequency.setValueAtTime(shape[1], at);
            tone.frequency.exponentialRampToValueAtTime(shape[2], at + shape[3]);
            volume.gain.setValueAtTime(0.0001, at);
            volume.gain.exponentialRampToValueAtTime(loud, at + 0.004);
            volume.gain.exponentialRampToValueAtTime(0.0001, at + shape[3] + 0.03);
            tone.connect(volume).connect(sound.destination); tone.start(at); tone.stop(at + shape[3] + 0.06);
        } catch { /* Sound is optional. */ }
    }
    function vibrate(ms = 12) { if (!reduceMotion.matches) try { navigator.vibrate?.(ms); } catch { /* optional */ } }
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
        if (last.by !== user?.id) { playSound('cue', 0.35 + 0.65 * (last.shot.power || 0.5)); vibrate(); }
        for (const b of last.before) if (!b.p) { const [x, y] = toScreen(b.x, b.y); lastSpot.set(b.n, [x, y]); }
        return new Promise(resolve => {
            const started = performance.now();
            let finished = false, played = 0, previous = frames[0];
            const finish = () => {
                if (finished) return; finished = true; clearTimeout(fallback); animating = false;
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
                previous = snapshot;
                // Impacts play at the moment they happen, louder for harder hits (a few per frame at most).
                const tickNow = at * 2;
                let voices = 0;
                while (played < impacts.length && impacts[played].tick <= tickNow) {
                    const hit = impacts[played++];
                    if (voices++ < 4) playSound(hit.type, Math.min(1, hit.strength / (hit.type === 'pocket' ? 14 : 22)));
                }
                draw(snapshot); renderGutter(snapshot);
                if (progress < 1) requestAnimationFrame(step);
                else finish();
            };
            requestAnimationFrame(step);
        });
    }

    // ---------- input ----------
    function pointAt(event) {
        if (!myTurn() || busy || animating || striking || !E) return;
        const p = toWorld(event), game = room.game, r = E.TABLE.radius;
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
        draw();
    }
    canvas.addEventListener('pointerdown', event => {
        if (!myTurn() || busy || animating || striking) return;
        const p = toWorld(event), white = pendingCue || cue();
        if (needsCall() && !placing) { const pocket = pocketNear(p); if (pocket >= 0) { setCall(pocket); return; } }
        if (room.game.ballInHand && (!white || white.p || placing || Math.hypot(p.x - white.x, p.y - white.y) < 45)) placing = true;
        dragging = true; canvas.setPointerCapture?.(event.pointerId); pointAt(event); updateControls();
    });
    canvas.addEventListener('pointermove', event => { if (dragging) pointAt(event); });
    canvas.addEventListener('pointerup', () => {
        dragging = false;
        if (placing && pendingCue && E.validPlacement(balls, pendingCue.x, pendingCue.y, room.game.ballInHand)) {
            placing = false; status('Blanca colocada. Ahora apunta y tira.'); updateControls(); draw();
        }
    });
    canvas.addEventListener('pointercancel', () => { dragging = false; });
    function rotate(degrees) {
        const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        aim = { dx: aim.dx * c - aim.dy * s, dy: aim.dx * s + aim.dy * c }; updateWheel(); draw();
    }
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
        draw();
    }
    canvas.addEventListener('keydown', event => {
        if (!myTurn() || busy || animating) return;
        const big = event.shiftKey ? 5 : 1;
        if (event.key === 'ArrowLeft') rotate(-big); else if (event.key === 'ArrowRight') rotate(big);
        else if (event.key === 'ArrowUp') setPower(Number($('poolFuerza').value) + 5); else if (event.key === 'ArrowDown') setPower(Number($('poolFuerza').value) - 5);
        else if (event.key === 'Enter' || event.key === ' ') shoot(); else return;
        event.preventDefault();
    });
    function needsCall() { return !!(E && room?.game && myTurn() && E.mustCallEight(room.game, user?.id)); }
    async function shoot() {
        if (!myTurn() || busy || animating || striking) return;
        const game = room.game;
        if (placing && !pendingCue) { status('Toca la mesa para colocar la blanca.'); return; }
        if (pendingCue && !E.validPlacement(balls, pendingCue.x, pendingCue.y, game.ballInHand)) { status(game.ballInHand === 'kitchen' ? 'La blanca debe quedar detrás de la línea, sin tocar otras bolas.' : 'La blanca debe quedar en un espacio libre.'); return; }
        if (!pendingCue && cue()?.p) { status('Coloca la blanca antes de tirar.'); return; }
        if (needsCall() && calledPocket === null) { status('Vas por la 8: toca la tronera donde la meterás (o elígela en la lista).'); draw(); $('poolTronera').focus(); return; }
        const len = Math.hypot(aim.dx, aim.dy) || 1, power = Number($('poolFuerza').value) / 100;
        const shot = { dx: aim.dx / len, dy: aim.dy / len, power, ...(spin ? { spin } : {}), ...(side ? { side } : {}), ...(needsCall() ? { call: calledPocket } : {}), ...(pendingCue ? { cue: pendingCue } : {}) };
        primeSound(); placing = false; striking = true; updateControls();
        try { await animateStrike(); } finally { striking = false; updateControls(); }
        playSound('cue', 0.35 + 0.65 * power); vibrate();
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
        const el = $('poolEfecto');
        el.style.setProperty('--efecto', String(spin)); el.style.setProperty('--efecto-x', String(side));
        el.setAttribute('aria-valuenow', String(Math.round(spin * 100)));
        const words = [spin > 0 ? 'seguir ' + Math.round(spin * 100) + '%' : spin < 0 ? 'retroceso ' + Math.round(-spin * 100) + '%' : '', side ? SIDE_WORDS(side) : ''].filter(Boolean);
        el.setAttribute('aria-valuetext', words.length ? words.join(', ') : 'Golpe al centro');
        el.title = words.length ? 'Efecto: ' + words.join(', ') : 'Efecto: golpe al centro';
        draw();
    }
    {
        const el = $('poolEfecto');
        let pressing = false;
        const pick = event => {
            if (!myTurn() || busy || animating) return;
            const r = el.getBoundingClientRect();
            setSpin((0.5 - (event.clientY - r.top) / r.height) * 2.4, ((event.clientX - r.left) / r.width - 0.5) * 2.4);
        };
        el.addEventListener('pointerdown', event => { pressing = true; el.setPointerCapture?.(event.pointerId); pick(event); });
        el.addEventListener('pointermove', event => { if (pressing) pick(event); });
        el.addEventListener('pointerup', () => { pressing = false; });
        el.addEventListener('pointercancel', () => { pressing = false; });
        el.addEventListener('dblclick', () => setSpin(0, 0));
        el.addEventListener('keydown', event => {
            if (!myTurn() || busy || animating) return;
            if (event.key === 'ArrowUp') setSpin(spin + 0.25); else if (event.key === 'ArrowDown') setSpin(spin - 0.25);
            else if (event.key === 'ArrowRight') setSpin(spin, side + 0.25); else if (event.key === 'ArrowLeft') setSpin(spin, side - 0.25);
            else if (event.key === 'Home') setSpin(0, 0); else return;
            event.preventDefault();
        });
    }

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

    // ---------- buttons ----------
    $('poolCrear').addEventListener('click', () => run('create', { code: '' }));
    $('poolUnirse').addEventListener('submit', event => { event.preventDefault(); run('join', { code: $('poolCodigo').value.trim().toUpperCase() }); });
    $('poolTirar').addEventListener('click', shoot);
    $('poolGirarIzq').addEventListener('click', () => rotate(-1));
    $('poolGirarDer').addEventListener('click', () => rotate(1));
    $('poolFuerza').addEventListener('input', () => setPower(Number($('poolFuerza').value)));
    function updateSoundButton() {
        $('poolSilencio').setAttribute('aria-pressed', String(muted));
        $('poolSilencio').setAttribute('aria-label', muted ? 'Activar sonidos del pool' : 'Silenciar sonidos del pool');
        $('poolSilencio').querySelector('.pool-accion-icono').textContent = muted ? '♪̸' : '♫';
        $('poolSilencio').querySelector('.pool-accion-texto').textContent = muted ? 'Sonido: no' : 'Sonido: sí';
    }
    updateSoundButton();
    $('poolSilencio').addEventListener('click', () => {
        muted = !muted;
        try { localStorage.setItem('redmusica-pool-muted', String(muted)); } catch { /* Sound still works for this visit. */ }
        updateSoundButton();
        if (!muted) primeSound();
    });
    const wheel = $('poolRueda'), powerBar = $('poolPotencia');
    let wheelPointer = null, wheelY = 0, powerPointer = null, powerY = 0, powerMoved = false;
    wheel.addEventListener('pointerdown', event => {
        if (!myTurn() || busy || animating || striking) return;
        wheelPointer = event.pointerId; wheelY = event.clientY; wheel.setPointerCapture?.(event.pointerId); event.preventDefault();
    });
    wheel.addEventListener('pointermove', event => {
        if (wheelPointer !== event.pointerId) return;
        const delta = event.clientY - wheelY; wheelY = event.clientY;
        rotate(delta * 0.24); event.preventDefault();
    });
    const endWheel = () => { wheelPointer = null; };
    wheel.addEventListener('pointerup', endWheel); wheel.addEventListener('pointercancel', endWheel);
    wheel.addEventListener('wheel', event => { if (!myTurn() || busy || animating || striking) return; event.preventDefault(); rotate(Math.sign(event.deltaY) * 0.5); }, { passive: false });
    wheel.addEventListener('keydown', event => {
        if (!myTurn() || busy || animating || striking) return;
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') rotate(event.shiftKey ? 5 : 0.5);
        else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') rotate(event.shiftKey ? -5 : -0.5);
        else return;
        event.preventDefault();
    });
    powerBar.addEventListener('pointerdown', event => {
        if (!myTurn() || busy || animating || striking) return;
        primeSound(); powerPointer = event.pointerId; powerY = event.clientY; powerMoved = false;
        powerBar.setPointerCapture?.(event.pointerId); powerBar.classList.add('pool-cargando'); event.preventDefault();
    });
    powerBar.addEventListener('pointermove', event => {
        if (powerPointer !== event.pointerId) return;
        const travel = Math.max(0, event.clientY - powerY);
        if (travel > 8) powerMoved = true;
        if (powerMoved) setPower(5 + travel / Math.max(80, powerBar.clientHeight - 20) * 95);
        event.preventDefault();
    });
    powerBar.addEventListener('pointerup', event => {
        if (powerPointer !== event.pointerId) return;
        powerPointer = null; powerBar.classList.remove('pool-cargando');
        if (powerMoved) shoot();
        else status('Arrastra la barra hacia abajo y suéltala para tirar.');
        event.preventDefault();
    });
    powerBar.addEventListener('pointercancel', () => { powerPointer = null; powerBar.classList.remove('pool-cargando'); });
    powerBar.addEventListener('keydown', event => {
        if (!myTurn() || busy || animating || striking) return;
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
    let confirmLeave = null;
    $('poolSalir').addEventListener('click', () => {
        const button = $('poolSalir');
        const setLabel = label => { button.setAttribute('aria-label', label); button.querySelector('.pool-accion-texto').textContent = label; };
        // Ask twice whenever a rival is seated: the local view may lag behind a rematch that already started.
        if (room && room.players.length === 2 && !confirmLeave) {
            setLabel(room.status === 'finished' ? 'Confirmar salida' : 'Confirmar: perderás la partida');
            confirmLeave = setTimeout(() => { confirmLeave = null; setLabel('Salir'); }, 5000);
            return;
        }
        clearTimeout(confirmLeave); confirmLeave = null; setLabel('Salir');
        run('leave');
    });
    $('poolInvitar').addEventListener('click', async () => {
        const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('seccion', 'pool'); url.searchParams.set('pool', roomCode);
        try { await navigator.clipboard.writeText(url.href); status('Enlace de invitación copiado.'); } catch { status('Comparte este código: ' + roomCode); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && roomCode) { refresh(); if (myTurn()) scrollPoolIntoView(); } });
    const resumePool = () => setTimeout(() => { if (roomCode && visible()) { refresh(true); scrollPoolIntoView(); } }, 0);
    document.addEventListener('click', event => { if (event.target.closest?.('#poolNav')) resumePool(); });
    window.addEventListener('popstate', resumePool);
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
