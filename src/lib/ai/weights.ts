import type { PipValue, Stone } from '../../types/domino';
import { isDouble } from '../../types/domino';
import type { LoggedMove, PlayerId } from '../../types/game';
import type { ReplayState } from '../replay';
import { resolvePlacement } from '../gameLogic';
import { contextFrom } from './context';
import { type Weights, policyDistribution, scoreMove } from './features';
import { candidateKey, legalMoves } from './moveGen';
import type { World } from './sampler';

/**
 * How sharply we assume other players follow the heuristic. Low beta means "they
 * play roughly like this, but do not read too much into any one move" — which is
 * the honest assumption about humans, and keeps a single surprising move from
 * annihilating an otherwise plausible world.
 */
export const POLICY_BETA = 0.06;

/** Same idea for the opening, which is a much stronger signal (§2.8). */
export const OPENING_BETA = 0.9;

/**
 * How much weight the choice of *which* partner opened carries, relative to the
 * choice of stone. Deliberately small: it is one bit of evidence at ply zero.
 */
export const PARTNER_CHOICE_WEIGHT = 0.4;

/** Penalty for opening with a non-double, relative to the double of the same suit. */
const NON_DOUBLE_PENALTY = 1.2;

/**
 * Weights are tempered before use: `weight ** TEMPER`. A plain product over ~20
 * plies concentrates almost all the mass on one or two worlds, which throws away
 * the sampling Phase 3 just paid for. Tempering keeps the ordering but flattens
 * the extremes.
 */
export const TEMPER = 0.5;

export interface WeightedWorld {
  world: World;
  weight: number;
}

/**
 * How well a hand explains an opening choice.
 *
 * The convention is "open with the double of your longest suit", so a hand that
 * is rich in the opened value explains the choice well. This is a soft prior,
 * never a rule — Phase 2's hard constraints override it the moment they disagree.
 */
export function openingScore(stone: Stone, hand: Stone[]): number {
  const count = (v: PipValue) => hand.filter((s) => s.a === v || s.b === v).length;
  if (isDouble(stone)) return count(stone.a);
  return Math.max(count(stone.a), count(stone.b)) - NON_DOUBLE_PENALTY;
}

function softmaxProbability(scores: number[], index: number, beta: number): number {
  const max = Math.max(...scores);
  let total = 0;
  for (const s of scores) total += Math.exp(beta * (s - max));
  return Math.exp(beta * (scores[index] - max)) / total;
}

/** Stones each player played at ply `t` or later, so their earlier hands can be rebuilt. */
function buildPlayedAfter(moves: LoggedMove[]): Map<PlayerId, { ply: number; stone: Stone }[]> {
  const out = new Map<PlayerId, { ply: number; stone: Stone }[]>();
  moves.forEach((move, ply) => {
    if (move.type !== 'play' || !move.stone) return;
    const list = out.get(move.playerId) ?? [];
    list.push({ ply, stone: move.stone });
    out.set(move.playerId, list);
  });
  return out;
}

export interface WeightOptions {
  weights?: Weights;
  beta?: number;
  openingBeta?: number;
  temper?: number;
  /**
   * The stone the opener was obliged to play, when the rules forced it — `1-1`
   * in game 1. A forced opening is not a choice and carries no information
   * (§2.7); without this the model would read the opener's 1-1 as evidence of a
   * one-heavy hand, which is exactly backwards.
   */
  forcedOpeningStoneId?: string | null;
  /**
   * The opener's partner, when either of them could have opened. Which one took
   * it is weak evidence that their hand was the more concentrated (§2.8).
   */
  openerAlternative?: PlayerId | null;
}

/**
 * How well a world explains everything we have watched people do.
 *
 * This is the particle-filter step. "Partner played a 6, so he probably has more
 * 6s" and "he took the 6 end over the 2 end, so he may be short of 2s" are not
 * coded anywhere — they fall out of asking which deals would have made the moves
 * we actually saw likely.
 */
