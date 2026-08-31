import { describe, expect, it } from 'vitest';
import { type Stone, makeStone } from '../../types/domino';
import type { LoggedMove, PlayerId } from '../../types/game';
import { applyMove, initialState, logMove } from '../replay';
import { recommend } from './pimc';
import { complementOf, scenarioState } from './scenario';

const s = makeStone;

describe('PIMC search', () => {
  it('is reproducible from a seed', () => {
    const hand = [s(0, 6), s(1, 2), s(3, 4)];
    const unseen = [s(6, 6), s(5, 6), s(4, 5), s(3, 3), s(2, 3), s(1, 1)];
    const state = scenarioState({
      played: complementOf(hand, unseen),
      hand,
      ends: { left: 0, right: 6 },
      counts: { B: 2, C: 2, D: 2 },
    });
    const once = recommend(state, hand, 'A', { worlds: 40, seed: 5 });
    const twice = recommend(state, hand, 'A', { worlds: 40, seed: 5 });
    expect(once.moves.map((m) => [m.candidate.key, m.ev])).toEqual(
      twice.moves.map((m) => [m.candidate.key, m.ev]),
    );
  });

  it('plays the last stone and knows it has won', () => {
    const hand = [s(3, 4)];
    const unseen = [s(1, 1), s(2, 2), s(5, 6)];
    const state = scenarioState({
      played: complementOf(hand, unseen),
      hand,
      ends: { left: 3, right: 5 },
      counts: { B: 1, C: 1, D: 1 },
    });
    const result = recommend(state, hand, 'A', { worlds: 30, seed: 1 });
    expect(result.moves[0].candidate.stone.id).toBe('3-4');
    expect(result.moves[0].winRate).toBeCloseTo(1, 6);
    // Going out always wins, but *how much* it scores depends on which of the
    // three hidden stones partner C is holding, since only the opponents' pips
    // count. 1-1, 2-2 and 5-6 are worth 2, 4 and 11:
    //   C holds 1-1  -> we score 4 + 11 = 15
    //   C holds 2-2  -> we score 2 + 11 = 13
    //   C holds 5-6  -> we score 2 + 4  = 6
    // Averaged over the sampled deals, about 11.3. This is exactly the kind of
    // distinction the old win/lose terminal value threw away.
    expect(result.moves[0].points).toBeGreaterThan(6);
    expect(result.moves[0].points).toBeLessThan(15);
    expect(result.moves[0].points).toBeCloseTo(34 / 3, 0);
  });

  it('finds the forced block, and prices the risk in it exactly', () => {
    // Every 0 but mine is on the table; playing 0-6 against the 6 end leaves
    // both ends showing 0 and blocks the game. We keep 1-2, worth 3 pips, and
    // the 6 hidden stones are worth 46, of which partner C holds two.
    //
    // We win the block iff 3 + C's pips < 46 - C's pips, i.e. C holds 21 or
    // fewer. Of the C(6,2) = 15 pairs C could hold, only {6-6, 5-6} = 23 loses.
    // So the true answer is 14/15 = 93.3%, and the search should find it —
    // the heuristic could not, because it works from the average hidden pip.
    const hand = [s(0, 6), s(1, 2)];
    const unseen = [s(6, 6), s(5, 6), s(4, 5), s(3, 4), s(2, 3), s(1, 1)];
    const state = scenarioState({
      played: complementOf(hand, unseen),
      hand,
      ends: { left: 0, right: 6 },
      counts: { B: 2, C: 2, D: 2 },
    });
    const result = recommend(state, hand, 'A', { worlds: 600, seed: 3 });
    expect(result.sampled).toBe(600);
    const blocking = result.moves.find(
      (m) => m.candidate.resultEnds.left === 0 && m.candidate.resultEnds.right === 0,
    )!;
    expect(blocking.winRate).toBeGreaterThan(0.88);
    expect(blocking.winRate).toBeLessThan(0.98);
    expect(result.moves[0].candidate.key).toBe(blocking.candidate.key);
  });

  it('still ranks moves when the log is impossible, instead of inventing deals', () => {
    const hand = [s(0, 0), s(0, 1), s(0, 2), s(0, 3), s(0, 4), s(0, 5), s(0, 6)];
    const state = scenarioState({
      played: [s(1, 1), s(2, 2), s(3, 3)],
      hand,
      ends: { left: 0, right: 2 },
      counts: { B: 6, C: 6, D: 6 },
      banned: { B: [1, 2, 3, 4, 5, 6] },
    });
    const result = recommend(state, hand, 'A', { worlds: 20, seed: 1 });
    expect(result.belief.contradiction).toBe(true);
    expect(result.sampled).toBe(0);
    // Falls back to the heuristic ordering rather than returning nothing.
    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.moves[0].reasons.length).toBeGreaterThan(0);
  });

  it('keeps the heuristic rationale alongside the search verdict', () => {
    const hand = [s(0, 6), s(1, 2), s(3, 4)];
    const unseen = [s(6, 6), s(5, 6), s(4, 5), s(3, 3), s(2, 3), s(1, 1)];
    const state = scenarioState({
      played: complementOf(hand, unseen),
      hand,
      ends: { left: 0, right: 6 },
      counts: { B: 2, C: 2, D: 2 },
    });
    const result = recommend(state, hand, 'A', { worlds: 40, seed: 2 });
    for (const move of result.moves) {
      expect(move.reasons.length).toBeGreaterThan(0);
      expect(move.ev).toBeGreaterThanOrEqual(-1.5);
      expect(move.ev).toBeLessThanOrEqual(1.5);
      expect(move.winRate).toBeGreaterThanOrEqual(0);
      expect(move.winRate).toBeLessThanOrEqual(1);
    }
  });
});

