import type { Stone } from '../../types/domino';
import type { GameResult, LoggedMove, PlayerId } from '../../types/game';
import { ALL_PLAYERS } from '../../types/game';
import { type ReplayState, applyMove, initialState, logMove } from '../replay';
import { FIRST_GAME_OPENING_STONE_ID } from '../matchRules';
import { contextFrom, contextWithBeliefs, handPips } from './context';
import { type GameScore, scoreGame } from '../scoring';
import { type Weights, chooseMove } from './features';
import { type Candidate, legalMoves } from './moveGen';
import { type Deal, dealHands } from './deal';
import { type PimcOptions, recommend } from './pimc';
import { type Random, makeRandom } from './rng';

/**
 * An agent sees only what a real player would: its own hand plus public history.
 * That is enforced by construction — the context it is handed is built from one
 * hand, and the other three are never passed in.
 */
export type Agent = (
  hand: Stone[],
  state: ReplayState,
  me: PlayerId,
  random: Random,
  /** The moves so far. Phase 4 reads this to weight worlds by how well they
   * explain the play; earlier agents ignore it. */
  log: LoggedMove[],
) => Candidate | null;

export const randomAgent: Agent = (hand, state, _me, random) => {
  const moves = legalMoves(hand, state.ends);
  if (moves.length === 0) return null;
  return moves[Math.floor(random() * moves.length)];
};

export function heuristicAgent(weights?: Weights): Agent {
  return (hand, state, me, random) => {
    if (legalMoves(hand, state.ends).length === 0) return null;
    return chooseMove(contextFrom(state, hand, me), random, weights)?.candidate ?? null;
  };
}

/** The same heuristic, but reading the certainty engine's deductions first. */
export function believingAgent(weights?: Weights): Agent {
  return (hand, state, me, random) => {
    if (legalMoves(hand, state.ends).length === 0) return null;
    return chooseMove(contextWithBeliefs(state, hand, me), random, weights)?.candidate ?? null;
  };
}

/**
 * Monte Carlo determinization. Slow enough that the ladder runs fewer games with
 * it, so keep `worlds` modest when measuring.
 */
export function pimcAgent(worlds = 120, weights?: Weights): Agent {
  let seed = 1;
  return (hand, state, me) => {
    if (legalMoves(hand, state.ends).length === 0) return null;
    const result = recommend(state, hand, me, { worlds, weights, seed: seed++ });
    return result.moves[0]?.candidate ?? null;
  };
}

/** Phase 4: the same search, over worlds weighted by how well they explain the play. */
export function weightedPimcAgent(worlds = 120, weights?: Weights): Agent {
  let seed = 1;
  return (hand, state, me, _random, log) => {
    if (legalMoves(hand, state.ends).length === 0) return null;
    const result = recommend(state, hand, me, {
      worlds,
      weights,
      seed: seed++,
      log: { opener: state.opener, moves: log },
      // The harness always plays game 1, where the opening is forced.
      likelihood: { forcedOpeningStoneId: FIRST_GAME_OPENING_STONE_ID },
    });
    return result.moves[0]?.candidate ?? null;
  };
}

/**
 * The search with any configuration, for sweeping its own knobs rather than the
 * feature weights: world count, likelihood sharpness, tempering, oversampling,
 * the endgame threshold.
 *
 * `pimcAgent` and `weightedPimcAgent` are the two configurations that were
 * measured in §8 and stay as they are; this is how any other one gets tested.
 */
export function configuredPimcAgent(options: PimcOptions = {}): Agent {
  let seed = 1;
  return (hand, state, me, _random, log) => {
    if (legalMoves(hand, state.ends).length === 0) return null;
    const result = recommend(state, hand, me, {
      ...options,
      seed: seed++,
      // A caller sweeping likelihood parameters means them to apply, which needs
      // the log; one sweeping anything else gets plain determinization.
      log: options.likelihood === false ? undefined : { opener: state.opener, moves: log },
    });
    return result.moves[0]?.candidate ?? null;
  };
}

export interface GameOutcome {
  result: GameResult;
  /** Points each team scored, under the real rules. */
  score: GameScore;
  winner: PlayerId | null;
  blocked: boolean;
  opener: PlayerId;
  plies: number;
  usPips: number;
  themPips: number;
  log: LoggedMove[];
}

