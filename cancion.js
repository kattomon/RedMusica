// "Adivina la canción" (Bandle style): the daily challenge and the live rooms run on the cancion Edge
// Function, which keeps the answers; packs, the bonus round and the audio mode run here in the browser.
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const root = $('cancion');
    const config = window.REDMUSICA_CONFIG;
    const db = config && window.supabase ? window.redmusicaClient || window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
    const LOGIC_URL = './supabase/functions/cancion/logic.js?v=20261003-2';
    const AUDIO_URL = './cancion-audio.js?v=20261003-1';
    const SHARE_URL = 'https://kattomon.github.io/RedMusica/?seccion=cancion';
    const PRACTICE_KEY = 'redmusica-cancion-paquete';
    setupProfileStats();
    if (!root) return;

    let L = null, A = null, player = null, user = null, tab = 'dia';
    let daily = null, dayWanted = null, archive = null, friends = null, practice = null, trivia = null, audio = null;
    let live = null, liveCode = '', liveTimer = null, layerTimer = null, channel = null, channelCode = '', subscribed = false, offset = 0, liveError = '';
    let viewing = null, busy = false, armedGiveUp = false, pick = null, query = '', highlight = -1, lastFlip = '', showArchive = false, showPacks = false;
    const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const panel = $('cancionPanel');
    const TABS = [['dia', 'cancionTabDia'], ['practica', 'cancionTabPractica'], ['vivo', 'cancionTabVivo'], ['audio', 'cancionTabAudio'], ['amigos', 'cancionTabAmigos']];

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
    const serverNow = () => Date.now() + offset;
    const focusInput = () => requestAnimationFrame(() => root.querySelector('.cancion-buscar input')?.focus({ preventScroll: true }));

    // ---------- server ----------
    async function request(action, extra = {}) {
        if (!db) throw new Error('No se pudo iniciar el juego. Recarga la página.');
        const { data: { session } } = await db.auth.getSession();
        if (!session) throw new Error('Inicia sesión para jugar.');
        const sent = Date.now();
        const response = await fetch(config.supabaseUrl + '/functions/v1/cancion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: config.supabasePublishableKey, Authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify({ action, ...extra }),
            signal: AbortSignal.timeout(12000)
        });
        let result = {};
        try { result = await response.json(); } catch { /* handled below */ }
        if (!response.ok) throw new Error(result.error || (response.status === 404 ? 'El juego todavía no está disponible. Inténtalo más tarde.' : 'No se pudo conectar con el juego.'));
        const rtt = Date.now() - sent;
        if (result.room?.now && rtt < 4000) offset = result.room.now - (sent + rtt / 2);
        return result;
    }
    async function loadDaily() {
        if (!user) { daily = null; render(); return; }
        try {
            status('Cargando el desafío…');
            const { game } = await request('today', dayWanted ? { day: dayWanted } : {});
            if (daily && daily.day !== game.day) viewing = null;
            daily = game; status('');
        } catch (error) { status(error.message); }
        render();
    }
    async function loadArchive() {
        try { archive = await request('archive'); } catch (error) { status(error.message); }
        render();
    }
    async function loadFriends() {
        if (!user) { friends = null; render(); return; }
        try { status('Cargando…'); friends = await request('board'); status(''); } catch (error) { status(error.message); }
        render();
    }

    // ---------- packs (local practice) ----------
    function newPractice(pack = practice?.pack || 'mix') {
        const songs = L.pickPack(random, pack, 10);
        practice = { pack, songs, guesses: songs.map(() => []) };
        savePractice(); viewing = null; resetSearch(); showPacks = false;
    }
    function savePractice() { try { localStorage.setItem(PRACTICE_KEY, JSON.stringify(practice)); } catch { /* storage may be blocked */ } }
    function loadPractice() {
        try {
            const saved = JSON.parse(localStorage.getItem(PRACTICE_KEY) || 'null');
            if (saved && Array.isArray(saved.songs) && saved.songs.length && saved.songs.every(id => L.songById(id)) && Array.isArray(saved.guesses)) practice = saved;
        } catch { /* ignore */ }
        if (!practice) { newPractice('mix'); showPacks = true; }
    }
    function practiceModel() {
        const slots = practice.songs.map((id, i) => L.slotView(id, practice.guesses[i]));
        const states = slots.map(s => s.state);
        const dist = [0, 0, 0, 0, 0, 0, 0];
        practice.songs.forEach((id, i) => { if (states[i] !== 'playing') dist[L.solvedAt(id, practice.guesses[i]) - 1]++; });
        return {
            practice: true, slots, current: states.indexOf('playing'), dist,
            score: slots.reduce((sum, s) => sum + s.points, 0), solved: states.filter(s => s === 'won').length,
            finished: states.every(s => s !== 'playing'), line: practice.songs.map((id, i) => L.emojiFor(id, practice.guesses[i])).join('')
        };
    }

    // ---------- playing (daily and packs) ----------
    async function act(slot, songId) {
        if (busy) return;
        armedGiveUp = false;
        if (tab === 'practica') {
            try { practice.guesses[slot] = L.addGuess(practice.songs[slot], practice.guesses[slot], songId); } catch (error) { status(error.message); return; }
            savePractice(); afterAct(practiceModel(), slot); return;
        }
        busy = true; render();
        try {
            const { game } = await request('guess', { slot, song: songId, day: daily.day });
            daily = game; status('');
            afterAct(game, slot);
        } catch (error) { status(error.message); vibrate(40); }
        finally { busy = false; render(); }
    }
    function afterAct(model, slot) {
        const s = model.slots[slot];
        lastFlip = `${tab}:${slot}:${s.step}`;
        resetSearch(); status('');
        if (s.state !== 'playing') viewing = slot;          // stay on the answer until "Siguiente"
        if (s.state === 'won') vibrate([20, 40, 20]); else if (s.state === 'lost') vibrate(60);
        render();
        if (s.state === 'playing') focusInput();
    }
    function resetSearch() { pick = null; query = ''; highlight = -1; }
    const model = () => tab === 'practica' ? (practice && practiceModel()) : daily;

    // ---------- rendering ----------
    function render() {
        for (const [name, id] of TABS) $(id)?.setAttribute('aria-selected', String(tab === name));
        $('cancionAcceso').hidden = !!user || tab === 'practica' || tab === 'audio';
        if (tab !== 'audio') player?.stop();
        if (!L) { panel.replaceChildren(h('p', { class: 'cancion-cargando', text: 'Cargando canciones…' })); return; }
        if (tab === 'amigos') { panel.replaceChildren(renderFriends()); return; }
        if (tab === 'vivo') { panel.replaceChildren(renderLive()); return; }
        if (tab === 'audio') { panel.replaceChildren(renderAudio()); return; }
        if (trivia && (tab === 'dia' || tab === 'practica')) { panel.replaceChildren(renderTrivia()); return; }
        if (tab === 'dia' && !user) { panel.replaceChildren(h('div', { class: 'cancion-vacio' }, h('p', { text: 'El desafío del día guarda tus puntos y tu racha. Mientras tanto, prueba los paquetes o el modo con audio.' }), h('button', { type: 'button', onclick: () => switchTab('practica'), text: 'Ir a los paquetes' }))); return; }
        if (tab === 'dia' && showArchive) { panel.replaceChildren(renderArchive()); return; }
        if (tab === 'practica' && showPacks) { panel.replaceChildren(renderPacks()); return; }
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
            'aria-label': `Canción ${i + 1}: ${slot.state === 'won' ? 'adivinada' : slot.state === 'lost' ? 'no adivinada' : slot.step ? 'en curso' : 'sin jugar'}`,
            'aria-current': i === index ? 'true' : null, onclick: () => { viewing = i; resetSearch(); armedGiveUp = false; render(); }
        }, String(i + 1)));
        if (m.finished) dots.push(h('button', { type: 'button', class: 'cancion-punto cancion-punto-resumen' + (index === 'summary' ? ' cancion-punto-actual' : ''), 'aria-label': 'Resumen', onclick: () => { viewing = 'summary'; render(); } }, '★'));
        const pack = m.practice ? L.packById(practice.pack) : null;
        const title = m.practice ? `${pack.icon} ${pack.name}` : (m.archive ? 'Archivo · ' : 'Desafío del ') + dayLabel(m.day);
        const extra = m.practice
            ? h('button', { type: 'button', class: 'cancion-secundario cancion-chico', onclick: () => { showPacks = true; render(); }, text: 'Cambiar paquete' })
            : h('button', { type: 'button', class: 'cancion-secundario cancion-chico', onclick: () => { showArchive = true; loadArchive(); render(); }, text: 'Días anteriores' });
        return h('div', { class: 'cancion-cabecera' },
            h('div', { class: 'cancion-cabecera-fila' }, h('strong', { text: title }), h('span', { class: 'cancion-puntaje', text: `${m.score} pts` })),
            m.archive ? h('p', { class: 'cancion-nota', text: 'Desafío de un día anterior: puedes jugarlo, pero no suma a tu racha.' }) : null,
            h('nav', { class: 'cancion-puntos', 'aria-label': 'Canciones de la partida' }, dots), h('div', { class: 'cancion-cabecera-acciones' }, extra));
    }

    function renderTitle(boxes, playing) {
        return h('div', { class: 'cancion-titulo', 'aria-label': playing ? `Título: ${boxes.map(w => w.filter(b => b.letter).length + ' letras').join(', ')}` : null },
            boxes.map(word => h('span', { class: 'cancion-palabra' }, word.map(box => box.letter
                ? h('span', { class: 'cancion-letra' + (box.hidden ? '' : box.match ? ' cancion-letra-match' : ' cancion-letra-ok'), 'aria-hidden': playing ? 'true' : null, text: box.hidden ? '' : box.ch })
                : h('span', { class: 'cancion-signo', 'aria-hidden': 'true', text: box.ch })))));
    }

    // The six layers of clues, Bandle style: open ones with their value, closed ones with a lock.
    function renderLayers(clues, playing) {
        const c = clues, layer = c.layer;
        const value = (n, open) => {
            if (!open) return null;
            if (n === 1) return `${c.year} · ${L.TIERS[c.tier] || ''}`;
            if (n === 2) return `${L.GENRES[c.genre]} · ${L.LANGS[c.lang]}`;
            if (n === 3) return `${L.flag(c.country)} ${L.COUNTRIES[c.country]} · ${L.KINDS[c.kind]}`;
            if (n === 4) return 'Mira las cajitas del título';
            if (n === 5) return 'Ya aparecen las vocales';
            return c.artist;
        };
        const rows = L.LAYERS.map((name, i) => {
            const n = i + 1, open = n <= layer || !playing;
            return h('li', { class: 'cancion-capa' + (open ? ' cancion-capa-abierta' : '') + (n === layer && playing ? ' cancion-capa-nueva' : '') },
                h('span', { class: 'cancion-capa-n', text: open ? n : '🔒' }),
                h('span', { class: 'cancion-capa-nombre', text: name }),
                h('span', { class: 'cancion-capa-valor', text: open ? value(n, true) || '' : 'Se abre en el paso ' + n }));
        });
        return h('div', { class: 'cancion-pistas-capas' },
            c.title ? renderTitle(c.title, playing) : h('div', { class: 'cancion-titulo cancion-titulo-cerrado', text: '¿Qué canción es?' }),
            h('ol', { class: 'cancion-capas', 'aria-label': 'Pistas' }, rows));
    }

    function stepSquares(slot, max = L.MAX_STEPS) {
        const cells = slot.history.map(item => item.type === 'skip' ? 'skip' : item.type === 'giveup' ? 'skip' : slot.answer && item.id === slot.answer ? 'right' : 'wrong');
        while (cells.length < max) cells.push(cells.length === slot.history.length && slot.state === 'playing' ? 'now' : 'empty');
        return h('div', { class: 'cancion-pasos', 'aria-label': `Paso ${Math.min(slot.step + 1, max)} de ${max}` }, cells.map((c, i) => h('span', { class: 'cancion-paso cancion-paso-' + c, title: 'Paso ' + (i + 1) })));
    }

    function renderSlot(m, index) {
        const slot = m.slots[index], playing = slot.state === 'playing';
        const card = h('section', { class: 'cancion-tarjeta', 'aria-label': `Canción ${index + 1} de ${m.slots.length}` },
            h('div', { class: 'cancion-numero-fila' }, h('p', { class: 'cancion-numero' }, `Canción ${index + 1} de ${m.slots.length}`, playing ? h('span', { class: 'cancion-intentos', text: ` · paso ${slot.step + 1} de 6` }) : null), stepSquares(slot)),
            renderLayers(slot.clues, playing));
        if (playing) card.append(renderSearch(slot.tries.map(t => t.id), {
            onGuess: id => act(index, id), onSkip: slot.step < 5 ? () => act(index, L.SKIP) : null, onGiveUp: () => act(index, L.GIVE_UP), skipText: `Saltar (+ pista ${slot.step + 2})`
        }));
        else card.append(renderResult(m, index));
        if (slot.tries.length) card.append(renderTries(slot.tries.map(t => t), `${tab}:${index}:${slot.step}`));
        return card;
    }

    // Search box with suggestions. opts: { onGuess(id), onSkip?, onGiveUp?, skipText, source?: list, label? }
    function renderSearch(tried, opts) {
        const results = !pick && query.trim() ? (opts.search ? opts.search(query, tried) : L.search(query, 8, tried)) : [];
        const input = h('input', {
            type: 'search', placeholder: opts.placeholder || 'Escribe una canción o artista…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
            'aria-label': 'Busca la canción', role: 'combobox', 'aria-expanded': String(results.length > 0), 'aria-controls': 'cancionOpciones', 'aria-autocomplete': 'list',
            'aria-activedescendant': highlight >= 0 && results[highlight] ? 'cancionOpcion' + highlight : null, enterkeyhint: 'go'
        });
        input.value = query;
        const label = song => song.artists ? [h('strong', { text: song.title }), h('span', { text: artistsText(song) })] : [h('strong', { text: song.title }), h('span', { text: song.by })];
        const choose = song => { pick = song; query = song.title + ' — ' + (song.artists ? artistsText(song) : song.by); highlight = -1; render(); requestAnimationFrame(() => root.querySelector('.cancion-adivinar')?.focus()); };
        const list = h('ul', { id: 'cancionOpciones', class: 'cancion-opciones', role: 'listbox', 'aria-label': 'Canciones' }, results.map((song, i) => h('li', {
            id: 'cancionOpcion' + i, role: 'option', 'aria-selected': String(i === highlight), class: i === highlight ? 'cancion-opcion-activa' : null,
            onmousedown: event => event.preventDefault(), onclick: () => choose(song)
        }, label(song))));
        if (query.trim() && !pick && !results.length) list.append(h('li', { class: 'cancion-sin-resultados', text: 'No está en la lista. Prueba con otra.' }));
        const again = () => root.querySelector('.cancion-buscar input');
        input.addEventListener('input', () => {
            const start = input.selectionStart;
            query = input.value; pick = null; highlight = -1; render();
            const el = again(); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(start, start); } catch { /* search inputs */ } }
        });
        input.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); highlight = (highlight + 1) % results.length; render(); again()?.focus(); }
            else if (event.key === 'ArrowUp' && results.length) { event.preventDefault(); highlight = (highlight - 1 + results.length) % results.length; render(); again()?.focus(); }
            else if (event.key === 'Enter') { event.preventDefault(); if (pick) opts.onGuess(pick.id); else if (results.length) choose(results[Math.max(0, highlight)]); }
            else if (event.key === 'Escape') { query = ''; pick = null; render(); again()?.focus(); }
        });
        const buttons = [h('button', { type: 'submit', class: 'cancion-adivinar', disabled: !pick || busy }, busy ? 'Revisando…' : pick ? 'Adivinar' : 'Elige una canción')];
        if (opts.onSkip) buttons.push(h('button', { type: 'button', class: 'cancion-saltar', disabled: busy, onclick: () => { resetSearch(); opts.onSkip(); } }, opts.skipText || 'Saltar'));
        if (opts.onGiveUp) buttons.push(h('button', {
            type: 'button', class: 'cancion-rendirse' + (armedGiveUp ? ' cancion-rendirse-armado' : ''), disabled: busy,
            onclick: () => { if (!armedGiveUp) { armedGiveUp = true; render(); return; } opts.onGiveUp(); }
        }, armedGiveUp ? '¿Seguro? Toca otra vez' : 'Me rindo'));
        return h('form', { class: 'cancion-buscar', onsubmit: event => { event.preventDefault(); if (pick) opts.onGuess(pick.id); } },
            h('div', { class: 'cancion-campo' }, input, list), h('div', { class: 'cancion-acciones' }, buttons));
    }

    function renderResult(m, index) {
        const slot = m.slots[index], song = L.songById(slot.answer);
        const won = slot.state === 'won';
        const next = m.slots.findIndex((s, i) => i > index && s.state === 'playing');
        const firstOpen = m.slots.findIndex(s => s.state === 'playing');
        const goTo = next >= 0 ? next : firstOpen >= 0 ? firstOpen : 'summary';
        const yt = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(song.title + ' ' + song.artists[0]);
        const step = slot.history.findIndex(x => x.id === slot.answer) + 1;
        return h('div', { class: 'cancion-resultado ' + (won ? 'cancion-resultado-bien' : 'cancion-resultado-mal'), role: 'status' },
            h('p', { class: 'cancion-resultado-titulo', text: won ? (step === 1 ? '¡Al primer paso! 🎯' : `¡La adivinaste en el paso ${step}!`) : 'Esta vez no' }),
            h('p', {}, 'Era ', h('strong', { text: `«${song.title}»` }), ` de ${artistsText(song)} (${song.year}).`),
            h('p', { class: 'cancion-resultado-puntos', text: won ? `+${slot.points} ${slot.points === 1 ? 'punto' : 'puntos'}` : '0 puntos' }),
            h('div', { class: 'cancion-acciones' },
                h('button', { type: 'button', onclick: () => { viewing = goTo; resetSearch(); render(); }, text: goTo === 'summary' ? 'Ver resultado' : 'Siguiente canción' }),
                h('a', { class: 'cancion-escuchar', href: yt, target: '_blank', rel: 'noopener noreferrer', text: 'Escúchala en YouTube ↗' })));
    }

    const CLUE_NAMES = { artist: 'Artista', year: 'Año', country: 'País', genre: 'Género', lang: 'Idioma', kind: 'Intérprete' };
    const STATE_WORDS = { hit: 'igual', near: 'cerca', miss: 'no' };
    const MARK = { hit: '✓', near: '≈', miss: '✕' };
    function renderTries(tries, flipKey) {
        const animate = flipKey === lastFlip && !reduceMotion.matches;
        const items = tries.map((tryItem, n) => {
            const song = L.songById(tryItem.id), c = tryItem.clues;
            const values = {
                artist: [artistsText(song), c.artist],
                year: [song.year + (c.year.dir === 'up' ? ' ↑' : c.year.dir === 'down' ? ' ↓' : ''), c.year.state, c.year.dir === 'up' ? 'es más nueva' : c.year.dir === 'down' ? 'es más antigua' : ''],
                country: [L.flag(song.country) + ' ' + L.COUNTRIES[song.country], c.country],
                genre: [L.GENRES[song.genre], c.genre],
                lang: [L.LANGS[song.lang], c.lang],
                kind: [L.KINDS[song.kind], c.kind]
            };
            const fresh = animate && n === tries.length - 1;
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

    function renderDistribution(dist, title = 'En qué paso las adivinaste') {
        const max = Math.max(1, ...dist);
        return h('figure', { class: 'cancion-dist' }, h('figcaption', { text: title }),
            dist.map((n, i) => h('div', { class: 'cancion-dist-fila' },
                h('span', { class: 'cancion-dist-paso', text: i < 6 ? String(i + 1) : '✕' }),
                h('span', { class: 'cancion-dist-barra' + (i === 6 ? ' cancion-dist-barra-mal' : ''), style: `width:${Math.max(8, Math.round(100 * n / max))}%`, text: n }))));
    }

    function renderSummary(m) {
        const ids = m.practice ? practice.songs : m.slots.map(s => s.answer);
        const rows = ids.map((id, i) => {
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
        if (!m.practice && m.stats && !m.archive) {
            const s = m.stats;
            box.append(h('dl', { class: 'cancion-stats' },
                h('div', {}, h('dt', { text: 'Racha' }), h('dd', { text: `${s.streak} ${s.streak === 1 ? 'día' : 'días'}` })),
                h('div', {}, h('dt', { text: 'Días jugados' }), h('dd', { text: s.days })),
                h('div', {}, h('dt', { text: 'Mejor día' }), h('dd', { text: `${s.best}/60` })),
                h('div', {}, h('dt', { text: 'Mejor racha' }), h('dd', { text: s.best_streak }))));
            if (Array.isArray(s.dist)) box.append(renderDistribution(s.dist, 'Todas tus canciones: en qué paso las adivinaste'));
        } else if (m.dist) box.append(renderDistribution(m.dist));
        const actions = h('div', { class: 'cancion-acciones' });
        if (!m.practice) {
            actions.append(h('button', { type: 'button', onclick: () => share(m), text: 'Compartir resultado' }),
                h('button', { type: 'button', class: 'cancion-secundario', onclick: startTrivia, text: 'Ronda extra 🎁' }),
                h('button', { type: 'button', class: 'cancion-secundario', onclick: () => switchTab('amigos'), text: 'Ver a mis amigos' }));
            box.append(actions, h('p', { class: 'cancion-manana', text: m.archive ? 'Puedes jugar otros días en «Días anteriores».' : 'Mañana hay 10 canciones nuevas. Mientras tanto, prueba los paquetes, la sala en vivo o el modo con audio.' }));
        } else {
            actions.append(h('button', { type: 'button', onclick: () => { newPractice(practice.pack); render(); }, text: 'Otra vez este paquete' }),
                h('button', { type: 'button', class: 'cancion-secundario', onclick: () => { showPacks = true; render(); }, text: 'Elegir otro paquete' }),
                h('button', { type: 'button', class: 'cancion-secundario', onclick: startTrivia, text: 'Ronda extra 🎁' }));
            box.append(actions);
        }
        box.append(h('ol', { class: 'cancion-resumen-lista' }, rows));
        return box;
    }
    const emojiRows = line => { const e = [...(line || '')]; return e.slice(0, 5).join('') + (e.length > 5 ? '\n' + e.slice(5).join('') : ''); };

    async function share(m) {
        const ids = m.slots.map(s => s.answer);
        const detail = m.slots.map((s, i) => L.stepRow(ids[i], s.history.map(x => x.type === 'skip' ? L.SKIP : x.type === 'giveup' ? L.SKIP : x.id))).join('\n');
        const text = `RedMusica · Adivina la canción ${dayLabel(m.day)}\n${m.score}/60 · ${m.solved} de 10\n${detail}\n${SHARE_URL}`;
        try {
            if (navigator.share) { await navigator.share({ text }); return; }
            await navigator.clipboard.writeText(text);
            status('Copiamos tu resultado. Pégalo donde quieras.');
        } catch (error) { if (error?.name !== 'AbortError') status('No se pudo compartir. Copia el resultado a mano.'); }
    }

    function renderArchive() {
        const wrap = h('section', { class: 'cancion-archivo', 'aria-label': 'Días anteriores' },
            h('div', { class: 'cancion-cabecera-fila' }, h('strong', { text: 'Días anteriores' }), h('button', { type: 'button', class: 'cancion-secundario cancion-chico', onclick: () => { showArchive = false; render(); }, text: 'Volver' })),
            h('p', { class: 'cancion-nota', text: 'Juega los desafíos que te perdiste. No suman a tu racha.' }));
        if (!archive) { wrap.append(h('p', { class: 'cancion-cargando', text: 'Cargando…' })); return wrap; }
        const days = [{ day: archive.today, today: true }, ...archive.days];
        wrap.append(h('ul', { class: 'cancion-dias' }, days.map(d => h('li', {}, h('button', {
            type: 'button', class: 'cancion-dia' + (daily?.day === d.day ? ' cancion-dia-actual' : ''),
            onclick: () => { dayWanted = d.today ? null : d.day; showArchive = false; daily = null; viewing = null; loadDaily(); }
        }, h('strong', { text: d.today ? 'Hoy' : dayLabel(d.day) }), h('span', { text: d.today ? 'Desafío del día' : d.finished ? `${d.score}/60` : d.score !== null ? 'Empezado' : 'Sin jugar' }))))));
        if (!archive.days.length) wrap.append(h('p', { class: 'cancion-vacio', text: 'Todavía no hay días anteriores: el juego empezó hoy.' }));
        return wrap;
    }

    function renderPacks() {
        return h('section', { class: 'cancion-paquetes', 'aria-label': 'Paquetes' },
            h('p', { class: 'cancion-nota', text: 'Elige un paquete: 10 canciones, las mismas reglas del desafío, todas las veces que quieras. No suma puntos al perfil.' }),
            h('ul', { class: 'cancion-paquetes-lista' }, L.PACKS.map(p => h('li', {}, h('button', {
                type: 'button', class: 'cancion-paquete' + (practice?.pack === p.id ? ' cancion-paquete-actual' : ''), onclick: () => { newPractice(p.id); render(); }
            }, h('span', { class: 'cancion-paquete-icono', 'aria-hidden': 'true', text: p.icon }), h('strong', { text: p.name }), h('span', { text: L.SONGS.filter(p.filter).length + ' canciones' }))))),
            practice ? h('button', { type: 'button', class: 'cancion-secundario', onclick: () => { showPacks = false; render(); }, text: 'Seguir con la partida actual' }) : null);
    }

    // ---------- bonus round ----------
    function startTrivia() {
        player?.stop();
        trivia = { questions: L.makeTrivia(random, 5), index: 0, score: 0, chosen: null };
        render();
    }
    function renderTrivia() {
        const t = trivia, q = t.questions[t.index];
        const close = h('button', { type: 'button', class: 'cancion-secundario cancion-chico', onclick: () => { trivia = null; render(); }, text: 'Salir' });
        if (!q) return h('section', { class: 'cancion-trivia', 'aria-label': 'Ronda extra' },
            h('div', { class: 'cancion-cabecera-fila' }, h('strong', { text: 'Ronda extra' }), close),
            h('p', { class: 'cancion-resumen-total' }, h('strong', { text: t.score }), ` / ${t.questions.length}`),
            h('div', { class: 'cancion-acciones' }, h('button', { type: 'button', onclick: startTrivia, text: 'Otra ronda' }), h('button', { type: 'button', class: 'cancion-secundario', onclick: () => { trivia = null; render(); }, text: 'Volver al juego' })));
        const answered = t.chosen !== null;
        return h('section', { class: 'cancion-trivia', 'aria-label': 'Ronda extra' },
            h('div', { class: 'cancion-cabecera-fila' }, h('strong', { text: `Ronda extra · ${t.index + 1} de ${t.questions.length}` }), close),
            h('p', { class: 'cancion-trivia-pregunta', text: q.prompt }),
            h('div', { class: 'cancion-trivia-opciones' }, q.options.map(option => h('button', {
                type: 'button', disabled: answered,
                class: 'cancion-trivia-opcion' + (answered && option === q.answer ? ' cancion-trivia-bien' : answered && option === t.chosen ? ' cancion-trivia-mal' : ''),
                onclick: () => { t.chosen = option; if (option === q.answer) { t.score++; vibrate(20); } else vibrate(50); render(); }
            }, option))),
            answered ? h('p', { class: 'cancion-trivia-feedback', role: 'status', text: t.chosen === q.answer ? '¡Correcto!' : `Era: ${q.answer}` }) : null,
            answered ? h('button', { type: 'button', onclick: () => { t.index++; t.chosen = null; render(); }, text: t.index + 1 < t.questions.length ? 'Siguiente pregunta' : 'Ver resultado' }) : null);
    }

    // ---------- live rooms ----------
    async function liveRequest(action, extra = {}) {
        try {
            const result = await request(action, { code: liveCode, ...extra });
            liveError = '';
            if (result.left) { leaveLiveView(); return; }
            showLive(result.room);
            if (['room_join', 'room_start', 'room_guess', 'room_options', 'room_kick'].includes(action)) ping();
        } catch (error) {
            liveError = error.message; status(error.message); vibrate(40);
            if (/No encontramos esa sala|No formas parte/.test(error.message)) leaveLiveView();
            render();
        }
    }
    function showLive(room) {
        const fresh = !live || live.code !== room.code;
        const before = live;
        live = room; liveCode = room.code; status('');
        if (before && before.status === 'playing' && room.status === 'reveal') vibrate(30);
        if (fresh) { subscribe(room.code); try { history.replaceState(null, '', '?seccion=cancion&sala=' + room.code); } catch { /* ignore */ } }
        scheduleLive();
        if (tab === 'vivo') {
            const typing = document.activeElement?.closest?.('.cancion-buscar');
            render();
            if (typing && live.status === 'playing') focusInput();
        }
    }
    function scheduleLive() {
        clearTimeout(liveTimer); clearTimeout(layerTimer);
        if (!live || live.status === 'lobby' || live.status === 'finished') { liveTimer = setTimeout(() => live && liveRequest('room_state'), subscribed ? 8000 : 3000); return; }
        const now = serverNow();
        // Ask the server to move on when the phase ends, and refresh when the next layer opens.
        const wait = Math.max(150, (live.deadline || now) - now + 120);
        liveTimer = setTimeout(() => liveRequest('room_advance'), Math.min(wait, subscribed ? 9000 : 2500));
        if (live.status === 'playing') {
            const step = live.options.seconds * 1000 / 6, nextLayer = live.phaseAt + live.layer * step;
            if (live.layer < 6) layerTimer = setTimeout(() => liveRequest('room_state'), Math.max(100, nextLayer - now + 80));
            tickLive();
        }
    }
    function tickLive() {
        const bar = root.querySelector('.cancion-reloj-barra');
        if (!live || live.status !== 'playing' || !bar) return;
        const total = live.options.seconds * 1000, left = Math.max(0, live.deadline - serverNow());
        bar.style.width = (100 * left / total) + '%';
        const text = root.querySelector('.cancion-reloj-texto'); if (text) text.textContent = Math.ceil(left / 1000) + ' s';
        if (left > 0) requestAnimationFrame(() => setTimeout(tickLive, 200));
    }
    function subscribe(code) {
        if (channel && channelCode === code) return;
        if (channel && db?.removeChannel) db.removeChannel(channel);
        channel = null; channelCode = ''; subscribed = false;
        if (!db?.channel) return;
        channelCode = code;
        channel = db.channel('cancion:' + code, { config: { broadcast: { self: false, ack: false } } });
        channel.on('broadcast', { event: 'changed' }, () => { setTimeout(() => liveRequest('room_state'), 80 + random(250)); })
            .subscribe(state => { subscribed = state === 'SUBSCRIBED'; });
    }
    async function ping() {
        if (!subscribed || !channel) return;
        try { await Promise.race([channel.send({ type: 'broadcast', event: 'changed', payload: { code: liveCode } }), new Promise(r => setTimeout(r, 700))]); } catch { /* polling still works */ }
    }
    function leaveLiveView() {
        clearTimeout(liveTimer); clearTimeout(layerTimer);
        if (channel && db?.removeChannel) db.removeChannel(channel);
        channel = null; channelCode = ''; subscribed = false; live = null; liveCode = '';
        try { if (new URLSearchParams(location.search).get('sala')) history.replaceState(null, '', '?seccion=cancion'); } catch { /* ignore */ }
        render();
    }
    const liveOptionsForm = (current, onSubmit, submitText) => {
        const pack = h('select', { name: 'pack', 'aria-label': 'Paquete' }, L.PACKS.map(p => h('option', { value: p.id, selected: current.pack === p.id, text: `${p.icon} ${p.name}` })));
        const rounds = h('select', { name: 'rounds', 'aria-label': 'Canciones' }, L.LIVE.rounds.map(n => h('option', { value: n, selected: current.rounds === n, text: `${n} canciones` })));
        const seconds = h('select', { name: 'seconds', 'aria-label': 'Tiempo por canción' }, L.LIVE.seconds.map(n => h('option', { value: n, selected: current.seconds === n, text: `${n} s por canción` })));
        return h('form', { class: 'cancion-vivo-opciones', onsubmit: event => { event.preventDefault(); onSubmit({ pack: pack.value, rounds: Number(rounds.value), seconds: Number(seconds.value) }); } },
            h('label', {}, 'Paquete', pack), h('label', {}, 'Largo', rounds), h('label', {}, 'Tiempo', seconds), h('button', { type: 'submit', text: submitText }));
    };
    function renderLive() {
        const wrap = h('section', { class: 'cancion-vivo', 'aria-label': 'Sala en vivo' });
        if (!user) { wrap.append(h('p', { text: 'Inicia sesión para crear una sala o entrar con un código.' })); return wrap; }
        if (!live) {
            const codeInput = h('input', { maxlength: 6, minlength: 6, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABC123', required: true, 'aria-label': 'Código de la sala' });
            wrap.append(
                h('p', { class: 'cancion-nota', text: 'Todos juegan las mismas canciones al mismo tiempo. Las pistas se abren solas con el reloj: mientras antes la adivines, más puntos. Tienes 3 intentos por canción.' }),
                h('h4', { text: 'Crear una sala' }),
                liveOptionsForm({ pack: 'mix', rounds: 10, seconds: 45 }, options => { liveCode = ''; liveRequest('room_create', { options }); }, 'Crear sala'),
                h('h4', { text: '¿Te pasaron un código?' }),
                h('form', { class: 'cancion-unirse', onsubmit: event => { event.preventDefault(); liveCode = codeInput.value.trim().toUpperCase(); liveRequest('room_join'); } }, codeInput, h('button', { type: 'submit', text: 'Entrar' })));
            return wrap;
        }
        const r = live, me = user.id, host = r.host_id === me;
        const invite = async () => {
            const url = SHARE_URL + '&sala=' + r.code;
            try { if (navigator.share) await navigator.share({ text: `¡Juguemos a Adivina la canción en RedMusica! Sala ${r.code}`, url }); else { await navigator.clipboard.writeText(url); status('Copiamos el enlace de la sala.'); } } catch { /* cancelled */ }
        };
        wrap.append(h('div', { class: 'cancion-vivo-barra' },
            h('strong', {}, 'Sala ', h('span', { class: 'cancion-codigo', text: r.code })),
            h('button', { type: 'button', class: 'cancion-chico', onclick: invite, text: 'Invitar' }),
            h('button', { type: 'button', class: 'cancion-secundario cancion-chico', onclick: () => liveRequest('room_leave'), text: 'Salir' })));
        const pack = L.packById(r.options.pack);
        if (r.status === 'lobby' || r.status === 'finished') {
            if (r.status === 'finished') wrap.append(renderPodium(r));
            wrap.append(h('p', { class: 'cancion-nota', text: `${pack.icon} ${pack.name} · ${r.options.rounds} canciones · ${r.options.seconds} s cada una` }));
            if (host) wrap.append(liveOptionsForm(r.options, options => liveRequest('room_options', { options }), 'Guardar opciones'),
                h('button', { type: 'button', class: 'cancion-empezar', disabled: r.players.length < 1, onclick: () => liveRequest('room_start'), text: r.status === 'finished' ? 'Jugar otra vez' : `Empezar (${r.players.length} ${r.players.length === 1 ? 'jugador' : 'jugadores'})` }));
            else wrap.append(h('p', { class: 'cancion-espera', text: `Esperando que ${r.players.find(p => p.user_id === r.host_id)?.username || 'el anfitrión'} empiece…` }));
            wrap.append(renderLivePlayers(r, host));
            return wrap;
        }
        if (r.status === 'countdown') {
            wrap.append(h('div', { class: 'cancion-cuenta', role: 'status' }, h('p', { text: '¡Prepárate!' }), h('strong', { text: Math.max(1, Math.ceil((r.deadline - serverNow()) / 1000)) })));
            setTimeout(() => { if (live?.status === 'countdown' && tab === 'vivo') render(); }, 500);
            wrap.append(renderLivePlayers(r, false));
            return wrap;
        }
        const solvedMe = r.players.find(p => p.user_id === me)?.solved;
        wrap.append(h('div', { class: 'cancion-numero-fila' }, h('p', { class: 'cancion-numero', text: `Canción ${r.round + 1} de ${r.rounds}` }),
            r.status === 'playing' ? h('span', { class: 'cancion-reloj' }, h('span', { class: 'cancion-reloj-barra' }), h('span', { class: 'cancion-reloj-texto' })) : null));
        if (r.clues) wrap.append(renderLayers(r.clues, r.status === 'playing'));
        if (r.status === 'playing') {
            if (solvedMe) wrap.append(h('p', { class: 'cancion-resultado cancion-resultado-bien', role: 'status', text: `¡La adivinaste en la pista ${solvedMe.layer}! +${solvedMe.points} puntos. Espera a los demás…` }));
            else if (r.mine.length >= L.LIVE.tries) wrap.append(h('p', { class: 'cancion-resultado cancion-resultado-mal', text: 'Usaste tus 3 intentos. Espera la siguiente canción.' }));
            else wrap.append(renderSearch(r.mine.map(t => t.id), { onGuess: id => { resetSearch(); liveRequest('room_guess', { song: id }); }, placeholder: `Intento ${r.mine.length + 1} de 3: escribe una canción…` }));
            if (r.mine.length) wrap.append(renderTries(r.mine, `vivo:${r.round}:${r.mine.length}`));
        } else if (r.status === 'reveal' && r.answer) {
            const song = L.songById(r.answer);
            wrap.append(h('div', { class: 'cancion-resultado ' + (solvedMe ? 'cancion-resultado-bien' : 'cancion-resultado-mal'), role: 'status' },
                h('p', {}, 'Era ', h('strong', { text: `«${song.title}»` }), ` de ${artistsText(song)} (${song.year}).`),
                h('p', { class: 'cancion-resultado-puntos', text: solvedMe ? `+${solvedMe.points} puntos` : 'Esta vez no' })));
        }
        wrap.append(renderLivePlayers(r, false));
        requestAnimationFrame(tickLive);
        return wrap;
    }
    function renderLivePlayers(r, canKick) {
        const sorted = [...r.players].sort((a, b) => b.score - a.score);
        return h('ol', { class: 'cancion-tabla cancion-vivo-jugadores', 'aria-label': 'Jugadores' }, sorted.map((p, i) => h('li', { class: p.user_id === user.id ? 'cancion-tabla-yo' : null },
            h('span', { class: 'cancion-tabla-pos', text: i + 1 }),
            h('span', { class: 'cancion-tabla-nombre', text: p.username + (p.user_id === r.host_id ? ' ★' : '') + (p.user_id === user.id ? ' (tú)' : '') }),
            h('span', { class: 'cancion-tabla-linea', text: r.status === 'playing' ? (p.solved ? `✓ pista ${p.solved.layer}` : p.tries ? '✕'.repeat(p.tries) : '…') : r.status === 'reveal' ? (p.solved ? `+${p.solved.points}` : '—') : '' }),
            h('span', { class: 'cancion-tabla-pts' }, `${p.score} pts`, canKick && p.user_id !== user.id ? h('button', { type: 'button', class: 'cancion-quitar', 'aria-label': 'Sacar a ' + p.username, onclick: () => liveRequest('room_kick', { user_id: p.user_id }), text: '✕' }) : null))));
    }
    function renderPodium(r) {
        const sorted = [...r.players].sort((a, b) => b.score - a.score);
        const medal = ['🥇', '🥈', '🥉'];
        return h('section', { class: 'cancion-podio', 'aria-label': 'Resultado de la partida' },
            h('p', { class: 'cancion-resultado-titulo', text: sorted[0]?.user_id === user.id ? '¡Ganaste! 🏆' : `Ganó ${sorted[0]?.username || ''}` }),
            h('ol', {}, sorted.slice(0, 3).map((p, i) => h('li', {}, h('span', { text: medal[i] }), h('strong', { text: p.username }), h('span', { text: `${p.score} pts` })))),
            h('details', {}, h('summary', { text: 'Canciones de la partida' }), h('ol', { class: 'cancion-resumen-lista' }, r.history.map(x => {
                const song = L.songById(x.song);
                return h('li', { class: 'cancion-vivo-historia' }, h('strong', { text: song.title }), ` · ${artistsText(song)} `, h('span', { text: x.mine ? `+${x.mine.points}` : '—' }));
            }))));
    }

    // ---------- audio mode (public domain, synthesized) ----------
    function newAudio() {
        const ids = A.PIECES.map(p => p.id);
        for (let i = ids.length - 1; i > 0; i--) { const j = random(i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
        audio = { pieces: ids.slice(0, 5), actions: [[], [], [], [], []], index: 0, playingLayer: 0 };
    }
    function audioSlot(i) {
        const id = audio.pieces[i], actions = audio.actions[i];
        const won = actions.includes(id), lost = !won && (actions.includes('giveup') || actions.length >= 6);
        return { id, actions, state: won ? 'won' : lost ? 'lost' : 'playing', layer: won || lost ? 6 : Math.min(6, actions.length + 1), points: won ? 6 - actions.indexOf(id) : 0 };
    }
    function audioAct(i, value) {
        const s = audioSlot(i);
        if (s.state !== 'playing') return;
        if (value !== 'skip' && value !== 'giveup' && s.actions.includes(value)) { status('Ya probaste con esa.'); return; }
        audio.actions[i].push(value);
        resetSearch(); armedGiveUp = false; status('');
        const after = audioSlot(i);
        if (after.state === 'won') vibrate([20, 40, 20]);
        render();
        if (after.state === 'playing') playLayer(i);
    }
    function playLayer(i) {
        const s = audioSlot(i), piece = A.pieceById(s.id);
        audio.playingLayer = s.layer;
        try { player.play(piece, s.layer, () => { audio.playingLayer = 0; if (tab === 'audio') render(); }); } catch { status('Tu navegador no pudo reproducir el audio.'); }
        render();
    }
    function renderAudio() {
        const wrap = h('section', { class: 'cancion-audio', 'aria-label': 'Clásicos por capas' });
        if (!A) { wrap.append(h('p', { class: 'cancion-cargando', text: 'Cargando instrumentos…' })); loadAudio(); return wrap; }
        if (!audio) newAudio();
        const slots = audio.pieces.map((_, i) => audioSlot(i));
        const total = slots.reduce((sum, s) => sum + s.points, 0), done = slots.every(s => s.state !== 'playing');
        wrap.append(h('p', { class: 'cancion-nota', text: 'Como Bandle, pero con música de dominio público (clásicos y canciones tradicionales). Escucha: cada paso suma un instrumento. Los arreglos son propios y suenan con un sintetizador en tu navegador.' }),
            h('div', { class: 'cancion-cabecera-fila' }, h('strong', { text: 'Clásicos por capas' }), h('span', { class: 'cancion-puntaje', text: `${total} pts` })),
            h('nav', { class: 'cancion-puntos', 'aria-label': 'Piezas' }, slots.map((s, i) => h('button', { type: 'button', class: `cancion-punto cancion-punto-${s.state}` + (i === audio.index ? ' cancion-punto-actual' : ''), onclick: () => { player.stop(); audio.index = i; resetSearch(); render(); } }, String(i + 1)))));
        if (audio.index === 'summary' || (done && audio.index === null)) {
            wrap.append(h('div', { class: 'cancion-resumen' }, h('p', { class: 'cancion-resumen-total' }, h('strong', { text: total }), ' / 30 puntos'),
                h('ol', { class: 'cancion-resumen-lista' }, slots.map(s => { const p = A.pieceById(s.id); return h('li', { class: 'cancion-vivo-historia' }, h('strong', { text: p.title }), ` · ${p.by} (${p.year}) `, h('span', { text: s.points ? `+${s.points}` : '0' })); })),
                h('button', { type: 'button', onclick: () => { newAudio(); render(); }, text: 'Otra ronda' })));
            return wrap;
        }
        const i = audio.index, s = slots[i], piece = A.pieceById(s.id), playing = s.state === 'playing';
        const squares = h('div', { class: 'cancion-pasos' }, Array.from({ length: 6 }, (_, k) => {
            const a = s.actions[k];
            const cls = a === undefined ? (k === s.actions.length && playing ? 'now' : 'empty') : a === s.id ? 'right' : a === 'skip' || a === 'giveup' ? 'skip' : 'wrong';
            return h('span', { class: 'cancion-paso cancion-paso-' + cls });
        }));
        wrap.append(h('div', { class: 'cancion-numero-fila' }, h('p', { class: 'cancion-numero', text: `Pieza ${i + 1} de 5` + (playing ? ` · paso ${s.actions.length + 1} de 6` : '') }), squares));
        wrap.append(h('ol', { class: 'cancion-capas cancion-capas-audio' }, A.LAYER_NAMES.map((name, k) => h('li', { class: 'cancion-capa' + (k < s.layer ? ' cancion-capa-abierta' : '') },
            h('span', { class: 'cancion-capa-n', text: k < s.layer ? k + 1 : '🔒' }), h('span', { class: 'cancion-capa-nombre', text: name }),
            h('span', { class: 'cancion-capa-valor', text: k === 0 ? `Época: ${piece.year < 1800 ? 'antes de 1800' : 'siglo ' + (piece.year < 1900 ? 'XIX' : 'XX')}` : k === 5 && s.layer >= 6 ? `Autor: ${piece.by}` : '' })))));
        const listening = audio.playingLayer > 0;
        wrap.append(h('button', { type: 'button', class: 'cancion-escuchar-boton' + (listening ? ' cancion-sonando' : ''), onclick: () => listening ? (player.stop(), audio.playingLayer = 0, render()) : playLayer(i) },
            listening ? '■ Detener' : `▶ Escuchar ${s.layer === 1 ? 'la batería' : `con ${s.layer} instrumentos`}`));
        if (playing) {
            wrap.append(renderSearch(s.actions.filter(a => typeof a === 'string' && A.pieceById(a)), {
                onGuess: id => audioAct(i, id), onSkip: s.actions.length < 5 ? () => audioAct(i, 'skip') : null, onGiveUp: () => audioAct(i, 'giveup'),
                skipText: 'Saltar (+ instrumento)', placeholder: 'Escribe el nombre de la pieza…',
                search: (text, tried) => { const w = L.fold(text).split(/[^a-z0-9]+/).filter(Boolean); return A.PIECES.filter(p => !tried.includes(p.id) && w.every(x => L.fold(p.title + ' ' + p.by).includes(x))).slice(0, 8); }
            }));
            const wrongs = s.actions.filter(a => a !== 'skip' && a !== 'giveup');
            if (wrongs.length) wrap.append(h('p', { class: 'cancion-nota', text: 'Probaste: ' + wrongs.map(a => A.pieceById(a).title).join(', ') }));
        } else {
            const next = slots.findIndex((x, k) => k > i && x.state === 'playing');
            wrap.append(h('div', { class: 'cancion-resultado ' + (s.state === 'won' ? 'cancion-resultado-bien' : 'cancion-resultado-mal'), role: 'status' },
                h('p', { class: 'cancion-resultado-titulo', text: s.state === 'won' ? `¡Bien! +${s.points}` : 'Esta vez no' }),
                h('p', {}, 'Era ', h('strong', { text: `«${piece.title}»` }), ` · ${piece.by} (${piece.year}).`),
                h('div', { class: 'cancion-acciones' }, h('button', { type: 'button', onclick: () => { player.stop(); audio.index = next >= 0 ? next : (slots.every(x => x.state !== 'playing') ? 'summary' : slots.findIndex(x => x.state === 'playing')); render(); }, text: next >= 0 || slots.some(x => x.state === 'playing') ? 'Siguiente pieza' : 'Ver resultado' }))));
        }
        return wrap;
    }
    function loadAudio() {
        if (loadAudio.started) return;
        loadAudio.started = true;
        import(AUDIO_URL).then(module => { A = module; player = A.createPlayer(); render(); }).catch(() => { loadAudio.started = false; status('No se pudo cargar el modo con audio.'); });
    }

    // ---------- friends ----------
    function renderFriends() {
        const wrap = h('section', { class: 'cancion-amigos', 'aria-label': 'Resultados de tus amigos hoy' });
        if (!user) { wrap.append(h('p', { text: 'Inicia sesión para ver cómo les va a tus amigos.' })); return wrap; }
        if (!friends) { wrap.append(h('p', { class: 'cancion-cargando', text: 'Cargando…' })); return wrap; }
        wrap.append(h('div', { class: 'cancion-cabecera-fila' }, h('strong', { text: 'Hoy, ' + dayLabel(friends.day) }), h('button', { type: 'button', class: 'cancion-secundario cancion-chico', onclick: loadFriends, text: 'Actualizar' })));
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
    // Only talk to the server while the section is on screen (opening it is what starts the day's game).
    const section = $('seccionCancion');
    const visible = () => !section || !section.hidden;
    function wake() {
        if (!L || !user || !visible()) return;
        if (tab === 'dia' && !daily) loadDaily();
        else if (tab === 'amigos' && !friends) loadFriends();
        else if (tab === 'vivo' && liveCode && !live) liveRequest('room_join');
    }
    if (section) new MutationObserver(() => { if (!visible()) player?.stop(); wake(); }).observe(section, { attributes: true, attributeFilter: ['hidden'] });
    function switchTab(name) {
        tab = name; viewing = null; resetSearch(); armedGiveUp = false; status(''); trivia = null; showArchive = false;
        if (name === 'amigos') friends = null;
        if (name === 'audio') loadAudio();
        render(); wake();
    }
    for (const [name, id] of TABS) $(id)?.addEventListener('click', () => switchTab(name));
    root.querySelector('.cancion-pestanas').addEventListener('keydown', event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const i = TABS.findIndex(([name]) => name === tab);
        const [next, id] = TABS[(i + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        switchTab(next); $(id).focus();
    });
    function setUser(next) {
        const changed = (next?.id || '') !== (user?.id || '');
        user = next;
        if (changed) { daily = null; friends = null; archive = null; if (live) leaveLiveView(); wake(); }
        render();
    }
    // Reload the daily game when coming back after midnight; refresh the room when the tab returns.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        if (daily && L && !daily.archive && L.chileDay() !== daily.day && tab === 'dia') { daily = null; viewing = null; wake(); }
        if (live) liveRequest('room_state');
    });

    const params = new URLSearchParams(location.search);
    const invited = (params.get('sala') || '').toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(invited)) { liveCode = invited; tab = 'vivo'; }
    import(LOGIC_URL).then(module => {
        L = module; loadPractice();
        if (params.get('modo') === 'practica' || !db) tab = liveCode ? 'vivo' : 'practica';
        if (params.get('modo') === 'audio') { tab = 'audio'; loadAudio(); }
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
            const { data, error } = await db.from('song_stats').select('days,best,streak,best_streak,live_games,live_wins').eq('user_id', id).maybeSingle();
            if (error || !data || (!data.days && !data.live_games) || id !== current) return;
            const parts = [];
            if (data.days) parts.push(`${data.days} ${data.days === 1 ? 'día' : 'días'} · mejor día ${data.best}/60 · mejor racha ${data.best_streak}`);
            if (data.live_games) parts.push(`en vivo ${data.live_wins} ${data.live_wins === 1 ? 'victoria' : 'victorias'} de ${data.live_games}`);
            line.textContent = 'Adivina la canción: ' + parts.join(' · ');
            line.hidden = false;
        };
        new MutationObserver(load).observe(presence, { attributes: true, attributeFilter: ['data-user-id'] });
        load();
    }
})();
