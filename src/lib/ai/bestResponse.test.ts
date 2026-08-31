import { describe, expect, it } from 'vitest';
import { type Stone, makeStone } from '../../types/domino';
import type { PlayerId } from '../../types/game';
import { initialState } from '../replay';
import { bestResponseValue } from './bestResponse';
import { solveEndgame, totalStones } from './endgame';
import { dealHands } from './deal';
import { makeRandom } from './rng';
import { generateFullSet } from '../dominoSet';

const s = makeStone;

/**
 * A position with the four hands known, built by hand.
 *
 * `initialState` then a fixed set of ends is enough: the chain is cosmetic
 * (§2.1), and the solver only ever reads the ends, the bans and whose turn it
 * is. `passStreak` starts at zero and the bans start empty, which is the
 * position a fresh determinized world is in.
 */
function position(
  hands: Record<PlayerId, Stone[]>,
  ends: { left: number; right: number },
  turn: PlayerId,
) {
  const state = initialState('A');
  return {
    hands,
    state: {
      ...state,
      turn,
      ends: { left: ends.left as never, right: ends.right as never },
      counts: { A: hands.A.length, B: hands.B.length, C: hands.C.length, D: hands.D.length },
    },
  };
}

describe('best response against a fixed policy', () => {
  it('takes the win when going out is available', () => {
    // A holds one stone that fits; playing it ends the game and scores B+D's pips.
    const { state, hands } = position(
      { A: [s(3, 4)], B: [s(6, 6)], C: [s(0, 0)], D: [s(5, 5)] },
      { left: 3, right: 1 },
      'A',
    );
    const result = bestResponseValue(state, hands, 'A');
    expect(result.solved).toBe(true);
    // B holds 12 and D holds 10, so going out is worth 22 to us.
    expect(result.value).toBe(22);
  });

  it('never values a position below minimax when only opponents are modelled', () => {
    // max_a min_b ≤ max_a E_{b~π}: replacing perfectly-playing *opponents* with
    // any fixed policy cannot be worth less to us. The comparison only holds for
    // the opponents-only variant — minimax also gives us a partner who plays
    // perfectly on information they do not have, and taking that away is a
    // different change, measured in the next test. If this one ever fails, the
    // two solvers disagree about the rules rather than about the opponents.
    const random = makeRandom(4242);
    let compared = 0;

    for (let attempt = 0; attempt < 40 && compared < 12; attempt++) {
      const deal = dealHands(random);
      // Trim every hand down to a solvable endgame.
      const hands = {
        A: deal.A.slice(0, 3),
        B: deal.B.slice(0, 3),
        C: deal.C.slice(0, 3),
        D: deal.D.slice(0, 3),
      };
      const played = new Set(
        [...hands.A, ...hands.B, ...hands.C, ...hands.D].map((stone) => stone.id),
      );
      // Ends have to be values that are actually still around, or the position is
      // an immediate four-way block and says nothing.
      const spare = generateFullSet().filter((stone) => !played.has(stone.id));
      const ends = { left: spare[attempt % spare.length].a, right: spare[attempt % spare.length].b };
      const { state } = position(hands, ends, 'A');

      const minimax = solveEndgame(hands, state.ends, 'A', 0);
      // Opponents only: our two seats still coordinate, exactly as minimax has
      // them do, so the inequality applies to this variant.
      const response = bestResponseValue(state, hands, 'A', {
        nodeBudget: 200_000,
        modelPartner: false,
      });
      if (!minimax.solved || !response.solved) continue;
      compared++;
      expect(
        response.value,
        `deal ${attempt}: best response ${response.value} < minimax ${minimax.value}`,
      ).toBeGreaterThanOrEqual(minimax.value - 1e-9);
    }
    expect(compared).toBeGreaterThan(5);
  });

  it('is deterministic and stops at the node budget', () => {
    const { state, hands } = position(
      { A: [s(1, 2), s(3, 3)], B: [s(2, 4), s(0, 6)], C: [s(1, 5), s(4, 4)], D: [s(2, 2), s(5, 6)] },
      { left: 1, right: 2 },
      'A',
    );
    const once = bestResponseValue(state, hands, 'A');
    const twice = bestResponseValue(state, hands, 'A');
    expect(twice.value).toBe(once.value);
    expect(once.solved).toBe(true);

    const starved = bestResponseValue(state, hands, 'A', { nodeBudget: 3 });
    expect(starved.solved).toBe(false);
    expect(starved.nodes).toBeLessThanOrEqual(4);
  });

  it('modelling the partner can cost us, which is the fusion coming out', () => {
    // Minimax credits us with a partner who plays perfectly on information they
    // do not have. Modelling them honestly can only remove that credit, and on
    // some positions it does — that is the point, not a defect.
    const random = makeRandom(4242);
    let sawDrop = false;
    for (let attempt = 0; attempt < 40 && !sawDrop; attempt++) {
      const deal = dealHands(random);
      const hands = {
        A: deal.A.slice(0, 3),
        B: deal.B.slice(0, 3),
        C: deal.C.slice(0, 3),
        D: deal.D.slice(0, 3),
      };
      const { state } = position(hands, { left: 1, right: 2 }, 'A');
      const coordinated = bestResponseValue(state, hands, 'A', { modelPartner: false });
      const honest = bestResponseValue(state, hands, 'A', { modelPartner: true });
      if (!coordinated.solved || !honest.solved) continue;
      if (honest.value < coordinated.value - 1e-9) sawDrop = true;
      expect(honest.value).toBeLessThanOrEqual(coordinated.value + 1e-9);
    }
    expect(sawDrop).toBe(true);
  });

  it('a greedy model is at least as good for us as a soft one', () => {
    // Greedy is the sharper assumption: we know exactly what they will play, so
    // we can exploit it. That it scores higher *in the model* is the whole
    // reason not to trust it as a measure of strength.
    const { state, hands } = position(
      { A: [s(1, 2), s(3, 3)], B: [s(2, 4), s(0, 6)], C: [s(1, 5), s(4, 4)], D: [s(2, 2), s(5, 6)] },
      { left: 1, right: 2 },
      'A',
    );
    const soft = bestResponseValue(state, hands, 'A', { beta: 0.06 });
    const greedy = bestResponseValue(state, hands, 'A', { beta: Infinity });
    expect(greedy.solved && soft.solved).toBe(true);
    expect(greedy.value).toBeGreaterThanOrEqual(soft.value - 1e-9);
  });

  it('costs a bounded number of nodes on a real 16-stone world', () => {
    const random = makeRandom(99);
    const deal = dealHands(random);
    const hands = {
      A: deal.A.slice(0, 4),
      B: deal.B.slice(0, 4),
      C: deal.C.slice(0, 4),
      D: deal.D.slice(0, 4),
    };
    expect(totalStones(hands)).toBe(16);
    const { state } = position(hands, { left: 1, right: 1 }, 'A');
    const result = bestResponseValue(state, hands, 'A');
    // Not a performance guarantee, a sanity bound: the tail pruning and the
    // memo have to keep a 16-stone world well inside the budget.
    expect(result.nodes).toBeLessThan(60_000);
  });
});
