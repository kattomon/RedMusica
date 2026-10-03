// "Clásicos por capas": the Bandle-style audio mode of "Adivina la canción".
// Only public-domain music (traditional songs and works published before 1929). The arrangements are
// written here as notes and played by a small synthesizer in the browser: no recordings are used.
// Layers: 1 drums, 2 + bass, 3 + chords, 4 + arpeggio, 5 + melody, 6 + melody and a written hint.

// Notes: "E4:1" = E in octave 4 for one beat; "R:2" = rest for two beats; "C#5:0.5", "Bb3:1.5".
// Chords: one per bar ("C"), or with beats ("G:2 C:2"); "N" = no chord.
export const PIECES = Object.freeze([
  { id: 'alegria', title: 'Himno de la alegría', by: 'Ludwig van Beethoven', year: 1824, meter: 4, tempo: 116, style: 'pop',
    melody: 'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 E4:1.5 D4:0.5 D4:2 E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 D4:1.5 C4:0.5 C4:2',
    chords: 'C G C G C G C G:2_C:2' },
  { id: 'elisa', title: 'Para Elisa', by: 'Ludwig van Beethoven', year: 1810, meter: 3, tempo: 132, style: 'soft',
    melody: 'R:2 E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:1 R:0.5 C4:0.5 E4:0.5 A4:0.5 B4:1 R:0.5 E4:0.5 G#4:0.5 B4:0.5 C5:1 R:0.5 E4:0.5 E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:1 R:0.5 C4:0.5 E4:0.5 A4:0.5 B4:1 R:0.5 E4:0.5 C5:0.5 B4:0.5 A4:3',
    chords: 'N Am Am E Am Am Am E Am' },
  { id: 'estrellita', title: 'Estrellita, ¿dónde estás?', by: 'Canción tradicional francesa', year: 1761, meter: 4, tempo: 108, style: 'pop',
    melody: 'C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2',
    chords: 'C F:2_C:2 F:2_C:2 G:2_C:2 C:2_F:2 C:2_G:2 C:2_F:2 C:2_G:2 C F:2_C:2 F:2_C:2 G:2_C:2' },
  { id: 'cumple', title: 'Cumpleaños feliz', by: 'Mildred y Patty Hill', year: 1893, meter: 3, tempo: 100, style: 'waltz',
    melody: 'R:2 G4:0.75 G4:0.25 A4:1 G4:1 C5:1 B4:2 G4:0.75 G4:0.25 A4:1 G4:1 D5:1 C5:2 G4:0.75 G4:0.25 G5:1 E5:1 C5:1 B4:1 A4:1 F5:0.75 F5:0.25 E5:1 C5:1 D5:1 C5:3',
    chords: 'N C G G C C F C:2_G:1 C' },
  { id: 'jingle', title: 'Jingle Bells', by: 'James Lord Pierpont', year: 1857, meter: 4, tempo: 132, style: 'pop',
    melody: 'E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:0.5 E4:4 F4:1 F4:1 F4:1.5 F4:0.5 F4:1 E4:1 E4:1 E4:0.5 E4:0.5 E4:1 D4:1 D4:1 E4:1 D4:2 G4:2',
    chords: 'C C C C F C D7 G' },
  { id: 'cucaracha', title: 'La cucaracha', by: 'Canción tradicional mexicana', year: 1900, meter: 4, tempo: 126, style: 'latin',
    melody: 'R:3 C4:0.333 C4:0.333 C4:0.334 F4:1 A4:2 C4:0.333 C4:0.333 C4:0.334 F4:1 A4:2 R:1 F4:0.5 F4:0.5 E4:0.5 E4:0.5 D4:0.5 D4:0.5 C4:1 R:3 C4:0.333 C4:0.333 C4:0.334 E4:1 G4:2 C4:0.333 C4:0.333 C4:0.334 E4:1 G4:2 R:1 C5:0.5 D5:0.5 C5:0.5 Bb4:0.5 A4:0.5 G4:0.5 F4:1',
    chords: 'N F F F:2_C7:2 C7 C7 C7 C7:2_F:2' },
  { id: 'martinillo', title: 'Martinillo (Frère Jacques)', by: 'Canción tradicional francesa', year: 1780, meter: 4, tempo: 112, style: 'pop',
    melody: 'C4:1 D4:1 E4:1 C4:1 C4:1 D4:1 E4:1 C4:1 E4:1 F4:1 G4:2 E4:1 F4:1 G4:2 G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:1 C4:1 G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:1 C4:1 C4:1 G3:1 C4:2 C4:1 G3:1 C4:2',
    chords: 'C C C C C C C:2_G:2 C' },
  { id: 'cuna', title: 'Canción de cuna', by: 'Johannes Brahms', year: 1868, meter: 3, tempo: 92, style: 'soft',
    melody: 'R:2 E4:0.5 E4:0.5 G4:2 E4:0.5 E4:0.5 G4:2 E4:0.5 G4:0.5 C5:1 B4:1.5 A4:0.5 A4:1 G4:1 D4:0.5 E4:0.5 F4:1 D4:1 D4:0.5 E4:0.5 F4:2 D4:0.5 F4:0.5 B4:0.5 A4:0.5 G4:1 B4:1 C5:3',
    chords: 'C C C C C:2_G:1 G G G7 C' },
  { id: 'serenata', title: 'Pequeña serenata nocturna', by: 'Wolfgang Amadeus Mozart', year: 1787, meter: 4, tempo: 126, style: 'classical',
    melody: 'G4:1 R:0.5 D4:0.5 G4:1 R:0.5 D4:0.5 G4:0.5 D4:0.5 G4:0.5 B4:0.5 D5:2 C5:1 R:0.5 A4:0.5 C5:1 R:0.5 A4:0.5 C5:0.5 A4:0.5 F#4:0.5 A4:0.5 D4:2 G4:1 R:0.5 D4:0.5 G4:1 R:0.5 D4:0.5 G4:0.5 D4:0.5 G4:0.5 B4:0.5 D5:2 C5:1 R:0.5 A4:0.5 C5:1 R:0.5 A4:0.5 C5:0.5 A4:0.5 F#4:0.5 A4:0.5 G4:2',
    chords: 'G G D D G G D D:2_G:2' },
  { id: 'gruta', title: 'En la gruta del rey de la montaña', by: 'Edvard Grieg', year: 1875, meter: 4, tempo: 116, style: 'march',
    melody: 'A3:0.5 B3:0.5 C4:0.5 D4:0.5 E4:0.5 C4:0.5 E4:1 D#4:0.5 B3:0.5 D#4:1 D4:0.5 A#3:0.5 D4:1 A3:0.5 B3:0.5 C4:0.5 D4:0.5 E4:0.5 C4:0.5 E4:0.5 A4:0.5 G4:0.5 E4:0.5 C4:0.5 E4:0.5 G4:2',
    chords: 'Am B:2_Bb:2 Am C:2_G:2' },
  { id: 'danubio', title: 'El Danubio azul', by: 'Johann Strauss (hijo)', year: 1866, meter: 3, tempo: 168, style: 'waltz',
    melody: 'R:2 D4:1 D4:1 F#4:1 A4:1 A4:3 R:1 A5:1 A5:1 R:1 F#5:1 F#5:1 D4:1 F#4:1 A4:1 A4:3 R:1 A5:1 A5:1 R:1 G5:1 G5:1',
    chords: 'N D D D D D D A7 A7' },
  { id: 'turca', title: 'Marcha turca', by: 'Wolfgang Amadeus Mozart', year: 1783, meter: 2, tempo: 112, style: 'classical',
    melody: 'B4:0.25 A4:0.25 G#4:0.25 A4:0.25 C5:1 D5:0.25 C5:0.25 B4:0.25 C5:0.25 E5:1 F5:0.25 E5:0.25 D#5:0.25 E5:0.25 B5:0.25 A5:0.25 G#5:0.25 A5:0.25 B5:0.25 A5:0.25 G#5:0.25 A5:0.25 C6:1 A5:0.5 C6:0.5 B5:0.5 A5:0.5 G5:0.5 A5:0.5 B5:0.5 A5:0.5 G5:0.5 A5:0.5 B5:0.5 A5:0.5 G5:0.5 F#5:0.5 E5:1',
    chords: 'Am Am Am Am Am:1_E:1 Am:1_E:1 Em Am' },
  { id: 'habanera', title: 'Habanera de «Carmen»', by: 'Georges Bizet', year: 1875, meter: 2, tempo: 72, style: 'latin',
    melody: 'D5:0.75 C#5:0.25 C5:0.5 C5:0.5 B4:0.75 Bb4:0.25 A4:0.5 A4:0.5 Ab4:0.75 G4:0.25 F#4:0.5 F4:0.25 F4:0.25 E4:0.5 F4:0.25 E4:0.25 D4:1',
    chords: 'Dm Dm A7 Dm' },
  { id: 'greensleeves', title: 'Greensleeves', by: 'Canción tradicional inglesa', year: 1580, meter: 3, tempo: 120, style: 'soft',
    melody: 'R:2 A4:1 C5:2 D5:1 E5:1.5 F5:0.5 E5:1 D5:2 B4:1 G4:1.5 A4:0.5 B4:1 C5:2 A4:1 A4:1.5 G#4:0.5 A4:1 B4:2 G#4:1 E4:2 A4:1 C5:2 D5:1 E5:1.5 F5:0.5 E5:1 D5:2 B4:1 G4:1.5 A4:0.5 B4:1 C5:1.5 B4:0.5 A4:1 G#4:1.5 F#4:0.5 G#4:1 A4:3',
    chords: 'Am Am C G Em Am Am E E Am C G Em Am:2_E:1 E Am' },
  { id: 'despedida', title: 'Canción de la despedida (Auld Lang Syne)', by: 'Canción tradicional escocesa', year: 1788, meter: 4, tempo: 92, style: 'soft',
    melody: 'R:3 G4:1 C5:1.5 C5:0.5 C5:1 E5:1 D5:1.5 C5:0.5 D5:1 E5:0.5 D5:0.5 C5:1.5 C5:0.5 E5:1 G5:1 A5:3 A5:1 G5:1.5 E5:0.5 E5:1 C5:1 D5:1.5 C5:0.5 D5:1 E5:0.5 D5:0.5 C5:1.5 A4:0.5 A4:1 G4:1 C5:3 R:1',
    chords: 'N C G C F C G F:2_G:2 C' },
  { id: 'susana', title: 'Oh! Susana', by: 'Stephen Foster', year: 1848, meter: 4, tempo: 120, style: 'country',
    melody: 'R:3 C4:0.5 D4:0.5 E4:1 G4:1 G4:1.5 A4:0.5 G4:1 E4:1 C4:1.5 D4:0.5 E4:1 E4:1 D4:1 C4:1 D4:3 C4:0.5 D4:0.5 E4:1 G4:1 G4:1.5 A4:0.5 G4:1 E4:1 C4:1.5 D4:0.5 E4:1 E4:1 D4:1 D4:1 C4:4',
    chords: 'N C C C G C C G C' },
  { id: 'nochepaz', title: 'Noche de paz', by: 'Franz Gruber', year: 1818, meter: 3, tempo: 84, style: 'soft',
    melody: 'G4:1.5 A4:0.5 G4:1 E4:3 G4:1.5 A4:0.5 G4:1 E4:3 D5:2 D5:1 B4:3 C5:2 C5:1 G4:3 A4:2 A4:1 C5:1.5 B4:0.5 A4:1 G4:1.5 A4:0.5 G4:1 E4:3',
    chords: 'C C C C G G C C F F C C' },
  { id: 'gracia', title: 'Sublime gracia (Amazing Grace)', by: 'Melodía tradicional «New Britain»', year: 1835, meter: 3, tempo: 84, style: 'soft',
    melody: 'R:2 G4:1 C5:2 E5:0.5 C5:0.5 E5:2 D5:1 C5:2 A4:1 G4:2 G4:1 C5:2 E5:0.5 C5:0.5 E5:2 D5:1 G5:3',
    chords: 'N C C F C C C G' },
  { id: 'santos', title: 'When the Saints Go Marching In', by: 'Canción tradicional estadounidense', year: 1896, meter: 4, tempo: 138, style: 'march',
    melody: 'R:1 C4:1 E4:1 F4:1 G4:4 R:1 C4:1 E4:1 F4:1 G4:4 R:1 C4:1 E4:1 F4:1 G4:2 E4:2 C4:2 E4:2 D4:4',
    chords: 'C C C C C C C G' },
  { id: 'canon', title: 'Canon en re', by: 'Johann Pachelbel', year: 1700, meter: 4, tempo: 66, style: 'soft',
    melody: 'F#5:2 E5:2 D5:2 C#5:2 B4:2 A4:2 B4:2 C#5:2 F#5:2 E5:2 D5:2 C#5:2 B4:2 A4:2 B4:2 C#5:2',
    chords: 'D:2_A:2 Bm:2_F#m:2 G:2_D:2 G:2_A:2 D:2_A:2 Bm:2_F#m:2 G:2_D:2 G:2_A:2' },
  { id: 'granja', title: 'Old MacDonald (En la granja de mi tío)', by: 'Canción tradicional', year: 1917, meter: 4, tempo: 120, style: 'country',
    melody: 'G4:1 G4:1 G4:1 D4:1 E4:1 E4:1 D4:2 B4:1 B4:1 A4:1 A4:1 G4:3 D4:1 G4:1 G4:1 G4:1 D4:1 E4:1 E4:1 D4:2 B4:1 B4:1 A4:1 A4:1 G4:4',
    chords: 'G C:2_G:2 G:2_D:2 G G C:2_G:2 G:2_D:2 G' },
  { id: 'corderito', title: 'Mary Had a Little Lamb', by: 'Lowell Mason', year: 1830, meter: 4, tempo: 120, style: 'pop',
    melody: 'E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:2 D4:1 D4:1 D4:2 E4:1 G4:1 G4:2 E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:1 E4:1 D4:1 D4:1 E4:1 D4:1 C4:4',
    chords: 'C C G C C C G C' },
  { id: 'puente', title: 'El puente de Londres', by: 'Canción tradicional inglesa', year: 1744, meter: 4, tempo: 120, style: 'pop',
    melody: 'G4:1.5 A4:0.5 G4:1 F4:1 E4:1 F4:1 G4:2 D4:1 E4:1 F4:2 E4:1 F4:1 G4:2 G4:1.5 A4:0.5 G4:1 F4:1 E4:1 F4:1 G4:2 D4:2 G4:2 E4:1 C4:3',
    chords: 'C C G C C C G C' }
]);

