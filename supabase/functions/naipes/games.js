// The card games available in the "naipes" rooms.
import * as brisca from './brisca.js';
import * as potosucio from './potosucio.js';
import * as carioca from './carioca.js';
import * as ultima from './ultima.js';

export const GAMES = Object.freeze({ brisca, potosucio, carioca, ultima });
export const gameOf = id => GAMES[id] || null;
