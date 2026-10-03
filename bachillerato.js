// Bachillerato (tutti frutti / ¡Basta!) online, with any number of players.
// The bachillerato Edge Function is the referee (letters, clock, hidden answers, votes, points);
// this file draws each phase, autosaves your answers and asks the server to move on when a clock runs out.
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const root = $('tutti');
    const config = window.REDMUSICA_CONFIG;
    const db = config && window.supabase ? window.redmusicaClient || window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
    const LOGIC_URL = './supabase/functions/bachillerato/logic.js?v=20261003-1';
    setupProfileStats();
    if (!root) return;

    let L = null;
    const logicReady = import(LOGIC_URL).then(module => { L = module; return module; });
    const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };
    const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    let user = null, roomCode = '', room = null, busy = false, pollTimer = null, tickTimer = null;
    let offset = 0, bestRtt = Infinity;
    let viewKey = '', answers = [], saveTimer = null, lastSent = '', finalSentFor = '', advanceTried = new Map();
    let myRejects = new Set(), myReady = false, voteTimer = null, settingsDraft = null, settingsTimer = null;
    let channel = null, channelCode = '', subscribed = false, pingTimer = null;
    let sound = null, muted = false, revealedFor = '', bastaSeenFor = '', lastTick = -1, confirmLeave = null;
    try { muted = localStorage.getItem('redmusica-tutti-muted') === 'true'; } catch { /* storage may be blocked */ }
    const serverNow = () => Date.now() + offset;
    const me = () => user?.id || '';
    const isHost = () => !!room && room.host_id === me();
    const nameOf = id => room?.players.find(p => p.user_id === id)?.username || room?.game?.ranking?.find(p => p.user_id === id)?.username || 'Alguien';
    const STATUS = {
        unica: ['20 · única', 'tutti-ok-unica'], original: ['10', 'tutti-ok-original'], repetida: ['5 · repetida', 'tutti-ok-repetida'],
        vacia: ['—', 'tutti-mal'], letra: ['0 · otra letra', 'tutti-mal'], rechazada: ['0 · anulada', 'tutti-mal']
    };

    // Small DOM helper: h('div', { class: 'x', onclick: fn }, child, 'text').
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

    // ---------- server ----------
    async function request(action, extra = {}) {
        if (!db) throw new Error('No se pudo iniciar el juego. Recarga la página.');
        const { data: { session } } = await db.auth.getSession();
        if (!session) throw new Error('Inicia sesión para jugar al bachillerato.');
        const sent = Date.now();
        const response = await fetch(config.supabaseUrl + '/functions/v1/bachillerato', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: config.supabasePublishableKey, Authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify({ action, code: extra.code ?? roomCode, ...extra }),
            signal: AbortSignal.timeout(12000)
        });
        let result = {};
        try { result = await response.json(); } catch { /* handled below */ }
        if (!response.ok) throw new Error(result.error || (response.status === 404 ? 'El bachillerato todavía no está disponible. Inténtalo más tarde.' : 'No se pudo actualizar la sala.'));
        // Keep our clock in step with the server's (timers and deadlines are the server's).
        const rtt = Date.now() - sent;
        if (result.room?.now && rtt < 4000) {
            const sample = result.room.now - (sent + rtt / 2);
            if (rtt <= bestRtt + 80 || Math.abs(sample - offset) > 1500) { offset = bestRtt === Infinity ? sample : offset * 0.5 + sample * 0.5; bestRtt = Math.min(bestRtt, rtt); }
        }
        return result;
    }
    async function run(action, extra = {}, { announce = true } = {}) {
        if (busy) return null;
        busy = true; updateButtons();
        try {
            const result = await request(action, extra);
            if (result.left) { if (announce) await ping(); leaveView(); return result; }
            status('');
            if (announce) void ping();
            await show(result.room);
            return result;
        } catch (error) {
            status(error.message);
            if (/No encontramos esa sala|No formas parte/.test(error.message) && action !== 'join') leaveView();
            return null;
        } finally { busy = false; updateButtons(); schedule(); }
    }
    // Background calls (autosave, votes, deadlines) never block buttons.
    async function quiet(action, extra = {}, announce = false) {
        try {
            const result = await request(action, extra);
            if (announce) void ping();
            if (result.room && roomCode) await show(result.room);
            return result;
        } catch (error) {
            if (/No formas parte|No encontramos esa sala/.test(error.message)) { status(error.message); leaveView(); }
            return null;
        }
    }
    async function refresh() {
        if (!roomCode || busy) return;
        await quiet('state');
        schedule();
    }
    function schedule() {
        clearTimeout(pollTimer); pollTimer = null;
        if (!roomCode) return;
        const visible = !document.hidden && !$('seccionBachillerato')?.hidden;
        const every = !visible ? 15000 : { lobby: 5000, playing: 4000, review: 3000, scores: 5000, finished: 10000 }[room?.status] || 6000;
        pollTimer = setTimeout(refresh, every);
    }

    // Realtime only says "something changed"; each player then asks the server, spread out a little.
    function subscribeRoom(code) {
        if (channel && channelCode === code) return;
        if (channel && db?.removeChannel) db.removeChannel(channel);
        channel = null; channelCode = ''; subscribed = false;
        if (!db?.channel) return;
        channelCode = code;
        channel = db.channel('tutti:' + code, { config: { broadcast: { self: false, ack: false } } });
        channel.on('broadcast', { event: 'changed' }, ({ payload }) => {
            if (!payload || payload.code !== roomCode || payload.sender === me()) return;
            clearTimeout(pingTimer);
            const spread = Math.min(1500, 40 * (room?.players.length || 1));
            pingTimer = setTimeout(refresh, 40 + Math.random() * spread);
        }).subscribe(state => { subscribed = state === 'SUBSCRIBED'; });
    }
    async function ping() {
        if (!subscribed || !channel || !roomCode) return;
        try { await Promise.race([channel.send({ type: 'broadcast', event: 'changed', payload: { code: roomCode, sender: me() } }), new Promise(resolve => setTimeout(resolve, 700))]); } catch { /* polling still works */ }
    }

    // ---------- room ----------
    async function show(next) {
        if (!next) return;
        await logicReady;
        const entering = !roomCode;
        room = next; roomCode = next.code;
        subscribeRoom(next.code);
        rememberInvite();
        $('tuttiEntrada').hidden = true; $('tuttiSala').hidden = false;
        $('tuttiCodigoSala').textContent = next.code;
        render();
        if (!tickTimer) tickTimer = setInterval(tick, 200);
        if (entering) scrollToRoom();
    }
    function leaveView() {
        room = null; roomCode = ''; viewKey = ''; answers = []; myRejects = new Set(); myReady = false; settingsDraft = null;
        clearTimeout(pollTimer); clearTimeout(saveTimer); clearTimeout(voteTimer); clearTimeout(settingsTimer); clearInterval(tickTimer); tickTimer = null;
        if (channel && db?.removeChannel) db.removeChannel(channel);
        channel = null; channelCode = ''; subscribed = false;
        $('tuttiVista').replaceChildren();
        $('tuttiSala').hidden = true; $('tuttiEntrada').hidden = !user;
        const url = new URL(location.href);
        if (url.searchParams.has('tutti')) { url.searchParams.delete('tutti'); history.replaceState(history.state, '', url); }
        loadRecord();
    }
    function rememberInvite() {
        const url = new URL(location.href);
        if (url.searchParams.get('tutti') === roomCode) return;
        url.searchParams.set('seccion', 'bachillerato'); url.searchParams.set('tutti', roomCode);
        history.replaceState(history.state, '', url);
    }
    function scrollToRoom() {
        requestAnimationFrame(() => {
            const sticky = Math.max(document.querySelector('.cabecera-sitio')?.getBoundingClientRect().bottom || 0, 0) + 6;
            const top = $('tuttiSala').getBoundingClientRect().top + window.scrollY - sticky;
            if (Math.abs(window.scrollY - top) > 40) window.scrollTo(0, Math.max(0, top));
        });
    }
    function status(message) { $('tuttiEstado').textContent = message; }
    function updateButtons() {
        for (const el of root.querySelectorAll('[data-accion]')) el.disabled = busy;
    }

    // ---------- rendering by phase ----------
    function render() {
        const game = room.game;
        const key = room.status + ':' + (game?.id || '') + ':' + (game?.round || 0);
        if (key !== viewKey) {
            viewKey = key;
            const view = $('tuttiVista');
            view.replaceChildren();
            view.dataset.fase = room.status;
            if (room.status === 'lobby') view.append(buildLobby());
            else if (room.status === 'playing') view.append(buildPlaying());
            else if (room.status === 'review') view.append(buildReview());
            else if (room.status === 'scores') view.append(buildScores(false));
            else if (room.status === 'finished') view.append(buildScores(true));
            if (room.status !== 'playing') { clearTimeout(saveTimer); }
        }
        if (room.status === 'lobby') updateLobby();
        else if (room.status === 'playing') updatePlaying();
        else if (room.status === 'review') updateReview();
        else updateScores();
        updateButtons();
        tick();
    }

    // Lobby: code, players, rules (editable by the host).
    function playerChips(list, { kick = false, extra } = {}) {
        return list.map(p => h('li', { class: 'tutti-jugador' + (p.user_id === me() ? ' tutti-yo' : '') + (p.active === false ? ' tutti-ausente' : '') },
            h('span', { class: 'tutti-inicial', 'aria-hidden': 'true', text: p.username.slice(0, 1).toUpperCase() }),
            h('span', { class: 'tutti-nombre', text: p.username + (p.user_id === room.host_id ? ' 👑' : '') }),
            extra ? extra(p) : null,
            kick && isHost() && p.user_id !== me() ? h('button', { type: 'button', class: 'tutti-sacar', 'aria-label': 'Sacar a ' + p.username + ' de la sala', text: '×', onclick: () => run('kick', { user_id: p.user_id }) }) : null));
    }
    function buildLobby() {
        settingsDraft = structuredClone(room.settings);
        const box = h('div', { class: 'tutti-lobby' },
            h('div', { class: 'tutti-codigo' }, h('span', { text: 'Código de la sala' }), h('strong', { text: room.code }), h('button', { type: 'button', class: 'tutti-secundario', text: 'Compartir invitación', onclick: invite })),
            h('h4', { id: 'tuttiTituloJugadores' }), h('ul', { id: 'tuttiJugadoresLobby', class: 'tutti-jugadores' }),
            h('div', { id: 'tuttiReglasSala' }),
            h('div', { class: 'tutti-acciones', id: 'tuttiAccionesLobby' }));
        return box;
    }
    function updateLobby() {
        $('tuttiTituloJugadores').textContent = `Jugadores (${room.players.length})`;
        $('tuttiJugadoresLobby').replaceChildren(...playerChips(room.players, { kick: true }));
        const rules = $('tuttiReglasSala');
        if (isHost()) { if (!rules.dataset.editor) { rules.dataset.editor = '1'; rules.replaceChildren(buildSettingsEditor()); } }
        else { rules.dataset.editor = ''; rules.replaceChildren(settingsSummary(room.settings)); }
        const actions = $('tuttiAccionesLobby');
        actions.replaceChildren(isHost()
            ? h('button', { type: 'button', class: 'tutti-principal', 'data-accion': '1', text: room.players.length > 1 ? `Empezar con ${room.players.length} jugadores` : 'Empezar (puedes jugar solo para probar)', onclick: () => { primeSound(); run('start', { settings: settingsDraft }); } })
            : h('p', { class: 'tutti-espera', text: `Esperando que ${nameOf(room.host_id)} empiece la partida…` }));
    }
    const secondsText = s => s >= 60 ? (s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`) : `${s} s`;
    function settingsSummary(s) {
        return h('div', { class: 'tutti-resumen' },
            h('p', { text: `${s.rounds} ${s.rounds === 1 ? 'ronda' : 'rondas'} · ${secondsText(s.roundSeconds)} por ronda · ¡Basta!: ${s.bastaSeconds ? s.bastaSeconds + ' s para terminar' : 'corta al instante'}${s.hardLetters ? ' · con letras difíciles' : ''}` }),
            h('ul', { class: 'tutti-etiquetas' }, s.categories.map(c => h('li', { text: c }))));
    }
    function buildSettingsEditor() {
        const d = settingsDraft;
        const send = () => { clearTimeout(settingsTimer); settingsTimer = setTimeout(() => quiet('settings', { settings: d }, true), 600); };
        const chips = h('ul', { class: 'tutti-etiquetas tutti-editables' });
        const presets = h('div', { class: 'tutti-sugeridas' });
        const custom = h('input', { id: 'tuttiNuevaCategoria', maxlength: String(L.LIMITS.maxCategoryLength), placeholder: 'Otra categoría', autocomplete: 'off' });
        const counter = h('span', { class: 'tutti-contador' });
        function paint() {
            chips.replaceChildren(...d.categories.map((c, i) => h('li', {}, h('span', { text: c }),
                h('button', { type: 'button', 'aria-label': 'Quitar ' + c, text: '×', disabled: d.categories.length <= L.LIMITS.minCategories ? true : undefined, onclick: () => { d.categories.splice(i, 1); paint(); send(); } }))));
            const chosen = new Set(d.categories.map(L.normalize));
            presets.replaceChildren(...L.CATEGORY_PRESETS.filter(c => !chosen.has(L.normalize(c))).map(c => h('button', { type: 'button', class: 'tutti-sugerida', text: '+ ' + c, disabled: d.categories.length >= L.LIMITS.maxCategories ? true : undefined, onclick: () => { d.categories.push(c); paint(); send(); } })));
            counter.textContent = `${d.categories.length} de ${L.LIMITS.maxCategories} (mínimo ${L.LIMITS.minCategories})`;
        }
        function addCustom(event) {
            event.preventDefault();
            const name = L.cleanText(custom.value, L.LIMITS.maxCategoryLength);
            if (!name || d.categories.length >= L.LIMITS.maxCategories || d.categories.some(c => L.normalize(c) === L.normalize(name))) { custom.select(); return; }
            d.categories.push(name); custom.value = ''; paint(); send();
        }
        const select = (label, key, options, text) => h('label', { class: 'tutti-opcion' }, h('span', { text: label }),
            h('select', { onchange: event => { d[key] = Number(event.target.value); send(); } }, options.map(v => { const o = h('option', { value: String(v), text: text(v) }); o.selected = v === d[key]; return o; })));
        const hard = h('input', { type: 'checkbox', onchange: event => { d.hardLetters = event.target.checked; send(); } }); hard.checked = d.hardLetters;
        paint();
        return h('div', { class: 'tutti-editor' },
            h('div', { class: 'tutti-editor-cabeza' }, h('h4', { text: 'Categorías' }), counter),
            chips,
            h('form', { class: 'tutti-agregar', onsubmit: addCustom }, h('label', { for: 'tuttiNuevaCategoria', class: 'solo-lectores', text: 'Nueva categoría' }), custom, h('button', { type: 'submit', class: 'tutti-secundario', text: 'Agregar' })),
            h('details', { class: 'tutti-mas' }, h('summary', { text: 'Ideas de categorías' }), presets),
            h('div', { class: 'tutti-opciones' },
                select('Rondas', 'rounds', L.ROUND_OPTIONS, v => String(v)),
                select('Tiempo por ronda', 'roundSeconds', L.TIME_OPTIONS, secondsText),
                select('Después del ¡Basta!', 'bastaSeconds', L.BASTA_OPTIONS, v => v ? `${v} s para terminar` : 'Se corta al instante'),
                select('Tiempo para revisar', 'reviewSeconds', L.REVIEW_OPTIONS, secondsText),
                h('label', { class: 'tutti-opcion tutti-opcion-check' }, hard, h('span', { text: 'Incluir letras difíciles (K, Ñ, Q, W, X, Y, Z)' }))));
    }

    // Playing: the letter, the clock, one field per category and the ¡Basta! button.
    function buildPlaying() {
        const game = room.game, s = room.settings;
        const saved = room.mine?.answers || [];
        if (answers.length !== s.categories.length || answers.key !== viewKey) { answers = s.categories.map((_, i) => saved[i] || ''); answers.key = viewKey; }
        lastSent = JSON.stringify(answers); finalSentFor = ''; bastaSeenFor = ''; lastTick = -1;
        const fields = s.categories.map((category, i) => {
            const input = h('input', { id: 'tuttiCampo' + i, 'data-i': String(i), maxlength: String(L.LIMITS.maxAnswerLength), autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: i === s.categories.length - 1 ? 'done' : 'next' });
            input.value = answers[i];
            input.addEventListener('input', () => { answers[i] = input.value; markField(i); queueSave(); updateBasta(); });
            input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('tuttiCampo' + (i + 1))?.focus(); } });
            return h('label', { class: 'tutti-campo', id: 'tuttiFila' + i },
                h('span', { class: 'tutti-campo-nombre', text: category }), input,
                h('b', { class: 'tutti-marca', 'aria-hidden': 'true' }));
        });
        const box = h('div', { class: 'tutti-juego' },
            h('div', { class: 'tutti-cabeza' },
                h('div', { class: 'tutti-letra', id: 'tuttiLetra', 'aria-live': 'polite', text: '?' }),
                h('div', { class: 'tutti-info' },
                    h('span', { class: 'tutti-ronda', text: `Ronda ${game.round} de ${game.totalRounds}` }),
                    h('span', { class: 'tutti-reloj', id: 'tuttiReloj', role: 'timer', 'aria-live': 'off' }),
                    h('div', { class: 'tutti-tiempo' }, h('i', { id: 'tuttiBarra' })))),
            h('p', { class: 'tutti-alerta', id: 'tuttiAlerta', role: 'alert', hidden: true }),
            h('form', { class: 'tutti-respuestas', id: 'tuttiRespuestas', onsubmit: event => event.preventDefault() }, fields),
            h('ul', { class: 'tutti-progreso', id: 'tuttiProgreso', 'aria-label': 'Avance de cada jugador' }),
            h('div', { class: 'tutti-acciones tutti-fija' },
                h('button', { type: 'button', id: 'tuttiBasta', class: 'tutti-basta', onclick: callBasta, text: '¡Basta!' }),
                h('span', { class: 'tutti-pista', id: 'tuttiPista' })));
        requestAnimationFrame(() => s.categories.forEach((_, i) => markField(i)));
        return box;
    }
    function markField(i) {
        const row = $('tuttiFila' + i); if (!row || !room?.game) return;
        const value = answers[i], ok = L.startsWithLetter(value, room.game.letter);
        row.classList.toggle('tutti-campo-ok', !!value.trim() && ok);
        row.classList.toggle('tutti-campo-mal', !!value.trim() && !ok);
        row.querySelector('.tutti-marca').textContent = !value.trim() ? '' : ok ? '✓' : '✗';
        row.querySelector('input').setAttribute('aria-invalid', String(!!value.trim() && !ok));
    }
    function updateBasta() {
        const button = $('tuttiBasta'); if (!button || !room?.game) return;
        const game = room.game, now = serverNow(), open = now >= game.startsAt && now < game.endsAt;
        const ready = L.canCallBasta(answers, game.letter, room.settings.categories.length);
        button.disabled = !open || !ready || !!game.bastaBy;
        const missing = answers.filter(a => !L.startsWithLetter(a, game.letter)).length;
        $('tuttiPista').textContent = game.bastaBy ? '' : !open ? '' : ready ? '¡Puedes cortar la ronda!' : `Te ${missing === 1 ? 'falta 1 categoría' : 'faltan ' + missing + ' categorías'} para decir ¡Basta!`;
    }
    function queueSave(delay = 1200) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveAnswers, delay);
    }
    async function saveAnswers(force = false) {
        clearTimeout(saveTimer);
        if (!room || room.status !== 'playing') return;
        const body = JSON.stringify(answers);
        if (!force && body === lastSent) return;
        lastSent = body;
        await quiet('save', { answers: [...answers] });
    }
    async function callBasta() {
        if (!room?.game) return;
        primeSound();
        const button = $('tuttiBasta'); button.disabled = true;
        clearTimeout(saveTimer); lastSent = JSON.stringify(answers);
        try {
            const result = await request('basta', { answers: [...answers] });
            void ping();
            await show(result.room);
        } catch (error) { status(error.message); updateBasta(); }
    }
    function updatePlaying() {
        const list = $('tuttiProgreso'); if (!list) return;
        const total = room.settings.categories.length;
        list.replaceChildren(...room.players.map(p => h('li', { class: 'tutti-avance' + (p.user_id === me() ? ' tutti-yo' : '') },
            h('span', { class: 'tutti-nombre', text: p.username }),
            h('span', { class: 'tutti-mini' }, h('i', { style: `width:${Math.round(((p.user_id === me() ? answers.filter(a => a.trim()).length : p.filled || 0) / total) * 100)}%` })))));
        updateBasta();
    }

    // Review: everyone's answers by category; tap ✗ on the ones that do not count.
    function buildReview() {
        const s = room.settings, game = room.game;
        myRejects = new Set(room.round?.myRejects || []);
        myReady = !!room.players.find(p => p.user_id === me())?.ready;
        const rows = room.round?.answers || [];
        const sections = s.categories.map((category, c) => {
            const items = rows.map(r => ({ id: r.user_id, text: (r.answers || [])[c] || '' }))
                .sort((a, b) => (!a.text.trim() - !b.text.trim()) || L.comparable(a.text).localeCompare(L.comparable(b.text), 'es') || nameOf(a.id).localeCompare(nameOf(b.id), 'es'));
            return h('section', { class: 'tutti-categoria' }, h('h4', { text: category }),
                h('ul', {}, items.map(item => {
                    const key = item.id + ':' + c, mine = item.id === me();
                    return h('li', { class: 'tutti-respuesta' + (mine ? ' tutti-yo' : ''), 'data-key': key },
                        h('span', { class: 'tutti-quien', text: nameOf(item.id) }),
                        h('span', { class: 'tutti-texto', text: item.text || 'sin respuesta' }),
                        h('span', { class: 'tutti-estado-resp' }),
                        mine || !item.text.trim() ? h('span', { class: 'tutti-votos' }) : h('button', { type: 'button', class: 'tutti-anular', 'aria-pressed': 'false', 'aria-label': `Anular «${item.text}» de ${nameOf(item.id)}`, onclick: () => toggleReject(key) }, h('span', { 'aria-hidden': 'true', text: '✗' }), h('span', { class: 'tutti-votos' })));
                })));
        });
        return h('div', { class: 'tutti-revision' },
            h('div', { class: 'tutti-cabeza' },
                h('div', { class: 'tutti-letra', text: game.letter }),
                h('div', { class: 'tutti-info' },
                    h('span', { class: 'tutti-ronda', text: `Revisión · ronda ${game.round} de ${game.totalRounds}` }),
                    h('span', { class: 'tutti-reloj', id: 'tuttiReloj', role: 'timer' }),
                    h('div', { class: 'tutti-tiempo' }, h('i', { id: 'tuttiBarra' })))),
            h('p', { class: 'tutti-ayuda', text: game.bastaBy ? `¡Basta! de ${nameOf(game.bastaBy)}. Toca ✗ en las respuestas que no valen: se anulan si más de la mitad de los demás está de acuerdo.` : 'Toca ✗ en las respuestas que no valen: se anulan si más de la mitad de los demás está de acuerdo.' }),
            rows.length ? sections : h('p', { class: 'tutti-espera', text: 'Nadie alcanzó a escribir respuestas en esta ronda.' }),
            h('div', { class: 'tutti-acciones tutti-fija' },
                h('button', { type: 'button', id: 'tuttiListo', class: 'tutti-principal', onclick: toggleReady }),
                h('span', { class: 'tutti-pista', id: 'tuttiListos' }),
                isHost() ? h('button', { type: 'button', class: 'tutti-secundario', 'data-accion': '1', text: 'Calcular puntaje', onclick: () => run('advance', { expect: 'review:' + room.game.round, force: true }) }) : null));
    }
    function toggleReject(key) {
        if (myRejects.has(key)) myRejects.delete(key); else myRejects.add(key);
        vibrate(8); updateReview(); sendVote();
    }
    function toggleReady() { myReady = !myReady; updateReview(); sendVote(0, true); }
    function sendVote(delay = 500, announce = false) {
        clearTimeout(voteTimer);
        voteTimer = setTimeout(() => quiet('vote', { rejects: [...myRejects], ready: myReady }, announce), delay);
    }
    function updateReview() {
        const list = room.round?.answers || [], byUser = new Map(list.map(r => [r.user_id, r]));
        const rejections = room.round?.rejections || {};
        for (const li of $('tuttiVista').querySelectorAll('.tutti-respuesta')) {
            const key = li.dataset.key, [id, c] = key.split(':'), row = byUser.get(id);
            const code = row?.status?.[Number(c)] || 'vacia', [label, cls] = STATUS[code] || STATUS.vacia;
            const chip = li.querySelector('.tutti-estado-resp');
            chip.textContent = code === 'letra' ? `0 · no empieza con ${room.game.letter}` : label; chip.className = 'tutti-estado-resp ' + cls;
            const votes = rejections[key] || 0, button = li.querySelector('.tutti-anular');
            li.querySelector('.tutti-votos').textContent = votes ? String(votes) : '';
            li.classList.toggle('tutti-anulada', code === 'rechazada');
            if (button) button.setAttribute('aria-pressed', String(myRejects.has(key)));
        }
        const ready = $('tuttiListo');
        if (ready) { ready.textContent = myReady ? '✓ Listo (toca para seguir revisando)' : 'Terminé de revisar'; ready.classList.toggle('tutti-activo', myReady); }
        const count = $('tuttiListos');
        if (count) count.textContent = `${room.round?.ready || 0} de ${room.round?.voters || room.players.length} listos`;
    }

    // Scores after each round, and the final ranking.
    function buildScores(final) {
        const game = room.game, rows = room.round?.answers || [];
        const roundPoints = new Map(rows.map(r => [r.user_id, (r.points || []).reduce((a, b) => a + b, 0)]));
        const ranking = final && game.ranking ? game.ranking : [...room.players].sort((a, b) => b.total - a.total || a.username.localeCompare(b.username, 'es'));
        const winners = new Set(game.winners || []);
        let place = 0, previous = null;
        const items = ranking.map((p, i) => {
            if (p.total !== previous) { place = i + 1; previous = p.total; }
            return h('li', { class: 'tutti-puesto' + (p.user_id === me() ? ' tutti-yo' : '') + (final && winners.has(p.user_id) ? ' tutti-ganador' : '') },
                h('span', { class: 'tutti-lugar', text: final && place <= 3 ? ['🥇', '🥈', '🥉'][place - 1] : place + '.' }),
                h('span', { class: 'tutti-nombre', text: p.username }),
                h('span', { class: 'tutti-suma', text: roundPoints.has(p.user_id) ? '+' + roundPoints.get(p.user_id) : '' }),
                h('strong', { class: 'tutti-total', text: String(p.total) }));
        });
        const title = !final ? `Puntaje · ronda ${game.round} de ${game.totalRounds}`
            : winners.has(me()) ? (winners.size > 1 ? '¡Empate en el primer lugar!' : '¡Ganaste!') : winners.size ? `Ganó ${[...winners].map(nameOf).join(' y ')}` : 'Partida terminada';
        const table = buildAnswersTable(rows);
        return h('div', { class: 'tutti-puntajes' + (final ? ' tutti-final' : '') },
            h('div', { class: 'tutti-cabeza' }, h('div', { class: 'tutti-letra', text: game.letter }),
                h('div', { class: 'tutti-info' }, h('span', { class: 'tutti-ronda tutti-titulo', text: title }),
                    game.bastaBy ? h('span', { class: 'tutti-pista', text: `¡Basta! de ${nameOf(game.bastaBy)}` }) : null)),
            h('ol', { class: 'tutti-ranking' }, items),
            table ? h('details', { class: 'tutti-detalle' }, h('summary', { text: final ? 'Respuestas de la última ronda' : 'Ver todas las respuestas' }), table) : null,
            h('div', { class: 'tutti-acciones tutti-fija', id: 'tuttiAccionesPuntaje' }));
    }
    function buildAnswersTable(rows) {
        if (!rows.length) return null;
        const cats = room.settings.categories;
        return h('div', { class: 'tutti-tabla-caja' }, h('table', { class: 'tutti-tabla' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Jugador' }), cats.map(c => h('th', { scope: 'col', text: c })), h('th', { scope: 'col', text: 'Total' }))),
            h('tbody', {}, rows.map(r => h('tr', { class: r.user_id === me() ? 'tutti-yo' : '' },
                h('th', { scope: 'row', text: nameOf(r.user_id) }),
                cats.map((_, c) => { const code = r.status?.[c] || 'vacia'; return h('td', { class: STATUS[code]?.[1] || '' }, h('span', { text: r.answers?.[c] || '—' }), h('small', { text: String(r.points?.[c] ?? 0) })); }),
                h('td', { class: 'tutti-total', text: String(r.score ?? (r.points || []).reduce((a, b) => a + b, 0)) }))))));
    }
    function updateScores() {
        const actions = $('tuttiAccionesPuntaje'); if (!actions || actions.dataset.listo === viewKey) return;
        actions.dataset.listo = viewKey;
        if (room.status === 'scores') {
            actions.append(h('span', { class: 'tutti-pista', id: 'tuttiReloj' }),
                isHost() ? h('button', { type: 'button', class: 'tutti-principal', 'data-accion': '1', text: 'Siguiente ronda ya', onclick: () => run('advance', { expect: 'scores:' + room.game.round, force: true }) }) : null);
        } else {
            if (isHost()) actions.append(
                h('button', { type: 'button', class: 'tutti-principal', 'data-accion': '1', text: 'Jugar otra vez', onclick: () => { primeSound(); run('start', { settings: room.settings }); } }),
                h('button', { type: 'button', class: 'tutti-secundario', 'data-accion': '1', text: 'Cambiar reglas', onclick: () => run('settings', { settings: room.settings }) }));
            else actions.append(h('p', { class: 'tutti-espera', text: `${nameOf(room.host_id)} puede empezar otra partida.` }));
            if ((room.game.winners || []).includes(me())) { playSound('win'); vibrate([60, 40, 60, 40, 120]); }
        }
    }

    // ---------- clock ----------
    function tick() {
        if (!room?.game || !L) return;
        const game = room.game, now = serverNow(), phase = room.status;
        const reloj = $('tuttiReloj'), barra = $('tuttiBarra');
        const show = (left, total) => {
            const s = Math.max(0, Math.ceil(left / 1000));
            if (reloj) reloj.textContent = phase === 'scores' ? `Siguiente ronda en ${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
            if (barra) barra.style.width = Math.max(0, Math.min(100, left / total * 100)) + '%';
            return s;
        };
        if (phase === 'playing') {
            const letter = $('tuttiLetra');
            if (now < game.startsAt) {
                // Letter roulette.
                const pool = room.settings.hardLetters ? [...L.EASY_LETTERS, ...L.HARD_LETTERS] : L.EASY_LETTERS;
                if (letter) { letter.textContent = pool[Math.floor(now / 90) % pool.length]; letter.classList.add('tutti-girando'); }
                if (reloj) reloj.textContent = 'Sorteando letra…';
                setFieldsEnabled(false);
                if (Math.floor(now / 180) !== lastTick) { lastTick = Math.floor(now / 180); playSound('roll'); }
                return;
            }
            if (revealedFor !== viewKey) {
                revealedFor = viewKey;
                if (letter) { letter.textContent = game.letter; letter.classList.remove('tutti-girando'); letter.classList.add('tutti-revelada'); }
                setFieldsEnabled(true); playSound('reveal'); vibrate(30);
                const first = answers.findIndex(a => !a.trim());
                if (now - game.startsAt < 3000) $('tuttiCampo' + Math.max(0, first))?.focus({ preventScroll: coarse.matches });
                status('');
            }
            if (letter && letter.textContent !== game.letter) letter.textContent = game.letter;
            const left = game.endsAt - now, s = show(left, room.settings.roundSeconds * 1000);
            const alert = $('tuttiAlerta');
            if (game.bastaBy && alert) {
                alert.hidden = false;
                alert.textContent = left > 0 ? `¡BASTA! ${game.bastaBy === me() ? 'Lo dijiste tú' : 'Lo dijo ' + nameOf(game.bastaBy)} · quedan ${s} s` : '¡Tiempo!';
                if (bastaSeenFor !== viewKey) { bastaSeenFor = viewKey; playSound('basta'); vibrate([90, 50, 90]); }
            }
            reloj?.classList.toggle('tutti-urgente', left < 10000);
            if (left > 0 && left < 5500 && s !== lastTick) { lastTick = s; playSound('tick'); }
            updateBasta();
            if (left <= 0) {
                setFieldsEnabled(false);
                if (finalSentFor !== viewKey) { finalSentFor = viewKey; saveAnswers(true); }
                askToAdvance(game.endsAt + L.GRACE_MS);
            }
        } else if (phase === 'review') {
            show(game.reviewEndsAt - now, room.settings.reviewSeconds * 1000);
            askToAdvance(game.reviewEndsAt);
        } else if (phase === 'scores') {
            show(game.nextAt - now, L.SCORES_MS);
            askToAdvance(game.nextAt);
        }
    }
    function setFieldsEnabled(enabled) {
        for (const input of $('tuttiVista').querySelectorAll('.tutti-respuestas input')) if (input.disabled === enabled) input.disabled = !enabled;
    }
    // Once a deadline passes, ask the server to move on (spread out so a big room does not all ask at once).
    function askToAdvance(deadline) {
        const key = viewKey, now = serverNow();
        let plan = advanceTried.get(key);
        if (!plan) { plan = { at: deadline + 300 + Math.random() * Math.min(2500, 60 * room.players.length), tries: 0 }; advanceTried.set(key, plan); if (advanceTried.size > 20) advanceTried.delete(advanceTried.keys().next().value); }
        if (now < plan.at || plan.pending) return;
        plan.pending = true; plan.tries++;
        quiet('advance', { expect: room.status + ':' + room.game.round }, true).finally(() => { plan.pending = false; plan.at = serverNow() + Math.min(8000, 2000 * plan.tries); });
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
            const notes = { roll: [[660, 0, 0.03, 'square', 0.03]], tick: [[880, 0, 0.06, 'sine', 0.08]], reveal: [[523, 0, 0.12, 'triangle', 0.12], [784, 0.1, 0.2, 'triangle', 0.12]],
                basta: [[440, 0, 0.12, 'sawtooth', 0.09], [330, 0.13, 0.25, 'sawtooth', 0.09]], win: [[523, 0, 0.12, 'triangle', 0.12], [659, 0.12, 0.12, 'triangle', 0.12], [784, 0.24, 0.3, 'triangle', 0.12]] }[kind] || [];
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
    function paintSound() {
        $('tuttiSonido').setAttribute('aria-pressed', String(muted));
        $('tuttiSonido').textContent = muted ? 'Sonido: no' : 'Sonido: sí';
    }

    // ---------- buttons ----------
    $('tuttiCrear').addEventListener('click', () => { primeSound(); run('create', { code: '', settings: L ? L.DEFAULT_SETTINGS : undefined }, { announce: false }); });
    $('tuttiUnirse').addEventListener('submit', event => { event.preventDefault(); primeSound(); run('join', { code: $('tuttiCodigo').value.trim().toUpperCase() }); });
    $('tuttiSonido').addEventListener('click', () => { muted = !muted; try { localStorage.setItem('redmusica-tutti-muted', String(muted)); } catch { /* this visit only */ } paintSound(); if (!muted) primeSound(); });
    paintSound();
    $('tuttiInvitar').addEventListener('click', invite);
    async function invite() {
        const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('seccion', 'bachillerato'); url.searchParams.set('tutti', roomCode);
        if (navigator.share && coarse.matches) {
            try { await navigator.share({ title: 'Bachillerato en RedMusica', text: `¡Juguemos bachillerato! Código de sala: ${roomCode}`, url: url.href }); return; } catch (error) { if (error?.name === 'AbortError') return; }
        }
        try { await navigator.clipboard.writeText(url.href); status('Enlace de invitación copiado. Compártelo con quien quieras: no hay límite de jugadores.'); } catch { status('Comparte este código: ' + roomCode); }
    }
    $('tuttiSalir').addEventListener('click', () => {
        const button = $('tuttiSalir');
        const playing = room && ['playing', 'review', 'scores'].includes(room.status);
        if (playing && !confirmLeave) {
            button.textContent = '¿Salir? Toca otra vez';
            confirmLeave = setTimeout(() => { confirmLeave = null; button.textContent = 'Salir'; }, 4000);
            return;
        }
        clearTimeout(confirmLeave); confirmLeave = null; button.textContent = 'Salir';
        run('leave');
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && roomCode) refresh(); });
    document.addEventListener('click', event => { if (event.target.closest?.('#bachilleratoNav') && roomCode) setTimeout(refresh, 0); });

    // ---------- session ----------
    function joinInvite() {
        const invited = new URLSearchParams(location.search).get('tutti');
        if (user && invited && /^[A-Z0-9]{6}$/i.test(invited) && invited.toUpperCase() !== roomCode && !busy) run('join', { code: invited.toUpperCase() });
    }
    function setUser(next) {
        const changed = (next?.id || null) !== (user?.id || null);
        user = next;
        $('tuttiAcceso').hidden = Boolean(user);
        $('tuttiEntrada').hidden = !user || Boolean(roomCode);
        if (!user && roomCode) { leaveView(); status('Inicia sesión desde Inicio para volver a jugar.'); }
        if (changed) loadRecord();
    }
    async function loadRecord() {
        const line = $('tuttiRecord');
        if (!user || !db?.from) { line.hidden = true; return; }
        try {
            const { data, error } = await db.from('tutti_stats').select('games,wins,points').eq('user_id', user.id).maybeSingle();
            if (error || !data || !data.games) { line.hidden = true; return; }
            line.textContent = `Tu récord: ${data.wins} ${data.wins === 1 ? 'victoria' : 'victorias'} en ${data.games} ${data.games === 1 ? 'partida' : 'partidas'} · ${data.points} puntos`;
            line.hidden = false;
        } catch { line.hidden = true; }
    }
    if (!db) { status('El bachillerato requiere una cuenta de RedMusica.'); $('tuttiEntrada').hidden = true; return; }
    db.auth.onAuthStateChange((_event, session) => { setUser(session?.user || null); setTimeout(joinInvite, 0); });
    db.auth.getSession().then(({ data: { session } }) => { setUser(session?.user || null); joinInvite(); });

    // ---------- profile line ----------
    function setupProfileStats() {
        const presence = $('presenciaPerfil'), line = $('tuttiPerfil');
        if (!presence || !line || !db) return;
        let current = '';
        const load = async () => {
            const id = presence.dataset.userId || '';
            if (id === current) return;
            current = id; line.hidden = true; line.textContent = '';
            if (!id) return;
            const { data, error } = await db.from('tutti_stats').select('games,wins').eq('user_id', id).maybeSingle();
            if (error || !data || id !== current || !data.games) return;
            line.textContent = `Bachillerato: ${data.wins} ${data.wins === 1 ? 'victoria' : 'victorias'} en ${data.games} ${data.games === 1 ? 'partida' : 'partidas'}`;
            line.hidden = false;
        };
        new MutationObserver(load).observe(presence, { attributes: true, attributeFilter: ['data-user-id'] });
        load();
    }
})();
