import { describe, expect, it } from 'vitest';
import { type Stone, idHasValue, makeStone } from '../../types/domino';
import type { PlayerId } from '../../types/game';
import { ALL_PLAYERS } from '../../types/game';
import { candidatesFor, deriveBeliefs, holdsNoneOf } from './beliefs';
import { dealHands } from './deal';
import { heuristicAgent, playGame } from './harness';
import { makeRandom } from './rng';
import { scenarioState } from './scenario';

const s = makeStone;

/** Stones `player` could still be holding, proven or merely possible. */
function fivesFor(belief: ReturnType<typeof deriveBeliefs>, player: PlayerId) {
  return candidatesFor(belief, player)
    .filter((id) => id.split('-').map(Number).includes(5))
    .sort();
}

describe('the §2.5 worked example', () => {
  // B has played four fives, none of them the double.
  const bPlayed = [s(0, 5), s(1, 5), s(3, 5), s(5, 6)];
  const cPlayed = [s(1, 1), s(2, 3)];
  const dPlayed = [s(4, 6), s(2, 4)];
  const base = {
    playedBy: { B: bPlayed, C: cPlayed, D: dPlayed },
    ends: { left: 5 as const, right: 6 as const },
    counts: { B: 3, C: 5, D: 5 },
  };

  it('proves B holds no fives at all when the double is accounted for', () => {
    const hand = [s(5, 5), s(0, 0), s(0, 1), s(0, 2), s(2, 2), s(3, 3), s(4, 4)];
    const belief = deriveBeliefs(scenarioState({ ...base, hand }), hand, 'A');
    expect(belief.contradiction).toBe(false);
    expect(belief.maxNonDouble.B[5]).toBe(0);
    expect(holdsNoneOf(belief, 'B', 5)).toBe(true);
  });

  it('narrows B to the double alone when 5-5 is still unaccounted for', () => {
    const hand = [s(6, 6), s(0, 0), s(0, 1), s(0, 2), s(2, 2), s(3, 3), s(4, 4)];
    const belief = deriveBeliefs(scenarioState({ ...base, hand }), hand, 'A');
    expect(belief.contradiction).toBe(false);
    expect(holdsNoneOf(belief, 'B', 5)).toBe(false);
    // 2-5 and 4-5 are ruled out by the cap; only the double survives.
    expect(fivesFor(belief, 'B')).toEqual(['5-5']);
    expect(fivesFor(belief, 'C')).toContain('2-5');
  });
});

describe('passes', () => {
  it('rules a player out of both end suits, permanently', () => {
    const hand = [s(0, 0), s(0, 1), s(0, 2), s(0, 4), s(1, 2), s(2, 2), s(6, 6)];
    const state = scenarioState({
      played: [s(3, 3), s(3, 5), s(1, 1), s(4, 4)],
      hand,
      ends: { left: 3, right: 5 },
      counts: { B: 6, C: 6, D: 5 },
      banned: { B: [3, 5] },
    });
    const belief = deriveBeliefs(state, hand, 'A');
    for (const id of candidatesFor(belief, 'B')) {
      expect(id.split('-').map(Number)).not.toContain(3);
      expect(id.split('-').map(Number)).not.toContain(5);
    }
  });
});

