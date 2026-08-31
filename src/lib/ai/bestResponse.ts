import type { Stone } from '../../types/domino';
import type { PlayerId } from '../../types/game';
import { teamOf } from '../../types/game';
import { type ReplayState, applyMove, logMove } from '../replay';
import { contextFrom, handPips } from './context';
import { type Weights, policyDistribution, scoreMove } from './features';
import { legalMoves } from './moveGen';

/**
 * Exact search for *our* move, fixed policy for everyone else.
 *
 * §6 calls this the clearest remaining idea, and §5 explains why. `endgame.ts`
 * solves a determinized world by minimax, which assumes all four seats can see
 * the whole deal. That is precisely the strategy fusion §3 warns about: the
 * modelled opponents dodge traps a real player walks into, so the search
 * undervalues the moves worth playing. It measured that way too — +1.8 points
 * against a heuristic opponent, −3.8 against a random one, −2.5 head to head —
 * and the solver ships off as a result.
 *
 * The fix keeps the exact part and drops the wrong assumption. Only the seat
 * being advised maximises. The other three — including our partner, who cannot
 * see our hand either — follow the Phase 1 policy computed from their own hand
 * alone, exactly as they do in a playout. That makes this a best response to a
 * fixed policy rather than a minimax value.
 *
 * Whether our *partner* is modelled too is a separate question, and it is a
 * knob rather than a decision. With `modelPartner: false` only B and D are
 * replaced by the policy and our own two seats still coordinate perfectly; the
 * textbook inequality max_a min_b ≤ max_a E_{b~π} then applies exactly, and the
 * value can never fall below the minimax one. That is asserted as a test.
 *
 * With `modelPartner: true` — the default, and the honest model — the partner
 * follows the policy as well, because they cannot see our hand either. The value
 * may then be *lower* than minimax, and should be: minimax was assuming a
 * partner who plays perfectly on information they do not have.
 *
 * Values are points from **our team's (A+C)** point of view, matching
 * `solveEndgame`, so callers can swap one for the other.
 */

export interface BestResponseOptions {
  /** Give up and let the caller fall back if the search exceeds this many nodes. */
  nodeBudget?: number;
  /** Weights for the modelled players' policy. */
  weights?: Weights;
  /**
   * How sharply the modelled players follow the heuristic. `Infinity` makes them
   * greedy — the same choice `chooseMove` makes in a playout, and the cheapest
   * tree, but it assumes we know their move exactly.
   */
  beta?: number;
  /** Drop modelled moves below this probability, then renormalise. Bounds the tree. */
  minProbability?: number;
  /**
   * Whether our partner is modelled by the policy too. Default true: they cannot
   * see our hand any more than an opponent can. Set false to keep minimax's
   * assumption of a perfectly coordinated partner.
   */
  modelPartner?: boolean;
}

export const DEFAULT_NODE_BUDGET = 60_000;

/**
 * Soft rather than greedy by default. A greedy model gives a one-move branching
 * factor and a much bigger apparent gain, most of which is us exploiting the
 * certainty that the opponent will play exactly what our own heuristic would.
 */
export const DEFAULT_BETA = 0.06;
export const DEFAULT_MIN_PROBABILITY = 0.05;

class BudgetExceeded extends Error {}

function pipsOf(stones: Stone[]): number {
  return handPips(stones);
}

/** The lighter team wins a block and scores the opponents' pips; level is a seka. */
function blockedValue(hands: Record<PlayerId, Stone[]>): number {
  const us = pipsOf(hands.A) + pipsOf(hands.C);
  const them = pipsOf(hands.B) + pipsOf(hands.D);
  if (us < them) return them;
  if (us > them) return -us;
  return 0;
}

function goingOutValue(hands: Record<PlayerId, Stone[]>, winner: PlayerId): number {
  const opponentPips =
    teamOf(winner) === 'us'
      ? pipsOf(hands.B) + pipsOf(hands.D)
      : pipsOf(hands.A) + pipsOf(hands.C);
  return teamOf(winner) === 'us' ? opponentPips : -opponentPips;
}

