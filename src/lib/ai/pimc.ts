import type { Stone } from '../../types/domino';
import type { LoggedMove, PlayerId, PlayerNames, TeamId } from '../../types/game';
import { teamOf } from '../../types/game';
import { type ReplayState, applyMove, logMove, replayPlies } from '../replay';
import { type Belief, deriveBeliefs } from './beliefs';
import { contextWithBeliefs } from './context';
import type { Messages } from '../../i18n/types';
import { type MoveScore, type Weights, scoreMove } from './features';
import { legalMoves } from './moveGen';
import { POINTS_SCALE, playout, pointsOf } from './playout';
import { type GameScore, type Standing, matchValue } from '../scoring';
import { handPips } from './context';
import { type Random, makeRandom } from './rng';
import { type World, sampleWorlds } from './sampler';
import { solveEndgame, totalStones } from './endgame';
import { type BestResponseOptions, bestResponseValue } from './bestResponse';
import {
  type WeightOptions,
  effectiveSampleSize,
  resample,
  weightWorlds,
} from './weights';

export interface PimcMove extends MoveScore {
  /**
   * Expected value used for ranking: points, scaled, and capped at what the
   * match can still use. Show `points` to a human, not this.
   */
  ev: number;
  /** Share of sampled worlds this move wins outright. */
  winRate: number;
  /** Expected points for this move: what the game is actually scored in. */
  points: number;
  worlds: number;
  /**
   * Worlds whose outcome was solved exactly rather than played out. When this
   * equals the world count, the ranking rests on proof rather than simulation —
   * within the deals we consider possible.
   */
  exactWorlds: number;
}

export interface PimcOptions {
  worlds?: number;
  weights?: Weights;
  seed?: number;
  /**
   * Weight sampled worlds by how well they explain the play so far (Phase 4).
   * The move log is required for this; without it the worlds stay uniform.
   */
  log?: { opener: PlayerId; moves: LoggedMove[] };
  likelihood?: WeightOptions | false;
  /** Solve exactly when this many stones or fewer remain in play. 0 disables it. */
  endgameThreshold?: number;
  /**
   * How the endgame is solved once the threshold is reached.
   *
   * `minimax` is `endgame.ts`: exact, and it assumes every seat can see the
   * whole deal — the strategy fusion that made it ship off (§5).
   * `best-response` is `bestResponse.ts`: exact for our move, with the other
   * three following the playout policy from their own hand (§6).
   */
  endgameMode?: 'minimax' | 'best-response';
  /** Passed through to the best-response solver: policy sharpness, budget. */
  bestResponse?: BestResponseOptions;
  /** Pool multiplier used before resampling, when likelihood weighting is on. */
  oversample?: number;
  /**
   * Where the match stands: written points, points in the air, and the target.
   * Supplying it lets the search see the two non-linearities in the scoring —
   * points past 101 buy nothing, and a game worth less than 13 is not written
   * down. Without it the search simply maximises points, which is right for a
   * fresh match and for the harness.
   */
  standing?: Standing;
  /**
   * Display names for the seats, and the language to explain in. Both reach the
   * rationale text only — the ranking is identical whatever the players are
   * called and whichever language it is read in.
   */
  names?: PlayerNames;
  messages?: Messages;
}

export interface PimcResult {
  moves: PimcMove[];
  /** Worlds actually sampled. Zero means the log is inconsistent and we fell back. */
  sampled: number;
  /** Kish effective sample size after likelihood weighting. */
  ess: number;
  belief: Belief;
  ms: number;
}

export const DEFAULT_WORLDS = 300;
export const DEFAULT_OVERSAMPLE = 4;

/**
 * Exact endgame solving is **off** by default, despite being correct and cheap.
 *
 * Solving a determinized world assumes every opponent can see the whole deal,
 * which is the strategy fusion §3 warns about — and it measures that way: +1.8
 * points against a heuristic opponent, -3.8 against a random one, and -2.5 head
 * to head in this exact configuration. The optimal-play assumption is simply
 * wrong about the opponents it is applied to. `endgame.ts` and its tests stay;
 * §5 records what would make it pay. Set `endgameThreshold` to enable it.
 */
