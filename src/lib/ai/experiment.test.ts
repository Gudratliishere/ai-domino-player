import { describe, expect, it } from 'vitest';
import { formatPaired, pairedLadder, roundRobin } from './experiment';
import { heuristicAgent, randomAgent } from './harness';
import { STYLES } from './styles';
import { DEFAULT_WEIGHTS } from './features';

describe('paired mirrored ladder', () => {
  it('scores an agent against itself at exactly zero, on every deal', () => {
    // The point of mirroring: identical play cancels deal for deal, so the
    // result is not merely near zero with a standard error — it is zero, and the
    // error is zero too. Anything else means the pairing is broken.
    const result = pairedLadder(() => heuristicAgent(), () => heuristicAgent(), 40, 7);
    expect(result.netPoints).toBe(0);
    expect(result.standardError).toBe(0);
    expect(result.z).toBe(0);
    expect(result.deals).toBe(40);
  });

  it('is antisymmetric: swapping the agents flips the sign', () => {
    const strong = () => heuristicAgent();
    const a = pairedLadder(strong, randomAgent, 60, 11);
    const b = pairedLadder(randomAgent, strong, 60, 11);
    expect(a.netPoints).toBeCloseTo(-b.netPoints, 10);
    expect(a.standardError).toBeCloseTo(b.standardError, 10);
  });

  it('sees the heuristic beating random-legal play, decisively', () => {
    const result = pairedLadder(() => heuristicAgent(), randomAgent, 200, 3);
    expect(result.netPoints).toBeGreaterThan(5);
    // A difference this size must be far outside the noise on 200 deals, or the
    // error bars are lying.
    expect(result.z).toBeGreaterThan(4);
    expect(result.winRate).toBeGreaterThan(0.6);
  });

  it('is deterministic for a given seed', () => {
    const once = pairedLadder(() => heuristicAgent(), randomAgent, 30, 42);
    const twice = pairedLadder(() => heuristicAgent(), randomAgent, 30, 42);
    expect(twice).toEqual(once);
  });

  it('formats a result with its error bar', () => {
    expect(formatPaired(pairedLadder(() => heuristicAgent(), randomAgent, 20, 5))).toMatch(
      /^\+\d+\.\d+ ± \d+\.\d+ pts\/game \(z=\d+\.\d+, n=20 deals\)$/,
    );
  });
});

describe('round-robin', () => {
  it('plays every pair once and standings sum to zero', () => {
    const contenders = [
      { name: 'shipped', agent: () => heuristicAgent() },
      { name: 'random', agent: randomAgent },
      { name: 'greedy', agent: () => heuristicAgent({ ...DEFAULT_WEIGHTS, pipShed: 20 }) },
    ];
    const { entries, standings } = roundRobin(contenders, 20, 9);

    expect(entries).toHaveLength(3);
    expect(standings).toHaveLength(3);
    // Every point one style wins is a point another loses.
    const total = standings.reduce((sum, s) => sum + s.netPoints, 0);
    expect(total).toBeCloseTo(0, 10);
    // Random-legal cannot come out on top of a field containing the heuristic.
    expect(standings[standings.length - 1].name).toBe('random');
  });
});

describe('styles', () => {
  it('are distinct policies that never touch the forced-win term', () => {
    const names = new Set(STYLES.map((s) => s.name));
    expect(names.size).toBe(STYLES.length);
    for (const style of STYLES) {
      expect(style.weights.countOut).toBe(DEFAULT_WEIGHTS.countOut);
      expect(style.idea.length).toBeGreaterThan(20);
    }
    // Each non-baseline style must actually differ from the baseline.
    for (const style of STYLES.filter((s) => s.name !== 'shipped')) {
      expect(style.weights).not.toEqual(DEFAULT_WEIGHTS);
    }
  });
});