describe('the full pipeline', () => {
  it('runs with likelihood weighting and the endgame solver together', () => {
    const opener: PlayerId = 'D';
    let st = initialState(opener);
    const moves: LoggedMove[] = [];
    const play = (playerId: PlayerId, stone: Stone, side?: 'left' | 'right') => {
      const move = logMove(st, { playerId, type: 'play', stone, side });
      moves.push(move);
      st = applyMove(st, move);
    };
    // Play runs D -> C -> B -> A, so three plies brings it round to us.
    play('D', s(5, 5));
    play('C', s(5, 6), 'right');
    play('B', s(4, 6), 'right');
    expect(st.turn).toBe('A');

    const hand = [s(1, 1), s(1, 2), s(2, 2), s(2, 3), s(3, 4), s(6, 6), s(0, 4)];
    const result = recommend(st, hand, 'A', {
      worlds: 60,
      seed: 8,
      log: { opener, moves },
    });

    expect(result.sampled).toBe(60);
    // Resampling keeps the full budget, and the pool it came from was larger.
    expect(result.ess).toBeGreaterThan(1);
    expect(result.moves.length).toBeGreaterThan(0);
    for (const move of result.moves) {
      expect(move.winRate).toBeGreaterThanOrEqual(0);
      expect(move.winRate).toBeLessThanOrEqual(1);
      expect(move.exactWorlds).toBeLessThanOrEqual(move.worlds);
    }
  });

  it('solves every world outright when the endgame solver is enabled', () => {
    // Eight stones left in play: below the threshold, so nothing is simulated.
    const hand = [s(3, 4), s(1, 2)];
    const unseen = [s(6, 6), s(5, 6), s(4, 5), s(2, 3), s(1, 1), s(0, 0)];
    const scenario = {
      played: complementOf(hand, unseen),
      hand,
      ends: { left: 3 as const, right: 5 as const },
      counts: { B: 2, C: 2, D: 2 },
    };
    const enabled = recommend(scenarioState(scenario), hand, 'A', {
      worlds: 50,
      seed: 2,
      endgameThreshold: 16,
    });
    for (const move of enabled.moves) {
      expect(move.exactWorlds).toBe(move.worlds);
    }

    // Off by default: solving a guessed deal assumes opponents see it too, and
    // that measured worse than rolling out. See ENGINE_DESIGN.md §5.
    const shipped = recommend(scenarioState(scenario), hand, 'A', { worlds: 50, seed: 2 });
    for (const move of shipped.moves) {
      expect(move.exactWorlds).toBe(0);
    }
  });
});