export function worldWeight(
  states: ReplayState[],
  moves: LoggedMove[],
  world: World,
  me: PlayerId,
  options: WeightOptions = {},
): number {
  const beta = options.beta ?? POLICY_BETA;
  const openingBeta = options.openingBeta ?? OPENING_BETA;
  const playedAfter = buildPlayedAfter(moves);

  let logWeight = 0;

  for (let ply = 0; ply < moves.length; ply++) {
    const move = moves[ply];
    const player = move.playerId;
    // Our own moves tell us nothing about the hidden deal: the factor is the
    // same in every world and cancels out.
    if (player === me) continue;

    // Rebuild the hand this player held at this ply: what they hold now, plus
    // everything they have played since.
    const laterPlays = (playedAfter.get(player) ?? [])
      .filter((p) => p.ply >= ply)
      .map((p) => p.stone);
    const hand = [...world.hands[player], ...laterPlays];
    const state = states[ply];

    if (move.type === 'pass') {
      // A world where they could have played is impossible, not merely unlikely.
      if (legalMoves(hand, state.ends).length > 0) return 0;
      continue;
    }
    if (!move.stone) continue;

    if (state.ends.left === null) {
      // A forced opening is not a choice — game 1 must be opened with 1-1.
      if (options.forcedOpeningStoneId && move.stone.id === options.forcedOpeningStoneId) {
        // The world must still contain it in the opener's hand to be possible.
        if (!hand.some((s) => s.id === move.stone!.id)) return 0;
        continue;
      }

      // The opening: a free choice among all seven stones, and the most
      // informative event in the game (§2.8).
      const choices = hand;
      if (choices.length <= 1) continue;
      const index = choices.findIndex((s) => s.id === move.stone!.id);
      if (index < 0) return 0;
      const scores = choices.map((s) => openingScore(s, hand));
      logWeight += Math.log(Math.max(softmaxProbability(scores, index, openingBeta), 1e-12));

      // Which of the two winning partners took the opening is itself a signal:
      // the one with the more concentrated hand is likelier to have wanted it.
      const alternative = options.openerAlternative;
      if (alternative && alternative !== me) {
        const theirs = [...world.hands[alternative]];
        for (const later of playedAfter.get(alternative) ?? []) theirs.push(later.stone);
        const best = (h: Stone[]) => Math.max(...h.map((s) => openingScore(s, h)), 0);
        logWeight += Math.log(
          Math.max(
            softmaxProbability([best(hand), best(theirs)], 0, openingBeta * PARTNER_CHOICE_WEIGHT),
            1e-12,
          ),
        );
      }
      continue;
    }

    const options_ = legalMoves(hand, state.ends);
    // A forced move reveals only that it was legal (§2.7). Skipping these is
    // both correct and where most of the saving comes from.
    if (options_.length <= 1) continue;

    // Match on the position the move produces, not on the side it was placed.
    // Move generation collapses the two sides when they lead to the same
    // end-pair (§2.1), so a stone logged on the right can legitimately appear as
    // a left-side candidate — the same move by any measure that matters.
    const observed = candidateKey(
      move.stone,
      resolvePlacement(move.stone, move.side, state.ends).newEnds,
    );
    const index = options_.findIndex((c) => c.key === observed);
    if (index < 0) return 0;

    // Scored from what that player knew at that time — using anything we learned
    // later would invert the tells.
    const ctx = contextFrom(state, hand, player);
    const scored = options_.map((c) => scoreMove(ctx, c, options.weights));
    const probabilities = policyDistribution(scored, beta);
    logWeight += Math.log(Math.max(probabilities[index], 1e-12));
  }

  return Math.exp(logWeight);
}

export function weightWorlds(
  states: ReplayState[],
  moves: LoggedMove[],
  worlds: World[],
  me: PlayerId,
  options: WeightOptions = {},
): WeightedWorld[] {
  const temper = options.temper ?? TEMPER;
  const raw = worlds.map((world) => worldWeight(states, moves, world, me, options));

  const tempered = raw.map((w) => (w > 0 ? Math.pow(w, temper) : 0));
  const total = tempered.reduce((a, b) => a + b, 0);

  // If every world scores zero the observations cannot be explained at all;
  // fall back to uniform rather than returning nothing.
  if (total <= 0) {
    return worlds.map((world) => ({ world, weight: 1 / Math.max(worlds.length, 1) }));
  }
  return worlds.map((world, i) => ({ world, weight: tempered[i] / total }));
}

/**
 * Systematic resampling: turn a weighted pool into `count` equally-weighted
 * worlds, drawn in proportion to weight.
 *
 * Sharper likelihoods identify the real deal much better, but concentrate the
 * mass on a handful of worlds — so a fixed playout budget gets spent almost
 * entirely on worlds that barely matter. Sampling a larger pool cheaply and
 * resampling down to the budget spends every playout on a world worth playing,
 * without making the estimate any more biased.
 *
 * Systematic (one uniform draw, then evenly spaced strides) rather than
 * independent draws, because it has strictly lower resampling variance.
 */
export function resample(
  weighted: WeightedWorld[],
  count: number,
  random: () => number,
): World[] {
  if (weighted.length === 0) return [];
  const out: World[] = [];
  const step = 1 / count;
  let position = random() * step;
  let cumulative = weighted[0].weight;
  let index = 0;

  for (let i = 0; i < count; i++) {
    while (position > cumulative && index < weighted.length - 1) {
      index++;
      cumulative += weighted[index].weight;
    }
    out.push(weighted[index].world);
    position += step;
  }
  return out;
}

/**
 * Kish's effective sample size: how many independent worlds this weighted set is
 * really worth. If it collapses toward 1, the estimate rests on a single deal and
 * the search is fooling itself.
 */
export function effectiveSampleSize(weighted: WeightedWorld[]): number {
  let sum = 0;
  let sumSquares = 0;
  for (const { weight } of weighted) {
    sum += weight;
    sumSquares += weight * weight;
  }
  if (sumSquares <= 0) return 0;
  return (sum * sum) / sumSquares;
}
