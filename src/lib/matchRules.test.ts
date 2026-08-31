import { describe, expect, it } from 'vitest';
import { makeStone } from '../types/domino';
import type { MatchState } from '../types/game';
import { matchWinner } from '../types/game';
import { openingRule } from './matchRules';

const GAME_1: MatchState = {
  gameNumber: 1,
  seriesScore: { us: 0, them: 0 },
  previousWinner: null,
  target: 101,
  pot: 0,
  air: { us: 0, them: 0 },
};
const withDouble = [makeStone(1, 1), makeStone(0, 6)];
const without = [makeStone(2, 3), makeStone(0, 6)];

describe('openingRule', () => {
  it('makes me the opener in game 1 when I hold 1-1, and forces the stone', () => {
    const rule = openingRule(GAME_1, withDouble);
    expect(rule.candidates).toEqual(['A']);
    expect(rule.forcedStoneId).toBe('1-1');
  });

  it('asks which opponent holds 1-1 otherwise', () => {
    const rule = openingRule(GAME_1, without);
    expect(rule.candidates).toEqual(['B', 'C', 'D']);
    expect(rule.forcedStoneId).toBe('1-1');
  });

  it('lets the winning team open later games, with any stone', () => {
    const theyWon: MatchState = {
      gameNumber: 2,
      seriesScore: { us: 0, them: 1 },
      previousWinner: 'them',
      target: 101,
      pot: 0,
      air: { us: 0, them: 0 },
    };
    expect(openingRule(theyWon, without).candidates).toEqual(['B', 'D']);
    expect(openingRule(theyWon, without).forcedStoneId).toBeNull();

    const weWon: MatchState = { ...theyWon, previousWinner: 'us' };
    expect(openingRule(weWon, without).candidates).toEqual(['A', 'C']);
  });

  it('allows any opener after a seka, once the match is on the board', () => {
    // Nobody won the last game, so there is no winning team to open. That only
    // arises after someone has written — while the board is 0-0, 1-1 opens.
    const afterSeka: MatchState = {
      gameNumber: 4,
      seriesScore: { us: 40, them: 0 },
      previousWinner: null,
      target: 101,
      pot: 24,
      air: { us: 0, them: 0 },
    };
    expect(openingRule(afterSeka, without).candidates).toEqual(['A', 'B', 'C', 'D']);
    expect(openingRule(afterSeka, without).forcedStoneId).toBeNull();
  });

  it('still opens with 1-1 after a seka while the board is empty', () => {
    const early: MatchState = {
      gameNumber: 2,
      seriesScore: { us: 0, them: 0 },
      previousWinner: null,
      target: 101,
      pot: 24,
      air: { us: 0, them: 0 },
    };
    expect(openingRule(early, without).forcedStoneId).toBe('1-1');
  });
});

describe('match completion', () => {
  it('declares a winner only when a team reaches the points target', () => {
    const base: MatchState = {
      gameNumber: 4,
      seriesScore: { us: 88, them: 61 },
      previousWinner: 'us',
      target: 101,
      pot: 0,
      air: { us: 0, them: 0 },
    };
    expect(matchWinner(base)).toBeNull();
    expect(matchWinner({ ...base, seriesScore: { us: 101, them: 61 } })).toBe('us');
    expect(matchWinner({ ...base, seriesScore: { us: 88, them: 104 } })).toBe('them');
  });
});

describe('1-1 keeps opening until someone is on the board', () => {
  const base: MatchState = {
    gameNumber: 4,
    seriesScore: { us: 0, them: 0 },
    previousWinner: 'us',
    target: 101,
    pot: 0,
    air: { us: 0, them: 0 },
  };

  it('opens with 1-1 in a later game while the score is still 0-0', () => {
    const rule = openingRule(base, without);
    expect(rule.forcedStoneId).toBe('1-1');
    expect(rule.candidates).toEqual(['B', 'C', 'D']);
  });

  it('still opens with 1-1 when both sides have points in the air', () => {
    // 21 and 9 hanging, nothing written: air is not a score.
    const rule = openingRule({ ...base, air: { us: 21, them: 9 } }, without);
    expect(rule.forcedStoneId).toBe('1-1');
  });

  it('names us as the forced opener when we hold 1-1', () => {
    const rule = openingRule({ ...base, air: { us: 12, them: 0 } }, withDouble);
    expect(rule.candidates).toEqual(['A']);
    expect(rule.forcedStoneId).toBe('1-1');
  });

  it('hands the opening to the last winner as soon as anything is written', () => {
    const rule = openingRule({ ...base, seriesScore: { us: 34, them: 0 } }, without);
    expect(rule.forcedStoneId).toBeNull();
    expect(rule.candidates).toEqual(['A', 'C']);
  });

  it('does the same when it is the opponents who are on the board', () => {
    const rule = openingRule(
      { ...base, seriesScore: { us: 0, them: 18 }, previousWinner: 'them' },
      without,
    );
    expect(rule.forcedStoneId).toBeNull();
    expect(rule.candidates).toEqual(['B', 'D']);
  });
});
