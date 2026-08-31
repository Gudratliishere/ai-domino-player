import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS } from './features';
import { TUNABLE_KEYS, formatWeights, tuneWeights } from './tuning';

describe('cross-entropy tuner', () => {
  it('runs, keeps every weight finite, and never scores below chance', () => {
    const { best, history } = tuneWeights({
      population: 6,
      elite: 2,
      generations: 2,
      games: 40,
      seed: 5,
    });
    expect(history).toHaveLength(2);
    for (const key of TUNABLE_KEYS) {
      expect(Number.isFinite(best[key])).toBe(true);
    }
    // countOut is not tunable: a forced win must always dominate.
    expect(best.countOut).toBe(DEFAULT_WEIGHTS.countOut);
    for (const info of history) {
      expect(info.bestScore).toBeGreaterThanOrEqual(info.meanEliteScore - 1e-9);
    }
  });

  it('formats weights as pasteable source', () => {
    const text = formatWeights(DEFAULT_WEIGHTS);
    expect(text).toMatch(/starveOpponent: \d+,/);
  });
});
