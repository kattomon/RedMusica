// Room bookkeeping for online pool. Pure functions so they can be tested without a server.
export const TURN_LIMIT_MS = 5 * 60 * 1000;

export function newRoomState(userId, username) {
  return { status: 'lobby', players: [{ user_id: userId, username }], game: null, rematch: [], turn_started_at: null, recorded: false };
}

export function publicState(room) {
  const s = room.state;
  return { code: room.code, host_id: room.host_id, status: s.status, players: s.players, game: s.game, rematch: s.rematch || [], turn_started_at: s.turn_started_at, updated_at: room.updated_at };
}

/** Adds the second player. The caller starts the game right after. */
export function joinRoom(input, userId, username, now) {
  const state = structuredClone(input);
  const open = state.status === 'lobby' || (state.status === 'finished' && state.players.length < 2);
  if (!open || state.players.length >= 2) throw new Error('La sala ya tiene dos jugadores.');
  state.players.push({ user_id: userId, username });
  Object.assign(state, { status: 'playing', turn_started_at: now, recorded: false, rematch: [] });
  return state;
}

export function finishByForfeit(state, winnerId, reason, now) {
  state.game.winner = winnerId;
  state.game.reason = reason;
  state.game.ballInHand = null;
  state.status = 'finished';
  state.turn_started_at = now;
}

/** Leaving an active game hands the win to the opponent. */
export function leaveRoom(input, userId, hostId, now) {
  const state = structuredClone(input);
  const opponent = state.players.find(p => p.user_id !== userId);
  if (state.status === 'playing' && opponent && state.game && !state.game.winner) finishByForfeit(state, opponent.user_id, 'Su rival abandonó la partida.', now);
  state.players = state.players.filter(p => p.user_id !== userId);
  state.rematch = [];
  return { state, hostId: hostId === userId && state.players.length ? state.players[0].user_id : hostId };
}

export function claimAllowed(state, userId, now) {
  return state.status === 'playing' && !!state.game && !state.game.winner && state.game.turn !== userId &&
    state.players.some(p => p.user_id === userId) && Number.isFinite(state.turn_started_at) && now - state.turn_started_at >= TURN_LIMIT_MS;
}

/** Records a rematch vote; returns who breaks when both players agreed, otherwise null. */
export function requestRematch(state, userId) {
  if (state.status !== 'finished') throw new Error('La partida todavía está en curso.');
  if (state.players.length < 2) throw new Error('Esperando a otro jugador para la revancha.');
  state.rematch = [...new Set([...(state.rematch || []), userId])];
  if (state.rematch.length < 2) return null;
  const loser = state.players.find(p => p.user_id !== state.game?.winner);
  return (loser || state.players[0]).user_id;
}
