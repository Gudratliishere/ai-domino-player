import { describe, expect, it } from 'vitest';
import { makeStone } from '../types/domino';
import { MAX_DOUBLES_PER_HAND, countDoubles, isLegalHand, wouldExceedHandLimit } from './handRules';

const s = makeStone;

describe('the per-value cap', () => {
  it('allows four of a value, or five with the double', () => {
    const fourFives = [s(0, 5), s(1, 5), s(2, 5), s(3, 5)];
    expect(isLegalHand(fourFives)).toBe(true);
    expect(isLegalHand([...fourFives, s(4, 5)])).toBe(false);
    expect(isLegalHand([...fourFives, s(5, 5)])).toBe(true);
  });

  it('blocks the fifth non-double as you pick a hand', () => {
    const fourFives = [s(0, 5), s(1, 5), s(2, 5), s(3, 5)];
    expect(wouldExceedHandLimit(fourFives, s(4, 5))).toBe(true);
    expect(wouldExceedHandLimit(fourFives, s(5, 5))).toBe(false);
  });
});

describe('the four-doubles cap', () => {
  it('allows four doubles but not five', () => {
    const four = [s(0, 0), s(1, 1), s(2, 2), s(3, 3)];
    expect(countDoubles(four)).toBe(MAX_DOUBLES_PER_HAND);
    expect(isLegalHand(four)).toBe(true);
    expect(isLegalHand([...four, s(4, 4)])).toBe(false);
  });

  it('blocks a fifth double as you pick a hand, but not a non-double', () => {
    const four = [s(0, 0), s(1, 1), s(2, 2), s(3, 3)];
    expect(wouldExceedHandLimit(four, s(4, 4))).toBe(true);
    expect(wouldExceedHandLimit(four, s(4, 5))).toBe(false);
  });
});