function keyOf(state: ReplayState, hands: Record<PlayerId, Stone[]>): string {
  // The chain is irrelevant, only the ends (§2.1) — but the pass bans are not:
  // the modelled policy reads them, so two positions that differ only in who has
  // passed on what are genuinely different nodes.
  const bans = (['A', 'B', 'C', 'D'] as PlayerId[])
    .map((p) => [...state.banned[p]].sort().join(''))
    .join('/');
  const held = (['A', 'B', 'C', 'D'] as PlayerId[])
    .map((p) =>
      hands[p]
        .map((s) => s.id)
        .sort()
        .join('.'),
    )
    .join('/');
  return `${state.turn}|${state.ends.left},${state.ends.right}|${state.passStreak}|${bans}|${held}`;
}

export interface BestResponseResult {
  /** Points to our team (A+C) when `me` best-responds to the modelled policy. */
  value: number;
  nodes: number;
  /** False when the node budget ran out, so the answer is not exact. */
  solved: boolean;
}

export function bestResponseValue(
  state: ReplayState,
  hands: Record<PlayerId, Stone[]>,
  me: PlayerId,
  options: BestResponseOptions = {},
): BestResponseResult {
  const budget = options.nodeBudget ?? DEFAULT_NODE_BUDGET;
  const beta = options.beta ?? DEFAULT_BETA;
  const minProbability = options.minProbability ?? DEFAULT_MIN_PROBABILITY;
  const modelPartner = options.modelPartner ?? true;
  const memo = new Map<string, number>();
  let nodes = 0;

  function search(current: ReplayState, live: Record<PlayerId, Stone[]>): number {
    if (++nodes > budget) throw new BudgetExceeded();

    if (current.winner !== null) return goingOutValue(live, current.winner);
    if (current.blocked) return blockedValue(live);

    const key = keyOf(current, live);
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const seat = current.turn;
    const hand = live[seat];
    const moves = legalMoves(hand, current.ends);

    let value: number;
    if (moves.length === 0) {
      value = search(applyMove(current, logMove(current, { playerId: seat, type: 'pass' })), live);
    } else {
      const advance = (stone: Stone, side: 'left' | 'right' | undefined) => {
        const next = applyMove(
          current,
          logMove(current, { playerId: seat, type: 'play', stone, side }),
        );
        const after = { ...live, [seat]: hand.filter((s) => s.id !== stone.id) };
        // `applyMove` already flags the win, but the value needs the hands as
        // they are *after* the stone has left, so it is computed here.
        if (next.winner !== null) return goingOutValue(after, next.winner);
        return search(next, after);
      };

      const chooses =
        seat === me || (!modelPartner && teamOf(seat) === teamOf(me));
      if (chooses) {
        // The seats that get to choose: ours, and our partner's when the caller
        // keeps minimax's coordinated-partner assumption.
        value = -Infinity;
        for (const move of moves) {
          const child = advance(move.stone, move.side);
          if (child > value) value = child;
        }
      } else {
        // Everyone else follows the policy, from their own hand only — the same
        // context a playout hands them, so no seat ever sees another's stones.
        const ctx = contextFrom(current, hand, seat);
        const scored = moves.map((candidate) => scoreMove(ctx, candidate, options.weights));
        let probabilities: number[];
        if (!Number.isFinite(beta)) {
          // Greedy: all the mass on the best move, ties shared.
          const best = Math.max(...scored.map((s) => s.score));
          const winners: number[] = scored.map((s) => (s.score === best ? 1 : 0));
          const count = winners.reduce((sum, w) => sum + w, 0);
          probabilities = winners.map((w) => w / count);
        } else {
          probabilities = policyDistribution(scored, beta);
          // Prune the tail and renormalise: a move they will play one time in
          // fifty is not worth a subtree, and the tree has to stay bounded.
          const kept = probabilities.map((p) => (p >= minProbability ? p : 0));
          const total = kept.reduce((a, b) => a + b, 0);
          probabilities = total > 0 ? kept.map((p) => p / total) : probabilities;
        }

        value = 0;
        for (let i = 0; i < moves.length; i++) {
          if (probabilities[i] <= 0) continue;
          value += probabilities[i] * advance(moves[i].stone, moves[i].side);
        }
      }
    }

    memo.set(key, value);
    return value;
  }

  try {
    const value = search(state, {
      A: [...hands.A],
      B: [...hands.B],
      C: [...hands.C],
      D: [...hands.D],
    });
    return { value, nodes, solved: true };
  } catch (error) {
    if (error instanceof BudgetExceeded) return { value: 0, nodes, solved: false };
    throw error;
  }
}
