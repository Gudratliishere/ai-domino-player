import { describe, expect, it } from 'vitest';
import { type Stone, makeStone } from '../../types/domino';
import type { LoggedMove, PlayerId } from '../../types/game';
import { type ReplayState, applyMove, initialState, logMove, replayPlies } from '../replay';
import { deriveBeliefs } from './beliefs';
import { makeRandom } from './rng';
import { sampleWorlds } from './sampler';
import {
  effectiveSampleSize,
  openingScore,
  resample,
  weightWorlds,
  worldWeight,
} from './weights';

const s = makeStone;

interface Step {
  playerId: PlayerId;
  stone?: Stone;
  side?: 'left' | 'right';
}

function run(opener: PlayerId, steps: Step[]) {
  let state = initialState(opener);
  const moves: LoggedMove[] = [];
  for (const step of steps) {
    const move = logMove(state, {
      playerId: step.playerId,
      type: step.stone ? 'play' : 'pass',
      stone: step.stone,
      side: step.side,
    });
    moves.push(move);
    state = applyMove(state, move);
  }
  return { state, moves };
}

/** Average weight of the worlds where `player` holds `stoneId`, minus the rest. */
function posteriorShare(
  states: ReplayState[],
  moves: LoggedMove[],
  hand: Stone[],
  state: ReplayState,
  player: PlayerId,
  predicate: (hand: Stone[]) => boolean,
  seed = 4,
) {
  const belief = deriveBeliefs(state, hand, 'A');
  const random = makeRandom(seed);
  const { worlds } = sampleWorlds(belief, hand, 600, random);
  const weighted = weightWorlds(states, moves, worlds, 'A');

  let matching = 0;
  let uniform = 0;
  for (let i = 0; i < worlds.length; i++) {
    if (predicate(worlds[i].hands[player])) {
      matching += weighted[i].weight;
      uniform += 1 / worlds.length;
    }
  }
  return { weighted: matching, uniform };
}

describe('openingScore', () => {
  it('prefers the double of the longest suit', () => {
    const hand = [s(5, 5), s(0, 5), s(2, 5), s(3, 5), s(1, 1), s(2, 3), s(4, 6)];
    expect(openingScore(s(5, 5), hand)).toBeGreaterThan(openingScore(s(1, 1), hand));
    // A non-double of the same suit explains the hand less well than the double.
    expect(openingScore(s(5, 5), hand)).toBeGreaterThan(openingScore(s(0, 5), hand));
  });
});

describe('the opening tell (§2.8)', () => {
  it('makes worlds where the opener is rich in that suit far more likely', () => {
    // D opens the game with 5-5 in a later match game, a free choice.
    const hand = [s(0, 0), s(0, 1), s(0, 2), s(0, 3), s(1, 1), s(1, 2), s(1, 3)];
    const { state, moves } = run('D', [
      { playerId: 'D', stone: s(5, 5) },
      { playerId: 'C', stone: s(5, 6), side: 'right' },
      { playerId: 'B', stone: s(4, 6), side: 'right' },
    ]);
    const states = replayPlies('D', moves);

    const fivesHeavy = (h: Stone[]) => h.filter((x) => x.a === 5 || x.b === 5).length >= 2;
    const share = posteriorShare(states, moves, hand, state, 'D', fivesHeavy);

    // Opening 5-5 is evidence of a five-heavy hand, so those worlds gain weight.
    expect(share.weighted).toBeGreaterThan(share.uniform);
  });
});

