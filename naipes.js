// Card games (Brisca, Poto Sucio, Carioca, ¡Última!). The naipes Edge Function shuffles, deals and
// checks every move; this page only shows your own cards and sends what you choose to play.
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const root = $('naipes');
    const config = window.REDMUSICA_CONFIG;
    const db = config && window.supabase ? window.redmusicaClient || window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
    const CARIOCA_URL = './supabase/functions/naipes/carioca.js?v=20261003-1';
    setupProfileStats();
    if (!root) return;

    let Carioca = null;
    import(CARIOCA_URL).then(module => { Carioca = module; if (room?.game === 'carioca') render(); }).catch(() => {});
    const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };
    const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    let user = null, roomCode = '', room = null, busy = false, pollTimer = null, tickTimer = null, offset = 0, bestRtt = Infinity;
    let channel = null, channelCode = '', subscribed = false, pingTimer = null, sound = null, muted = false, confirmLeave = null;
    let selected = new Set(), groups = [], sortMode = 'rank', lastSeq = -1, lastTurnMine = false, timeoutAsked = '', colorPick = null, seenCards = new Set();
    try { muted = localStorage.getItem('redmusica-naipes-muted') === 'true'; } catch { /* storage may be blocked */ }
    const serverNow = () => Date.now() + offset;
    const me = () => user?.id || '';
    const isHost = () => !!room && room.host_id === me();

    const GAMES = {
        brisca: {
            name: 'Brisca', players: '2, 3, 4 en parejas o 6 en tríos', deck: 'Naipe español', icon: '🗡️',
            blurb: 'Gana bazas y suma más de 60 puntos. La muestra marca el triunfo.',
            options: [{ key: 'target', label: 'Para ganar', choices: [[1, 'Una mano'], [2, 'Mejor de 3'], [3, 'Mejor de 5']] }],
            rules: ['Se juega con naipe español de 40 cartas (48 con seis jugadores). Cada uno tiene tres cartas; la carta que queda a la vista es la muestra y su pinta es el triunfo.',
                'No es obligatorio seguir la pinta. Gana la baza el triunfo más alto o, si no hay triunfos, la carta más alta de la pinta que salió. Orden: As, 3, Rey, Caballo, Sota, 7, 6, 5, 4, 2.',
                'Después de cada baza todos roban una carta, partiendo por quien ganó, que además sale en la siguiente.',
                'Puntos: As 11, 3 10, Rey 4, Caballo 3, Sota 2. Hay 120 en total: gana la mano quien (o la pareja que) pase de 60.',
                'Si ya ganaste una baza puedes cambiar la muestra: con el 7 del triunfo si la muestra es mayor que un 7, o con el 2 si es menor.']
        },
        potosucio: {
            name: 'Poto Sucio', players: '2 a 8', deck: 'Naipe inglés + 1 joker', icon: '🃏',
            blurb: 'Junta pares y sácale cartas a tu vecino. Que no te quede el joker.',
            options: [],
            rules: ['Se reparte todo el naipe con un joker. Los pares del mismo número se bajan solos.',
                'En tu turno le sacas una carta, sin ver, al siguiente jugador que todavía tenga cartas. Si forma par con una tuya, se bajan las dos.',
                'Puedes barajar tu mano para que no sepan dónde quedó cada carta.',
                'Quien se queda sin cartas se salva. Quien termina con el joker es el poto sucio.']
        },
        carioca: {
            name: 'Carioca', players: '2 a 6', deck: '2 naipes ingleses + 4 jokers', icon: '🂡',
            blurb: 'Ocho rondas con contratos de tríos y escalas. Gana quien sume menos.',
            options: [{ key: 'rounds', label: 'Partida', choices: [[8, 'Completa (8 rondas)'], [4, 'Corta (4 rondas)']] }],
            rules: ['Se juega con dos naipes ingleses y cuatro jokers. En cada ronda se reparten 12 cartas.',
                'Contratos: 1) 2 tríos, 2) 1 trío y 1 escala, 3) 2 escalas, 4) 3 tríos, 5) 2 tríos y 1 escala, 6) 1 trío y 2 escalas, 7) 3 escalas, 8) 4 tríos.',
                'Trío: tres o más cartas del mismo número. Escala: cuatro o más cartas seguidas de la misma pinta (el As va abajo o arriba, nunca dando la vuelta). Máximo un joker por juego.',
                'En tu turno robas (del mazo o del pozo), te bajas cuando completas el contrato, desde tu siguiente turno puedes pegar cartas en cualquier juego de la mesa, y botas una carta.',
                'La ronda termina cuando alguien se queda sin cartas. Los demás suman lo que tienen en la mano: 2 a 10 lo que dicen, J, Q y K 10, As 20 y joker 30. Gana quien sume menos al final.']
        },
        ultima: {
            name: '¡Última!', players: '2 a 10', deck: '108 cartas de colores', icon: '🎨',
            blurb: 'Tira por color o número, usa los comodines y no olvides gritar ¡Última!',
            options: [{ key: 'target', label: '¿Hasta cuándo?', choices: [[0, 'Una mano'], [200, 'A 200 puntos'], [500, 'A 500 puntos']] }],
            rules: ['Cada uno recibe 7 cartas. En tu turno tira una carta del mismo color o del mismo número o símbolo que la de arriba, o un comodín.',
                'Salta: el siguiente pierde el turno. Reversa: cambia el sentido. +2: el siguiente roba dos y pierde el turno. Comodín: eliges el color. Comodín +4: eliges el color y el siguiente roba cuatro (solo si no tienes cartas del color que va).',
                'Si no puedes tirar, robas una; si te sirve, la puedes tirar al tiro.',
                'Cuando te quede una carta, toca «¡Última!». Si alguien te pilla antes, robas dos.',
                'Gana la mano quien se queda sin cartas y suma lo que les queda a los demás: números lo que dicen, Salta, Reversa y +2 20 puntos, comodines 50.']
        }
    };

    // ---------- helpers ----------
    function h(tag, attrs = {}, ...children) {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs || {})) {
            if (value === undefined || value === null || value === false) continue;
            if (key === 'class') el.className = value;
            else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
            else if (key === 'text') el.textContent = value;
            else el.setAttribute(key, value === true ? '' : String(value));
        }
        for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : String(child));
        return el;
    }
    const svgNS = 'http://www.w3.org/2000/svg';
    function svg(viewBox, paths) {
        const el = document.createElementNS(svgNS, 'svg'); el.setAttribute('viewBox', viewBox); el.setAttribute('aria-hidden', 'true');
        for (const [d, fill, stroke] of paths) { const p = document.createElementNS(svgNS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', fill || 'none'); if (stroke) { p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linejoin', 'round'); } el.append(p); }
        return el;
    }
    const nameOf = seat => { const id = room?.view?.players?.[seat]; return room?.players.find(p => p.user_id === id)?.username || 'Jugador'; };
    const nameById = id => room?.players.find(p => p.user_id === id)?.username || 'Jugador';
    const mySeat = () => room?.view?.seat ?? -1;
    const status = message => { $('naipesEstado').textContent = message; };

    // ---------- cards ----------
    const FRENCH = { S: ['♠', 'picas'], H: ['♥', 'corazones'], D: ['♦', 'diamantes'], C: ['♣', 'tréboles'] };
    const SPANISH = { O: 'oros', C: 'copas', E: 'espadas', B: 'bastos' };
    const SPANISH_NAMES = { 1: 'As', 10: 'Sota', 11: 'Caballo', 12: 'Rey' };
    const SPANISH_ICONS = {
        O: () => svg('0 0 40 40', [['M20 4a16 16 0 1 0 0 32a16 16 0 1 0 0-32Z', '#e0a526', '#8a5a0c'], ['M20 11a9 9 0 1 0 0 18a9 9 0 1 0 0-18Z', '#f6cf5a', '#8a5a0c']]),
        C: () => svg('0 0 40 40', [['M8 6h24c0 10-5 15-10 16v6h6v6H12v-6h6v-6C13 21 8 16 8 6Z', '#d24a3c', '#7e2219']]),
        E: () => svg('0 0 40 40', [['M20 2l4 6v20h-8V8Z', '#9fb4c8', '#3b4c63'], ['M11 28h18v4H11Z', '#3b6aa8', '#22406a'], ['M18 32h4v6h-4Z', '#3b4c63', '#22406a']]),
        B: () => svg('0 0 40 40', [['M14 36l6-32c3 0 6 2 6 5l-4 27Z', '#3f8a49', '#1f4d26'], ['M17 14l6 1M16 22l6 1', 'none', '#1f4d26']])
    };
    const ULTIMA_COLORS = { R: 'rojo', Y: 'amarillo', G: 'verde', B: 'azul' };
    const ULTIMA_LABEL = v => ({ S: 'Salta', V: 'Reversa', D2: '+2', W: 'Comodín', W4: 'Comodín +4' })[v] || v;
    const ULTIMA_GLYPH = v => ({ S: '⊘', V: '⇄', D2: '+2', W: '★', W4: '+4' })[v] || v;
    function cardLabel(card, game) {
        if (!card) return '';
        if (game === 'brisca') return `${SPANISH_NAMES[card.r] || card.r} de ${SPANISH[card.s]}`;
        if (game === 'ultima') return card.c ? `${ULTIMA_LABEL(card.v)} ${ULTIMA_COLORS[card.c]}` : ULTIMA_LABEL(card.v);
        if (card.r === 'JK') return 'Joker';
        return `${card.r} de ${FRENCH[card.s][1]}`;
    }
    function cardEl(card, game, opts = {}) {
        const fresh = card && !seenCards.has(card.id + game) && !reduceMotion.matches;
        if (card) seenCards.add(card.id + game);
        const tag = opts.onclick ? 'button' : 'span';
        const base = { type: opts.onclick ? 'button' : undefined, onclick: opts.onclick, 'aria-pressed': opts.onclick && opts.selectable ? String(!!opts.selected) : undefined, 'aria-label': opts.label || (opts.faceDown ? 'Carta boca abajo' : cardLabel(card, game)), disabled: opts.disabled ? true : undefined };
        const cls = ['carta', opts.small ? 'carta-chica' : '', opts.selected ? 'carta-elegida' : '', opts.dim ? 'carta-apagada' : '', opts.glow ? 'carta-jugable' : '', fresh && opts.animate !== false ? 'carta-nueva' : ''];
        if (opts.faceDown || !card) return h(tag, { ...base, class: [...cls, 'carta-dorso', game === 'ultima' ? 'carta-dorso-u' : ''].join(' ') }, h('span', { class: 'carta-dorso-dibujo', 'aria-hidden': 'true' }));
        if (game === 'ultima') {
            const wild = !card.c;
            return h(tag, { ...base, class: [...cls, 'carta-u', wild ? 'carta-u-comodin' : 'carta-u-' + card.c].join(' ') },
                h('span', { class: 'carta-u-esquina', 'aria-hidden': 'true', text: ULTIMA_GLYPH(card.v) }),
                h('span', { class: 'carta-u-centro', 'aria-hidden': 'true' }, wild ? h('span', { class: 'carta-u-rueda' }, h('b', { text: card.v === 'W4' ? '+4' : '★' })) : h('b', { text: ULTIMA_GLYPH(card.v) })),
                h('span', { class: 'carta-u-esquina carta-u-abajo', 'aria-hidden': 'true', text: ULTIMA_GLYPH(card.v) }));
        }
        if (game === 'brisca') {
            return h(tag, { ...base, class: [...cls, 'carta-es', 'carta-es-' + card.s].join(' ') },
                h('span', { class: 'carta-es-num', 'aria-hidden': 'true', text: String(card.r) }),
                h('span', { class: 'carta-es-pinta', 'aria-hidden': 'true' }, SPANISH_ICONS[card.s]()),
                h('span', { class: 'carta-es-nombre', 'aria-hidden': 'true', text: SPANISH_NAMES[card.r] || '' }));
        }
        if (card.r === 'JK') return h(tag, { ...base, class: [...cls, 'carta-fr', 'carta-joker'].join(' ') }, h('span', { class: 'carta-fr-num', 'aria-hidden': 'true', text: 'JK' }), h('span', { class: 'carta-fr-pinta', 'aria-hidden': 'true', text: '★' }));
        const red = card.s === 'H' || card.s === 'D';
        return h(tag, { ...base, class: [...cls, 'carta-fr', red ? 'carta-roja' : ''].join(' ') },
            h('span', { class: 'carta-fr-num', 'aria-hidden': 'true', text: card.r }),
            h('span', { class: 'carta-fr-pinta', 'aria-hidden': 'true', text: FRENCH[card.s][0] }),
            h('span', { class: 'carta-fr-num carta-fr-abajo', 'aria-hidden': 'true', text: card.r }));
    }

    // ---------- server ----------
    async function request(action, extra = {}) {
        if (!db) throw new Error('No se pudo iniciar el juego. Recarga la página.');
        const { data: { session } } = await db.auth.getSession();
        if (!session) throw new Error('Inicia sesión para jugar a las cartas.');
        const sent = Date.now();
        const response = await fetch(config.supabaseUrl + '/functions/v1/naipes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: config.supabasePublishableKey, Authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify({ action, code: extra.code ?? roomCode, ...extra }),
            signal: AbortSignal.timeout(12000)
        });
        let result = {};
        try { result = await response.json(); } catch { /* handled below */ }
        if (!response.ok) throw new Error(result.error || (response.status === 404 ? 'Los juegos de cartas todavía no están disponibles. Inténtalo más tarde.' : 'No se pudo actualizar la mesa.'));
        const rtt = Date.now() - sent;
        if (result.room?.now && rtt < 4000) { const sample = result.room.now - (sent + rtt / 2); if (rtt <= bestRtt + 80 || Math.abs(sample - offset) > 1500) { offset = bestRtt === Infinity ? sample : (offset + sample) / 2; bestRtt = Math.min(bestRtt, rtt); } }
        return result;
    }
    async function run(action, extra = {}, { announce = true } = {}) {
        if (busy) return null;
        busy = true; paintBusy();
        try {
            const result = await request(action, extra);
            if (result.left) { if (announce) await ping(); leaveView(); return result; }
            status('');
            if (announce) void ping();
            show(result.room);
            return result;
        } catch (error) {
            status(error.message); vibrate(40);
            if (/No encontramos esa mesa|No formas parte/.test(error.message) && action !== 'join') leaveView();
            return null;
        } finally { busy = false; paintBusy(); schedule(); }
    }
    const play = move => run('play', { move });
    async function refresh() {
        if (!roomCode || busy) return schedule();
        try { show((await request('state')).room); }
        catch (error) { if (/No encontramos esa mesa|No formas parte/.test(error.message)) { status(error.message); leaveView(); } }
        schedule();
    }
    function schedule() {
        clearTimeout(pollTimer); pollTimer = null;
        if (!roomCode) return;
        const visible = !document.hidden && !$('seccionNaipes')?.hidden;
        pollTimer = setTimeout(refresh, !visible ? 12000 : room?.status === 'playing' ? (subscribed ? 6000 : 2500) : 5000);
    }
    function subscribeRoom(code) {
        if (channel && channelCode === code) return;
        if (channel && db?.removeChannel) db.removeChannel(channel);
        channel = null; channelCode = ''; subscribed = false;
        if (!db?.channel) return;
        channelCode = code;
        channel = db.channel('naipes:' + code, { config: { broadcast: { self: false, ack: false } } });
        channel.on('broadcast', { event: 'changed' }, ({ payload }) => {
            if (!payload || payload.code !== roomCode || payload.sender === me()) return;
            clearTimeout(pingTimer); pingTimer = setTimeout(refresh, 40 + Math.random() * 160);
        }).subscribe(state => { subscribed = state === 'SUBSCRIBED'; });
    }
    async function ping() {
        if (!subscribed || !channel || !roomCode) return;
        try { await Promise.race([channel.send({ type: 'broadcast', event: 'changed', payload: { code: roomCode, sender: me() } }), new Promise(r => setTimeout(r, 700))]); } catch { /* polling still works */ }
    }

    // ---------- room ----------
    function show(next) {
        if (!next) return;
        const entering = !roomCode;
        room = next; roomCode = next.code;
        subscribeRoom(next.code);
        const url = new URL(location.href);
        if (url.searchParams.get('mesa') !== roomCode) { url.searchParams.set('seccion', 'naipes'); url.searchParams.set('mesa', roomCode); history.replaceState(history.state, '', url); }
        $('naipesEntrada').hidden = true; $('naipesSala').hidden = false;
        $('naipesCodigo').textContent = next.code; $('naipesNombreJuego').textContent = GAMES[next.game].name;
        paintRules(next.game);
        const seq = next.view ? next.view.seq + ':' + next.view.phase + ':' + (next.view.handNo || next.view.round || 0) : 'x';
        if (seq !== lastSeq) { lastSeq = seq; if (next.view) { selected = new Set([...selected].filter(id => next.view.hand?.some(c => c.id === id))); } else selected.clear(); }
        const myTurn = next.status === 'playing' && next.waitingFor === me();
        if (myTurn && !lastTurnMine) { playSound('turn'); vibrate(25); }
        lastTurnMine = myTurn;
        render();
        if (!tickTimer) tickTimer = setInterval(tick, 500);
        if (entering) requestAnimationFrame(() => { const top = $('naipesSala').getBoundingClientRect().top + scrollY - 70; if (Math.abs(scrollY - top) > 40) scrollTo(0, Math.max(0, top)); });
    }
    function leaveView() {
        room = null; roomCode = ''; selected.clear(); groups = []; seenCards.clear(); lastSeq = -1;
        clearTimeout(pollTimer); clearInterval(tickTimer); tickTimer = null;
        if (channel && db?.removeChannel) db.removeChannel(channel);
        channel = null; channelCode = ''; subscribed = false;
        $('naipesVista').replaceChildren(); $('naipesSala').hidden = true; $('naipesEntrada').hidden = !user;
        const url = new URL(location.href);
        if (url.searchParams.has('mesa')) { url.searchParams.delete('mesa'); history.replaceState(history.state, '', url); }
        paintRules(null); loadRecord();
    }
    function paintBusy() { for (const el of root.querySelectorAll('[data-accion]')) el.disabled = busy; }
    function paintRules(game) {
        const box = $('naipesReglasTexto');
        if (!game) { box.replaceChildren(...Object.values(GAMES).map(g => h('div', {}, h('h4', { text: g.name }), h('ul', {}, g.rules.map(r => h('li', { text: r })))))); $('naipesReglas').querySelector('summary').textContent = 'Reglas de los juegos'; return; }
        box.replaceChildren(h('ul', {}, GAMES[game].rules.map(r => h('li', { text: r }))));
        $('naipesReglas').querySelector('summary').textContent = 'Reglas de ' + GAMES[game].name;
    }

    // ---------- menu ----------
    function paintMenu() {
        $('naipesJuegos').replaceChildren(...Object.entries(GAMES).map(([id, g]) => h('li', { class: 'naipes-juego naipes-juego-' + id },
            h('span', { class: 'naipes-juego-icono', 'aria-hidden': 'true', text: g.icon }),
            h('h4', { text: g.name }),
            h('p', { class: 'naipes-juego-datos', text: `${g.players} jugadores · ${g.deck}` }),
            h('p', { text: g.blurb }),
            h('button', { type: 'button', 'data-accion': '1', text: 'Crear mesa de ' + g.name, onclick: () => { primeSound(); run('create', { code: '', game: id }, { announce: false }); } }))));
    }

    // ---------- table rendering ----------
    function render() {
        const view = $('naipesVista');
        view.dataset.juego = room.game; view.dataset.fase = room.status;
        if (room.status === 'lobby' || !room.view) { view.replaceChildren(lobby()); paintBusy(); return; }
        const builders = { brisca: brisca, potosucio: potosucio, carioca: carioca, ultima: ultima };
        const scroll = view.querySelector('.mano')?.scrollLeft || 0;
        view.replaceChildren(...[seats(), builders[room.game](), room.status === 'finished' ? finished() : null].filter(Boolean));
        const hand = view.querySelector('.mano'); if (hand) hand.scrollLeft = scroll;
        paintBusy(); tick();
    }
    function lobby() {
        const g = GAMES[room.game], limits = room.limits, n = room.players.length;
        const ok = limits.allowed.includes(n);
        const box = h('div', { class: 'naipes-lobby' },
            room.notice ? h('p', { class: 'naipes-aviso-mesa', text: room.notice }) : null,
            h('div', { class: 'naipes-codigo' }, h('span', { text: 'Código de la mesa' }), h('strong', { text: room.code }), h('button', { type: 'button', class: 'naipes-secundario', text: 'Compartir invitación', onclick: invite })),
            h('h4', { text: `Jugadores (${n} de ${limits.max})` }),
            h('ul', { class: 'naipes-jugadores' }, room.players.map(p => h('li', { class: p.user_id === me() ? 'naipes-yo' : '' },
                h('span', { class: 'naipes-inicial', 'aria-hidden': 'true', text: p.username.slice(0, 1).toUpperCase() }), h('span', { text: p.username + (p.user_id === room.host_id ? ' 👑' : '') }),
                isHost() && p.user_id !== me() ? h('button', { type: 'button', class: 'naipes-sacar', 'aria-label': 'Sacar a ' + p.username, text: '×', onclick: () => run('kick', { user_id: p.user_id }) }) : null))));
        if (isHost()) {
            const select = (label, key, choices) => h('label', { class: 'naipes-opcion' }, h('span', { text: label }), h('select', { onchange: e => run('options', { game: room.game, options: { ...room.options, [key]: Number(e.target.value) } }) },
                choices.map(([value, text]) => { const o = h('option', { value: String(value), text }); o.selected = room.options[key] === value; return o; })));
            const gameSelect = h('label', { class: 'naipes-opcion' }, h('span', { text: 'Juego' }), h('select', { onchange: e => run('options', { game: e.target.value, options: {} }) },
                Object.entries(GAMES).map(([id, info]) => { const o = h('option', { value: id, text: info.name }); o.selected = id === room.game; return o; })));
            box.append(h('div', { class: 'naipes-opciones' }, gameSelect, ...g.options.map(o => select(o.label, o.key, o.choices))));
            box.append(h('div', { class: 'naipes-acciones' },
                h('button', { type: 'button', class: 'naipes-principal', 'data-accion': '1', disabled: ok ? undefined : true, text: ok ? `Repartir (${n} jugadores)` : `Faltan jugadores: ${g.players}`, onclick: () => { primeSound(); run('start'); } })));
        } else {
            const option = g.options[0];
            box.append(h('p', { class: 'naipes-espera', text: `${option ? option.choices.find(c => c[0] === room.options[option.key])?.[1] + ' · ' : ''}Esperando que ${nameById(room.host_id)} reparta…` }));
        }
        return box;
    }
    // Everyone around the table: cards left, whose turn, and the turn clock.
    function seats() {
        const v = room.view, game = room.game;
        return h('ol', { class: 'naipes-asientos', 'aria-label': 'Jugadores' }, v.players.map((id, seat) => {
            const turn = room.status === 'playing' && v.phase === 'play' && v.turn === seat;
            let detail = `${v.counts?.[seat] ?? 0} cartas`;
            if (game === 'brisca' && v.teams.length < v.players.length) detail += ` · ${['Pareja A', 'Pareja B'][v.teams.findIndex(t => t.includes(seat))]}`;
            if (game === 'potosucio' && v.out.includes(seat)) detail = 'Se salvó ✓';
            if (game === 'potosucio' && v.from === seat && v.phase === 'play') detail += ' · le sacan';
            if (game === 'carioca') detail += ` · ${v.totals[seat]} pts${v.down[seat] ? ' · bajado' : ''}`;
            if (game === 'ultima') { detail += v.target ? ` · ${v.scores[seat]} pts` : ''; if (v.declared.includes(seat) && v.counts[seat] <= 1) detail += ' · ¡Última!'; }
            return h('li', { class: 'naipes-asiento' + (turn ? ' naipes-turno' : '') + (seat === v.seat ? ' naipes-yo' : ''), 'data-seat': String(seat) },
                h('span', { class: 'naipes-reloj', 'aria-hidden': 'true' }, h('span', { class: 'naipes-inicial', text: nameOf(seat).slice(0, 1).toUpperCase() })),
                h('span', { class: 'naipes-asiento-datos' }, h('strong', { text: nameOf(seat) + (seat === v.seat ? ' (tú)' : '') }), h('span', { text: detail })));
        }));
    }
    function handEl(cards, game, { onPick, isPlayable, multi = false, sort = true } = {}) {
        let list = [...cards];
        if (sort && game !== 'potosucio') list = sortCards(list, game);
        return h('div', { class: 'mano', role: 'group', 'aria-label': 'Tus cartas' }, list.map(card => {
            const can = isPlayable ? isPlayable(card) : true;
            return cardEl(card, game, { onclick: onPick ? () => onPick(card) : undefined, selectable: !!onPick, selected: selected.has(card.id), dim: isPlayable && !can, glow: isPlayable && can });
        }));
    }
    const FR_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', 'JK'], SUIT_ORDER = ['S', 'H', 'C', 'D', '*'];
    function sortCards(cards, game) {
        if (game === 'brisca') return cards.sort((a, b) => a.s.localeCompare(b.s) || a.r - b.r);
        if (game === 'ultima') { const order = ['R', 'Y', 'G', 'B', null]; return cards.sort((a, b) => order.indexOf(a.c) - order.indexOf(b.c) || String(a.v).localeCompare(String(b.v), 'es', { numeric: true })); }
        if (sortMode === 'suit') return cards.sort((a, b) => SUIT_ORDER.indexOf(a.s) - SUIT_ORDER.indexOf(b.s) || FR_ORDER.indexOf(a.r) - FR_ORDER.indexOf(b.r));
        return cards.sort((a, b) => FR_ORDER.indexOf(a.r) - FR_ORDER.indexOf(b.r) || SUIT_ORDER.indexOf(a.s) - SUIT_ORDER.indexOf(b.s));
    }
    const myTurn = () => room?.status === 'playing' && room.view?.phase === 'play' && room.view.turn === room.view.seat;
    function turnBanner(text) { return h('p', { class: 'naipes-turno-texto' + (myTurn() ? ' naipes-te-toca' : ''), role: 'status', text }); }
    function breakPanel(title, lines, button = 'Siguiente mano') {
        return h('div', { class: 'naipes-pausa' }, h('h4', { text: title }), lines.map(line => h('p', { text: line })),
            h('button', { type: 'button', class: 'naipes-principal', 'data-accion': '1', text: button, onclick: () => play({ type: 'next' }) }),
            h('p', { class: 'naipes-pista', id: 'naipesPausaReloj' }));
    }

    // Brisca
    function brisca() {
        const v = room.view, seat = v.seat;
        const team = v.teams.findIndex(t => t.includes(seat));
        const teamName = t => v.teams.length === 2 && v.players.length > 2 ? ['Pareja A', 'Pareja B'][t] + ' (' + v.teams[t].map(nameOf).join(' y ') + ')' : nameOf(v.teams[t][0]);
        const center = h('div', { class: 'naipes-centro naipes-centro-brisca' },
            h('div', { class: 'naipes-mazo' }, v.stock ? cardEl(v.muestra, 'brisca', { small: true, label: 'Muestra: ' + cardLabel(v.muestra, 'brisca'), animate: false }) : null,
                v.stock > 1 ? cardEl(null, 'brisca', { faceDown: true, small: true, label: `Mazo: ${v.stock} cartas` }) : null,
                h('span', { class: 'naipes-mazo-texto', text: v.stock ? `Triunfo: ${SPANISH[v.trump]} · quedan ${v.stock}` : `Triunfo: ${SPANISH[v.trump]} · sin mazo` })),
            h('div', { class: 'naipes-baza', 'aria-label': 'Baza en juego' }, v.trick.length ? v.trick.map(p => h('figure', {}, cardEl(p.card, 'brisca', { small: false }), h('figcaption', { text: nameOf(p.seat) })))
                : v.lastTrick ? h('p', { class: 'naipes-pista', text: `${nameOf(v.lastTrick.winner)} se llevó la última baza (+${v.lastTrick.points}).` }) : h('p', { class: 'naipes-pista', text: 'Sale ' + nameOf(v.turn) + '.' })),
            h('p', { class: 'naipes-marcador', text: `Tus puntos en esta mano: ${v.myPoints ?? 0}${v.target > 1 ? ` · Manos: ${v.score.map((s, t) => teamName(t) + ' ' + s).join(' · ')}` : ''}` }));
        if (v.phase === 'handOver' || (room.status === 'finished' && v.lastHand)) {
            const lh = v.lastHand;
            const lines = v.points ? v.points.map((p, t) => `${teamName(t)}: ${p} puntos`) : [];
            const title = lh?.winnerTeam === null ? 'Empate' : lh?.winnerTeam === team ? '¡Ganaste la mano!' : `Ganó ${teamName(lh.winnerTeam)}`;
            if (v.phase === 'handOver') return h('div', { class: 'naipes-mesa' }, center, breakPanel(title, lines));
        }
        const can = myTurn();
        return h('div', { class: 'naipes-mesa' },
            turnBanner(can ? 'Te toca: toca una carta para elegirla y tócala otra vez (o «Jugar») para tirarla.' : v.phase === 'play' ? `Turno de ${nameOf(v.turn)}.` : ''),
            center,
            handEl(v.hand, 'brisca', { onPick: card => pickOne(card, can, () => play({ type: 'play', card: card.id })) }),
            h('div', { class: 'naipes-acciones' },
                can ? h('button', { type: 'button', class: 'naipes-principal', 'data-accion': '1', disabled: selected.size ? undefined : true, text: 'Jugar carta', onclick: () => play({ type: 'play', card: [...selected][0] }) }) : null,
                v.canSwap ? h('button', { type: 'button', class: 'naipes-secundario', 'data-accion': '1', text: 'Cambiar la muestra', onclick: () => play({ type: 'swap' }) }) : null));
    }
    // One tap selects, a second tap on the same card plays it.
    function pickOne(card, allowed, playNow) {
        if (!allowed) { status('Espera tu turno.'); return; }
        if (selected.has(card.id)) { selected.clear(); playNow(); return; }
        selected = new Set([card.id]); render();
    }

    // Poto Sucio
    function potosucio() {
        const v = room.view, can = myTurn();
        const la = v.lastAction;
        let news = '';
        if (la?.type === 'draw') {
            news = `${nameOf(la.seat)} le sacó una carta a ${nameOf(la.from)}` + (la.paired ? ` e hizo par de ${la.paired}.` : '.');
            if (la.joker && la.seat === v.seat) news = '😱 Te llevaste el joker. ¡Pásalo rápido!';
            else if (la.joker && la.from === v.seat) news = `😌 ${nameOf(la.seat)} se llevó tu joker.`;
        } else if (la?.type === 'shuffle') news = `${nameOf(la.seat)} barajó su mano.`;
        const victimCount = v.from >= 0 ? v.counts[v.from] : 0;
        const neighbor = v.phase === 'play' && v.from >= 0 ? h('div', { class: 'naipes-vecino' },
            h('p', { class: 'naipes-pista', text: can ? `Sácale una carta a ${nameOf(v.from)}:` : `${nameOf(v.turn)} le saca una carta a ${nameOf(v.from)}.` }),
            h('div', { class: 'mano mano-dorso' }, Array.from({ length: victimCount }, (_, i) => cardEl(null, 'potosucio', { faceDown: true, label: `Carta ${i + 1} de ${nameOf(v.from)}`, onclick: can ? () => { primeSound(); playSound('card'); play({ type: 'draw', index: i }); } : undefined, disabled: !can })))) : null;
        return h('div', { class: 'naipes-mesa' },
            turnBanner(v.phase !== 'play' ? '' : can ? 'Te toca: elige una carta de tu vecino.' : v.seat >= 0 && !v.hand.length ? 'Te salvaste. Mira cómo termina.' : `Turno de ${nameOf(v.turn)}.`),
            news ? h('p', { class: 'naipes-noticia', text: news }) : null,
            neighbor,
            h('div', { class: 'naipes-pares' }, h('span', { text: `Pares en la mesa: ${v.pairs}` }), h('span', { class: 'naipes-pares-cartas' }, v.recent.map(c => cardEl(c, 'potosucio', { small: true, animate: false })))),
            v.hand.length ? handEl(v.hand, 'potosucio', { sort: false }) : null,
            v.hand.length && v.phase === 'play' ? h('div', { class: 'naipes-acciones' }, h('button', { type: 'button', class: 'naipes-secundario', 'data-accion': '1', text: '🔀 Barajar mi mano', onclick: () => play({ type: 'shuffle' }) })) : null);
    }

    // Carioca
    function carioca() {
        const v = room.view, can = myTurn(), seat = v.seat;
        if (v.phase === 'handOver') {
            const lr = v.lastRound;
            return h('div', { class: 'naipes-mesa' }, breakPanel(lr.winner === seat ? '¡Cerraste la ronda!' : `${nameOf(lr.winner)} cerró la ronda ${lr.round}`,
                v.players.map((_, s) => `${nameOf(s)}: +${lr.penalties[s]} (total ${v.totals[s]})`), 'Siguiente ronda'));
        }
        const handIds = new Set(v.hand.map(c => c.id));
        groups = groups.filter(g => g.every(id => handIds.has(id)));
        const inGroups = new Set(groups.flat());
        const free = v.hand.filter(c => !inGroups.has(c.id));
        const toggle = card => { if (!can || v.step !== 'act') { status(v.step === 'draw' && can ? 'Primero roba una carta.' : 'Espera tu turno.'); return; } if (selected.has(card.id)) selected.delete(card.id); else selected.add(card.id); render(); };
        const melds = h('div', { class: 'carioca-mesa', 'aria-label': 'Juegos en la mesa' }, v.melds.length ? v.melds.map(m => {
            const target = can && v.step === 'act' && v.canAdd && selected.size;
            return h(target ? 'button' : 'div', { type: target ? 'button' : undefined, class: 'carioca-juego' + (target ? ' carioca-destino' : ''), 'aria-label': target ? `Pegar en ${m.type === 'trio' ? 'el trío' : 'la escala'} de ${nameOf(m.owner)}` : undefined, onclick: target ? () => play({ type: 'add', meld: m.id, cards: [...selected] }) : undefined },
                h('span', { class: 'carioca-juego-nombre', text: `${m.type === 'trio' ? 'Trío' : 'Escala'} · ${nameOf(m.owner)}` }),
                h('span', { class: 'carioca-cartas' }, m.cards.map(c => cardEl(c, 'carioca', { small: true, animate: false }))));
        }) : h('p', { class: 'naipes-pista', text: 'Todavía nadie se baja.' }));
        const pile = h('div', { class: 'naipes-centro carioca-centro' },
            h('div', { class: 'naipes-mazo' },
                cardEl(null, 'carioca', { faceDown: true, label: `Robar del mazo (${v.stock} cartas)`, onclick: can && v.step === 'draw' ? () => { playSound('card'); play({ type: 'draw', from: 'stock' }); } : undefined }),
                v.top ? cardEl(v.top, 'carioca', { label: 'Tomar del pozo: ' + cardLabel(v.top, 'carioca'), glow: can && v.step === 'draw', onclick: can && v.step === 'draw' ? () => { playSound('card'); play({ type: 'draw', from: 'pile' }); } : undefined, animate: false }) : h('span', { class: 'naipes-pista', text: 'Pozo vacío' }),
                h('span', { class: 'naipes-mazo-texto', text: `Ronda ${v.round} de ${v.rounds}: ${v.contractText}` })));
        const actions = [];
        if (can && v.step === 'draw') actions.push(h('p', { class: 'naipes-pista', text: 'Roba del mazo o toma la carta del pozo.' }));
        if (can && v.step === 'act') {
            if (!v.down[seat]) {
                const groupBtn = h('button', { type: 'button', class: 'naipes-secundario', disabled: selected.size >= 3 ? undefined : true, text: 'Formar juego con las elegidas', onclick: () => {
                    const cards = v.hand.filter(c => selected.has(c.id));
                    if (!Carioca?.classify(cards)) { status('Esas cartas no forman un trío ni una escala.'); vibrate(40); return; }
                    groups.push([...selected]); selected.clear(); status(''); render();
                } });
                const ready = Carioca && groups.length && (() => { const kinds = groups.map(g => Carioca.classify(v.hand.filter(c => g.includes(c.id)))?.type); return kinds.filter(k => k === 'trio').length === v.contract.t && kinds.filter(k => k === 'escala').length === v.contract.e; })();
                actions.push(groupBtn,
                    h('button', { type: 'button', class: 'naipes-secundario', text: '✨ Sugerir', onclick: () => { const found = Carioca?.findContract(v.hand, v.contract); if (found) { groups = found; selected.clear(); status('Te armé el contrato. Revísalo y bájate.'); render(); } else status('Todavía no tienes ' + v.contractText + '.'); } }),
                    h('button', { type: 'button', class: 'naipes-principal', 'data-accion': '1', disabled: ready ? undefined : true, text: 'Bajarme', onclick: () => { const g = groups; groups = []; play({ type: 'down', groups: g }); } }));
            } else if (v.canAdd) actions.push(h('p', { class: 'naipes-pista', text: selected.size ? 'Toca el juego de la mesa donde quieres pegar.' : 'Elige cartas y toca un juego de la mesa para pegarlas.' }));
            actions.push(h('button', { type: 'button', class: 'naipes-principal', 'data-accion': '1', disabled: selected.size === 1 ? undefined : true, text: 'Botar carta', onclick: () => { const id = [...selected][0]; selected.clear(); play({ type: 'discard', card: id }); } }));
        }
        const pending = groups.length ? h('div', { class: 'carioca-grupos' }, groups.map((g, i) => h('div', { class: 'carioca-grupo' },
            h('span', { class: 'carioca-cartas' }, v.hand.filter(c => g.includes(c.id)).map(c => cardEl(c, 'carioca', { small: true, animate: false }))),
            h('button', { type: 'button', class: 'naipes-sacar', 'aria-label': 'Deshacer este juego', text: '×', onclick: () => { groups.splice(i, 1); render(); } })))) : null;
        return h('div', { class: 'naipes-mesa' },
            turnBanner(can ? (v.step === 'draw' ? 'Te toca: roba una carta.' : v.down[seat] ? 'Pega cartas si puedes y bota una para terminar.' : 'Arma tu contrato o bota una carta.') : `Turno de ${nameOf(v.turn)}.`),
            pile, melds, pending,
            h('div', { class: 'naipes-orden' }, h('span', { text: 'Ordenar:' }),
                h('button', { type: 'button', class: 'naipes-secundario', 'aria-pressed': String(sortMode === 'rank'), text: 'Por número', onclick: () => { sortMode = 'rank'; render(); } }),
                h('button', { type: 'button', class: 'naipes-secundario', 'aria-pressed': String(sortMode === 'suit'), text: 'Por pinta', onclick: () => { sortMode = 'suit'; render(); } })),
            handEl(free, 'carioca', { onPick: toggle }),
            h('div', { class: 'naipes-acciones' }, actions));
    }

    // ¡Última!
    function ultima() {
        const v = room.view, can = myTurn(), seat = v.seat;
        if (v.phase === 'handOver') return h('div', { class: 'naipes-mesa' }, breakPanel(v.lastHand.winner === seat ? '¡Ganaste la mano!' : `${nameOf(v.lastHand.winner)} se quedó sin cartas`, [`+${v.lastHand.points} puntos`, ...v.players.map((_, s) => `${nameOf(s)}: ${v.scores[s]} pts`)]));
        const playable = new Set(v.playable);
        const la = v.lastAction;
        let news = '';
        if (la?.type === 'play') news = `${nameOf(la.seat)} tiró ${cardLabel(la.card, 'ultima')}` + (!la.card.c ? ` y eligió ${ULTIMA_COLORS[la.color]}` : '') + (la.victim !== undefined ? ` · ${nameOf(la.victim)} roba ${la.card.v === 'W4' ? 4 : 2}` : '') + '.';
        else if (la?.type === 'draw') news = `${nameOf(la.seat)} robó una carta.`;
        else if (la?.type === 'catch') news = `¡${nameOf(la.seat)} pilló a ${nameOf(la.target)}! Roba dos.`;
        else if (la?.type === 'ultima') news = `¡${nameOf(la.seat)} dijo ¡Última!`;
        else if (la?.type === 'pass') news = `${nameOf(la.seat)} pasó.`;
        const pick = card => {
            if (!can) { status('Espera tu turno.'); return; }
            if (!playable.has(card.id)) { status('Esa carta no calza. Busca una del mismo color o número, o roba.'); vibrate(30); return; }
            playSound('card');
            const ultimaCall = v.hand.length === 2;
            if (!card.c) { colorPick = { card: card.id, ultima: ultimaCall }; render(); return; }
            play({ type: 'play', card: card.id, ultima: ultimaCall && v.declared.includes(seat) });
        };
        const center = h('div', { class: 'naipes-centro ultima-centro ultima-color-' + (v.color || 'X') },
            h('button', { type: 'button', class: 'ultima-mazo', 'data-accion': '1', 'aria-label': `Robar (${v.stock} cartas)`, disabled: can && v.drawn === null ? undefined : true, onclick: () => { playSound('card'); play({ type: 'draw' }); } }, cardEl(null, 'ultima', { faceDown: true, animate: false }), h('span', { text: 'Robar' })),
            h('div', { class: 'ultima-pozo' }, cardEl(v.top, 'ultima', { label: 'Arriba: ' + cardLabel(v.top, 'ultima') })),
            h('div', { class: 'ultima-estado' }, h('span', { class: 'ultima-sentido', text: v.direction === 1 ? '↻' : '↺', 'aria-label': v.direction === 1 ? 'Sentido horario' : 'Sentido antihorario' }),
                h('span', { class: 'ultima-color', text: v.color ? 'Color: ' + ULTIMA_COLORS[v.color] : 'Cualquier color' })));
        const buttons = [];
        if (v.vulnerable !== null && v.vulnerable !== seat) buttons.push(h('button', { type: 'button', class: 'ultima-pillar', 'data-accion': '1', text: `¡Te pillé, ${nameOf(v.vulnerable)}!`, onclick: () => play({ type: 'catch' }) }));
        if (seat >= 0 && v.hand.length <= 2 && !v.declared.includes(seat) && v.phase === 'play') buttons.push(h('button', { type: 'button', class: 'ultima-grito', 'data-accion': '1', text: '¡Última!', onclick: () => { playSound('ultima'); play({ type: 'ultima' }); } }));
        if (can && v.drawn !== null) buttons.push(h('button', { type: 'button', class: 'naipes-secundario', 'data-accion': '1', text: 'Quedarme con la carta y pasar', onclick: () => play({ type: 'pass' }) }));
        const picker = colorPick ? h('div', { class: 'ultima-colores', role: 'dialog', 'aria-label': 'Elige un color' }, h('p', { text: 'Elige el color' }),
            h('div', {}, ['R', 'Y', 'G', 'B'].map(c => h('button', { type: 'button', class: 'ultima-elegir ultima-elegir-' + c, text: ULTIMA_COLORS[c], onclick: () => { const p = colorPick; colorPick = null; play({ type: 'play', card: p.card, color: c, ultima: p.ultima && v.declared.includes(seat) }); } }))),
            h('button', { type: 'button', class: 'naipes-secundario', text: 'Cancelar', onclick: () => { colorPick = null; render(); } })) : null;
        return h('div', { class: 'naipes-mesa' },
            turnBanner(can ? (v.drawn !== null ? 'Te sirve la carta que robaste: tírala o pasa.' : playable.size ? 'Te toca: tira una carta que brille o roba.' : 'Te toca: no tienes jugada, roba una carta.') : `Turno de ${nameOf(v.turn)}.`),
            news ? h('p', { class: 'naipes-noticia', text: news }) : null,
            center, buttons.length ? h('div', { class: 'naipes-acciones ultima-acciones' }, buttons) : null,
            handEl(v.hand, 'ultima', { onPick: pick, isPlayable: can ? card => playable.has(card.id) : null }), picker);
    }

    function finished() {
        const o = room.outcome || { winners: [], losers: [] }, v = room.view;
        const won = o.winners.includes(me());
        let title = won ? '¡Ganaste!' : o.winners.length ? `Ganó ${o.winners.map(nameById).join(' y ')}` : 'Partida terminada';
        let detail = '';
        if (room.game === 'potosucio') { title = o.losers.includes(me()) ? '¡Quedaste de poto sucio! 🃏' : o.losers.length ? `${nameById(o.losers[0])} es el poto sucio 🃏` : 'Partida terminada'; detail = o.winners.length ? `${nameById(o.winners[0])} fue el primero en salvarse.` : ''; }
        if (room.game === 'carioca') detail = v.players.map((_, s) => `${nameOf(s)}: ${v.totals[s]}`).join(' · ');
        if (room.game === 'brisca' && v.points) detail = v.points.map((p, t) => `${v.teams[t].map(nameOf).join(' y ')}: ${p} pts`).join(' · ');
        if (room.game === 'ultima') detail = v.target ? v.players.map((_, s) => `${nameOf(s)}: ${v.scores[s]}`).join(' · ') : `+${v.lastHand?.points || 0} puntos`;
        if (won) { playSound('win'); vibrate([60, 40, 120]); }
        return h('div', { class: 'naipes-final' + (won ? ' naipes-final-gano' : '') }, h('h4', { text: title }), detail ? h('p', { text: detail }) : null,
            isHost() ? h('div', { class: 'naipes-acciones' }, h('button', { type: 'button', class: 'naipes-principal', 'data-accion': '1', text: 'Otra partida', onclick: () => run('start') }), h('button', { type: 'button', class: 'naipes-secundario', 'data-accion': '1', text: 'Cambiar de juego', onclick: () => run('options', { game: room.game, options: room.options }) }))
                : h('p', { class: 'naipes-espera', text: `${nameById(room.host_id)} puede repartir otra vez.` }));
    }

    // ---------- clock ----------
    function tick() {
        if (!room || room.status !== 'playing' || !room.view) return;
        const late = room.waitingFor, limit = late ? room.turnMs : room.breakMs;
        const left = (room.turnStartedAt || serverNow()) + limit - serverNow();
        const share = Math.max(0, Math.min(1, left / limit));
        for (const seat of $('naipesVista').querySelectorAll('.naipes-asiento')) seat.style.setProperty('--tiempo', seat.classList.contains('naipes-turno') ? String(share) : '1');
        const pause = $('naipesPausaReloj');
        if (pause) pause.textContent = left > 0 ? `Sigue sola en ${Math.ceil(left / 1000)} s` : '';
        const banner = $('naipesVista').querySelector('.naipes-te-toca');
        if (banner && left < 15000 && left > 0) banner.dataset.segundos = Math.ceil(left / 1000) + ' s';
        const key = room.view.seq + ':' + room.view.phase + ':' + (late || '');
        if (left < -1500 - Math.random() * 1500 && timeoutAsked !== key && (late !== me() || !late)) {
            timeoutAsked = key;
            request('timeout').then(r => { void ping(); show(r.room); }).catch(() => {});
        }
    }

    // ---------- sound & touch ----------
    function primeSound() {
        if (muted) return;
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        try { sound ||= new Audio(); if (sound.state === 'suspended') sound.resume().catch(() => {}); } catch { /* optional */ }
    }
    function playSound(kind) {
        if (muted || !sound || sound.state !== 'running' || document.hidden) return;
        try {
            const notes = { card: [[1800, 0, 0.04, 'triangle', 0.05]], turn: [[660, 0, 0.1, 'sine', 0.09], [880, 0.1, 0.14, 'sine', 0.09]], ultima: [[784, 0, 0.1, 'square', 0.06], [1046, 0.1, 0.2, 'square', 0.06]], win: [[523, 0, 0.12, 'triangle', 0.12], [659, 0.12, 0.12, 'triangle', 0.12], [784, 0.24, 0.3, 'triangle', 0.12]] }[kind] || [];
            const at = sound.currentTime;
            for (const [freq, delay, length, type, volume] of notes) {
                const tone = sound.createOscillator(), gain = sound.createGain();
                tone.type = type; tone.frequency.value = freq;
                gain.gain.setValueAtTime(0.0001, at + delay); gain.gain.exponentialRampToValueAtTime(volume, at + delay + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, at + delay + length);
                tone.connect(gain).connect(sound.destination); tone.start(at + delay); tone.stop(at + delay + length + 0.02);
            }
        } catch { /* optional */ }
    }
    function vibrate(pattern) { if (!reduceMotion.matches) try { navigator.vibrate?.(pattern); } catch { /* optional */ } }
    function paintSound() { $('naipesSonido').setAttribute('aria-pressed', String(muted)); $('naipesSonido').textContent = muted ? 'Sonido: no' : 'Sonido: sí'; }

    // ---------- buttons ----------
    $('naipesUnirse').addEventListener('submit', event => { event.preventDefault(); primeSound(); run('join', { code: $('naipesCodigoEntrada').value.trim().toUpperCase() }); });
    $('naipesSonido').addEventListener('click', () => { muted = !muted; try { localStorage.setItem('redmusica-naipes-muted', String(muted)); } catch { /* this visit */ } paintSound(); if (!muted) primeSound(); });
    paintSound();
    $('naipesInvitar').addEventListener('click', invite);
    async function invite() {
        const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('seccion', 'naipes'); url.searchParams.set('mesa', roomCode);
        const text = `Juguemos ${GAMES[room.game].name} en RedMusica. Código de mesa: ${roomCode}`;
        if (navigator.share && coarse.matches) { try { await navigator.share({ title: GAMES[room.game].name + ' en RedMusica', text, url: url.href }); return; } catch (error) { if (error?.name === 'AbortError') return; } }
        try { await navigator.clipboard.writeText(url.href); status('Enlace de invitación copiado.'); } catch { status('Comparte este código: ' + roomCode); }
    }
    $('naipesSalir').addEventListener('click', () => {
        const button = $('naipesSalir');
        if (room?.status === 'playing' && !confirmLeave) {
            button.textContent = '¿Salir? Se cancela la partida';
            confirmLeave = setTimeout(() => { confirmLeave = null; button.textContent = 'Salir'; }, 4000);
            return;
        }
        clearTimeout(confirmLeave); confirmLeave = null; button.textContent = 'Salir';
        run('leave');
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && roomCode) refresh(); });
    document.addEventListener('click', event => { if (event.target.closest?.('#naipesNav') && roomCode) setTimeout(refresh, 0); });

    // ---------- session ----------
    function joinInvite() {
        const invited = new URLSearchParams(location.search).get('mesa');
        if (user && invited && /^[A-Z0-9]{6}$/i.test(invited) && invited.toUpperCase() !== roomCode && !busy) run('join', { code: invited.toUpperCase() });
    }
    function setUser(next) {
        const changed = (next?.id || null) !== (user?.id || null);
        user = next;
        $('naipesAcceso').hidden = Boolean(user);
        $('naipesEntrada').hidden = !user || Boolean(roomCode);
        if (!user && roomCode) { leaveView(); status('Inicia sesión desde Inicio para volver a jugar.'); }
        if (changed) loadRecord();
    }
    async function loadRecord() {
        const line = $('naipesRecord');
        if (!user || !db?.from) { line.hidden = true; return; }
        try {
            const { data, error } = await db.from('card_stats').select('game,games,wins,losses').eq('user_id', user.id);
            if (error || !data?.length) { line.hidden = true; return; }
            line.textContent = 'Tu récord: ' + data.map(r => r.game === 'potosucio' ? `${GAMES[r.game].name} ${r.losses} ${r.losses === 1 ? 'vez' : 'veces'} poto sucio en ${r.games}` : `${GAMES[r.game]?.name || r.game} ${r.wins}/${r.games}`).join(' · ');
            line.hidden = false;
        } catch { line.hidden = true; }
    }
    paintMenu(); paintRules(null);
    if (!db) { status('Los juegos de cartas requieren una cuenta de RedMusica.'); $('naipesEntrada').hidden = true; return; }
    db.auth.onAuthStateChange((_event, session) => { setUser(session?.user || null); setTimeout(joinInvite, 0); });
    db.auth.getSession().then(({ data: { session } }) => { setUser(session?.user || null); joinInvite(); });

    // ---------- profile line ----------
    function setupProfileStats() {
        const presence = $('presenciaPerfil'), line = $('naipesPerfil');
        if (!presence || !line || !db) return;
        let current = '';
        const load = async () => {
            const id = presence.dataset.userId || '';
            if (id === current) return;
            current = id; line.hidden = true; line.textContent = '';
            if (!id) return;
            const { data, error } = await db.from('card_stats').select('game,games,wins,losses').eq('user_id', id);
            if (error || !data?.length || id !== current) return;
            const names = { brisca: 'Brisca', potosucio: 'Poto Sucio', carioca: 'Carioca', ultima: '¡Última!' };
            line.textContent = 'Cartas: ' + data.map(r => r.game === 'potosucio' ? `${names[r.game]} ${r.games} ${r.games === 1 ? 'partida' : 'partidas'}` : `${names[r.game]} ${r.wins} ${r.wins === 1 ? 'victoria' : 'victorias'}`).join(' · ');
            line.hidden = false;
        };
        new MutationObserver(load).observe(presence, { attributes: true, attributeFilter: ['data-user-id'] });
        load();
    }
})();
