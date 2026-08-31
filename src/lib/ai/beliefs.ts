import type { PipValue, Stone } from '../../types/domino';
import { idHasValue, isDouble } from '../../types/domino';
import type { PlayerId } from '../../types/game';
import { ALL_PLAYERS } from '../../types/game';
import { generateFullSet } from '../dominoSet';
import type { ReplayState } from '../replay';
import { MAX_DOUBLES_PER_HAND, MAX_NON_DOUBLES_PER_VALUE } from '../handRules';

/** Re-exported so the deduction and the UI validator cannot drift apart. */
export { MAX_DOUBLES_PER_HAND, MAX_NON_DOUBLES_PER_VALUE };

export interface Belief {
  me: PlayerId;
  /** The three players whose hands are hidden. */
  others: PlayerId[];
  handSize: Record<PlayerId, number>;
  /** Values a player has passed on, and so certainly holds none of (§2.6). */
  banned: Record<PlayerId, Set<PipValue>>;
  /** Non-double stones carrying each value that a player may still be holding. */
  maxNonDouble: Record<PlayerId, number[]>;
  /** Doubles a player may still be holding, given the four-doubles cap. */
  maxDoubles: Record<PlayerId, number>;
  /** Unresolved stones: id -> the players who could still hold it. */
  possible: Map<string, Set<PlayerId>>;
  /** Stones pinned to an owner by deduction alone. */
  known: Map<string, PlayerId>;
  /** Set when no legal deal explains the log — almost always a mis-logged move. */
  contradiction: boolean;
}

/** Stones a player could be holding, proven ones included. */
export function candidatesFor(belief: Belief, player: PlayerId): string[] {
  const out: string[] = [];
  for (const [id, owner] of belief.known) if (owner === player) out.push(id);
  for (const [id, holders] of belief.possible) if (holders.has(player)) out.push(id);
  return out;
}

export function knownCount(belief: Belief, player: PlayerId): number {
  let n = 0;
  for (const owner of belief.known.values()) if (owner === player) n++;
  return n;
}

/** True when `player` is proven to hold no stone carrying `value`. */
export function holdsNoneOf(belief: Belief, player: PlayerId, value: PipValue): boolean {
  for (const id of candidatesFor(belief, player)) {
    if (idHasValue(id, value)) return false;
  }
  return true;
}

interface Options {
  /**
   * Game 1 is opened with 1-1 by whoever was dealt it, so naming the opener pins
   * that stone before it is ever played.
   */
  openingStoneId?: string | null;
}

/**
 * Everything the log proves about the hidden hands, propagated to a fixed point.
 *
 * Every rule here is a deduction, never an estimate: if this says a player holds
 * a stone, they hold it. Guessing is Phase 3's job, and it is built on top of
 * whatever this leaves unresolved.
 */
export function deriveBeliefs(
  state: ReplayState,
  myHand: Stone[],
  me: PlayerId,
  options: Options = {},
): Belief {
  const others = ALL_PLAYERS.filter((p) => p !== me);
  const myIds = new Set(myHand.map((s) => s.id));

  const stonesById = new Map<string, Stone>();
  const unknown: Stone[] = [];
  for (const stone of generateFullSet()) {
    stonesById.set(stone.id, stone);
    if (!state.playedIds.has(stone.id) && !myIds.has(stone.id)) unknown.push(stone);
  }

  const handSize = { ...state.counts };
  const possible = new Map<string, Set<PlayerId>>();
  for (const stone of unknown) possible.set(stone.id, new Set(others));
  const known = new Map<string, PlayerId>();

  // --- Passes are permanent certainties (§2.6) ---
  const banned = {} as Record<PlayerId, Set<PipValue>>;
  for (const p of ALL_PLAYERS) banned[p] = new Set(state.banned[p]);
  for (const player of others) {
    for (const value of banned[player]) {
      for (const stone of unknown) {
        if (stone.a === value || stone.b === value) possible.get(stone.id)?.delete(player);
      }
    }
  }

  // --- The dealing cap, counted against what each player has already played (§2.5) ---
  const maxNonDouble = {} as Record<PlayerId, number[]>;
  const maxDoubles = {} as Record<PlayerId, number>;
  for (const p of ALL_PLAYERS) {
    maxNonDouble[p] = Array(7).fill(MAX_NON_DOUBLES_PER_VALUE);
    maxDoubles[p] = MAX_DOUBLES_PER_HAND;
  }
  for (const placed of state.chain) {
    if (isDouble(placed.stone)) {
      // A hand holds at most four doubles, so every one played is one fewer
      // they can still be sitting on.
      maxDoubles[placed.playerId]--;
      continue;
    }
    maxNonDouble[placed.playerId][placed.stone.a]--;
    maxNonDouble[placed.playerId][placed.stone.b]--;
  }

  const belief: Belief = {
    me,
    others,
    handSize,
    banned,
    maxNonDouble,
    maxDoubles,
    possible,
    known,
    contradiction: false,
  };

  if (options.openingStoneId && possible.has(options.openingStoneId)) {
    possible.set(options.openingStoneId, new Set([state.opener]));
  }

  propagate(belief, stonesById);
  return belief;
}

function fail(belief: Belief) {
  belief.contradiction = true;
}

function assign(belief: Belief, id: string, player: PlayerId) {
  belief.possible.delete(id);
  belief.known.set(id, player);
}

/** Stones carrying `value` that are still unresolved. */
function unresolvedWith(belief: Belief, stonesById: Map<string, Stone>, value: PipValue): Stone[] {
  const out: Stone[] = [];
  for (const id of belief.possible.keys()) {
    const stone = stonesById.get(id)!;
    if (stone.a === value || stone.b === value) out.push(stone);
  }
  return out;
}