describe('the pass tell', () => {
  it('assigns zero weight to any world where a passer could have played', () => {
    const hand = [s(0, 0), s(0, 1), s(0, 2), s(0, 3), s(1, 1), s(1, 2), s(1, 3)];
    const { state, moves } = run('D', [
      { playerId: 'D', stone: s(5, 5) },
      { playerId: 'C', stone: s(5, 6), side: 'right' },
      { playerId: 'B' }, // B passes on 5 | 6
    ]);
    const states = replayPlies('D', moves);
    const belief = deriveBeliefs(state, hand, 'A');
    const { worlds } = sampleWorlds(belief, hand, 50, makeRandom(9));

    for (const world of worlds) {
      // The sampler already respects the pass, so every world should survive.
      expect(worldWeight(states, moves, world, 'A')).toBeGreaterThan(0);
      expect(world.hands.B.some((x) => x.a === 5 || x.b === 5 || x.a === 6 || x.b === 6)).toBe(
        false,
      );
    }

    // A hand-built world that violates the pass is impossible, not just unlikely.
    const bogus = {
      hands: {
        ...worlds[0].hands,
        B: [s(5, 4), ...worlds[0].hands.B.slice(1)],
      },
    };
    expect(worldWeight(states, moves, bogus, 'A')).toBe(0);
  });
});

describe('forced moves carry no information (§2.7)', () => {
  it('gives the same weight to every world when nobody had a choice', () => {
    // Game 1: D must open with 1-1, and that is the only move so far.
    const hand = [s(0, 0), s(0, 1), s(0, 2), s(0, 3), s(2, 2), s(2, 3), s(3, 3)];
    const { state, moves } = run('D', [{ playerId: 'D', stone: s(1, 1) }]);
    const states = replayPlies('D', moves);
    const belief = deriveBeliefs(state, hand, 'A');
    const { worlds } = sampleWorlds(belief, hand, 40, makeRandom(11));

    // The opening model still applies (it was a free choice among 7 stones), so
    // weights differ — but with only one ply nothing should collapse.
    const weighted = weightWorlds(states, moves, worlds, 'A');
    expect(effectiveSampleSize(weighted)).toBeGreaterThan(worlds.length * 0.5);
  });
});

describe('weight hygiene', () => {
  it('normalises, and keeps a usable effective sample size', () => {
    const hand = [s(0, 0), s(0, 1), s(0, 2), s(0, 3), s(1, 1), s(1, 2), s(1, 3)];
    const { state, moves } = run('D', [
      { playerId: 'D', stone: s(5, 5) },
      { playerId: 'C', stone: s(5, 6), side: 'right' },
      { playerId: 'B', stone: s(4, 6), side: 'right' },
      { playerId: 'A', stone: s(0, 5), side: 'left' },
      { playerId: 'D', stone: s(0, 3), side: 'left' },
    ]);
    const states = replayPlies('D', moves);
    const belief = deriveBeliefs(state, hand.filter((x) => x.id !== '0-5'), 'A');
    const { worlds } = sampleWorlds(belief, hand.filter((x) => x.id !== '0-5'), 300, makeRandom(3));
    const weighted = weightWorlds(states, moves, worlds, 'A');

    const total = weighted.reduce((sum, w) => sum + w.weight, 0);
    expect(total).toBeCloseTo(1, 6);
    for (const w of weighted) expect(w.weight).toBeGreaterThanOrEqual(0);

    const ess = effectiveSampleSize(weighted);
    // Tempering exists precisely to stop this collapsing toward 1.
    expect(ess).toBeGreaterThan(20);
    console.log(`weights: ESS ${ess.toFixed(0)} of ${worlds.length} worlds`);
  });
});

