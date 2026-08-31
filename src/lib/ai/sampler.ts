import type { Stone } from '../../types/domino';
import { isDouble, stoneFromId as stoneOf } from '../../types/domino';
import type { PlayerId } from '../../types/game';
import { type Belief, knownCount } from './beliefs';
import type { Random } from './rng';

export interface World {
  /** A complete, legal deal of the hidden stones. `me`'s hand is the real one. */
  hands: Record<PlayerId, Stone[]>;
}

export interface SampleStats {
  /** Deals attempted, including ones abandoned part-way. */
  attempts: number;
  /** Attempts that painted themselves into a corner and were restarted. */
  restarts: number;
}

const MAX_ATTEMPTS_PER_WORLD = 200;

/**
 * One consistent deal of the hidden stones.
 *
 * Assigns the most constrained stones first and weights each choice by how many
 * slots a player has left, which keeps the spread of deals roughly even rather
 * than crowding stones onto whoever happens to be checked first. Returns null if
 * this attempt runs out of legal placements; the caller retries.
 */
function attemptWorld(belief: Belief, myHand: Stone[], random: Random): World | null {
  const hands = { [belief.me]: [...myHand] } as Record<PlayerId, Stone[]>;
  const slots = {} as Record<PlayerId, number>;
  const allowance = {} as Record<PlayerId, number[]>;

  const doublesLeft = {} as Record<PlayerId, number>;
  for (const player of belief.others) {
    hands[player] = [];
    slots[player] = belief.handSize[player] - knownCount(belief, player);
    allowance[player] = belief.maxNonDouble[player].slice();
    doublesLeft[player] = belief.maxDoubles[player];
  }

  for (const [id, owner] of belief.known) {
    const stone = stoneOf(id);
    hands[owner].push(stone);
    if (isDouble(stone)) {
      doublesLeft[owner]--;
    } else {
      allowance[owner][stone.a]--;
      allowance[owner][stone.b]--;
    }
  }

  // Most constrained first, ties broken at random so successive worlds differ.
  const pending = [...belief.possible.entries()].map(([id, holders]) => ({
    stone: stoneOf(id),
    holders: [...holders],
    jitter: random(),
  }));
  pending.sort((x, y) => x.holders.length - y.holders.length || x.jitter - y.jitter);

  for (const { stone, holders } of pending) {
    const double = isDouble(stone);
    const candidates = holders.filter(
      (p) =>
        slots[p] > 0 &&
        (double
          ? doublesLeft[p] > 0
          : allowance[p][stone.a] > 0 && allowance[p][stone.b] > 0),
    );
    if (candidates.length === 0) return null;

    const total = candidates.reduce((sum, p) => sum + slots[p], 0);
    let pick = random() * total;
    let chosen = candidates[candidates.length - 1];
    for (const p of candidates) {
      pick -= slots[p];
      if (pick <= 0) {
        chosen = p;
        break;
      }
    }

    hands[chosen].push(stone);
    slots[chosen]--;
    if (double) {
      doublesLeft[chosen]--;
    } else {
      allowance[chosen][stone.a]--;
      allowance[chosen][stone.b]--;
    }
  }

  for (const player of belief.others) {
    if (slots[player] !== 0) return null;
  }
  return { hands };
}

export function sampleWorlds(
  belief: Belief,
  myHand: Stone[],
  count: number,
  random: Random,
): { worlds: World[]; stats: SampleStats } {
  const worlds: World[] = [];
  const stats: SampleStats = { attempts: 0, restarts: 0 };
  if (belief.contradiction) return { worlds, stats };

  for (let i = 0; i < count; i++) {
    let world: World | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_WORLD && world === null; attempt++) {
      stats.attempts++;
      world = attemptWorld(belief, myHand, random);
      if (world === null) stats.restarts++;
    }
    if (world) worlds.push(world);
  }
  return { worlds, stats };
}
