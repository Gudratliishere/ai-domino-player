import type { Stone } from '../../types/domino';
import type { PlayerId } from '../../types/game';
import { ALL_PLAYERS } from '../../types/game';
import { generateFullSet } from '../dominoSet';
import { HAND_SIZE } from '../replay';
import { isLegalHand } from '../handRules';
import { type Random, shuffle } from './rng';

export type Deal = Record<PlayerId, Stone[]>;

/**
 * The dealing constraint lives in handRules — the harness has to respect exactly
 * the same rule the UI validates against, or every belief test would be tuned
 * against deals that cannot happen.
 */
export { isLegalHand };

export function isLegalDeal(deal: Deal): boolean {
  return ALL_PLAYERS.every((p) => isLegalHand(deal[p]));
}

/** Deals all 28 stones, redealing until every hand is legal. */
export function dealHands(random: Random, maxAttempts = 500): Deal {
  const full = generateFullSet();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const stones = shuffle(full.slice(), random);
    const deal = {} as Deal;
    ALL_PLAYERS.forEach((p, i) => {
      deal[p] = stones.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE);
    });
    if (isLegalDeal(deal)) return deal;
  }
  throw new Error('could not produce a legal deal');
}
