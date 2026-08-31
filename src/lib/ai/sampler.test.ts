import { describe, expect, it } from 'vitest';
import type { PlayerId } from '../../types/game';
import { ALL_PLAYERS } from '../../types/game';
import { deriveBeliefs } from './beliefs';
import { isLegalHand } from './deal';
import { dealHands } from './deal';
import { believingAgent, playGame } from './harness';
import { makeRandom } from './rng';
import { sampleWorlds } from './sampler';

describe('sampler invariants', () => {
  it('every world it emits is a legal deal that respects every deduction', { timeout: 60000 }, () => {
    const random = makeRandom(2024);
    const agent = believingAgent();
    const agents = { A: agent, B: agent, C: agent, D: agent };
    let worldsChecked = 0;
    let attempts = 0;
    let restarts = 0;
    let positions = 0;

    for (let game = 0; game < 25; game++) {
      playGame(dealHands(random), agents, random, (state, hands) => {
        const me: PlayerId = 'A';
        const belief = deriveBeliefs(state, hands.A, me);
        const { worlds, stats } = sampleWorlds(belief, hands.A, 8, random);
        positions++;
        attempts += stats.attempts;
        restarts += stats.restarts;
        expect(worlds.length).toBe(8);

        for (const world of worlds) {
          worldsChecked++;

          // Hand sizes match, and the 28 stones are partitioned exactly once.
          const seen = new Set<string>();
          for (const p of ALL_PLAYERS) {
            expect(world.hands[p].length).toBe(state.counts[p]);
            for (const stone of world.hands[p]) {
              expect(seen.has(stone.id)).toBe(false);
              seen.add(stone.id);
              expect(state.playedIds.has(stone.id)).toBe(false);
            }
            // The dealing cap holds for the stones still in hand plus those played.
            const played = state.chain.filter((c) => c.playerId === p).map((c) => c.stone);
            expect(isLegalHand([...world.hands[p], ...played])).toBe(true);
          }
          expect(seen.size).toBe(28 - state.playedIds.size);

          // My own hand is never invented.
          expect(world.hands.A.map((s) => s.id).sort()).toEqual(
            hands.A.map((s) => s.id).sort(),
          );

          // Nothing contradicts a pass, or a proven assignment.
          for (const p of ALL_PLAYERS) {
            if (p === me) continue;
            for (const stone of world.hands[p]) {
              expect(belief.banned[p].has(stone.a)).toBe(false);
              expect(belief.banned[p].has(stone.b)).toBe(false);
            }
          }
          for (const [id, owner] of belief.known) {
            expect(world.hands[owner].some((s) => s.id === id)).toBe(true);
          }
          for (const [id, holders] of belief.possible) {
            const actual = ALL_PLAYERS.find((p) => world.hands[p].some((s) => s.id === id))!;
            expect([...holders]).toContain(actual);
          }
        }
      });
    }

    expect(worldsChecked).toBeGreaterThan(2000);
    console.log(
      `sampler: ${worldsChecked} worlds over ${positions} positions, ` +
        `${restarts} restarts in ${attempts} attempts (${((restarts / attempts) * 100).toFixed(2)}% rejected)`,
    );
  });

  it('spreads stones around rather than always giving them to one player', () => {
    const random = makeRandom(5);
    const deal = dealHands(random);
    const agent = believingAgent();
    let captured: { state: Parameters<typeof deriveBeliefs>[0]; hand: typeof deal.A } | null = null;
    playGame(deal, { A: agent, B: agent, C: agent, D: agent }, random, (state, hands) => {
      if (state.chain.length === 6) captured ??= { state, hand: [...hands.A] };
    });
    expect(captured).not.toBeNull();

    const belief = deriveBeliefs(captured!.state, captured!.hand, 'A');
    const { worlds } = sampleWorlds(belief, captured!.hand, 400, random);
    const someStone = [...belief.possible.keys()][0];
    const owners = new Set(
      worlds.map((w) => ALL_PLAYERS.find((p) => w.hands[p].some((s) => s.id === someStone))),
    );
    // With three possible holders and no deduction pinning it, all three should appear.
    expect(owners.size).toBeGreaterThan(1);
  });
});
