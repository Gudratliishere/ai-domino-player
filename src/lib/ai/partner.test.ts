import { describe, expect, it } from 'vitest';
import { makeStone } from '../../types/domino';
import type { PipValue } from '../../types/domino';
import { DEFAULT_WEIGHTS, scoreMove } from './features';
import { legalMoves } from './moveGen';
import { recommend } from './pimc';
import { type Scenario, scenarioContext, scenarioState } from './scenario';

const s = makeStone;

/**
 * The position from the bug report, in the reporter's own words: "D started with
 * 1-1. C (partner) played 1-6. B played 6-6." A is on lead with seven stones to
 * C's six, and can either consume the 6 end or leave it standing.
 */
function position(banned?: Partial<Record<'C', PipValue[]>>): Scenario {
  return {
    playedBy: { D: [s(1, 1)], C: [s(1, 6)], B: [s(6, 6)] },
    hand: [s(1, 2), s(2, 6), s(0, 0), s(3, 3), s(4, 5), s(0, 4), s(3, 5)],
    ends: { left: 1, right: 6 },
    counts: { B: 6, C: 6, D: 6 },
    banned,
  };
}

function scores(scenario: Scenario) {
  const ctx = scenarioContext(scenario);
  const byStone = new Map<string, ReturnType<typeof scoreMove>>();
  for (const move of legalMoves(ctx.hand, ctx.ends)) {
    const scored = scoreMove(ctx, move, DEFAULT_WEIGHTS);
    const best = byStone.get(move.stone.id);
    if (!best || scored.score > best.score) byStone.set(move.stone.id, scored);
  }
  return byStone;
}

describe('playing for your partner', () => {
  it('prefers the move that leaves the partner’s suit standing', () => {
    const byStone = scores(position());
    // 1-2 answers the 1 end and leaves the 6 open for C; 2-6 eats the 6.
    const keepsSix = byStone.get('1-2');
    const eatsSix = byStone.get('2-6');
    expect(keepsSix).toBeDefined();
    expect(eatsSix).toBeDefined();
    expect(keepsSix!.score).toBeGreaterThan(eatsSix!.score);
  });

  it('says why, in terms of the partner', () => {
    const reasons = scores(position()).get('1-2')!.reasons.join(' ');
    expect(reasons).toContain('C has already played');
    expect(reasons).toContain('strong suit');
    expect(reasons).toContain('closer to going out than you');
  });

  it('drops the read the moment the partner passes on that suit', () => {
    // "if he passes in 6-6, ofc this changes is cleared" — C passing on 6 kills
    // both halves of the read, and the engine stops holding the end open.
    const after = scores(position({ C: [1, 6] }));
    const reasons = after.get('1-2')!.reasons.join(' ');
    expect(reasons).not.toContain('strong suit');

    const before = scores(position());
    const gapBefore = before.get('1-2')!.score - before.get('2-6')!.score;
    const gapAfter = after.get('1-2')!.score - after.get('2-6')!.score;
    expect(gapAfter).toBeLessThan(gapBefore);
  });

  it('counts a partner who is level as no reason to feed them harder', () => {
    const level = scores({ ...position(), counts: { B: 6, C: 7, D: 6 }, hand: position().hand.slice(0, 6) });
    expect(level.get('1-2')!.reasons.join(' ')).not.toContain('closer to going out');
  });
});

describe('end to end, through the real engine', () => {
  it('carries the partner read all the way into a recommendation', () => {
    const scenario = position();
    const result = recommend(scenarioState(scenario), scenario.hand, 'A', {
      worlds: 120,
      seed: 7,
    });
    expect(result.moves.length).toBeGreaterThan(0);
    // The rationale comes from the heuristic even though the search does the
    // ranking, so the partner reasoning has to survive the whole pipeline.
    const forKeepingSix = result.moves.find((m) => m.candidate.stone.id === '1-2');
    expect(forKeepingSix).toBeDefined();
    expect(forKeepingSix!.reasons.join(' ')).toMatch(/partner|C has already played/);
  });
});
