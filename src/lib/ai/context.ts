import type { PipValue, Stone } from '../../types/domino';
import { stoneId, stoneFromId as stoneOf } from '../../types/domino';
import type { ChainEnds, PlayerId, PlayerNames } from '../../types/game';
import { DEFAULT_PLAYER_NAMES, TEAMMATE } from '../../types/game';
import type { Messages } from '../../i18n/types';
import { en } from '../../i18n/en';
import type { ReplayState } from '../replay';
import { type Belief, deriveBeliefs } from './beliefs';

/** Indexed by pip value 0-6. */
export type PerValue = number[];

export const TOTAL_PIPS = 168;
/** Every value appears on exactly 7 stones (v-0 … v-6). */
export const STONES_PER_VALUE = 7;

/**
 * Everything a player may legitimately use to choose a move: their own hand plus
 * public history. Deliberately excludes the other hands — a simulated player who
 * can see the deal produces strategy fusion, and the engine then overrates traps
 * a real opponent would walk straight past (§3).
 */
export interface PolicyContext {
  me: PlayerId;
  partner: PlayerId;
  opponents: PlayerId[];
  /**
   * Display names for the seats and the language to write in, used only in the
   * rationale text a move carries. Nothing the engine decides may depend on
   * either — they default to the seat letters and English, and a playout never
   * needs anything else.
   */
  names: PlayerNames;
  messages: Messages;
  hand: Stone[];
  ends: ChainEnds;
  counts: Record<PlayerId, number>;
  banned: Record<PlayerId, Set<PipValue>>;
  /** Stones on the table carrying each value. */
  playedPerValue: PerValue;
  /** Stones in my hand carrying each value. */
  myPerValue: PerValue;
  /** Stones neither played nor in my hand, carrying each value. */
  unseenPerValue: PerValue;
  /**
   * Stones each player has *played* carrying each value.
   *
   * Convention is to lead from your long suit, so this is the practical read on
   * what somebody is strong in — most usefully your partner. It is a soft signal
   * and a pass overrides it outright.
   */
  playedByPlayer: Record<PlayerId, PerValue>;
  /** Ids of the stones in the hidden pool, for exact membership tests. */
  unseenIds: Set<string>;
  unseenCount: number;
  playedPips: number;
  /**
   * What the log *proves* about the hidden hands, when it has been derived.
   * Null inside playouts: deriving it costs far more than the playout itself,
   * and the whole point of a playout is to be cheap.
   */
  belief: Belief | null;
  /** Per-player candidate stones, precomputed from `belief` so scoring stays cheap. */
  pools: Record<PlayerId, BeliefPool> | null;
}

export interface BeliefPool {
  /** Stones proven to be theirs. */
  known: Stone[];
  /** Stones they might hold; the rest of their hand is drawn from these. */
  possible: Stone[];
  /** Hand slots not yet accounted for by `known`. */
  freeSlots: number;
}

export function stonePips(stone: Stone): number {
  return stone.a + stone.b;
}

export function handPips(hand: Stone[]): number {
  let total = 0;
  for (const s of hand) total += stonePips(s);
  return total;
}

function tally(stones: Stone[]): PerValue {
  const per: PerValue = [0, 0, 0, 0, 0, 0, 0];
  for (const s of stones) {
    per[s.a]++;
    if (s.b !== s.a) per[s.b]++;
  }
  return per;
}

export interface ContextOptions {
  /** Names for the seats, for the rationale text only. */
  names?: PlayerNames;
  /** The language the rationale is written in. */
  messages?: Messages;
}

export function contextFrom(
  state: ReplayState,
  hand: Stone[],
  me: PlayerId,
  options: ContextOptions = {},
): PolicyContext {
  const played = state.chain.map((p) => p.stone);
  const playedPerValue = tally(played);
  const myPerValue = tally(hand);

  const playedByPlayer = {
    A: [0, 0, 0, 0, 0, 0, 0],
    B: [0, 0, 0, 0, 0, 0, 0],
    C: [0, 0, 0, 0, 0, 0, 0],
    D: [0, 0, 0, 0, 0, 0, 0],
  } as Record<PlayerId, PerValue>;
  for (const placed of state.chain) {
    for (const v of placed.exposed) playedByPlayer[placed.playerId][v]++;
  }

  const unseenPerValue: PerValue = [];
  for (let v = 0; v <= 6; v++) {
    unseenPerValue[v] = STONES_PER_VALUE - playedPerValue[v] - myPerValue[v];
  }

  const unseenIds = new Set<string>();
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      const id = stoneId(a as PipValue, b as PipValue);
      if (!state.playedIds.has(id) && !hand.some((s) => s.id === id)) unseenIds.add(id);
    }
  }

  const partner = TEAMMATE[me];
  return {
    me,
    partner,
    names: options.names ?? DEFAULT_PLAYER_NAMES,
    messages: options.messages ?? en,
    opponents: (Object.keys(state.counts) as PlayerId[]).filter(
      (p) => p !== me && p !== partner,
    ),
    hand,
    ends: state.ends,
    counts: state.counts,
    banned: state.banned,
    playedPerValue,
    myPerValue,
    unseenPerValue,
    playedByPlayer,
    unseenIds,
    unseenCount: unseenIds.size,
    playedPips: handPips(played),
    belief: null,
    pools: null,
  };
}

/**
 * A context that has run the certainty engine first.
 *
 * Use this for real recommendations, never inside a playout — Phase 2 costs
 * roughly what a whole playout costs, and it would swamp Phase 3's search.
 */
export function contextWithBeliefs(
  state: ReplayState,
  hand: Stone[],
  me: PlayerId,
  options: ContextOptions & { openingStoneId?: string | null } = {},
): PolicyContext {
  const ctx = contextFrom(state, hand, me, options);
  const belief = deriveBeliefs(state, hand, me, options);
  // A contradiction means the log does not describe a legal game, so every
  // deduction from it is void. Fall back to counting, which cannot be wrong.
  if (belief.contradiction) return { ...ctx, belief, pools: null };
  return { ...ctx, belief, pools: buildPools(belief) };
}

function buildPools(belief: Belief): Record<PlayerId, BeliefPool> {
  const pools = {} as Record<PlayerId, BeliefPool>;
  for (const player of [belief.me, ...belief.others]) {
    pools[player] = { known: [], possible: [], freeSlots: 0 };
  }
  for (const [id, owner] of belief.known) {
    pools[owner].known.push(stoneOf(id));
  }
  for (const [id, holders] of belief.possible) {
    for (const holder of holders) pools[holder].possible.push(stoneOf(id));
  }
  for (const player of belief.others) {
    pools[player].freeSlots = belief.handSize[player] - pools[player].known.length;
  }
  return pools;
}


/** A value is dead once all 7 stones carrying it are on the table (§2.4). */
export function isDeadValue(playedPerValue: PerValue, value: PipValue): boolean {
  return playedPerValue[value] >= STONES_PER_VALUE;
}