export const LAYER_NAMES = Object.freeze(['Batería', '+ Bajo', '+ Acordes', '+ Arpegio', '+ Melodía', '+ Melodía y pista']);
export const pieceById = id => PIECES.find(p => p.id === id) || null;

// ---------- parsing ----------
const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midi(note) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(note);
  if (!m) throw new Error('nota ' + note);
  return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
/** [{ midi|null, start, beats }] */
export function parseMelody(text) {
  let t = 0;
  return text.trim().split(/\s+/).map(token => {
    const [note, len] = token.split(':');
    const beats = Number(len);
    const ev = { midi: note === 'R' ? null : midi(note), start: t, beats };
    t += beats;
    return ev;
  });
}
const QUALITY = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10] };
export function chordNotes(name) {
  if (name === 'N') return [];
  const m = /^([A-G])(#|b)?(m7|m|7)?$/.exec(name);
  if (!m) throw new Error('acorde ' + name);
  const root = NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return QUALITY[m[3] || ''].map(i => root + i);
}
/** [{ notes (pitch classes), start, beats }] — bars separated by spaces, parts of a bar by "_". */
export function parseChords(text, meter) {
  let t = 0;
  const out = [];
  for (const bar of text.trim().split(/\s+/)) {
    for (const part of bar.split('_')) {
      const [name, len] = part.split(':');
      const beats = len ? Number(len) : meter;
      out.push({ name, notes: chordNotes(name), start: t, beats });
      t += beats;
    }
  }
  return out;
}
export function pieceLength(piece) {
  const melody = parseMelody(piece.melody), chords = parseChords(piece.chords, piece.meter);
  const end = Math.max(melody.at(-1).start + melody.at(-1).beats, chords.at(-1).start + chords.at(-1).beats);
  return Math.ceil(end / piece.meter) * piece.meter;
}

// ---------- synthesizer ----------
const hz = n => 440 * Math.pow(2, (n - 69) / 12);
export function createPlayer() {
  let ctx = null, master = null, noise = null, playing = [], endTimer = null;
  function setup() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createDynamicsCompressor();
    const gain = ctx.createGain(); gain.gain.value = 0.9;
    master.connect(gain); gain.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const track = node => { playing.push(node); return node; };
  function env(gain, t, attack, peak, release, end) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.setValueAtTime(peak, Math.max(t + attack, end - release));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
  }
  function tone(freq, t, dur, { type = 'triangle', peak = 0.2, attack = 0.01, release = 0.08, filter = 0, vibrato = 0 } = {}) {
    const osc = track(ctx.createOscillator()), g = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (vibrato) { const lfo = track(ctx.createOscillator()), depth = ctx.createGain(); lfo.frequency.value = 5.5; depth.gain.value = freq * vibrato; lfo.connect(depth); depth.connect(osc.frequency); lfo.start(t); lfo.stop(t + dur + 0.1); }
    let last = osc;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; osc.connect(f); last = f; }
    last.connect(g); g.connect(master);
    env(g, t, attack, peak, release, t + dur);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function hit(t, kind, level = 1) {
    if (kind === 'kick') {
      const osc = track(ctx.createOscillator()), g = ctx.createGain();
      osc.frequency.setValueAtTime(140, t); osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      osc.connect(g); g.connect(master); env(g, t, 0.003, 0.8 * level, 0.1, t + 0.18); osc.start(t); osc.stop(t + 0.2);
      return;
    }
    const src = track(ctx.createBufferSource()), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise;
    f.type = kind === 'snare' ? 'bandpass' : 'highpass'; f.frequency.value = kind === 'snare' ? 1800 : 7000;
    src.connect(f); f.connect(g); g.connect(master);
    const len = kind === 'snare' ? 0.16 : 0.05;
    env(g, t, 0.002, (kind === 'snare' ? 0.35 : 0.12) * level, len * 0.8, t + len);
    src.start(t); src.stop(t + len + 0.02);
  }
  function drums(piece, start, beat, bars) {
    const m = piece.meter, soft = piece.style === 'soft';
    for (let b = 0; b < bars; b++) {
      const t0 = start + b * m * beat;
      for (let i = 0; i < m * 2; i++) {
        const t = t0 + i * beat / 2, onBeat = i % 2 === 0, n = i / 2;
        if (soft) { if (onBeat) hit(t, 'hat', n === 0 ? 0.9 : 0.5); if (n === 0 && onBeat) hit(t, 'kick', 0.45); continue; }
        hit(t, 'hat', onBeat ? 0.8 : 0.45);
        if (!onBeat) continue;
        if (m === 3) { if (n === 0) hit(t, 'kick'); else hit(t, 'snare', 0.45); }
        else if (piece.style === 'latin') { if (n === 0 || (m === 4 && n === 2)) hit(t, 'kick'); if (n === 1 || n === 3) hit(t, 'snare', 0.6); if (n === 1) hit(t + beat / 2, 'kick', 0.7); }
        else { if (n % 2 === 0) hit(t, 'kick'); else hit(t, 'snare', piece.style === 'march' ? 0.8 : 0.6); }
      }
    }
  }
  function stop() {
    for (const node of playing) { try { node.stop(); } catch { /* already stopped */ } }
    playing = []; clearTimeout(endTimer);
  }
  /** Plays the piece once with the instruments of `layer`. Returns the length in seconds. */
  function play(piece, layer, onEnd) {
    setup(); stop();
    if (ctx.state === 'suspended') ctx.resume();
    const beat = 60 / piece.tempo, total = pieceLength(piece), bars = total / piece.meter;
    const repeats = total * beat < 11 ? 2 : 1;          // short themes play twice
    const melody = parseMelody(piece.melody), chords = parseChords(piece.chords, piece.meter);
    for (let r = 0; r < repeats; r++) {
      const start = ctx.currentTime + 0.08 + r * total * beat;
      drums(piece, start, beat, bars);
      for (const c of chords) {
        if (!c.notes.length) continue;
        const t = start + c.start * beat, dur = c.beats * beat;
        if (layer >= 2) {
          const root = 36 + (c.notes[0] % 12);
          for (let k = 0; k < c.beats; k += piece.meter === 3 ? 3 : 2) tone(hz(root), t + k * beat, Math.min(dur - k * beat, beat * 1.6), { type: 'sine', peak: 0.38, release: 0.1 });
        }
        if (layer >= 3) for (const pc of c.notes.slice(0, 3)) tone(hz(57 + ((pc - 9 + 12) % 12)), t, dur, { type: 'sawtooth', peak: 0.035, attack: 0.08, release: 0.2, filter: 1300 });
        if (layer >= 4) {
          const arp = c.notes.slice(0, 3).map(pc => 72 + (pc % 12)).sort((a, b) => a - b);
          for (let k = 0; k < c.beats * 2; k++) tone(hz(arp[k % arp.length]), t + k * beat / 2, beat * 0.45, { type: 'square', peak: 0.03, release: 0.12, filter: 2600 });
        }
      }
      if (layer >= 5) for (const n of melody) if (n.midi !== null) tone(hz(n.midi + (n.midi < 60 ? 12 : 0)), start + n.start * beat, n.beats * beat * 0.95, { type: 'triangle', peak: layer >= 6 ? 0.3 : 0.24, release: 0.06, vibrato: 0.006 });
    }
    const seconds = repeats * total * beat + 0.4;
    endTimer = setTimeout(() => onEnd?.(), seconds * 1000);
    return seconds;
  }
  return { play, stop, get running() { return !!ctx && playing.length > 0; } };
}
