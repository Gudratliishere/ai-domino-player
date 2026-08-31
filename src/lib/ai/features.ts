import type { PipValue, Stone } from '../../types/domino';
import { isDouble, stoneId } from '../../types/domino';
import type { ChainEnds, PlayerId } from '../../types/game';
import { displayName } from '../../types/game';
import { playableSides } from '../gameLogic';
import { type Candidate, endValues, legalMoves } from './moveGen';
import {
  type PerValue,
  type PolicyContext,
  TOTAL_PIPS,
  handPips,
  isDeadValue,
  stonePips,
} from './context';

export interface Weights {
  countOut: number;
  /** Multiplier on the points a forced block is estimated to be worth. */
  forcedBlockPoints: number;
  suitControl: number;
  selfBlockNone: number;
  selfBlockThin: number;
  starveOpponent: number;
  /** Reward for leaving an end your partner can answer. */
  feedPartner: number;
  /**
   * Extra reward per stone your partner is closer to going out than you.
   *
   * Deliberately small. Measured over 12k games it is worth nothing at 2 and
   * costs half a point per game by 12: the ends rotate through all four players,
   * so feeding the partner does not actually shorten their hand the way it feels
   * like it should. It is kept because the read itself is sound and it shows up
   * in the explanation; it is kept small because the table says so.
   */
  partnerAhead: number;
  /**
   * Reward per stone your partner has *exposed* carrying a live end value.
   *
   * The one term here that pays: +0.66 net points/game at 4, on held-out seeds.
   * The curve is smooth and peaks there, falling off both sides.
   */
  partnerSuit: number;
  pipShed: number;
  deadDouble: number;
  thinDouble: number;
}

/**
 * Hand-set. Phase 5's cross-entropy tuner was run twice over roughly a million
 * games and could not beat these on held-out seeds, so they stayed. See §5.
 */
export const DEFAULT_WEIGHTS: Weights = {
  countOut: 1000,
  forcedBlockPoints: 6,
  suitControl: 2,
  selfBlockNone: -34,
  selfBlockThin: -9,
  starveOpponent: 40,
  feedPartner: 20,
  partnerAhead: 2,
  partnerSuit: 4,
  pipShed: 0.6,
  deadDouble: -25,
  thinDouble: -7,
};

interface Term {
  label: string;
  value: number;
  reason: string;
  /** True when this follows by deduction, false when it is an estimate. */
  certain?: boolean;
}

export interface MoveScore {
  candidate: Candidate;
  score: number;
  /** Plain language, most influential first — a human has to trust this fast. */
  reasons: string[];
  /** The subset of reasons that are proven rather than likely. */
  proven: string[];
  terms: Term[];
}

/**
 * Probability that `playerId` will be unable to play against `ends`.
 *
 * A pass is certain knowledge (§2.6), so a value they have passed on contributes
 * nothing. Beyond that we know only how many stones they hold and how large the
 * hidden pool is, which is exactly a hypergeometric draw.
 */
export function pCannotPlay(ctx: PolicyContext, playerId: PlayerId, ends: ChainEnds): number {
  const held = ctx.counts[playerId];
  if (held <= 0) return 0;

  const live = endValues(ends).filter((v) => !ctx.banned[playerId].has(v));
  if (live.length === 0) return 1;

  const pool = ctx.pools?.[playerId];
  if (pool) {
    const serves = (s: Stone) => live.includes(s.a) || live.includes(s.b);
    // A stone proven to be theirs that answers the ends settles it outright.
    if (pool.known.some(serves)) return 0;
    const matches = pool.possible.filter(serves).length;
    if (matches === 0) return 1;
    if (pool.freeSlots <= 0) return 1;
    const n = pool.possible.length;
    if (n - matches < pool.freeSlots) return 0;
    let q = 1;
    for (let i = 0; i < pool.freeSlots; i++) q *= (n - matches - i) / (n - i);
    return q;
  }

  let matching = ctx.unseenPerValue[live[0]];
  if (live.length === 2) {
    matching += ctx.unseenPerValue[live[1]];
    // The stone carrying both end values was counted once for each.
    if (ctx.unseenIds.has(stoneId(live[0], live[1]))) matching -= 1;
  }

  if (matching <= 0) return 1;
  if (ctx.unseenCount - matching < held) return 0;

  let p = 1;
  for (let i = 0; i < held; i++) {
    p *= (ctx.unseenCount - matching - i) / (ctx.unseenCount - i);
  }
  return p;
}

