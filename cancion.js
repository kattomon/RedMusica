// "Adivina la canción": the daily challenge (the cancion Edge Function keeps the answers and checks
// every try) and a free practice mode that runs here in the browser with the same rules.
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const root = $('cancion');
    const config = window.REDMUSICA_CONFIG;
    const db = config && window.supabase ? window.redmusicaClient || window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
    const LOGIC_URL = './supabase/functions/cancion/logic.js?v=20261003-1';
    const SHARE_URL = 'https://kattomon.github.io/RedMusica/?seccion=cancion';
    const PRACTICE_KEY = 'redmusica-cancion-practica';
    setupProfileStats();
    if (!root) return;

    let L = null, user = null, tab = 'dia', daily = null, practice = null, friends = null;
    let viewing = null, busy = false, armedGiveUp = false, pick = null, query = '', highlight = -1, lastFlip = '';
    const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const panel = $('cancionPanel');
    const PRACTICE_MODES = [
        ['mix', 'Mezcla'], ['es', 'En español'], ['en', 'En inglés'], ['cl', 'Chilenas'], ['old', 'Antes del 2000'], ['new', 'Desde 2015']
    ];

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
    const status = text => { $('cancionEstado').textContent = text || ''; };
    const random = n => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; };
    const vibrate = ms => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };
    const artistsText = song => song.artists.join(' & ');
    const dayLabel = day => { const [y, m, d] = day.split('-'); return `${d}-${m}-${y}`; };

    // ---------- server ----------
    async function request(action, extra = {}) {
        if (!db) throw new Error('No se pudo iniciar el juego. Recarga la página.');
        const { data: { session } } = await db.auth.getSession();
        if (!session) throw new Error('Inicia sesión para jugar el desafío del día.');
        const response = await fetch(config.supabaseUrl + '/functions/v1/cancion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: config.supabasePublishableKey, Authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify({ action, ...extra }),
            signal: AbortSignal.timeout(12000)
        });
        let result = {};
        try { result = await response.json(); } catch { /* handled below */ }
        if (!response.ok) throw new Error(result.error || (response.status === 404 ? 'El desafío todavía no está disponible. Inténtalo más tarde.' : 'No se pudo conectar con el juego.'));
        return result;
    }
    async function loadDaily() {
        if (!user) { daily = null; render(); return; }
        try {
            status('Cargando el desafío de hoy…');
            const { game } = await request('today');
            if (daily && daily.day !== game.day) viewing = null;
            daily = game; status('');
        } catch (error) { status(error.message); }
        render();
    }
    async function loadFriends() {
        if (!user) { friends = null; render(); return; }
        try { status('Cargando…'); friends = await request('board'); status(''); } catch (error) { status(error.message); }
        render();
    }

    // ---------- practice (local) ----------
    function newPractice(mode = practice?.mode || 'mix') {
        const all = L.SONGS;
        const pools = {
            mix: [all, 5], es: [all.filter(s => s.lang === 'es'), 10], en: [all.filter(s => s.lang === 'en'), 0],
            cl: [all.filter(s => s.country === 'CL'), 10], old: [all.filter(s => s.year < 2000), 5], new: [all.filter(s => s.year >= 2015), 5]
        };
        const [pool, spanish] = pools[mode] || pools.mix;
        const songs = L.pickSongs(random, { pool, spanish });
        practice = { mode, songs, guesses: songs.map(() => []) };
        savePractice(); viewing = null; resetSearch();
    }
    function savePractice() { try { localStorage.setItem(PRACTICE_KEY, JSON.stringify(practice)); } catch { /* storage may be blocked */ } }
    function loadPractice() {
        try {
            const saved = JSON.parse(localStorage.getItem(PRACTICE_KEY) || 'null');
            if (saved && Array.isArray(saved.songs) && saved.songs.length && saved.songs.every(id => L.songById(id)) && Array.isArray(saved.guesses)) practice = saved;
        } catch { /* ignore */ }
        if (!practice) newPractice('mix');
    }
    function practiceModel() {
        const slots = practice.songs.map((id, i) => L.slotView(id, practice.guesses[i]));
        const states = slots.map(s => s.state);
        return {
            practice: true, slots, current: states.indexOf('playing'),
            score: slots.reduce((sum, s) => sum + s.points, 0), solved: states.filter(s => s === 'won').length,
            finished: states.every(s => s !== 'playing'), line: practice.songs.map((id, i) => L.emojiFor(id, practice.guesses[i])).join('')
        };
    }

    // ---------- playing ----------
    async function guess(slot, songId) {
        if (busy) return;
        armedGiveUp = false;
        if (tab === 'practica') {
            try { practice.guesses[slot] = L.addGuess(practice.songs[slot], practice.guesses[slot], songId); } catch (error) { status(error.message); return; }
            savePractice(); afterGuess(practiceModel(), slot); return;
        }
        busy = true; render();
        try {
            const { game } = await request('guess', { slot, song: songId, day: daily.day });
            daily = game; status('');
            afterGuess(game, slot);
        } catch (error) {
            status(error.message); vibrate(40);
            if (/otro día/.test(error.message)) { daily = null; viewing = null; loadDaily(); }
        } finally { busy = false; render(); }
    }
    function afterGuess(model, slot) {
        const s = model.slots[slot];
        lastFlip = `${tab}:${slot}:${s.tries.length}`;
        resetSearch();
        if (s.state !== 'playing') viewing = slot;          // stay on the answer until "Siguiente"
        if (s.state === 'won') vibrate([20, 40, 20]);
        else if (s.state === 'lost') vibrate(60);
        render();
        if (s.state === 'playing') requestAnimationFrame(() => root.querySelector('.cancion-buscar input')?.focus({ preventScroll: true }));
    }
    function resetSearch() { pick = null; query = ''; highlight = -1; }
    const model = () => tab === 'practica' ? (practice && practiceModel()) : daily;

    // ---------- rendering ----------
    function render() {
        for (const [id, name] of [['cancionTabDia', 'dia'], ['cancionTabPractica', 'practica'], ['cancionTabAmigos', 'amigos']]) $(id).setAttribute('aria-selected', String(tab === name));
        $('cancionAcceso').hidden = !!user || tab === 'practica';
        if (!L) { panel.replaceChildren(h('p', { class: 'cancion-cargando', text: 'Cargando canciones…' })); return; }
        if (tab === 'amigos') { panel.replaceChildren(renderFriends()); return; }
        if (tab === 'dia' && !user) { panel.replaceChildren(h('div', { class: 'cancion-vacio' }, h('p', { text: 'El desafío del día guarda tus puntos y tu racha. Mientras tanto, prueba la práctica libre.' }), h('button', { type: 'button', onclick: () => switchTab('practica'), text: 'Ir a la práctica libre' }))); return; }
        const m = model();
        if (!m) { panel.replaceChildren(); return; }
        let index = viewing;
        if (index === null || index === undefined) index = m.finished ? 'summary' : m.current;
        if (index !== 'summary' && !m.slots[index]) index = m.finished ? 'summary' : m.current;
        panel.replaceChildren(...[renderHeader(m, index), index === 'summary' ? renderSummary(m) : renderSlot(m, index)].filter(Boolean));
    }

    function renderHeader(m, index) {
        const dots = m.slots.map((slot, i) => h('button', {
            type: 'button', class: `cancion-punto cancion-punto-${slot.state}` + (i === index ? ' cancion-punto-actual' : ''),
            'aria-label': `Canción ${i + 1}: ${slot.state === 'won' ? 'adivinada' : slot.state === 'lost' ? 'no adivinada' : slot.tries.length ? 'en curso' : 'sin jugar'}`,
            'aria-current': i === index ? 'true' : null, onclick: () => { viewing = i; resetSearch(); armedGiveUp = false; render(); }
        }, String(i + 1)));
        if (m.finished) dots.push(h('button', { type: 'button', class: 'cancion-punto cancion-punto-resumen' + (index === 'summary' ? ' cancion-punto-actual' : ''), 'aria-label': 'Resumen del día', onclick: () => { viewing = 'summary'; render(); } }, '★'));
        const title = m.practice ? 'Práctica · ' + (PRACTICE_MODES.find(([k]) => k === practice.mode)?.[1] || '') : 'Desafío del ' + dayLabel(m.day);
        return h('div', { class: 'cancion-cabecera' },
            h('div', { class: 'cancion-cabecera-fila' }, h('strong', { text: title }), h('span', { class: 'cancion-puntaje', text: `${m.score} pts` })),
            h('nav', { class: 'cancion-puntos', 'aria-label': 'Canciones de la partida' }, dots));
    }

    function renderTitle(slot) {
        return h('div', { class: 'cancion-titulo', 'aria-label': slot.state === 'playing' ? `Título: ${slot.title.map(w => w.filter(b => b.letter).length + ' letras').join(', ')}` : null },
            slot.title.map(word => h('span', { class: 'cancion-palabra' }, word.map(box => box.letter
                ? h('span', { class: 'cancion-letra' + (box.hidden ? '' : box.match ? ' cancion-letra-match' : ' cancion-letra-ok'), 'aria-hidden': slot.state === 'playing' ? 'true' : null, text: box.hidden ? '' : box.ch })
                : h('span', { class: 'cancion-signo', 'aria-hidden': 'true', text: box.ch })))));
    }

    function renderSlot(m, index) {
        const slot = m.slots[index], playing = slot.state === 'playing';
        const card = h('section', { class: 'cancion-tarjeta', 'aria-label': `Canción ${index + 1} de ${m.slots.length}` },
            h('p', { class: 'cancion-numero' }, `Canción ${index + 1} de ${m.slots.length}`, playing ? h('span', { class: 'cancion-intentos', text: ` · ${slot.left} ${slot.left === 1 ? 'intento' : 'intentos'}` }) : null),
            renderTitle(slot));
        if (playing && (slot.artistHint || slot.tries.length >= 2)) {
            card.append(h('p', { class: 'cancion-pista' }, slot.artistHint ? ['Pista: es de ', h('strong', { text: slot.artistHint })] : 'Pista: ya aparece la primera letra de cada palabra.'));
        }
        if (playing) card.append(renderSearch(m, index));
        else card.append(renderResult(m, index));
        if (slot.tries.length) card.append(renderTries(slot, index));
        return card;
    }

    function renderSearch(m, index) {
        const slot = m.slots[index];
        const tried = slot.tries.map(t => t.id);
        const results = !pick && query.trim() ? L.search(query, 8, tried) : [];
        const input = h('input', {
            type: 'search', placeholder: 'Escribe una canción o artista…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
            'aria-label': 'Busca la canción', role: 'combobox', 'aria-expanded': String(results.length > 0), 'aria-controls': 'cancionOpciones', 'aria-autocomplete': 'list',
            'aria-activedescendant': highlight >= 0 && results[highlight] ? 'cancionOpcion' + highlight : null, enterkeyhint: 'go'
        });
        input.value = query;
        const list = h('ul', { id: 'cancionOpciones', class: 'cancion-opciones', role: 'listbox', 'aria-label': 'Canciones' }, results.map((song, i) => h('li', {
            id: 'cancionOpcion' + i, role: 'option', 'aria-selected': String(i === highlight), class: i === highlight ? 'cancion-opcion-activa' : null,
            onmousedown: event => event.preventDefault(), onclick: () => choose(song)
        }, h('strong', { text: song.title }), h('span', { text: artistsText(song) }))));
        if (query.trim() && !results.length) list.append(h('li', { class: 'cancion-sin-resultados', text: 'No está en el catálogo. Prueba con otra canción.' }));
        const choose = song => { pick = song; query = song.title + ' — ' + artistsText(song); highlight = -1; render(); requestAnimationFrame(() => root.querySelector('.cancion-adivinar')?.focus()); };
        const refresh = () => {
            const value = input.value, start = input.selectionStart;
            query = value; pick = null; highlight = -1; render();
            const again = root.querySelector('.cancion-buscar input');
            if (again) { again.focus({ preventScroll: true }); try { again.setSelectionRange(start, start); } catch { /* search inputs */ } }
        };
        input.addEventListener('input', refresh);
        input.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); highlight = (highlight + 1) % results.length; render(); root.querySelector('.cancion-buscar input')?.focus(); }
            else if (event.key === 'ArrowUp' && results.length) { event.preventDefault(); highlight = (highlight - 1 + results.length) % results.length; render(); root.querySelector('.cancion-buscar input')?.focus(); }
            else if (event.key === 'Enter') {
                event.preventDefault();
                if (pick) guess(index, pick.id);
                else if (results.length) choose(results[Math.max(0, highlight)]);
            } else if (event.key === 'Escape') { query = ''; pick = null; render(); root.querySelector('.cancion-buscar input')?.focus(); }
        });
        const giveUp = h('button', {
            type: 'button', class: 'cancion-rendirse' + (armedGiveUp ? ' cancion-rendirse-armado' : ''), disabled: busy,
            onclick: () => { if (!armedGiveUp) { armedGiveUp = true; render(); return; } guess(index, L.GIVE_UP); }
        }, armedGiveUp ? '¿Seguro? Toca otra vez' : 'Me rindo');
        return h('form', { class: 'cancion-buscar', onsubmit: event => { event.preventDefault(); if (pick) guess(index, pick.id); } },
            h('div', { class: 'cancion-campo' }, input, list),
            h('div', { class: 'cancion-acciones' },
                h('button', { type: 'submit', class: 'cancion-adivinar', disabled: !pick || busy }, busy ? 'Revisando…' : pick ? 'Adivinar' : 'Elige una canción'),
                giveUp));
    }

    function renderResult(m, index) {
        const slot = m.slots[index], song = L.songById(slot.answer);
        const won = slot.state === 'won';
        const next = m.slots.findIndex((s, i) => i > index && s.state === 'playing');
        const firstOpen = m.slots.findIndex(s => s.state === 'playing');
        const goTo = next >= 0 ? next : firstOpen >= 0 ? firstOpen : 'summary';
        const yt = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(song.title + ' ' + song.artists[0]);
        return h('div', { class: 'cancion-resultado ' + (won ? 'cancion-resultado-bien' : 'cancion-resultado-mal'), role: 'status' },
            h('p', { class: 'cancion-resultado-titulo', text: won ? (slot.tries.length === 1 ? '¡A la primera! 🎯' : '¡La adivinaste!') : 'Esta vez no' }),
            h('p', {}, 'Era ', h('strong', { text: `«${song.title}»` }), ` de ${artistsText(song)} (${song.year}).`),
            h('p', { class: 'cancion-resultado-puntos', text: won ? `+${slot.points} ${slot.points === 1 ? 'punto' : 'puntos'}` : '0 puntos' }),
            h('div', { class: 'cancion-acciones' },
                h('button', { type: 'button', onclick: () => { viewing = goTo; resetSearch(); render(); }, text: goTo === 'summary' ? 'Ver resultado' : 'Siguiente canción' }),
                h('a', { class: 'cancion-escuchar', href: yt, target: '_blank', rel: 'noopener noreferrer', text: 'Escúchala en YouTube ↗' })));
    }

    const CLUE_NAMES = { artist: 'Artista', year: 'Año', country: 'País', genre: 'Género', lang: 'Idioma', kind: 'Intérprete' };
    const STATE_WORDS = { hit: 'igual', near: 'cerca', miss: 'no' };
    const MARK = { hit: '✓', near: '≈', miss: '✕' };
    function renderTries(slot, index) {
        const flipKey = `${tab}:${index}:${slot.tries.length}`;
        const animate = flipKey === lastFlip && !reduceMotion.matches;
        const items = slot.tries.map((tryItem, n) => {
            const song = L.songById(tryItem.id), c = tryItem.clues;
            const values = {
                artist: [artistsText(song), c.artist],
                year: [song.year + (c.year.dir === 'up' ? ' ↑' : c.year.dir === 'down' ? ' ↓' : ''), c.year.state, c.year.dir === 'up' ? 'es más nueva' : c.year.dir === 'down' ? 'es más antigua' : ''],
                country: [L.flag(song.country) + ' ' + L.COUNTRIES[song.country], c.country],
                genre: [L.GENRES[song.genre], c.genre],
                lang: [L.LANGS[song.lang], c.lang],
                kind: [L.KINDS[song.kind], c.kind]
            };
            const fresh = animate && n === slot.tries.length - 1;
            return h('li', { class: 'cancion-intento' + (c.song ? ' cancion-intento-acierto' : '') },
                h('p', { class: 'cancion-intento-nombre' }, h('span', { class: 'cancion-intento-n', text: n + 1 }), h('strong', { text: song.title }), h('span', { text: ' · ' + artistsText(song) })),
                c.song ? h('p', { class: 'cancion-intento-bien', text: '¡Es esta!' }) : h('div', { class: 'cancion-pistas' }, Object.keys(CLUE_NAMES).map((key, k) => {
                    const [text, state, extra] = values[key];
                    return h('div', { class: `cancion-pista-caja cancion-${state}` + (fresh ? ' cancion-girar' : ''), style: fresh ? `animation-delay:${k * 110}ms` : null, 'aria-label': `${CLUE_NAMES[key]}: ${text.replace(/ [↑↓]$/, '')}, ${STATE_WORDS[state]}${extra ? ', la canción ' + extra : ''}` },
                        h('span', { class: 'cancion-pista-nombre', 'aria-hidden': 'true', text: CLUE_NAMES[key] }),
                        h('span', { class: 'cancion-pista-valor', 'aria-hidden': 'true', text }),
                        h('span', { class: 'cancion-pista-marca', 'aria-hidden': 'true', text: MARK[state] }));
                })));
        });
        return h('ol', { class: 'cancion-intentos-lista', reversed: true, 'aria-label': 'Tus intentos' }, items.reverse());
    }

    function renderSummary(m) {
        const rows = (m.practice ? practice.songs : m.slots.map(s => s.answer)).map((id, i) => {
            const slot = m.slots[i], song = L.songById(slot.answer ?? id);
            return h('li', {}, h('button', { type: 'button', class: 'cancion-resumen-fila', onclick: () => { viewing = i; render(); } },
                h('span', { class: 'cancion-resumen-emoji', text: (m.line ? [...m.line][i] : '') || '' }),
                h('span', {}, h('strong', { text: song.title }), h('span', { text: ' · ' + artistsText(song) })),
                h('span', { class: 'cancion-resumen-pts', text: slot.points ? `+${slot.points}` : '0' })));
        });
        const perfect = m.solved === m.slots.length;
        const box = h('section', { class: 'cancion-resumen', 'aria-label': 'Resultado' },
            h('p', { class: 'cancion-resumen-total' }, h('strong', { text: `${m.score}` }), ` / ${m.slots.length * 6} puntos`),
            h('p', { class: 'cancion-resumen-texto', text: perfect ? '¡Adivinaste las 10! 🏆' : `Adivinaste ${m.solved} de ${m.slots.length} canciones.` }),
            h('p', { class: 'cancion-emojis', 'aria-label': 'Tu resultado en cuadritos', text: emojiRows(m.line) }));
        if (!m.practice && m.stats) {
            const s = m.stats;
            box.append(h('dl', { class: 'cancion-stats' },
                h('div', {}, h('dt', { text: 'Racha' }), h('dd', { text: `${s.streak} ${s.streak === 1 ? 'día' : 'días'}` })),
                h('div', {}, h('dt', { text: 'Días jugados' }), h('dd', { text: s.days })),
                h('div', {}, h('dt', { text: 'Mejor día' }), h('dd', { text: `${s.best}/60` })),
                h('div', {}, h('dt', { text: 'Mejor racha' }), h('dd', { text: s.best_streak }))));
        }
        const actions = h('div', { class: 'cancion-acciones' });
        if (!m.practice) {
            actions.append(h('button', { type: 'button', onclick: () => share(m), text: 'Compartir resultado' }),
                h('button', { type: 'button', class: 'cancion-secundario', onclick: () => switchTab('amigos'), text: 'Ver a mis amigos' }));
            box.append(actions, h('p', { class: 'cancion-manana', text: 'Mañana hay 10 canciones nuevas. Mientras tanto, sigue en la práctica libre.' }));
        } else {
            actions.append(renderModePicker(), h('button', { type: 'button', onclick: () => { newPractice(practice.mode); render(); }, text: 'Jugar otra vez' }));
            box.append(actions);
        }
        box.append(h('ol', { class: 'cancion-resumen-lista' }, rows));
        return box;
    }
    const emojiRows = line => { const e = [...(line || '')]; return e.slice(0, 5).join('') + (e.length > 5 ? '\n' + e.slice(5).join('') : ''); };

    function renderModePicker() {
        const select = h('select', { 'aria-label': 'Tipo de canciones', onchange: () => { newPractice(select.value); render(); } },
            PRACTICE_MODES.map(([key, label]) => h('option', { value: key, selected: practice?.mode === key, text: label })));
        return h('label', { class: 'cancion-modo' }, 'Canciones: ', select);
    }

    async function share(m) {
        const text = `RedMusica · Adivina la canción ${dayLabel(m.day)}\n${m.score}/60 · ${m.solved} de 10\n${emojiRows(m.line)}\n${SHARE_URL}`;
        try {
            if (navigator.share) { await navigator.share({ text }); return; }
            await navigator.clipboard.writeText(text);
            status('Copiamos tu resultado. Pégalo donde quieras.');
        } catch (error) { if (error?.name !== 'AbortError') status('No se pudo compartir. Copia el resultado a mano.'); }
    }

    function renderFriends() {
        const wrap = h('section', { class: 'cancion-amigos', 'aria-label': 'Resultados de tus amigos hoy' });
        if (!user) { wrap.append(h('p', { text: 'Inicia sesión para ver cómo les va a tus amigos.' })); return wrap; }
        if (!friends) { wrap.append(h('p', { class: 'cancion-cargando', text: 'Cargando…' })); return wrap; }
        wrap.append(h('div', { class: 'cancion-cabecera-fila' }, h('strong', { text: 'Hoy, ' + dayLabel(friends.day) }), h('button', { type: 'button', class: 'cancion-secundario', onclick: loadFriends, text: 'Actualizar' })));
        if (!friends.rows.length || (friends.rows.length === 1 && friends.rows[0].me)) wrap.append(h('p', { class: 'cancion-vacio', text: 'Ninguno de tus amigos ha jugado todavía hoy. ¡Invítalos!' }));
        wrap.append(h('ol', { class: 'cancion-tabla' }, friends.rows.map((row, i) => h('li', { class: row.me ? 'cancion-tabla-yo' : null },
            h('span', { class: 'cancion-tabla-pos', text: i + 1 }),
            h('span', { class: 'cancion-tabla-nombre', text: row.me ? `${row.username} (tú)` : row.username }),
            h('span', { class: 'cancion-tabla-linea', 'aria-label': `${row.solved} adivinadas`, text: row.line }),
            h('span', { class: 'cancion-tabla-pts', text: row.finished ? `${row.score} pts` : `${row.score} pts…` })))));
        wrap.append(h('p', { class: 'cancion-nota', text: `${friends.players} ${friends.players === 1 ? 'persona jugó' : 'personas jugaron'} hoy en RedMusica.` }));
        return wrap;
    }

    // ---------- tabs and session ----------
    function switchTab(name) {
        tab = name; viewing = null; resetSearch(); armedGiveUp = false; status('');
        if (name === 'amigos') { friends = null; wake(); }
        else wake();
        render();
    }
    $('cancionTabDia').addEventListener('click', () => switchTab('dia'));
    $('cancionTabPractica').addEventListener('click', () => switchTab('practica'));
    $('cancionTabAmigos').addEventListener('click', () => switchTab('amigos'));
    root.querySelector('.cancion-pestanas').addEventListener('keydown', event => {
        const order = ['dia', 'practica', 'amigos'], i = order.indexOf(tab);
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const next = order[(i + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
        switchTab(next); $({ dia: 'cancionTabDia', practica: 'cancionTabPractica', amigos: 'cancionTabAmigos' }[next]).focus();
    });
    // Only talk to the server while the section is on screen (opening it is what starts the day's game).
    const section = $('seccionCancion');
    const visible = () => !section || !section.hidden;
    function wake() {
        if (!L || !user || !visible()) return;
        if (tab === 'dia' && !daily) loadDaily();
        else if (tab === 'amigos' && !friends) loadFriends();
    }
    if (section) new MutationObserver(wake).observe(section, { attributes: true, attributeFilter: ['hidden'] });
    function setUser(next) {
        const changed = (next?.id || '') !== (user?.id || '');
        user = next;
        if (changed) { daily = null; friends = null; wake(); }
        render();
    }
    // Reload the daily game when coming back to the tab after midnight.
    document.addEventListener('visibilitychange', () => { if (!document.hidden && daily && L && L.chileDay() !== daily.day && tab === 'dia') { daily = null; viewing = null; wake(); } });

    import(LOGIC_URL).then(module => {
        L = module; loadPractice();
        if (new URLSearchParams(location.search).get('modo') === 'practica' || !db) tab = 'practica';
        render(); wake();
    }).catch(() => { panel.replaceChildren(h('p', { class: 'cancion-cargando', text: 'No se pudo cargar el juego. Recarga la página.' })); });
    if (db) {
        db.auth.onAuthStateChange((_event, session) => setUser(session?.user || null));
        db.auth.getSession().then(({ data: { session } }) => setUser(session?.user || null));
    }
    render();

    // ---------- profile line ----------
    function setupProfileStats() {
        const presence = $('presenciaPerfil'), line = $('cancionPerfil');
        if (!presence || !line || !db) return;
        let current = '';
        const load = async () => {
            const id = presence.dataset.userId || '';
            if (id === current) return;
            current = id; line.hidden = true; line.textContent = '';
            if (!id) return;
            const { data, error } = await db.from('song_stats').select('days,best,streak,best_streak').eq('user_id', id).maybeSingle();
            if (error || !data || !data.days || id !== current) return;
            line.textContent = `Adivina la canción: ${data.days} ${data.days === 1 ? 'día' : 'días'} · mejor día ${data.best}/60 · mejor racha ${data.best_streak}`;
            line.hidden = false;
        };
        new MutationObserver(load).observe(presence, { attributes: true, attributeFilter: ['data-user-id'] });
        load();
    }
})();
