import { describe, expect, it } from 'vitest';
import { ALL_PLAYERS } from '../../types/game';
import { dealHands, isLegalDeal, isLegalHand } from './deal';
import {
  heuristicAgent,
  pimcAgent,
  playGame,
  randomAgent,
  runLadder,
  weightedPimcAgent,
} from './harness';
import { makeRandom } from './rng';

describe('dealing', () => {
  it('respects the 4/5 cap on every hand', () => {
    const random = makeRandom(7);
    for (let i = 0; i < 200; i++) {
      const deal = dealHands(random);
      expect(isLegalDeal(deal)).toBe(true);
      expect(ALL_PLAYERS.flatMap((p) => deal[p])).toHaveLength(28);
    }
  });

  it('rejects a hand with five of a value and no double', () => {
    const five = [
      { id: '0-5', a: 0 as const, b: 5 as const },
      { id: '1-5', a: 1 as const, b: 5 as const },
      { id: '2-5', a: 2 as const, b: 5 as const },
      { id: '3-5', a: 3 as const, b: 5 as const },
      { id: '4-5', a: 4 as const, b: 5 as const },
    ];
    expect(isLegalHand(five)).toBe(false);
    expect(isLegalHand([...five.slice(0, 4), { id: '5-5', a: 5 as const, b: 5 as const }])).toBe(true);
  });
});

describe('self-play', () => {
  it('always reaches a terminal state', () => {
    const random = makeRandom(11);
    const agents = { A: randomAgent, B: randomAgent, C: randomAgent, D: randomAgent };
    for (let i = 0; i < 100; i++) {
      const outcome = playGame(dealHands(random), agents, random);
      expect(outcome.winner !== null || outcome.blocked).toBe(true);
      expect(outcome.plies).toBeGreaterThan(0);
    }
  });

  it('is reproducible from a seed', () => {
    const run = () =>
      runLadder(heuristicAgent(), randomAgent, 25, 4242);
    expect(run()).toEqual(run());
  });
});

describe('baseline ladder (§5)', () => {
  it('the heuristic beats random-legal play by a clear margin', () => {
    const result = runLadder(heuristicAgent(), randomAgent, 400, 99);
    // Printed on every run: later phases have to beat the rung below them, and
    // that is only visible if the number is in front of you.
    console.log(
      `ladder  heuristic vs random: ${result.us}-${result.them}-${result.draws} ` +
        `(win rate ${(result.winRate * 100).toFixed(1)}%, ${result.blocked} blocked, ` +
        `${result.avgPlies.toFixed(1)} plies avg)`,
    );
    // A coin flip would be 0.5; anything near it means the heuristic is not working.
    expect(result.winRate).toBeGreaterThan(0.62);
  });

  it('wins from the other seats too, so the margin is not a seating artefact', () => {
    const result = runLadder(randomAgent, heuristicAgent(), 400, 99);
    expect(result.winRate).toBeLessThan(0.38);
  });

  it('the search still plays a sane game', { timeout: 120000 }, () => {
    // A regression guard, not a strength claim: at this sample size the error bar
    // is around +/-9 points, far too wide to separate the search from the
    // heuristic. It exists to catch the search breaking outright. The powered
    // comparison against the Phase 2 agent is recorded in ENGINE_DESIGN.md.
    const result = runLadder(pimcAgent(50), randomAgent, 100, 21);
    console.log(
      `ladder  PIMC(50) vs random: ${(result.winRate * 100).toFixed(1)}% ` +
        `(${result.us}-${result.them}-${result.draws})`,
    );
    expect(result.winRate).toBeGreaterThan(0.6);
  });
});

describe('the opt-in Phase 4 agent', () => {
  it('plays legal games with likelihood weighting enabled', { timeout: 120000 }, () => {
    // Weighting is off in the shipped engine, but the path must keep working —
    // it is the foundation for per-player opponent models (ENGINE_DESIGN §6).
    const result = runLadder(weightedPimcAgent(30), randomAgent, 30, 77);
    expect(result.games).toBe(30);
    expect(result.us + result.them + result.draws).toBe(30);
    expect(result.winRate).toBeGreaterThan(0.3);
  });
});
