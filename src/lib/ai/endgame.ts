import type { PipValue, Stone } from '../../types/domino';
import type { ChainEnds, PlayerId } from '../../types/game';
import { nextPlayer, teamOf } from '../../types/game';
import { otherValue, playableSides } from '../gameLogic';

/**
 * Exact solution of a fully determinized endgame.
 *
 * Once a world is fixed, the game is perfect information, and short hands make
 * the tree small enough to solve outright. Domino games are decided in the
 * endgame and that is exactly where a playout policy is weakest, so replacing
 * approximation with proof here is worth more than anywhere else.
 *
 * Values are from our team's (A+C) point of view, in **points**: the winning
 * team scores the opponents' remaining pips, so the margin is the payoff.
 */

export interface EndgameOptions {
  /** Give up and let the caller fall back if the search exceeds this many nodes. */
  nodeBudget?: number;
}

export const DEFAULT_NODE_BUDGET = 120_000;

/**
 * Total stones across all four hands at which an exact solve is attempted.
 *
 * At 16 an exact solve costs about 0.2 ms, the same as the rollout it replaces,
 * and every sampled world solves inside the node budget. Above 18 the cost
 * roughly triples every two stones.
 */
export const ENDGAME_THRESHOLD = 16;

interface Frame {
  hands: Record<PlayerId, Stone[]>;
  ends: ChainEnds;
  turn: PlayerId;
  passStreak: number;
}

class BudgetExceeded extends Error {}

function pipsOf(stones: Stone[]): number {
  let total = 0;
  for (const s of stones) total += s.a + s.b;
  return total;
}

/**
 * Terminal value of a blocked game, in points to our team.
 *
 * The lighter team wins the block and scores the **opponents'** remaining pips.
 * Level on pips is a seka: nobody scores this game.
 */
function blockedValue(hands: Record<PlayerId, Stone[]>): number {
  const us = pipsOf(hands.A) + pipsOf(hands.C);
  const them = pipsOf(hands.B) + pipsOf(hands.D);
  if (us < them) return them;
  if (us > them) return -us;
  return 0;
}

/** Points to our team when `winner` empties their hand in this position. */
function goingOutValue(hands: Record<PlayerId, Stone[]>, winner: PlayerId): number {
  const opponentPips =
    teamOf(winner) === 'us'
      ? pipsOf(hands.B) + pipsOf(hands.D)
      : pipsOf(hands.A) + pipsOf(hands.C);
  return teamOf(winner) === 'us' ? opponentPips : -opponentPips;
}

function keyOf(frame: Frame): string {
  // Hands are kept sorted by id on entry, so this is a canonical description of
  // the position. The chain itself is irrelevant — only the ends matter (§2.1).
  return (
    `${frame.turn}|${frame.ends.left},${frame.ends.right}|${frame.passStreak}|` +
    `${frame.hands.A.map((s) => s.id).join('.')}/` +
    `${frame.hands.B.map((s) => s.id).join('.')}/` +
    `${frame.hands.C.map((s) => s.id).join('.')}/` +
    `${frame.hands.D.map((s) => s.id).join('.')}`
  );
}

export interface EndgameResult {
  /** Value to our team with best play by everyone. */
  value: number;
  nodes: number;
  /** False when the node budget ran out and the answer is not a proof. */
  solved: boolean;
}

/**
 * Solves the position exactly. Each team maximises its own outcome, so this is a
 * two-value minimax over the four seats rather than a plain one.
 */
