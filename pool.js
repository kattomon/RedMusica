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
    let shownGame = null, shownSeq = -1, balls = [], aim = { dx: 1, dy: 0 }, pendingCue = null, placing = false, dragging = false, placementValid = null;
    let striking = false, cueStroke = 0, channel = null, channelCode = '', subscribed = false, broadcastTimer = null, lastBroadcastFetch = 0;
    let sound = null, muted = false, ringTimer = null, gutterSignature = '';
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
    const visible = () => !$('seccionJuegos') || !$('seccionJuegos').hidden;

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
            aim = { dx: 1, dy: 0 };
        } else if (game && game.seq !== shownSeq) {
            const last = game.last;
            if (last && last.seq === game.seq && game.seq === shownSeq + 1 && !reduceMotion.matches && !document.hidden && visible()) await animate(last);
            shownSeq = game.seq; balls = game.balls; pendingCue = null;
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
    function updateTurnRing() {
        const avatar = $('poolJugadores').querySelector('.pool-turno-activo .pool-avatar');
        if (!avatar || !room?.turn_started_at) return;
        const elapsed = Math.max(0, Date.now() - Number(room.turn_started_at));
        avatar.style.setProperty('--turn-progress', Math.max(0, 100 - elapsed / TURN_LIMIT_MS * 100) + '%');
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
        for (const id of ['poolRueda', 'poolPotencia']) { $(id).setAttribute('aria-disabled', String(!active)); $(id).tabIndex = active ? 0 : -1; }
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
            // Tangent after impact: a visual estimate, not a change to server physics.
            const incoming = Math.hypot(aim.dx, aim.dy) || 1, ux = aim.dx / incoming, uy = aim.dy / incoming;
            const nx = dx / len, ny = dy / len, along = ux * nx + uy * ny;
            const tx = ux - along * nx, ty = uy - along * ny, tangent = Math.hypot(tx, ty);
            if (tangent > 0.08) {
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
    function playSound(kind) {
        if (muted) return;
        primeSound();
        if (!sound || sound.state !== 'running') return;
        try {
            const at = sound.currentTime, tone = sound.createOscillator(), volume = sound.createGain();
            tone.type = kind === 'pocket' ? 'sine' : 'triangle';
            tone.frequency.setValueAtTime(kind === 'hit' ? 210 : kind === 'rail' ? 150 : 320, at);
            tone.frequency.exponentialRampToValueAtTime(kind === 'hit' ? 95 : kind === 'rail' ? 75 : 130, at + 0.12);
            volume.gain.setValueAtTime(0.0001, at);
            volume.gain.exponentialRampToValueAtTime(kind === 'hit' ? 0.12 : 0.075, at + 0.008);
            volume.gain.exponentialRampToValueAtTime(0.0001, at + (kind === 'pocket' ? 0.2 : 0.13));
            tone.connect(volume).connect(sound.destination); tone.start(at); tone.stop(at + 0.22);
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
        const { events } = E.simulate(last.before, last.shot, snapshot => {
            if (ticks++ % 3 === 0) frames.push(snapshot);
            if (frames.length > 360) frames = frames.filter((_, index) => index % 2 === 0);
        });
        if (!frames.length) return Promise.resolve();
        animating = true; updateControls();
        const duration = Math.min(2500, Math.max(650, ticks * 6));
        if (last.by !== user?.id) { playSound('hit'); vibrate(); }
        return new Promise(resolve => {
            const started = performance.now(); let railPlayed = false, pocketCount = last.before.filter(b => b.n && b.p).length;
            let finished = false;
            const finish = () => { if (finished) return; finished = true; clearTimeout(fallback); animating = false; resolve(); };
            const fallback = setTimeout(finish, duration + 350);
            const step = now => {
                if (finished) return;
                const progress = Math.max(0, Math.min(1, (now - started) / duration));
                const snapshot = frames[Math.min(frames.length - 1, Math.floor(progress * (frames.length - 1)))];
                draw(snapshot); renderGutter(snapshot);
                const entered = snapshot.filter(b => b.n && b.p).length;
                if (entered > pocketCount) { playSound('pocket'); vibrate(18); pocketCount = entered; }
                if (!railPlayed && events.railAfterContact && progress > 0.42) { playSound('rail'); railPlayed = true; }
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
    async function shoot() {
        if (!myTurn() || busy || animating || striking) return;
        const game = room.game;
        if (placing && !pendingCue) { status('Toca la mesa para colocar la blanca.'); return; }
        if (pendingCue && !E.validPlacement(balls, pendingCue.x, pendingCue.y, game.ballInHand)) { status(game.ballInHand === 'kitchen' ? 'La blanca debe quedar detrás de la línea, sin tocar otras bolas.' : 'La blanca debe quedar en un espacio libre.'); return; }
        if (!pendingCue && cue()?.p) { status('Coloca la blanca antes de tirar.'); return; }
        const len = Math.hypot(aim.dx, aim.dy) || 1;
        const shot = { dx: aim.dx / len, dy: aim.dy / len, power: Number($('poolFuerza').value) / 100, ...(pendingCue ? { cue: pendingCue } : {}) };
        primeSound(); placing = false; striking = true; updateControls();
        try { await animateStrike(); } finally { striking = false; updateControls(); }
        playSound('hit'); vibrate();
        await run('shoot', shot);
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
        const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('seccion', 'juegos'); url.searchParams.set('pool', roomCode);
        try { await navigator.clipboard.writeText(url.href); status('Enlace de invitación copiado.'); } catch { status('Comparte este código: ' + roomCode); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && roomCode) { refresh(); if (myTurn()) scrollPoolIntoView(); } });
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
