import type { Stone } from '../types/domino';

export const MAX_STONES_PER_VALUE_WITHOUT_DOUBLE = 4;
export const MAX_STONES_PER_VALUE_WITH_DOUBLE = 5;

/** Counts stones in `stones` that contain `value`, and whether its double is among them. */
function countForValue(stones: Stone[], value: number): { total: number; hasDouble: boolean } {
  let total = 0;
  let hasDouble = false;
  for (const s of stones) {
    if (s.a === value || s.b === value) {
      total++;
      if (s.a === value && s.b === value) hasDouble = true;
    }
  }
  return { total, hasDouble };
}

/** A hand may not hold five or more doubles. */
export const MAX_DOUBLES_PER_HAND = 4;

export function countDoubles(stones: Stone[]): number {
  let n = 0;
  for (const s of stones) if (s.a === s.b) n++;
  return n;
}

/**
 * A hand may hold at most 4 stones carrying a given number, or 5 if the
 * double of that number is among them (the double is the only stone that
 * can push the count to 5) — and at most 4 doubles in total.
 */
export function wouldExceedHandLimit(selected: Stone[], candidate: Stone): boolean {
  if (candidate.a === candidate.b && countDoubles(selected) >= MAX_DOUBLES_PER_HAND) return true;

  const values = candidate.a === candidate.b ? [candidate.a] : [candidate.a, candidate.b];
  for (const value of values) {
    const { total, hasDouble } = countForValue(selected, value);
    const willHaveDouble = hasDouble || (candidate.a === candidate.b && candidate.a === value);
    const cap = willHaveDouble ? MAX_STONES_PER_VALUE_WITH_DOUBLE : MAX_STONES_PER_VALUE_WITHOUT_DOUBLE;
    if (total + 1 > cap) return true;
  }
  return false;
}

/**
 * The same cap stated as one number.
 *
 * "At most 4 of a value, or 5 with its double" says the same thing twice about
 * the *non-doubles*: with the double, 4 + 1 = 5; without it, 4. So a hand holds
 * at most four non-double stones carrying any value, and that form is usable
 * even when nobody knows where the double is — which is what makes it a
 * deduction rule and not merely a validator (§2.5).
 */
export const MAX_NON_DOUBLES_PER_VALUE = 4;

/** Whether a complete hand satisfies both dealing caps. */
export function isLegalHand(stones: Stone[]): boolean {
  if (countDoubles(stones) > MAX_DOUBLES_PER_HAND) return false;
  for (let value = 0; value <= 6; value++) {
    const { total, hasDouble } = countForValue(stones, value);
    const cap = hasDouble ? MAX_STONES_PER_VALUE_WITH_DOUBLE : MAX_STONES_PER_VALUE_WITHOUT_DOUBLE;
    if (total > cap) return false;
  }
  return true;
}