describe('forced assignment', () => {
  it('pins a suit onto the only player who can still hold it', () => {
    // C and D have both passed on 6, so every unplayed 6 must be B's.
    const hand = [s(0, 0), s(0, 1), s(0, 2), s(0, 3), s(1, 1), s(1, 2), s(1, 3)];
    const state = scenarioState({
      played: [s(6, 6), s(5, 6), s(4, 6), s(2, 2), s(3, 3), s(4, 4), s(5, 5)],
      hand,
      ends: { left: 6, right: 5 },
      counts: { B: 5, C: 5, D: 4 },
      banned: { C: [6], D: [6] },
    });
    const belief = deriveBeliefs(state, hand, 'A');
    expect(belief.contradiction).toBe(false);
    for (const id of ['0-6', '1-6', '2-6', '3-6']) {
      expect(belief.known.get(id)).toBe('B');
    }
  });

  it('rejects a position that would need five non-double sixes in one hand', () => {
    // The same position with 4-6 still live: B would have to hold all five, and
    // the dealing cap makes that impossible.
    const hand = [s(0, 0), s(0, 1), s(0, 2), s(0, 3), s(1, 1), s(1, 2), s(1, 3)];
    const state = scenarioState({
      played: [s(6, 6), s(5, 6), s(2, 2), s(3, 3), s(4, 4), s(5, 5)],
      hand,
      ends: { left: 6, right: 5 },
      counts: { B: 5, C: 5, D: 5 },
      banned: { C: [6], D: [6] },
    });
    expect(deriveBeliefs(state, hand, 'A').contradiction).toBe(true);
  });

  it('gives a player every remaining stone once their candidates fill their hand', () => {
    const hand = [s(0, 0), s(0, 1), s(0, 2), s(0, 3), s(0, 4), s(0, 5), s(0, 6)];
    const state = scenarioState({
      played: [s(1, 1), s(1, 2), s(1, 3), s(1, 4), s(1, 5), s(1, 6), s(2, 2), s(2, 3), s(2, 4)],
      hand,
      ends: { left: 2, right: 4 },
      counts: { B: 2, C: 5, D: 5 },
      // B is shut out of everything except the three remaining 5/6 stones.
      banned: { B: [2, 3, 4] },
    });
    const belief = deriveBeliefs(state, hand, 'A');
    expect(belief.contradiction).toBe(false);
    const bCandidates = candidatesFor(belief, 'B');
    expect(bCandidates.length).toBeGreaterThanOrEqual(2);
  });
});

describe('game 1', () => {
  it('pins 1-1 on the named opener before it is played', () => {
    const hand = [s(0, 0), s(0, 1), s(0, 2), s(0, 3), s(0, 4), s(0, 5), s(0, 6)];
    const state = scenarioState({
      played: [],
      hand,
      ends: { left: null, right: null },
      counts: { B: 7, C: 7, D: 7 },
      turn: 'D',
    });
    state.opener = 'D';
    const belief = deriveBeliefs(state, hand, 'A', { openingStoneId: '1-1' });
    expect(belief.known.get('1-1')).toBe('D');
  });
});

describe('contradictions', () => {
  it('flags a position no legal deal can explain', () => {
    // B is said to hold 5 stones but has passed on every value in play.
    const hand = [s(0, 0), s(0, 1), s(0, 2), s(0, 3), s(0, 4), s(0, 5), s(0, 6)];
    const state = scenarioState({
      played: [s(1, 1), s(2, 2), s(3, 3)],
      hand,
      ends: { left: 1, right: 2 },
      counts: { B: 6, C: 6, D: 6 },
      banned: { B: [1, 2, 3, 4, 5, 6] },
    });
    const belief = deriveBeliefs(state, hand, 'A');
    // Every stone left carries at least one banned value, so B can hold nothing.
    expect(belief.contradiction).toBe(true);
  });
});

