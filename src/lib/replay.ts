import type { PipValue, Stone } from '../types/domino';
import type { ChainEnds, LoggedMove, PlacedStone, PlayerId, Side } from '../types/game';
import { PLAYER_ORDER, nextPlayer } from '../types/game';
import { canPlay, resolvePlacement } from './gameLogic';

export const HAND_SIZE = 7;

/**
 * The complete state of a game, rebuilt from its move log.
 *
 * The engine replays logs constantly — once per sampled world in the later
 * phases — so this is a pure function over plain data with no React in sight.
 */
export interface ReplayState {
  opener: PlayerId;
  chain: PlacedStone[];
  ends: ChainEnds;
  playedIds: Set<string>;
  /** Stones still held, per player. A's is exact; the others are counts only. */
  counts: Record<PlayerId, number>;
  turn: PlayerId;
  passStreak: number;
  winner: PlayerId | null;
  blocked: boolean;
  /**
   * Values a player has passed on, and therefore certainly holds none of.
   * Passing is forced and hands only shrink, so this is permanent (§2.6) — the
   * cheapest hard information in the game, and the policy reads it every ply.
   */
  banned: Record<PlayerId, Set<PipValue>>;
}

function emptyBanned(): Record<PlayerId, Set<PipValue>> {
  return { A: new Set(), B: new Set(), C: new Set(), D: new Set() };
}

export function initialState(opener: PlayerId): ReplayState {
  return {
    opener,
    chain: [],
    ends: { left: null, right: null },
    playedIds: new Set(),
    counts: { A: HAND_SIZE, B: HAND_SIZE, C: HAND_SIZE, D: HAND_SIZE },
    turn: opener,
    passStreak: 0,
    winner: null,
    blocked: false,
    banned: emptyBanned(),
  };
}

export class IllegalMoveError extends Error {}

/** Stamps the current open ends onto a move, so callers cannot forget to. */
export function logMove(
  state: ReplayState,
  move: { playerId: PlayerId; type: 'play' | 'pass'; stone?: Stone; side?: Side },
): LoggedMove {
  return { ...move, endsBefore: state.ends };
}

/** Applies one logged move, returning a new state. Throws on an illegal move. */
export function applyMove(state: ReplayState, move: LoggedMove): ReplayState {
  if (state.winner !== null || state.blocked) {
    throw new IllegalMoveError('the game is already over');
  }
  if (move.playerId !== state.turn) {
    throw new IllegalMoveError(`it is ${state.turn}'s turn, not ${move.playerId}'s`);
  }

  if (move.type === 'pass') {
    if (state.ends.left === null || state.ends.right === null) {
      throw new IllegalMoveError('the opener cannot pass — every stone is legal on an empty table');
    }
    const passStreak = state.passStreak + 1;
    const banned = { ...state.banned };
    banned[move.playerId] = new Set(banned[move.playerId]).add(state.ends.left).add(state.ends.right);
    return {
      ...state,
      banned,
      passStreak,
      blocked: passStreak >= PLAYER_ORDER.length,
      turn: nextPlayer(state.turn),
    };
  }

  const stone = move.stone;
  if (!stone) throw new IllegalMoveError('a play must name a stone');
  if (state.playedIds.has(stone.id)) throw new IllegalMoveError(`${stone.id} is already on the table`);
  if (!canPlay(stone, state.ends)) {
    throw new IllegalMoveError(`${stone.id} matches neither open end`);
  }

  const { displayA, displayB, newEnds } = resolvePlacement(stone, move.side, state.ends);
  const exposed =
    state.ends.left === null
      ? stone.a === stone.b
        ? [stone.a]
        : [stone.a, stone.b]
      : [move.side === 'left' ? displayA : displayB];
  const placed: PlacedStone = { stone, playerId: move.playerId, displayA, displayB, exposed };
  const counts = { ...state.counts, [move.playerId]: state.counts[move.playerId] - 1 };
  const playedIds = new Set(state.playedIds);
  playedIds.add(stone.id);

  return {
    ...state,
    chain: move.side === 'left' ? [placed, ...state.chain] : [...state.chain, placed],
    ends: newEnds,
    playedIds,
    counts,
    passStreak: 0,
    winner: counts[move.playerId] === 0 ? move.playerId : null,
    turn: nextPlayer(state.turn),
  };
}

/** Rebuilds the final state from a log. */
export function replay(opener: PlayerId, moves: LoggedMove[]): ReplayState {
  return moves.reduce(applyMove, initialState(opener));
}

/**
 * The state before every ply, plus the final state — `states[i]` is the position
 * that `moves[i]` was chosen from. The engine scores historical moves from the
 * position they were actually made in, so it needs this, not just the end state.
 */
export function replayPlies(opener: PlayerId, moves: LoggedMove[]): ReplayState[] {
  const states = [initialState(opener)];
  for (const move of moves) {
    states.push(applyMove(states[states.length - 1], move));
  }
  return states;
}

/** Stones on the table, oldest placement first. */
export function playedStones(state: ReplayState): Stone[] {
  return state.chain.map((p) => p.stone);
}