export const DEFAULT_ENDGAME_THRESHOLD = 0;

/**
 * Ranks the legal moves by playing each one out across many consistent deals.
 *
 * Blocking, starving and counting out are not coded here — they emerge from
 * searching worlds that respect everything the log proves.
 */
export function recommend(
  state: ReplayState,
  dealtOrCurrentHand: Stone[],
  me: PlayerId,
  options: PimcOptions = {},
): PimcResult {
  const started = Date.now();
  // Accept either the hand as dealt or as it stands now. Anything already on the
  // table is not in your hand, whatever the caller believes — getting this wrong
  // once made the engine offer a stone it had already played, throw, and leave
  // the UI telling the user to pass when they had four legal moves.
  const hand = dealtOrCurrentHand.filter((s) => !state.playedIds.has(s.id));
  const count = options.worlds ?? DEFAULT_WORLDS;
  const random = makeRandom(options.seed ?? 0x5eed);
  const endgameThreshold = options.endgameThreshold ?? DEFAULT_ENDGAME_THRESHOLD;

  const ctx = contextWithBeliefs(state, hand, me, {
    names: options.names,
    messages: options.messages,
  });
  const belief = ctx.belief ?? deriveBeliefs(state, hand, me);
  const candidates = legalMoves(hand, state.ends);

  // The heuristic still supplies the rationale — the search ranks, it does not explain.
  const scored = candidates.map((c) => scoreMove(ctx, c, options.weights));

  // On whenever the log is available. Weighting only pays once the pool is
  // oversampled and resampled back down — on its own it trades better-aimed
  // worlds for a collapsed sample size and nets nothing. And it must stay mild:
  // sharp likelihoods measured clearly worse. See ENGINE_DESIGN.md §4.
  const weighting = Boolean(options.log) && options.likelihood !== false;
  // Sampling is cheap and playouts are not, so when the worlds are going to be
  // weighted it pays to draw a bigger pool and resample it down to the playout
  // budget — every playout then lands on a world worth playing.
  const oversample = weighting ? (options.oversample ?? DEFAULT_OVERSAMPLE) : 1;
  const pool = sampleWorlds(belief, hand, count * oversample, random).worlds;

  // Phase 4: worlds that explain the observed play carry more weight than worlds
  // that merely satisfy the hard constraints. After resampling they are equally
  // weighted again, with the likelihood expressed as how often each was drawn.
  let worlds = pool;
  let ess = pool.length;
  if (weighting && pool.length > 0) {
    const states = replayPlies(options.log!.opener, options.log!.moves);
    const weighted = weightWorlds(
      states,
      options.log!.moves,
      pool,
      me,
      options.likelihood === false ? {} : (options.likelihood ?? {}),
    );
    ess = effectiveSampleSize(weighted);
    worlds = resample(weighted, count, random);
  }

  if (worlds.length === 0) {
    // An inconsistent log leaves nothing legal to sample; fall back to the
    // heuristic ordering rather than inventing worlds that cannot exist.
    const moves = scored
      .map((s) => ({ ...s, ev: 0, points: 0, winRate: 0, worlds: 0, exactWorlds: 0 }))
      .sort((a, b) => b.score - a.score);
    return { moves, sampled: 0, ess: 0, belief, ms: Date.now() - started };
  }

  // Common random numbers: every candidate is judged against the same deals AND
  // the same policy coin-flips, so a difference in EV is the move's doing rather
  // than one candidate having drawn luckier playouts than another.
  const worldSeeds = worlds.map(() => Math.floor(random() * 0xffffffff));

  const moves: PimcMove[] = scored.map((s) => {
    let total = 0;
    let totalPoints = 0;
    let wins = 0;
    let exactWorlds = 0;
    for (let i = 0; i < worlds.length; i++) {
      const outcome = evaluate(
        state,
        s,
        worlds[i],
        me,
        makeRandom(worldSeeds[i]),
        options.weights,
        endgameThreshold,
        options.standing,
        options.endgameMode ?? 'minimax',
        options.bestResponse,
      );
      if (outcome.exact) exactWorlds++;
      total += outcome.value;
      totalPoints += outcome.points;
      // Counted on the discrete result, so "wins 68%" means 68 games in 100,
      // not 68% of a score that includes a pip-margin tiebreaker.
      if (outcome.won) wins++;
    }
    return {
      ...s,
      ev: total / worlds.length,
      points: totalPoints / worlds.length,
      winRate: wins / worlds.length,
      worlds: worlds.length,
      exactWorlds,
    };
  });

  // Ties on expected value fall back to the heuristic, which is a reasonable
  // prior and keeps the ordering stable between runs.
  moves.sort((a, b) => b.ev - a.ev || b.score - a.score);
  return { moves, sampled: worlds.length, ess, belief, ms: Date.now() - started };
}