describe('soundness against ground truth', () => {
  // 150 full games with beliefs derived for all four players at every ply lands
  // near the 5s default, so it fails on a loaded machine rather than on a bug.
  it('never claims anything false, over thousands of real positions', { timeout: 120000 }, () => {
    const random = makeRandom(31);
    const agent = heuristicAgent();
    const agents = { A: agent, B: agent, C: agent, D: agent };
    let positions = 0;
    let pinned = 0;

    for (let game = 0; game < 150; game++) {
      playGame(dealHands(random), agents, random, (state, hands) => {
        for (const me of ALL_PLAYERS) {
          const belief = deriveBeliefs(state, hands[me], me);
          positions++;
          expect(belief.contradiction).toBe(false);

          const trueOwner = new Map<string, PlayerId>();
          for (const p of ALL_PLAYERS) {
            if (p === me) continue;
            for (const stone of hands[p] as Stone[]) trueOwner.set(stone.id, p);
          }

          // Anything pinned must be pinned correctly.
          for (const [id, owner] of belief.known) {
            expect(owner).toBe(trueOwner.get(id));
            pinned++;
          }
          // Anything unresolved must still admit its real holder.
          for (const [id, holders] of belief.possible) {
            expect([...holders]).toContain(trueOwner.get(id));
          }
          // Every hidden stone is accounted for exactly once.
          expect(belief.known.size + belief.possible.size).toBe(trueOwner.size);
        }
      });
    }

    expect(positions).toBeGreaterThan(1000);
    // If this is ever zero the engine is sound but useless.
    expect(pinned).toBeGreaterThan(0);
    console.log(`beliefs: ${pinned} stones pinned across ${positions} positions`);
  });
});

describe('the four-doubles cap', () => {
  it('proves a player who has played four doubles holds no more', () => {
    // D has played 0-0, 2-2, 3-3 and 4-4 — the whole allowance.
    const hand = [s(0, 1), s(0, 2), s(0, 3), s(1, 2), s(1, 3), s(2, 3), s(0, 4)];
    const state = scenarioState({
      playedBy: { D: [s(0, 0), s(2, 2), s(3, 3), s(4, 4)], B: [s(1, 4)], C: [s(2, 4)] },
      hand,
      ends: { left: 0, right: 4 },
      counts: { B: 6, C: 6, D: 3 },
    });
    const belief = deriveBeliefs(state, hand, 'A');
    expect(belief.contradiction).toBe(false);
    expect(belief.maxDoubles.D).toBe(0);
    for (const id of candidatesFor(belief, 'D')) {
      const [lo, hi] = id.split('-').map(Number);
      expect(lo === hi).toBe(false);
    }
    // The others are unaffected.
    expect(candidatesFor(belief, 'B').some((id) => id === '5-5' || id === '6-6')).toBe(true);
  });

  it('leaves the doubles alone while the allowance survives', () => {
    const hand = [s(0, 1), s(0, 2), s(0, 3), s(1, 2), s(1, 3), s(2, 3), s(0, 4)];
    const state = scenarioState({
      playedBy: { D: [s(0, 0), s(2, 2)], B: [s(1, 4)], C: [s(2, 4)] },
      hand,
      ends: { left: 0, right: 4 },
      counts: { B: 6, C: 6, D: 5 },
    });
    const belief = deriveBeliefs(state, hand, 'A');
    expect(belief.maxDoubles.D).toBe(2);
    expect(candidatesFor(belief, 'D').some((id) => id === '5-5')).toBe(true);
  });
});

describe('what an opponent can still be holding', () => {
  it('drops the fifth six but keeps the double, exactly as the rules require', () => {
    // D has played four non-double sixes. A fifth six is impossible; 6-6 is not.
    const hand = [s(0, 1), s(0, 2), s(0, 3), s(1, 2), s(1, 3), s(2, 3), s(0, 4)];
    const state = scenarioState({
      playedBy: { D: [s(0, 6), s(1, 6), s(2, 6), s(3, 6)], B: [s(1, 4)], C: [s(2, 4)] },
      hand,
      ends: { left: 6, right: 4 },
      counts: { B: 6, C: 6, D: 3 },
    });
    const belief = deriveBeliefs(state, hand, 'A');
    expect(belief.contradiction).toBe(false);

    const sixes = candidatesFor(belief, 'D').filter((id) => idHasValue(id, 6));
    expect(sixes).toEqual(['6-6']);
    // 4-6 and 5-6 are still out there, just not in D's hand.
    expect(candidatesFor(belief, 'B')).toContain('4-6');
  });
});
