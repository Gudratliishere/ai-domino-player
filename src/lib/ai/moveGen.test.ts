import { describe, expect, it } from 'vitest';
import { makeStone } from '../../types/domino';
import { endsKey, hasLegalMove, legalMoves } from './moveGen';

describe('legalMoves', () => {
  it('offers every stone on an empty table, with no side to choose', () => {
    const hand = [makeStone(1, 1), makeStone(3, 4), makeStone(0, 6)];
    const moves = legalMoves(hand, { left: null, right: null });
    expect(moves).toHaveLength(3);
    expect(moves.every((m) => m.side === undefined)).toBe(true);
    expect(moves[1].resultEnds).toEqual({ left: 3, right: 4 });
  });

  it('collapses the two sides when the ends are equal', () => {
    // Left and right both show 3, so playing 3-6 either way reaches the same
    // position — one move, not two (§2.1).
    const moves = legalMoves([makeStone(3, 6)], { left: 3, right: 3 });
    expect(moves).toHaveLength(1);
    expect(endsKey(moves[0].resultEnds)).toBe('3,6');
  });

  it('keeps both sides when they lead somewhere different', () => {
    const moves = legalMoves([makeStone(3, 5)], { left: 3, right: 5 });
    expect(moves).toHaveLength(2);
    expect(moves.map((m) => endsKey(m.resultEnds)).sort()).toEqual(['3,3', '5,5']);
  });

  it('gives a double a single move when only one end serves it', () => {
    const moves = legalMoves([makeStone(3, 3)], { left: 3, right: 5 });
    expect(moves).toHaveLength(1);
    expect(moves[0].resultEnds).toEqual({ left: 3, right: 5 });
  });

  it('omits stones that fit neither end', () => {
    const hand = [makeStone(0, 1), makeStone(3, 4)];
    expect(legalMoves(hand, { left: 5, right: 6 })).toEqual([]);
    expect(hasLegalMove(hand, { left: 5, right: 6 })).toBe(false);
    expect(hasLegalMove(hand, { left: 5, right: 4 })).toBe(true);
  });

  it('keeps the branching factor small in a realistic hand', () => {
    const hand = [
      makeStone(0, 3),
      makeStone(3, 3),
      makeStone(3, 6),
      makeStone(1, 2),
      makeStone(5, 5),
    ];
    const moves = legalMoves(hand, { left: 3, right: 3 });
    // 0-3, 3-3 and 3-6 all serve a 3, each collapsing to one move.
    expect(moves).toHaveLength(3);
  });
});

describe('endsKey', () => {
  it('is symmetric under swapping the ends', () => {
    expect(endsKey({ left: 2, right: 6 })).toBe(endsKey({ left: 6, right: 2 }));
    expect(endsKey({ left: null, right: null })).toBe('empty');
  });
});
