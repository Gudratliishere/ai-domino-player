import { describe, expect, it } from 'vitest';
import { type Stone, makeStone } from '../types/domino';
import type { PlayerId } from '../types/game';
import {
  AIR_WEIGHT,
  type GameScore,
  MATCH_TARGET,
  type Standing,
  WRITE_THRESHOLD,
  applyGameScore,
  matchValue,
  pointsSwing,
  scoreGame,
} from './scoring';

const s = makeStone;

function hands(a: Stone[], b: Stone[], c: Stone[], d: Stone[]): Record<PlayerId, Stone[]> {
  return { A: a, B: b, C: c, D: d };
}

describe('going out', () => {
  it('scores the opponents pips, not everyone else', () => {
    // A goes out. B holds 6-6 (12) and D holds 4-5 (9) — 21 to us. Partner C's
    // remaining 1-1 does not count against us.
    const score = scoreGame({
      winner: 'A',
      hands: hands([], [s(6, 6)], [s(1, 1)], [s(4, 5)]),
    });
    expect(score).toEqual({ us: 21, them: 0, carry: 0, seka: false });
    expect(pointsSwing(score)).toBe(21);
  });

  it('scores against us when an opponent goes out', () => {
    const score = scoreGame({
      winner: 'B',
      hands: hands([s(6, 6)], [], [s(3, 4)], [s(0, 1)]),
    });
    // Our team held 12 + 7 = 19.
    expect(score).toEqual({ us: 0, them: 19, carry: 0, seka: false });
    expect(pointsSwing(score)).toBe(-19);
  });
});

describe('blocked games', () => {
  it('gives the lighter team the opponents pips', () => {
    // Us 4 + 9 = 13, them 11 + 7 = 18. We are lighter, so we score their 18.
    const score = scoreGame({
      winner: null,
      hands: hands([s(1, 3)], [s(5, 6)], [s(4, 5)], [s(3, 4)]),
    });
    expect(score.us).toBe(18);
    expect(score.them).toBe(0);
    expect(score.seka).toBe(false);
  });

  it('pots both sides pips when they are level — a seka', () => {
    // Both teams on 12. Nobody scores; 24 waits for the next winner.
    const score = scoreGame({
      winner: null,
      hands: hands([s(5, 6)], [s(6, 6)], [s(0, 1)], [s(0, 0)]),
    });
    expect(score).toEqual({ us: 0, them: 0, carry: 24, seka: true });
    expect(pointsSwing(score)).toBe(0);
  });
});

describe('the seka pot', () => {
  it('is collected by whoever wins the next game, on top of their own score', () => {
    const score = scoreGame({
      winner: 'A',
      hands: hands([], [s(6, 6)], [s(1, 1)], [s(4, 5)]),
      pot: 36,
    });
    expect(score.us).toBe(21 + 36);
    expect(score.carry).toBe(0);
  });

  it('accumulates if a second game is also level', () => {
    const score = scoreGame({
      winner: null,
      hands: hands([s(5, 6)], [s(6, 6)], [s(0, 1)], [s(0, 0)]),
      pot: 36,
    });
    expect(score.carry).toBe(24 + 36);
    expect(score.seka).toBe(true);
  });
});

const fresh = (): Standing => ({ written: { us: 0, them: 0 }, air: { us: 0, them: 0 } });

/** A game our team wins for exactly `points`. */
function weWin(points: number): GameScore {
  return { us: points, them: 0, carry: 0, seka: false };
}
function theyWin(points: number): GameScore {
  return { us: 0, them: points, carry: 0, seka: false };
}

describe('the writing threshold', () => {
  it('does not write a win worth less than 13 — it hangs in the air', () => {
    const after = applyGameScore(fresh(), weWin(12));
    expect(after.written.us).toBe(0);
    expect(after.air.us).toBe(12);
  });

  it('accumulates further small wins without writing any of them', () => {
    let standing = applyGameScore(fresh(), weWin(12));
    standing = applyGameScore(standing, weWin(9));
    expect(standing.written.us).toBe(0);
    expect(standing.air.us).toBe(21);
  });

  it('banks everything hanging as soon as a win reaches 13', () => {
    let standing = applyGameScore(fresh(), weWin(12));
    standing = applyGameScore(standing, weWin(9));
    standing = applyGameScore(standing, weWin(13));
    expect(standing.written.us).toBe(13 + 21);
    expect(standing.air.us).toBe(0);
  });

  it('writes a big win immediately', () => {
    const after = applyGameScore(fresh(), weWin(40));
    expect(after.written.us).toBe(40);
    expect(after.air.us).toBe(0);
  });
});

describe('losing what is in the air', () => {
  it('is wiped when the opponents win by 13 or more', () => {
    let standing = applyGameScore(fresh(), weWin(12));
    expect(standing.air.us).toBe(12);
    standing = applyGameScore(standing, theyWin(20));
    expect(standing.air.us).toBe(0);
    expect(standing.written.them).toBe(20);
    expect(standing.written.us).toBe(0);
  });

  it('survives an opponent win that is too small to write', () => {
    let standing = applyGameScore(fresh(), weWin(12));
    standing = applyGameScore(standing, theyWin(7));
    expect(standing.air.us).toBe(12);
    expect(standing.air.them).toBe(7);
    expect(standing.written).toEqual({ us: 0, them: 0 });
  });

  it('is untouched by a seka, which scores for nobody', () => {
    let standing = applyGameScore(fresh(), weWin(12));
    standing = applyGameScore(standing, { us: 0, them: 0, carry: 36, seka: true });
    expect(standing.air.us).toBe(12);
  });
});

describe('match-aware value', () => {
  it('is the plain swing when the match is nowhere near over', () => {
    const score = scoreGame({ winner: 'A', hands: hands([], [s(6, 6)], [], [s(4, 5)]) });
    expect(matchValue(score, fresh())).toBe(21);
  });

  it('stops paying for points past the target', () => {
    // At 95, a 21-point game and a 15-point game both end the match, so the
    // riskier line that might score 21 is not worth more.
    const big = scoreGame({ winner: 'A', hands: hands([], [s(6, 6)], [], [s(4, 5)]) });
    const enough = weWin(15);
    const standing: Standing = { written: { us: 95, them: 40 }, air: { us: 0, them: 0 } };
    expect(matchValue(big, standing)).toBe(6);
    expect(matchValue(enough, standing)).toBe(6);
  });

  it('prices the 13-point cliff, not just the margin', () => {
    // Sitting on 30 in the air, a 12-point win banks nothing while a 13-point
    // win banks 43. One extra pip is worth far more than one point.
    const standing: Standing = { written: { us: 0, them: 0 }, air: { us: 30, them: 0 } };
    const justUnder = matchValue(weWin(12), standing);
    const justOver = matchValue(weWin(13), standing);
    expect(justUnder).toBe(AIR_WEIGHT * 12);
    expect(justOver).toBe(43);
    expect(justOver - justUnder).toBeGreaterThan(30);
  });

  it('counts destroying the opponents air as part of the prize', () => {
    const clean: Standing = { written: { us: 0, them: 0 }, air: { us: 0, them: 0 } };
    const theirsAtRisk: Standing = { written: { us: 0, them: 0 }, air: { us: 0, them: 40 } };
    expect(matchValue(weWin(13), theirsAtRisk)).toBeGreaterThan(matchValue(weWin(13), clean));
  });

  it('defaults to a match of 101, written in units of 13', () => {
    expect(MATCH_TARGET).toBe(101);
    expect(WRITE_THRESHOLD).toBe(13);
  });
});