const MAX_PLIES = 200;

/** Game 1's rule: whoever holds 1-1 opens, and must open with it. */
export function openerOf(deal: Deal): PlayerId {
  const holder = ALL_PLAYERS.find((p) =>
    deal[p].some((s) => s.id === FIRST_GAME_OPENING_STONE_ID),
  );
  if (!holder) throw new Error('nobody was dealt 1-1');
  return holder;
}

/**
 * Called before every ply with the position and the true deal. Only the harness
 * may look at this — it is how a deduction can be checked against the ground
 * truth it is supposed to be deducing.
 */
export type Observer = (state: ReplayState, hands: Deal, log: LoggedMove[]) => void;

export function playGame(
  deal: Deal,
  agents: Record<PlayerId, Agent>,
  random: Random,
  observe?: Observer,
): GameOutcome {
  const hands: Deal = { A: [...deal.A], B: [...deal.B], C: [...deal.C], D: [...deal.D] };
  const opener = openerOf(deal);
  let state = initialState(opener);
  const log: LoggedMove[] = [];

  for (let ply = 0; ply < MAX_PLIES; ply++) {
    if (state.winner !== null || state.blocked) break;
    observe?.(state, hands, log);
    const me = state.turn;
    const hand = hands[me];

    let move: LoggedMove;
    if (state.chain.length === 0) {
      // The opening is forced: the holder of 1-1 must play it.
      const stone = hand.find((s) => s.id === FIRST_GAME_OPENING_STONE_ID)!;
      move = logMove(state, { playerId: me, type: 'play', stone, side: undefined });
    } else {
      const choice = agents[me](hand, state, me, random, log);
      move = choice
        ? logMove(state, {
            playerId: me,
            type: 'play',
            stone: choice.stone,
            side: choice.side,
          })
        : logMove(state, { playerId: me, type: 'pass' });
    }

    if (move.type === 'play') {
      hands[me] = hand.filter((s) => s.id !== move.stone!.id);
    }
    log.push(move);
    state = applyMove(state, move);
  }

  const usPips = handPips(hands.A) + handPips(hands.C);
  const themPips = handPips(hands.B) + handPips(hands.D);
  // The real scoring: the winning team takes the opponents' pips.
  const score = scoreGame({ winner: state.winner, hands });

  const result: GameResult = score.us > 0 ? 'us' : score.them > 0 ? 'them' : 'draw';

  return {
    result,
    score,
    winner: state.winner,
    blocked: state.blocked,
    opener,
    plies: log.length,
    usPips,
    themPips,
    log,
  };
}

export interface LadderResult {
  games: number;
  us: number;
  them: number;
  draws: number;
  blocked: number;
  /** Wins as a share of decisive games. */
  winRate: number;
  /** Points scored, which is what the match is actually decided on. */
  pointsFor: number;
  pointsAgainst: number;
  /**
   * Net points per game. **This is the metric that matters** — a match runs to
   * 101 points, so winning fewer games by larger margins is better than winning
   * more games narrowly, and win rate cannot see the difference.
   */
  pointsPerGame: number;
  avgPlies: number;
}

/**
 * Runs `games` deals with one agent on A+C and another on B+D. Engine-version
 * against engine-version is the only unambiguous answer to "did that change
 * help?" (§5).
 */
export function runLadder(us: Agent, them: Agent, games: number, seed = 1): LadderResult {
  const random = makeRandom(seed);
  const agents: Record<PlayerId, Agent> = { A: us, C: us, B: them, D: them };
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let blocked = 0;
  let plies = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;

  for (let i = 0; i < games; i++) {
    const outcome = playGame(dealHands(random), agents, random);
    if (outcome.result === 'us') wins++;
    else if (outcome.result === 'them') losses++;
    else draws++;
    if (outcome.blocked) blocked++;
    plies += outcome.plies;
    pointsFor += outcome.score.us;
    pointsAgainst += outcome.score.them;
  }

  const decisive = wins + losses;
  return {
    games,
    us: wins,
    them: losses,
    draws,
    blocked,
    winRate: decisive > 0 ? wins / decisive : 0.5,
    pointsFor,
    pointsAgainst,
    pointsPerGame: (pointsFor - pointsAgainst) / games,
    avgPlies: plies / games,
  };
}