export function solveEndgame(
  hands: Record<PlayerId, Stone[]>,
  ends: ChainEnds,
  turn: PlayerId,
  passStreak = 0,
  options: EndgameOptions = {},
): EndgameResult {
  const budget = options.nodeBudget ?? DEFAULT_NODE_BUDGET;
  const memo = new Map<string, number>();
  let nodes = 0;

  const sorted: Record<PlayerId, Stone[]> = {
    A: [...hands.A].sort((x, y) => x.id.localeCompare(y.id)),
    B: [...hands.B].sort((x, y) => x.id.localeCompare(y.id)),
    C: [...hands.C].sort((x, y) => x.id.localeCompare(y.id)),
    D: [...hands.D].sort((x, y) => x.id.localeCompare(y.id)),
  };

  function search(frame: Frame): number {
    if (++nodes > budget) throw new BudgetExceeded();

    // A hand may already be empty when the caller hands us the position — the
    // game is over and nobody moves again.
    for (const player of ['A', 'B', 'C', 'D'] as PlayerId[]) {
      if (frame.hands[player].length === 0) return goingOutValue(frame.hands, player);
    }

    const key = keyOf(frame);
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const hand = frame.hands[frame.turn];
    const moves: { stone: Stone; newEnds: ChainEnds }[] = [];
    if (frame.ends.left === null || frame.ends.right === null) {
      for (const stone of hand) moves.push({ stone, newEnds: { left: stone.a, right: stone.b } });
    } else {
      const seen = new Set<string>();
      for (const stone of hand) {
        for (const side of playableSides(stone, frame.ends)) {
          const matched = side === 'left' ? frame.ends.left : frame.ends.right;
          const other = otherValue(stone, matched);
          const newEnds: ChainEnds =
            side === 'left'
              ? { left: other, right: frame.ends.right }
              : { left: frame.ends.left, right: other };
          // Collapse the sides that reach the same position (§2.1).
          const dedupe = `${stone.id}@${Math.min(newEnds.left as PipValue, newEnds.right as PipValue)},${Math.max(newEnds.left as PipValue, newEnds.right as PipValue)}`;
          if (seen.has(dedupe)) continue;
          seen.add(dedupe);
          moves.push({ stone, newEnds });
        }
      }
    }

    let value: number;
    if (moves.length === 0) {
      const passStreak = frame.passStreak + 1;
      if (passStreak >= 4) {
        value = blockedValue(frame.hands);
      } else {
        value = search({ ...frame, passStreak, turn: nextPlayer(frame.turn) });
      }
    } else {
      const maximising = teamOf(frame.turn) === 'us';
      value = maximising ? -Infinity : Infinity;

      for (const move of moves) {
        const remaining = frame.hands[frame.turn].filter((s) => s.id !== move.stone.id);
        let childValue: number;
        if (remaining.length === 0) {
          // Going out ends the game and scores the opponents' remaining pips.
          childValue = goingOutValue({ ...frame.hands, [frame.turn]: remaining }, frame.turn);
        } else {
          childValue = search({
            hands: { ...frame.hands, [frame.turn]: remaining },
            ends: move.newEnds,
            turn: nextPlayer(frame.turn),
            passStreak: 0,
          });
        }
        value = maximising ? Math.max(value, childValue) : Math.min(value, childValue);
        // No cutoff: with a points payoff there is no known best value to stop
        // at, and the trees this runs on are small enough not to need one.
      }
    }

    memo.set(key, value);
    return value;
  }

  try {
    const value = search({ hands: sorted, ends, turn, passStreak });
    return { value, nodes, solved: true };
  } catch (error) {
    if (error instanceof BudgetExceeded) return { value: 0, nodes, solved: false };
    throw error;
  }
}

export function totalStones(hands: Record<PlayerId, Stone[]>): number {
  return hands.A.length + hands.B.length + hands.C.length + hands.D.length;
}

export interface EndgameMove {
  stone: Stone;
  newEnds: ChainEnds;
}

/**
 * The move the player to move should make, and what it is worth.
 *
 * `move` is null when they have nothing legal and must pass.
 */
export function bestEndgameMove(
  hands: Record<PlayerId, Stone[]>,
  ends: ChainEnds,
  turn: PlayerId,
  passStreak = 0,
  options: EndgameOptions = {},
): { value: number; move: EndgameMove | null; solved: boolean } {
  const hand = hands[turn];
  const candidates: EndgameMove[] = [];

  if (ends.left === null || ends.right === null) {
    for (const stone of hand) candidates.push({ stone, newEnds: { left: stone.a, right: stone.b } });
  } else {
    const seen = new Set<string>();
    for (const stone of hand) {
      for (const side of playableSides(stone, ends)) {
        const matched = side === 'left' ? ends.left : ends.right;
        const other = otherValue(stone, matched);
        const newEnds: ChainEnds =
          side === 'left' ? { left: other, right: ends.right } : { left: ends.left, right: other };
        const lo = Math.min(newEnds.left as PipValue, newEnds.right as PipValue);
        const hi = Math.max(newEnds.left as PipValue, newEnds.right as PipValue);
        const dedupe = `${stone.id}@${lo},${hi}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        candidates.push({ stone, newEnds });
      }
    }
  }

  if (candidates.length === 0) {
    if (passStreak + 1 >= 4) return { value: blockedValue(hands), move: null, solved: true };
    const rest = solveEndgame(hands, ends, nextPlayer(turn), passStreak + 1, options);
    return { value: rest.value, move: null, solved: rest.solved };
  }

  const maximising = teamOf(turn) === 'us';
  let best: EndgameMove | null = null;
  let bestValue = maximising ? -Infinity : Infinity;
  let solved = true;

  for (const candidate of candidates) {
    const remaining = hand.filter((s) => s.id !== candidate.stone.id);
    let value: number;
    if (remaining.length === 0) {
      value = goingOutValue({ ...hands, [turn]: remaining }, turn);
    } else {
      const child = solveEndgame(
        { ...hands, [turn]: remaining },
        candidate.newEnds,
        nextPlayer(turn),
        0,
        options,
      );
      if (!child.solved) solved = false;
      value = child.value;
    }
    if (maximising ? value > bestValue : value < bestValue) {
      bestValue = value;
      best = candidate;
    }
  }

  return { value: bestValue, move: best, solved };
}