function evaluate(
  state: ReplayState,
  move: MoveScore,
  world: World,
  me: PlayerId,
  random: Random,
  weights: Weights | undefined,
  endgameThreshold: number,
  standing: Standing | undefined,
  endgameMode: 'minimax' | 'best-response' = 'minimax',
  bestResponse?: BestResponseOptions,
): { value: number; points: number; won: boolean; exact?: boolean } {
  const { stone, side } = move.candidate;
  const after = applyMove(state, logMove(state, { playerId: me, type: 'play', stone, side }));
  const hands = { ...world.hands, [me]: world.hands[me].filter((s) => s.id !== stone.id) };
  // Value is always computed for the team of whoever is choosing, so this works
  // unchanged when a B or D seat runs the search in the harness.
  const perspective = teamOf(me) === 'us' ? 'us' : 'them';

  /**
   * Turns raw points into what they are worth to the match.
   *
   * Two non-linearities live here, and neither is visible from the pips alone:
   * points past the target buy nothing, and a game worth less than 13 is not
   * written down at all. Without a standing this is the identity, which is the
   * right behaviour for the harness and for a fresh match.
   */
  const useful = (points: number) => {
    if (!standing) return points;
    const mine: TeamId = perspective === 'us' ? 'us' : 'them';
    const other: TeamId = mine === 'us' ? 'them' : 'us';
    const asScore: GameScore =
      points >= 0
        ? { us: 0, them: 0, carry: 0, seka: false, [mine]: points }
        : { us: 0, them: 0, carry: 0, seka: false, [other]: -points };
    const value = matchValue(asScore, standing);
    return mine === 'us' ? value : -value;
  };

  // Playing our last stone ends the game here and now; there is nothing to
  // search — but the payoff is what the opponents are caught holding, not a flag.
  if (after.winner !== null) {
    const points = pointsOf(
      {
        winner: after.winner,
        blocked: false,
        usPips: handPips(hands.A) + handPips(hands.C),
        themPips: handPips(hands.B) + handPips(hands.D),
        plies: 0,
      },
      perspective,
    );
    return { value: useful(points) / POINTS_SCALE, points, won: points > 0, exact: true };
  }

  // Phase 5: once the world is small enough, stop guessing. Off by default —
  // see DEFAULT_ENDGAME_THRESHOLD.
  if (endgameThreshold > 0 && totalStones(hands) <= endgameThreshold) {
    const exact =
      endgameMode === 'best-response'
        ? bestResponseValue(after, hands, me, { weights, ...bestResponse })
        : solveEndgame(hands, after.ends, after.turn, after.passStreak);
    if (exact.solved) {
      const points = perspective === 'us' ? exact.value : -exact.value;
      return { value: useful(points) / POINTS_SCALE, points, won: points > 0, exact: true };
    }
  }

  const result = playout(after, hands, random, weights);
  const points = pointsOf(result, perspective);
  return { value: useful(points) / POINTS_SCALE, points, won: points > 0 };
}