describe('shipped defaults', () => {
  it('weights worlds whenever the log is available, and can be switched off', () => {
    const opener: PlayerId = 'D';
    let st = initialState(opener);
    const moves: LoggedMove[] = [];
    const play = (playerId: PlayerId, stone: Stone, side?: 'left' | 'right') => {
      const move = logMove(st, { playerId, type: 'play', stone, side });
      moves.push(move);
      st = applyMove(st, move);
    };
    play('D', s(5, 5));
    play('C', s(5, 6), 'right');
    play('B', s(4, 6), 'right');

    const hand = [s(1, 1), s(1, 2), s(2, 2), s(2, 3), s(3, 4), s(6, 6), s(0, 4)];
    const withLog = recommend(st, hand, 'A', { worlds: 40, seed: 3, log: { opener, moves } });
    const off = recommend(st, hand, 'A', { worlds: 40, seed: 3, log: { opener, moves }, likelihood: false });

    // Weighting is on whenever the log is available, and it draws from a larger
    // pool before resampling — so the effective sample size exceeds the budget.
    expect(withLog.ess).toBeGreaterThan(40);
    expect(off.ess).toBe(40);
    expect(withLog.sampled).toBe(40);
    expect(off.sampled).toBe(40);
  });

  it('keeps weighting mild — sharp settings measured worse', () => {
    const opener: PlayerId = 'D';
    let st = initialState(opener);
    const moves: LoggedMove[] = [];
    const play = (playerId: PlayerId, stone: Stone, side?: 'left' | 'right') => {
      const move = logMove(st, { playerId, type: 'play', stone, side });
      moves.push(move);
      st = applyMove(st, move);
    };
    play('D', s(5, 5));
    play('C', s(5, 6), 'right');
    play('B', s(4, 6), 'right');

    const hand = [s(1, 1), s(1, 2), s(2, 2), s(2, 3), s(3, 4), s(6, 6), s(0, 4)];
    const weighted = recommend(st, hand, 'A', {
      worlds: 40,
      seed: 3,
      log: { opener, moves },
      likelihood: {},
    });
    // The pool it drew from was larger than the budget, so ESS exceeds it.
    expect(weighted.ess).toBeGreaterThan(40);
    expect(weighted.sampled).toBe(40);
  });
});

describe('hands that have already played', () => {
  it('ignores stones on the table, whatever hand the caller passes', () => {
    // The exact shape of a real bug: the UI handed the engine the hand as
    // *dealt* rather than as it stood, so the engine saw a stone it had already
    // played, threw on applyMove, returned nothing, and the app told the user to
    // pass while holding four legal moves.
    const opener: PlayerId = 'B';
    let st = initialState(opener);
    const moves: LoggedMove[] = [];
    const step = (playerId: PlayerId, stone?: Stone, side?: 'left' | 'right') => {
      const m = logMove(st, { playerId, type: stone ? 'play' : 'pass', stone, side });
      moves.push(m);
      st = applyMove(st, m);
    };
    step('B', s(1, 1));
    step('A');
    step('D', s(1, 6), 'left');
    step('C', s(1, 4), 'right');
    step('B', s(0, 4), 'right');
    step('A', s(6, 6), 'left'); // <- A has now played a stone
    step('D', s(0, 0), 'right');
    step('C', s(0, 1), 'right');
    step('B', s(1, 2), 'right');

    expect(st.turn).toBe('A');
    expect(st.ends).toEqual({ left: 6, right: 2 });

    const dealt = [s(0, 6), s(6, 6), s(3, 6), s(2, 5), s(4, 5), s(0, 3), s(2, 2)];
    const current = dealt.filter((x) => x.id !== '6-6');

    const fromDealt = recommend(st, dealt, 'A', { worlds: 40, seed: 4 });
    const fromCurrent = recommend(st, current, 'A', { worlds: 40, seed: 4 });

    // Four legal moves: 0-6 and 3-6 on the 6, 2-5 and 2-2 on the 2.
    expect(fromCurrent.moves.length).toBe(4);
    expect(fromDealt.moves.length).toBe(4);
    expect(fromDealt.moves.map((m) => m.candidate.key)).toEqual(
      fromCurrent.moves.map((m) => m.candidate.key),
    );
    // And 6-6 is never offered, because it is on the table.
    expect(fromDealt.moves.some((m) => m.candidate.stone.id === '6-6')).toBe(false);
  });
});
