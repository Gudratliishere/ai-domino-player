import type { PipValue, Stone } from '../../types/domino';
import type { ChainEnds, PlayerId, Side } from '../../types/game';
import { ALL_PLAYERS } from '../../types/game';
import { generateFullSet } from '../dominoSet';
import { canPlay, resolvePlacement } from '../gameLogic';
import { type ReplayState, initialState } from '../replay';
import { type PolicyContext, contextFrom, contextWithBeliefs } from './context';

export interface Scenario {
  /**
   * Stones on the table whose player does not matter to the test. They are
   * attributed to `me`, whose dealing caps the belief engine never consults —
   * so they cannot manufacture a deduction about anybody else.
   */
  played?: Stone[];
  /** Stones on the table attributed to the player who actually played them. */
  playedBy?: Partial<Record<PlayerId, Stone[]>>;
  /** The acting player's hand. */
  hand: Stone[];
  ends: ChainEnds;
  /** Stone counts for the three players other than `me`. Must sum to the hidden pool. */
  counts: Partial<Record<PlayerId, number>>;
  /** Values each player has demonstrably passed on. */
  banned?: Partial<Record<PlayerId, PipValue[]>>;
  turn?: PlayerId;
  me?: PlayerId;
}

/**
 * Builds a mid-game position directly, without replaying a log to reach it.
 *
 * Hand-built scenarios with the answer worked out on paper are where correctness
 * actually lives (§5), and reaching a specific late-game position by playing a
 * legal game to it is impractical.
 */
export function scenarioState(scenario: Scenario): ReplayState {
  const me = scenario.me ?? 'A';
  const state = initialState(scenario.turn ?? me);

  const placements: { stone: Stone; playerId: PlayerId }[] = [];
  for (const stone of scenario.played ?? []) placements.push({ stone, playerId: me });
  for (const [player, stones] of Object.entries(scenario.playedBy ?? {})) {
    for (const stone of stones as Stone[]) placements.push({ stone, playerId: player as PlayerId });
  }

  // Walk the placements in the order given, as if each were played onto a
  // growing chain, so that `exposed` means the same here as it does in a real
  // log. Scenarios that care list their stones in play order; ones that do not
  // may describe a chain that never joins up, and those fall back to "both
  // halves", which is what you would assume knowing nothing.
  let live: ChainEnds = { left: null, right: null };
  state.chain = placements.map(({ stone, playerId }) => {
    const both = stone.a === stone.b ? [stone.a] : [stone.a, stone.b];
    if (live.left === null || !canPlay(stone, live)) {
      const ends = live.left === null ? { left: stone.a, right: stone.b } : live;
      live = ends;
      return { stone, playerId, displayA: stone.a, displayB: stone.b, exposed: both };
    }
    const side: Side = stone.a === live.left || stone.b === live.left ? 'left' : 'right';
    const { displayA, displayB, newEnds } = resolvePlacement(stone, side, live);
    live = newEnds;
    return {
      stone,
      playerId,
      displayA,
      displayB,
      exposed: [side === 'left' ? displayA : displayB],
    };
  });
  state.playedIds = new Set(placements.map((p) => p.stone.id));
  state.ends = scenario.ends;
  state.turn = scenario.turn ?? me;

  state.counts[me] = scenario.hand.length;
  for (const p of ALL_PLAYERS) {
    if (p === me) continue;
    const count = scenario.counts[p];
    if (count === undefined) throw new Error(`scenario is missing a stone count for ${p}`);
    state.counts[p] = count;
  }

  for (const [player, values] of Object.entries(scenario.banned ?? {})) {
    state.banned[player as PlayerId] = new Set(values as PipValue[]);
  }

  // Closed accounting (§2.2): the hidden pool and the other hands must agree
  // exactly, or every probability computed from this scenario is nonsense.
  const hidden = generateFullSet().length - state.playedIds.size - scenario.hand.length;
  const claimed = ALL_PLAYERS.filter((p) => p !== me).reduce((sum, p) => sum + state.counts[p], 0);
  if (hidden !== claimed) {
    throw new Error(`scenario is inconsistent: ${hidden} hidden stones but counts sum to ${claimed}`);
  }

  return state;
}

export function scenarioContext(scenario: Scenario): PolicyContext {
  const me = scenario.me ?? 'A';
  return contextFrom(scenarioState(scenario), scenario.hand, me);
}

/** The same position, with the certainty engine run over it first. */
export function scenarioBeliefContext(scenario: Scenario): PolicyContext {
  const me = scenario.me ?? 'A';
  return contextWithBeliefs(scenarioState(scenario), scenario.hand, me);
}

/** The stones of the full set that are in neither list. */
export function complementOf(...taken: Stone[][]): Stone[] {
  const takenIds = new Set(taken.flat().map((s) => s.id));
  return generateFullSet().filter((s) => !takenIds.has(s.id));
}