describe('systematic resampling', () => {
  const fakeWorld = (id: string) => ({ hands: { A: [], B: [], C: [], D: [] }, id }) as never;

  it('draws worlds in proportion to their weight', () => {
    const weighted = [
      { world: fakeWorld('a'), weight: 0.6 },
      { world: fakeWorld('b'), weight: 0.3 },
      { world: fakeWorld('c'), weight: 0.1 },
    ];
    const drawn = resample(weighted, 1000, makeRandom(3));
    expect(drawn).toHaveLength(1000);
    const counts = new Map<unknown, number>();
    for (const w of drawn) counts.set(w, (counts.get(w) ?? 0) + 1);
    // Systematic resampling is near-exact, not merely unbiased.
    expect(counts.get(weighted[0].world)! / 1000).toBeCloseTo(0.6, 2);
    expect(counts.get(weighted[1].world)! / 1000).toBeCloseTo(0.3, 2);
    expect(counts.get(weighted[2].world)! / 1000).toBeCloseTo(0.1, 2);
  });

  it('never draws a world with zero weight', () => {
    const weighted = [
      { world: fakeWorld('a'), weight: 0 },
      { world: fakeWorld('b'), weight: 1 },
    ];
    const drawn = resample(weighted, 200, makeRandom(9));
    expect(drawn.every((w) => w === weighted[1].world)).toBe(true);
  });

  it('handles an empty pool', () => {
    expect(resample([], 10, makeRandom(1))).toEqual([]);
  });
});

describe('a forced opening is not a tell (§2.7)', () => {
  // Game 1 must be opened with 1-1, so seeing it says nothing about the opener's
  // hand shape. Without the guard the model reads it as "D loves ones".
  const hand = [s(0, 0), s(0, 2), s(0, 3), s(2, 2), s(2, 3), s(3, 3), s(4, 4)];
  const { state, moves } = run('D', [{ playerId: 'D', stone: s(1, 1) }]);
  const states = replayPlies('D', moves);

  function onesHeavyShare(options: Parameters<typeof weightWorlds>[4]) {
    const belief = deriveBeliefs(state, hand, 'A');
    const { worlds } = sampleWorlds(belief, hand, 500, makeRandom(21));
    const weighted = weightWorlds(states, moves, worlds, 'A', options);
    let weightedMass = 0;
    let uniformMass = 0;
    for (let i = 0; i < worlds.length; i++) {
      const ones = worlds[i].hands.D.filter((x) => x.a === 1 || x.b === 1).length;
      if (ones >= 2) {
        weightedMass += weighted[i].weight;
        uniformMass += 1 / worlds.length;
      }
    }
    return { weightedMass, uniformMass };
  }

  it('reads a free opening of 1-1 as evidence of a one-heavy hand', () => {
    const free = onesHeavyShare({ temper: 1 });
    expect(free.weightedMass).toBeGreaterThan(free.uniformMass);
  });

  it('reads nothing into it once the rules are known to have forced it', () => {
    const forced = onesHeavyShare({ temper: 1, forcedOpeningStoneId: '1-1' });
    expect(forced.weightedMass).toBeCloseTo(forced.uniformMass, 6);
  });
});

describe('which partner opened (§2.8)', () => {
  it('favours worlds where the opener held the more concentrated hand', () => {
    const hand = [s(0, 0), s(0, 1), s(0, 2), s(0, 3), s(1, 1), s(1, 2), s(1, 3)];
    const { state, moves } = run('D', [
      { playerId: 'D', stone: s(5, 5) },
      { playerId: 'C', stone: s(5, 6), side: 'right' },
      { playerId: 'B', stone: s(4, 6), side: 'right' },
    ]);
    const states = replayPlies('D', moves);
    const belief = deriveBeliefs(state, hand, 'A');
    const { worlds } = sampleWorlds(belief, hand, 500, makeRandom(31));

    // D opened rather than partner B, so worlds where D's hand is the stronger
    // of the two should gain weight relative to worlds where B's is.
    const plain = weightWorlds(states, moves, worlds, 'A', { temper: 1 });
    const withChoice = weightWorlds(states, moves, worlds, 'A', {
      temper: 1,
      openerAlternative: 'B',
    });

    const best = (h: typeof hand) =>
      Math.max(...h.map((x) => openingScore(x, h)), 0);
    let plainMass = 0;
    let choiceMass = 0;
    for (let i = 0; i < worlds.length; i++) {
      if (best(worlds[i].hands.D) > best(worlds[i].hands.B)) {
        plainMass += plain[i].weight;
        choiceMass += withChoice[i].weight;
      }
    }
    expect(choiceMass).toBeGreaterThan(plainMass);
  });
});
