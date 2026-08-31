import type { PipValue, Stone } from '../../types/domino';
import type { ChainEnds, Side } from '../../types/game';
import { playableSides, resolvePlacement } from '../gameLogic';

export interface Candidate {
  stone: Stone;
  /** Undefined for the opening move, where there is no side to choose. */
  side: Side | undefined;
  /** The ends this move produces. Kept ordered, because the user has to place the stone. */
  resultEnds: ChainEnds;
  /** Identity of the move for the engine: the stone, plus its end-pair as a set. */
  key: string;
}

/** `{3,6}` and `{6,3}` are the same position, so they normalise to one key (§2.1). */
export function endsKey(ends: ChainEnds): string {
  const { left, right } = ends;
  if (left === null || right === null) return 'empty';
  return left <= right ? `${left},${right}` : `${right},${left}`;
}

export function candidateKey(stone: Stone, ends: ChainEnds): string {
  return `${stone.id}@${endsKey(ends)}`;
}

/**
 * Every legal move, with duplicates collapsed.
 *
 * Nothing in this game depends on the shape of the chain — only on the two open
 * ends — so a move that produces the same unordered end-pair with the same stone
 * is the same move played twice. That is what makes the real branching factor
 * 2-4 rather than 14: on equal ends, or with a double, both sides coincide.
 */
export function legalMoves(hand: Stone[], ends: ChainEnds): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();

  const push = (stone: Stone, side: Side | undefined) => {
    const { newEnds } = resolvePlacement(stone, side, ends);
    const key = candidateKey(stone, newEnds);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ stone, side, resultEnds: newEnds, key });
  };

  if (ends.left === null || ends.right === null) {
    for (const stone of hand) push(stone, undefined);
    return out;
  }

  for (const stone of hand) {
    for (const side of playableSides(stone, ends)) push(stone, side);
  }
  return out;
}

export function hasLegalMove(hand: Stone[], ends: ChainEnds): boolean {
  if (ends.left === null || ends.right === null) return hand.length > 0;
  return hand.some((s) => playableSides(s, ends).length > 0);
}

/** The values a stone would leave open, as a pair. */
export function endValues(ends: ChainEnds): PipValue[] {
  if (ends.left === null || ends.right === null) return [];
  return ends.left === ends.right ? [ends.left] : [ends.left, ends.right];
}
