import type { PipValue, Stone } from '../types/domino';
import type { ChainEnds, Side } from '../types/game';

export function otherValue(stone: Stone, matched: PipValue): PipValue {
  return stone.a === matched ? stone.b : stone.a;
}

/** Which open ends (if any) a stone can legally be played against. */
export function playableSides(stone: Stone, ends: ChainEnds): Side[] {
  if (ends.left === null || ends.right === null) return [];
  const sides: Side[] = [];
  if (stone.a === ends.left || stone.b === ends.left) sides.push('left');
  if (stone.a === ends.right || stone.b === ends.right) sides.push('right');
  return sides;
}

export function canPlay(stone: Stone, ends: ChainEnds): boolean {
  return ends.left === null || playableSides(stone, ends).length > 0;
}

export function resolvePlacement(
  stone: Stone,
  side: Side | undefined,
  ends: ChainEnds,
): { displayA: PipValue; displayB: PipValue; newEnds: ChainEnds } {
  if (ends.left === null || ends.right === null) {
    return { displayA: stone.a, displayB: stone.b, newEnds: { left: stone.a, right: stone.b } };
  }
  if (side === 'left') {
    const matched = ends.left;
    const other = otherValue(stone, matched);
    return { displayA: other, displayB: matched, newEnds: { left: other, right: ends.right } };
  }
  const matched = ends.right;
  const other = otherValue(stone, matched);
  return { displayA: matched, displayB: other, newEnds: { left: ends.left, right: other } };
}
