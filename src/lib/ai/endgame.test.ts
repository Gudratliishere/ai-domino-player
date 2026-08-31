import { describe, expect, it } from 'vitest';
import { type Stone, makeStone } from '../../types/domino';
import type { PlayerId } from '../../types/game';
import { ENDGAME_THRESHOLD, bestEndgameMove, solveEndgame, totalStones } from './endgame';
import { dealHands } from './deal';
import { believingAgent, playGame } from './harness';
import { makeRandom } from './rng';
import { sampleWorlds } from './sampler';
import { deriveBeliefs } from './beliefs';
import { nextPlayer } from '../../types/game';

const next = nextPlayer;
const pips = (h: Stone[]) => h.reduce((sum, x) => sum + x.a + x.b, 0);

const s = makeStone;

function hands(a: Stone[], b: Stone[], c: Stone[], d: Stone[]): Record<PlayerId, Stone[]> {
  return { A: a, B: b, C: c, D: d };
}

describe('exact endgame', () => {
  it('scores a win as the pips the opponents are caught holding', () => {
    const result = solveEndgame(
      hands([s(3, 4)], [s(6, 6)], [s(5, 5)], [s(2, 2)]),
      { left: 3, right: 0 },
      'A',
    );
    expect(result.solved).toBe(true);
    // A goes out; B holds 12 and D holds 4. Partner C's 10 does not count.
    expect(result.value).toBe(16);
  });

  it('scores a loss as the pips we are caught holding', () => {
    // B is on lead with one playable stone; we can never move.
    const result = solveEndgame(
      hands([s(5, 5)], [s(3, 4)], [s(6, 6)], [s(2, 2)]),
      { left: 3, right: 0 },
      'B',
    );
    expect(result.solved).toBe(true);
    // A holds 10 and C holds 12, so they score 22 off us.
    expect(result.value).toBe(-22);
  });

  it('scores a dead-locked position by pips, not by who is on move', () => {
    // Nobody can play: every hand is a double that does not match the ends.
    const light = solveEndgame(
      hands([s(1, 1)], [s(6, 6)], [s(2, 2)], [s(5, 5)]),
      { left: 3, right: 4 },
      'A',
    );
    expect(light.solved).toBe(true);
    // Us 2 + 4 = 6, them 12 + 10 = 22. We are lighter, so we score their 22.
    expect(light.value).toBe(22);

    const heavy = solveEndgame(
      hands([s(6, 6)], [s(1, 1)], [s(5, 5)], [s(2, 2)]),
      { left: 3, right: 4 },
      'A',
    );
    expect(heavy.value).toBe(-22);
  });

  it('reports a tie as a tie', () => {
    const result = solveEndgame(
      hands([s(6, 6)], [s(5, 5)], [s(1, 1)], [s(2, 2)]),
      { left: 3, right: 4 },
      'A',
    );
    // Us 12 + 2 = 14, them 10 + 4 = 14.
    expect(result.value).toBe(0);
  });

  it('sees a line the opponent must walk into', () => {
    // A holds 0-1 and 0-2; ends are 1 | 2. Whatever A plays leaves a 0 end.
    // B holds only 6-6 and can never move, C then goes out.
    const result = solveEndgame(
      hands([s(0, 1), s(0, 2)], [s(6, 6)], [s(0, 5)], [s(6, 5)]),
      { left: 1, right: 2 },
      'A',
    );
    expect(result.solved).toBe(true);
    expect(result.value).toBeGreaterThan(0);
  });

  it('respects the node budget instead of hanging', () => {
    const random = makeRandom(1);
    const deal = dealHands(random);
    const result = solveEndgame(deal, { left: null, right: null }, 'A', 0, { nodeBudget: 500 });
    expect(result.solved).toBe(false);
    expect(result.nodes).toBeLessThanOrEqual(501);
  });
});

describe('the solver agrees with reality', () => {
  it('predicts a value that actually comes about when everyone plays it', () => {
    // The strongest self-check available: walk the position to the end with every
    // seat playing the solver's own recommendation, and confirm the game really
    // finishes with the value the solver promised at the root. This catches an
    // inverted min/max, a mis-scored block, and an off-by-one in the pass streak.
    //
    // Comparing against a heuristic playout would prove nothing: "proven loss"
    // means loses to *optimal* play, and a playout opponent is not optimal.
    const random = makeRandom(17);
    const agent = believingAgent();
    let solved = 0;

    for (let game = 0; game < 40; game++) {
      playGame(dealHands(random), { A: agent, B: agent, C: agent, D: agent }, random, (state, hs) => {
        const live = { A: [...hs.A], B: [...hs.B], C: [...hs.C], D: [...hs.D] };
        if (totalStones(live) > ENDGAME_THRESHOLD || state.ends.left === null) return;
        const root = solveEndgame(live, state.ends, state.turn, state.passStreak);
        if (!root.solved) return;
        solved++;

        let hands = live;
        let ends = state.ends;
        let turn = state.turn;
        let passStreak = state.passStreak;
        let outcome: number | null = null;

        for (let ply = 0; ply < 40 && outcome === null; ply++) {
          const best = bestEndgameMove(hands, ends, turn, passStreak);
          if (best.move === null) {
            passStreak++;
            if (passStreak >= 4) {
              // The lighter team wins the block and scores the opponents' pips.
              const us = pips(hands.A) + pips(hands.C);
              const them = pips(hands.B) + pips(hands.D);
              outcome = us < them ? them : us > them ? -us : 0;
              break;
            }
            turn = next(turn);
            continue;
          }
          const remaining = hands[turn].filter((x) => x.id !== best.move!.stone.id);
          hands = { ...hands, [turn]: remaining };
          ends = best.move.newEnds;
          if (remaining.length === 0) {
            // Going out scores whatever the opponents are left holding.
            outcome =
              turn === 'A' || turn === 'C'
                ? pips(hands.B) + pips(hands.D)
                : -(pips(hands.A) + pips(hands.C));
            break;
          }
          passStreak = 0;
          turn = next(turn);
        }

        expect(outcome).toBe(root.value);
      });
    }

    expect(solved).toBeGreaterThan(50);
    console.log(`endgame: verified ${solved} exact solutions by playing them out`);
  });

  it('solves sampled endgame worlds inside the node budget', () => {
    const random = makeRandom(23);
    const agent = believingAgent();
    let attempts = 0;
    let solvedCount = 0;
    let totalNodes = 0;

    for (let game = 0; game < 25; game++) {
      playGame(dealHands(random), { A: agent, B: agent, C: agent, D: agent }, random, (state, hs) => {
        if (state.ends.left === null) return;
        const remaining = state.counts.A + state.counts.B + state.counts.C + state.counts.D;
        if (remaining > ENDGAME_THRESHOLD) return;
        const belief = deriveBeliefs(state, hs.A, 'A');
        const { worlds } = sampleWorlds(belief, hs.A, 3, random);
        for (const world of worlds) {
          attempts++;
          const exact = solveEndgame(world.hands, state.ends, state.turn, state.passStreak);
          totalNodes += exact.nodes;
          if (exact.solved) solvedCount++;
        }
      });
    }

    expect(attempts).toBeGreaterThan(50);
    // If this ever drops it means the threshold is set too high to be practical.
    expect(solvedCount / attempts).toBeGreaterThan(0.99);
    console.log(
      `endgame: ${solvedCount}/${attempts} sampled worlds solved, ` +
        `${(totalNodes / attempts).toFixed(0)} nodes average`,
    );
  });
});