function countKnownNonDoubles(belief: Belief, stonesById: Map<string, Stone>, player: PlayerId, value: PipValue): number {
  let n = 0;
  for (const [id, owner] of belief.known) {
    if (owner !== player) continue;
    const stone = stonesById.get(id)!;
    if (isDouble(stone)) continue;
    if (stone.a === value || stone.b === value) n++;
  }
  return n;
}

function propagate(belief: Belief, stonesById: Map<string, Stone>) {
  const { others } = belief;

  for (let pass = 0; pass < 40; pass++) {
    let changed = false;

    // 1. A stone with a single possible holder belongs to them.
    for (const [id, holders] of [...belief.possible]) {
      if (holders.size === 0) return fail(belief);
      if (holders.size === 1) {
        assign(belief, id, [...holders][0]);
        changed = true;
      }
    }

    // 2. Cap arithmetic. Once a player's non-double quota for a value is used
    //    up, they cannot be holding any more of that suit — the §2.5 deduction.
    for (const player of others) {
      for (let v = 0 as PipValue; v <= 6; v++) {
        const cap = belief.maxNonDouble[player][v];
        if (cap < 0) return fail(belief);
        const held = countKnownNonDoubles(belief, stonesById, player, v);
        if (held > cap) return fail(belief);
        if (held < cap) continue;
        for (const stone of unresolvedWith(belief, stonesById, v)) {
          if (isDouble(stone)) continue;
          const holders = belief.possible.get(stone.id)!;
          if (holders.delete(player)) changed = true;
        }
      }
    }

    // 2b. The doubles cap, the same arithmetic applied to doubles as a group.
    for (const player of others) {
      const cap = belief.maxDoubles[player];
      if (cap < 0) return fail(belief);
      let held = 0;
      for (const [id, owner] of belief.known) {
        if (owner === player && isDouble(stonesById.get(id)!)) held++;
      }
      if (held > cap) return fail(belief);
      if (held < cap) continue;
      for (const [id, holders] of belief.possible) {
        if (!isDouble(stonesById.get(id)!)) continue;
        if (holders.delete(player)) changed = true;
      }
    }

    // 3. Hand sizes. A player whose candidates exactly fill their hand holds all
    //    of them; one whose hand is already accounted for holds nothing else.
    for (const player of others) {
      const assigned = knownCount(belief, player);
      const size = belief.handSize[player];
      if (assigned > size) return fail(belief);

      const open: string[] = [];
      for (const [id, holders] of belief.possible) if (holders.has(player)) open.push(id);

      if (assigned + open.length < size) return fail(belief);
      if (assigned === size) {
        for (const id of open) {
          belief.possible.get(id)!.delete(player);
          changed = true;
        }
      } else if (assigned + open.length === size) {
        for (const id of open) assign(belief, id, player);
        changed = true;
      }
    }

    // 4. Two players whose candidate stones exactly fill both their hands leave
    //    nothing over for the third.
    for (let i = 0; i < others.length; i++) {
      for (let j = i + 1; j < others.length; j++) {
        const pair = [others[i], others[j]];
        const needed = pair.reduce(
          (sum, p) => sum + belief.handSize[p] - knownCount(belief, p),
          0,
        );
        const confined: string[] = [];
        for (const [id, holders] of belief.possible) {
          if ([...holders].every((h) => pair.includes(h))) confined.push(id);
        }
        if (confined.length > needed) return fail(belief);
        if (confined.length !== needed) continue;
        // Their two hands are now entirely spoken for by the confined stones, so
        // neither of them can be holding anything else.
        const confinedIds = new Set(confined);
        for (const [id, holders] of belief.possible) {
          if (confinedIds.has(id)) continue;
          for (const p of pair) {
            if (holders.delete(p)) changed = true;
          }
          if (holders.size === 0) return fail(belief);
        }
      }
    }

    // 5. Per-value feasibility. If the other two players cannot between them
    //    absorb every remaining stone of a suit, the rest are forced onto the
    //    third — and when that forces all of their candidates, they are pinned.
    for (let v = 0 as PipValue; v <= 6; v++) {
      const pool = unresolvedWith(belief, stonesById, v);
      if (pool.length === 0) continue;

      const capacity = new Map<PlayerId, number>();
      const mine = new Map<PlayerId, Stone[]>();
      for (const player of others) {
        const cap =
          belief.maxNonDouble[player][v] - countKnownNonDoubles(belief, stonesById, player, v);
        const slots = belief.handSize[player] - knownCount(belief, player);
        const canTakeDouble = pool.some(
          (s) => isDouble(s) && belief.possible.get(s.id)!.has(player),
        );
        capacity.set(player, Math.min(Math.max(cap, 0) + (canTakeDouble ? 1 : 0), slots));
        mine.set(
          player,
          pool.filter((s) => belief.possible.get(s.id)!.has(player)),
        );
      }

      for (const player of others) {
        const elsewhere = others
          .filter((p) => p !== player)
          .reduce((sum, p) => sum + capacity.get(p)!, 0);
        const required = pool.length - elsewhere;
        const candidates = mine.get(player)!;
        // They must take at least `required` of this suit, so it cannot exceed
        // either the stones they could hold or their own capacity for the suit.
        if (required > candidates.length) return fail(belief);
        if (required > capacity.get(player)!) return fail(belief);
        if (required > 0 && required === candidates.length) {
          for (const stone of candidates) {
            if (belief.possible.has(stone.id)) {
              assign(belief, stone.id, player);
              changed = true;
            }
          }
        }
      }
    }

    if (!changed) return;
  }
}
