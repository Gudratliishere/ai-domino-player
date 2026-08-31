import { type PipValue, type Stone, makeStone } from '../types/domino';

/** All 28 stones of a standard double-six set. */
export function generateFullSet(): Stone[] {
  const stones: Stone[] = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      stones.push(makeStone(a as PipValue, b as PipValue));
    }
  }
  return stones;
}
