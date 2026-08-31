import { describe, expect, it } from 'vitest';
import { makeStone } from '../types/domino';
import type { GameScore } from './scoring';
import { applyGameScore } from './scoring';
import { openingRule } from './matchRules';
import { INITIAL_MATCH, type MatchState } from '../types/game';

const hand = [makeStone(2, 3), makeStone(0, 6)];

/** Plays a game worth `points` for `team` and returns the next game's match state. */
function next(match: MatchState, team: 'us' | 'them', points: number): MatchState {
  const score: GameScore = { us: 0, them: 0, carry: 0, seka: false, [team]: points };
  const after = applyGameScore(
    { written: match.seriesScore, air: match.air, target: match.target },
    score,
  );
  return {
    ...match,
    gameNumber: match.gameNumber + 1,
    seriesScore: after.written,
    air: after.air,
    previousWinner: team,
  };
}

describe('the opening across a whole match', () => {
  it('keeps 1-1 opening until a score is written, then hands it to the winner', () => {
    let m = INITIAL_MATCH;
    expect(openingRule(m, hand).forcedStoneId).toBe('1-1');

    // We win 9 — under 13, so nothing is written and 1-1 opens again.
    m = next(m, 'us', 9);
    expect(m.seriesScore).toEqual({ us: 0, them: 0 });
    expect(m.air.us).toBe(9);
    expect(openingRule(m, hand).forcedStoneId).toBe('1-1');

    // They win 7 — also under 13. Still 0-0, still 1-1.
    m = next(m, 'them', 7);
    expect(m.seriesScore).toEqual({ us: 0, them: 0 });
    expect(openingRule(m, hand).forcedStoneId).toBe('1-1');

    // We win 20 — over the threshold, so 20 + our 9 goes up and their 7 is wiped.
    m = next(m, 'us', 20);
    expect(m.seriesScore).toEqual({ us: 29, them: 0 });
    expect(m.air).toEqual({ us: 0, them: 0 });

    // Now the board is not empty, so the winner opens with any stone.
    const rule = openingRule(m, hand);
    expect(rule.forcedStoneId).toBeNull();
    expect(rule.candidates).toEqual(['A', 'C']);
  });
});