export function scoreMove(
  ctx: PolicyContext,
  candidate: Candidate,
  weights: Weights = DEFAULT_WEIGHTS,
): MoveScore {
  const terms: Term[] = [];
  // Reasons are read by a person, so they name the players and speak their
  // language; scoring never does either.
  const r = ctx.messages.reasons;
  const name = (player: PlayerId) => displayName(ctx.names, player);
  const listValues = (values: PipValue[]) => values.join(r.andJoin);
  const add = (label: string, value: number, reason: string, certain = false) => {
    if (value !== 0) terms.push({ label, value, reason, certain });
  };

  const { stone, resultEnds } = candidate;
  const handAfter = ctx.hand.filter((s) => s.id !== stone.id);
  const newValues = endValues(resultEnds);

  // A forced path to emptying your hand dominates everything else.
  if (handAfter.length === 0) {
    const r = ctx.messages.reasons;
    return {
      candidate,
      score: weights.countOut,
      reasons: [r.lastStone],
      proven: [r.lastStone],
      terms: [
        {
          label: 'countOut',
          value: weights.countOut,
          reason: r.lastStoneShort,
          certain: true,
        },
      ],
    };
  }

  const playedAfter: PerValue = ctx.playedPerValue.slice();
  playedAfter[stone.a]++;
  if (stone.b !== stone.a) playedAfter[stone.b]++;
  const playedPipsAfter = ctx.playedPips + stonePips(stone);

  // --- Forced block (§2.4): both ends dead means every player must pass ---
  const bothEndsDead = newValues.every((v) => isDeadValue(playedAfter, v));
  if (bothEndsDead) {
    const myPips = handPips(handAfter);
    const hiddenPips = TOTAL_PIPS - playedPipsAfter - myPips;
    const perHidden = ctx.unseenCount > 0 ? hiddenPips / ctx.unseenCount : 0;
    // Pip conservation gives the two halves from one estimate (§2.3).
    const ourPips = myPips + ctx.counts[ctx.partner] * perHidden;
    const theirPips = TOTAL_PIPS - playedPipsAfter - ourPips;

    // The lighter team scores the *opponents'* pips, so this is worth points,
    // not a win flag: blocking them on 40 is worth far more than on 8.
    const expectedPoints = ourPips < theirPips ? theirPips : -ourPips;
    const label = listValues(newValues);
    add(
      'forcedBlock',
      expectedPoints * weights.forcedBlockPoints,
      expectedPoints > 0
        ? r.forcedBlockGood(label, Math.round(expectedPoints))
        : r.forcedBlockBad(label, Math.round(-expectedPoints)),
      true,
    );
  }

  // --- Suit control and self-block risk ---
  const myPlayable = handAfter.filter((s) => playableSides(s, resultEnds).length > 0).length;
  add(
    'suitControl',
    myPlayable * weights.suitControl,
    r.suitControl(myPlayable, handAfter.length),
  );
  if (myPlayable === 0) {
    add('selfBlock', weights.selfBlockNone, r.selfBlockNone);
  } else if (myPlayable === 1) {
    add('selfBlock', weights.selfBlockThin, r.selfBlockThin);
  }

  // --- Starving the opponents, without starving your partner ---
  const stuckReason = (player: PlayerId) => {
    const values = listValues(newValues);
    const who = name(player);
    return newValues.every((v) => ctx.banned[player].has(v))
      ? r.stuckPassed(who, values)
      : r.stuckRuledOut(who, values);
  };

  for (const opponent of ctx.opponents) {
    const p = pCannotPlay(ctx, opponent, resultEnds);
    if (p <= 0.05) continue;
    const certain = p >= 0.999;
    add(
      `starve:${opponent}`,
      p * weights.starveOpponent,
      certain ? stuckReason(opponent) : r.starveLikely(name(opponent), Math.round(p * 100)),
      certain,
    );
  }
  // --- Playing for your partner ---
  //
  // Two things a good player weighs that counting alone misses. First, the suit
  // your partner has been playing: convention is to lead from strength, so an
  // end they have served before is one they can probably serve again. Second,
  // who is closer to going out — if your partner is two stones ahead of you, it
  // is their hand that should be fed, not yours. The first of those measured well
  // and the second did not; see the weights above and §12.
  //
  // Both are soft reads and a pass beats them outright: `pCannotPlay` already
  // returns 1 for a value they have passed on, and the suit signal below skips
  // banned values entirely.
  const pPartnerStuck = pCannotPlay(ctx, ctx.partner, resultEnds);
  const partnerCanAnswer = 1 - pPartnerStuck;
  const partnerAhead = Math.max(0, ctx.counts[ctx.me] - ctx.counts[ctx.partner]);

  if (pPartnerStuck >= 0.999) {
    add(
      'feedPartner',
      -weights.feedPartner - partnerAhead * weights.partnerAhead,
      r.partnerShutOut(name(ctx.partner)),
      true,
    );
  } else {
    add(
      'feedPartner',
      partnerCanAnswer * (weights.feedPartner + partnerAhead * weights.partnerAhead),
      partnerAhead > 0
        ? r.feedPartnerAhead(name(ctx.partner), partnerAhead)
        : r.feedPartner(name(ctx.partner)),
    );
  }

  // The suit your partner has actually shown, which a pass cancels.
  let shownByPartner = 0;
  for (const v of newValues) {
    if (!ctx.banned[ctx.partner].has(v)) shownByPartner += ctx.playedByPlayer[ctx.partner][v];
  }
  if (shownByPartner > 0) {
    const values = listValues(
      newValues.filter(
        (v) => !ctx.banned[ctx.partner].has(v) && ctx.playedByPlayer[ctx.partner][v] > 0,
      ),
    );
    add(
      'partnerSuit',
      shownByPartner * weights.partnerSuit,
      r.partnerSuit(name(ctx.partner), shownByPartner, values),
    );
  }

  // --- Pip shedding: cheap insurance against a blocked finish (§2.3) ---
  const pips = stonePips(stone);
  add('pipShed', pips * weights.pipShed, r.pipShed(pips));

  // --- Doubles you may never get to play ---
  for (const held of handAfter) {
    if (!isDouble(held)) continue;
    const v = held.a as PipValue;
    if (newValues.includes(v)) continue;
    const outside = ctx.unseenPerValue[v];
    const iCanServe = handAfter.some((s) => s.id !== held.id && (s.a === v || s.b === v));
    if (iCanServe) continue;
    if (outside === 0) {
      add('deadDouble', weights.deadDouble, r.deadDouble(`${held.a}-${held.b}`, v), true);
    } else if (outside <= 1) {
      add('thinDouble', weights.thinDouble, r.thinDouble(`${held.a}-${held.b}`, v, outside));
    }
  }

  const score = terms.reduce((sum, t) => sum + t.value, 0);
  const ranked = [...terms].sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  const reasons = ranked.slice(0, 3).map((t) => t.reason);
  // Deductions are worth surfacing even when they are not the loudest term —
  // "certain" is a different claim from "high scoring", and the user can tell.
  const proven = ranked.filter((t) => t.certain).map((t) => t.reason);

  return { candidate, score, reasons, proven, terms };
}

export function rankMoves(ctx: PolicyContext, weights: Weights = DEFAULT_WEIGHTS): MoveScore[] {
  return legalMoves(ctx.hand, ctx.ends)
    .map((c) => scoreMove(ctx, c, weights))
    .sort((a, b) => b.score - a.score);
}

/** The playout policy: best move, ties broken at random so playouts stay varied. */
export function chooseMove(
  ctx: PolicyContext,
  random: () => number,
  weights: Weights = DEFAULT_WEIGHTS,
): MoveScore | null {
  const ranked = rankMoves(ctx, weights);
  if (ranked.length === 0) return null;
  const best = ranked[0].score;
  const tied = ranked.filter((m) => m.score >= best - 1e-9);
  return tied[Math.floor(random() * tied.length)];
}

/**
 * The same heuristic as a probability distribution. Phase 4 needs this to ask
 * "how well does this world explain the move we actually saw?".
 */
export function policyDistribution(scores: MoveScore[], beta = 0.08): number[] {
  if (scores.length === 0) return [];
  const max = Math.max(...scores.map((s) => s.score));
  const exps = scores.map((s) => Math.exp(beta * (s.score - max)));
  const total = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / total);
}
