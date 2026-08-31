import type { Stone } from '../../types/domino';
import type { PlayerId } from '../../types/game';
import { type ReplayState, applyMove, logMove } from '../replay';
import { contextFrom, handPips } from './context';
import { type Weights, chooseMove } from './features';
import { legalMoves } from './moveGen';
import type { Random } from './rng';

export interface PlayoutResult {
  winner: PlayerId | null;
  blocked: boolean;
  usPips: number;
  themPips: number;
  plies: number;
}

const MAX_PLIES = 60;

/**
 * Plays a determinized world out to a terminal state.
 *
 * Every simulated player is handed only their own hand. Letting them see the
 * whole deal is strategy fusion: they would dodge traps a real opponent walks
 * into, and the search would then undervalue exactly the moves worth playing.
 *
 * Beliefs are deliberately not derived here. They cost more than the playout
 * itself and would swamp the search for no measured gain (Phase 2).
 */
export function playout(
  state: ReplayState,
  hands: Record<PlayerId, Stone[]>,
  random: Random,
  weights?: Weights,
): PlayoutResult {
  const live: Record<PlayerId, Stone[]> = {
    A: [...hands.A],
    B: [...hands.B],
    C: [...hands.C],
    D: [...hands.D],
  };
  let current = state;

  for (let ply = 0; ply < MAX_PLIES; ply++) {
    if (current.winner !== null || current.blocked) break;
    const me = current.turn;
    const hand = live[me];

    if (legalMoves(hand, current.ends).length === 0) {
      current = applyMove(current, logMove(current, { playerId: me, type: 'pass' }));
      continue;
    }

    const choice = chooseMove(contextFrom(current, hand, me), random, weights);
    if (!choice) {
      current = applyMove(current, logMove(current, { playerId: me, type: 'pass' }));
      continue;
    }
    const { stone, side } = choice.candidate;
    live[me] = hand.filter((s) => s.id !== stone.id);
    current = applyMove(current, logMove(current, { playerId: me, type: 'play', stone, side }));
  }

  return {
    winner: current.winner,
    blocked: current.blocked,
    usPips: handPips(live.A) + handPips(live.C),
    themPips: handPips(live.B) + handPips(live.D),
    plies: current.chain.length,
  };
}

/**
 * A rough ceiling on what one game is worth, used only to put values on a
 * comparable scale with the rest of the engine. Two opponent hands of seven
 * stones average well under this; it is a normaliser, not a cap.
 */
export const POINTS_SCALE = 60;

/**
 * Terminal value from one team's point of view, in **points**.
 *
 * The winning team takes the pips left in the opponents' hands, so this is not a
 * win/lose flag with a tiebreaker bolted on — the margin *is* the payoff.
 * Winning by 48 really is worth eight times winning by 6, and losing while
 * holding heavy stones really is much worse than losing light.
 *
 * Scaled by `POINTS_SCALE` so the numbers stay near [-1, 1].
 */
export function valueOf(result: PlayoutResult, us: 'us' | 'them' = 'us'): number {
  return pointsOf(result, us) / POINTS_SCALE;
}

/** The same terminal value, unscaled, in points actually scored. */
export function pointsOf(result: PlayoutResult, us: 'us' | 'them' = 'us'): number {
  const ourPips = us === 'us' ? result.usPips : result.themPips;
  const theirPips = us === 'us' ? result.themPips : result.usPips;

  if (result.winner !== null) {
    const winnerIsOurs = result.winner === 'A' || result.winner === 'C';
    // The winner scores what the *opponents* still hold.
    return winnerIsOurs === (us === 'us') ? theirPips : -ourPips;
  }

  // Blocked: the lighter team wins, and still scores the opponents' pips.
  if (ourPips < theirPips) return theirPips;
  if (ourPips > theirPips) return -ourPips;
  // Level — a seka. Nobody scores this game; the pot is a later game's problem.
  return 0;
}
