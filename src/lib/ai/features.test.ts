import { describe, expect, it } from 'vitest';
import { makeStone } from '../../types/domino';
import { DEFAULT_WEIGHTS, pCannotPlay, rankMoves, scoreMove } from './features';
import { legalMoves } from './moveGen';
import { complementOf, scenarioBeliefContext, scenarioContext } from './scenario';
import { az } from '../../i18n/az';

const s = makeStone;

function labels(terms: { label: string }[]) {
  return terms.map((t) => t.label);
}

describe('count-out dominates', () => {
  it('scores playing your last stone above everything else', () => {
    const hand = [s(3, 4)];
    const unseen = [s(1, 1), s(2, 2), s(5, 6)];
    const ctx = scenarioContext({
      played: complementOf(hand, unseen),
      hand,
      ends: { left: 3, right: 5 },
      counts: { B: 1, C: 1, D: 1 },
    });
    const [best] = rankMoves(ctx);
    expect(best.score).toBe(DEFAULT_WEIGHTS.countOut);
    expect(best.reasons[0]).toMatch(/last stone/i);
  });
});

describe('forced block (§2.4)', () => {
  // 0-0 through 0-5 are all on the table and I hold 0-6. Playing it against the
  // 6 end leaves both ends showing 0, which nobody can ever answer.
  const hand = [s(0, 6), s(1, 2)];
  const unseen = [s(6, 6), s(5, 6), s(4, 5), s(3, 4), s(2, 3), s(1, 1)];
  const ctx = scenarioContext({
    played: complementOf(hand, unseen),
    hand,
    ends: { left: 0, right: 6 },
    counts: { B: 2, C: 2, D: 2 },
  });

  it('finds the killing side and explains it', () => {
    const [best] = rankMoves(ctx);
    expect(best.candidate.stone.id).toBe('0-6');
    expect(best.candidate.resultEnds).toEqual({ left: 0, right: 0 });
    expect(labels(best.terms)).toContain('forcedBlock');
    expect(best.reasons[0]).toMatch(/kills the game/i);
  });

  it('does not claim a block on the side that leaves the game alive', () => {
    const other = legalMoves(ctx.hand, ctx.ends).find((c) => c.side === 'left')!;
    expect(labels(scoreMove(ctx, other).terms)).not.toContain('forcedBlock');
  });

  it('prefers the block to the alternative', () => {
    const ranked = rankMoves(ctx);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});

describe('opponent starvation from observed passes (§2.6)', () => {
  const hand = [s(2, 5), s(2, 3)];
  const unseen = [s(1, 1), s(4, 4), s(0, 6), s(1, 6), s(4, 6), s(3, 6)];
  const scenario = {
    played: complementOf(hand, unseen),
    hand,
    ends: { left: 2 as const, right: 2 as const },
    counts: { B: 2, C: 2, D: 2 },
    banned: { B: [2 as const, 5 as const] },
  };

  it('treats a player who passed on both ends as a certainty, not a guess', () => {
    const ctx = scenarioContext(scenario);
    const starving = legalMoves(ctx.hand, ctx.ends).find((c) => c.stone.id === '2-5')!;
    const scored = scoreMove(ctx, starving);
    const term = scored.terms.find((t) => t.label === 'starve:B')!;
    expect(term.value).toBe(DEFAULT_WEIGHTS.starveOpponent);
    expect(term.reason).toMatch(/must pass again/);
  });

  it('does not credit starvation on an end the opponent can still serve', () => {
    const ctx = scenarioContext(scenario);
    const other = legalMoves(ctx.hand, ctx.ends).find((c) => c.stone.id === '2-3')!;
    const term = scoreMove(ctx, other).terms.find((t) => t.label === 'starve:B');
    expect(term?.value ?? 0).toBeLessThan(DEFAULT_WEIGHTS.starveOpponent);
  });
});

describe('self-block risk', () => {
  it('prefers the move that keeps more of the hand alive', () => {
    const hand = [s(3, 4), s(3, 6), s(6, 6)];
    const unseen = [s(0, 0), s(1, 1), s(2, 2), s(4, 4), s(5, 5), s(0, 1)];
    const ctx = scenarioContext({
      played: complementOf(hand, unseen),
      hand,
      ends: { left: 3, right: 3 },
      counts: { B: 2, C: 2, D: 2 },
    });
    const ranked = rankMoves(ctx);
    expect(ranked[0].candidate.stone.id).toBe('3-6');
  });

  it('flags a move that leaves nothing playable', () => {
    const hand = [s(3, 4), s(6, 6)];
    const unseen = [s(0, 0), s(1, 1), s(2, 2), s(5, 5), s(0, 1), s(1, 2)];
    const ctx = scenarioContext({
      played: complementOf(hand, unseen),
      hand,
      ends: { left: 3, right: 3 },
      counts: { B: 2, C: 2, D: 2 },
    });
    const [only] = rankMoves(ctx);
    expect(only.candidate.stone.id).toBe('3-4');
    const term = only.terms.find((t) => t.label === 'selfBlock')!;
    expect(term.value).toBe(DEFAULT_WEIGHTS.selfBlockNone);
  });
});

describe('double safety', () => {
  it('warns when a held double has no surviving suit', () => {
    // Every 6 except my own 6-6 is already on the table.
    const hand = [s(1, 2), s(6, 6)];
    const unseen = [s(0, 0), s(2, 2), s(3, 4)];
    const ctx = scenarioContext({
      played: complementOf(hand, unseen),
      hand,
      ends: { left: 1, right: 1 },
      counts: { B: 1, C: 1, D: 1 },
    });
    const [only] = rankMoves(ctx);
    const term = only.terms.find((t) => t.label === 'deadDouble')!;
    expect(term.value).toBe(DEFAULT_WEIGHTS.deadDouble);
    expect(term.reason).toMatch(/6-6/);
  });
});

describe('pCannotPlay', () => {
  const hand = [s(0, 0), s(1, 1)];
  const unseen = complementOf(hand).slice(0, 12);
  const ctx = scenarioContext({
    played: complementOf(hand, unseen),
    hand,
    ends: { left: 0, right: 1 },
    counts: { B: 4, C: 4, D: 4 },
    banned: { D: [3, 4] },
  });

  it('is a certainty when every open end has been passed on', () => {
    expect(pCannotPlay(ctx, 'D', { left: 3, right: 4 })).toBe(1);
  });

  it('is a probability otherwise, and never leaves [0,1]', () => {
    for (const p of ['B', 'C', 'D'] as const) {
      const value = pCannotPlay(ctx, p, { left: 2, right: 5 });
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('deduction feeding the policy (Phase 2)', () => {
  // B has played four non-double fives and I hold 5-5, so the dealing cap proves
  // B holds no fives at all — without B ever having passed on one.
  const hand = [s(5, 6), s(5, 5), s(0, 0), s(0, 1), s(0, 2), s(2, 2), s(3, 3)];
  const scenario = {
    playedBy: {
      B: [s(0, 5), s(1, 5), s(2, 5), s(3, 5)],
      C: [s(1, 1), s(2, 3)],
      D: [s(4, 6), s(2, 4)],
    },
    hand,
    ends: { left: 5 as const, right: 6 as const },
    counts: { B: 3, C: 5, D: 5 },
  };

  it('turns a cap deduction into a certain starve, and marks it proven', () => {
    const ctx = scenarioBeliefContext(scenario);
    const move = legalMoves(ctx.hand, ctx.ends).find(
      (c) => c.stone.id === '5-6' && c.side === 'right',
    )!;
    expect(move.resultEnds).toEqual({ left: 5, right: 5 });

    const scored = scoreMove(ctx, move);
    const term = scored.terms.find((t) => t.label === 'starve:B')!;
    expect(term.value).toBe(DEFAULT_WEIGHTS.starveOpponent);
    expect(term.certain).toBe(true);
    expect(term.reason).toMatch(/the log rules it out/);
    expect(scored.proven).toContain(term.reason);
  });

  it('does not claim that certainty without the deduction', () => {
    // Same position, but scored on counting alone: B merely looks unlikely.
    const ctx = scenarioContext(scenario);
    const move = legalMoves(ctx.hand, ctx.ends).find(
      (c) => c.stone.id === '5-6' && c.side === 'right',
    )!;
    const term = scoreMove(ctx, move).terms.find((t) => t.label === 'starve:B');
    expect(term?.certain ?? false).toBe(false);
    expect(term?.value ?? 0).toBeLessThan(DEFAULT_WEIGHTS.starveOpponent);
  });
});

describe('the rationale reads in the players names', () => {
  const hand = [s(2, 5), s(2, 3)];
  const unseen = [s(1, 1), s(4, 4), s(0, 6), s(1, 6), s(4, 6), s(3, 6)];
  const scenario = {
    played: complementOf(hand, unseen),
    hand,
    ends: { left: 2 as const, right: 2 as const },
    counts: { B: 2, C: 2, D: 2 },
    banned: { B: [2 as const, 5 as const] },
  };

  it('names the opponent it is starving, and the ranking is unchanged', () => {
    const seats = scenarioContext(scenario);
    const named = { ...seats, names: { A: 'Dunay', B: 'Resad', C: 'Aysel', D: 'Kamran' } };
    const starving = legalMoves(seats.hand, seats.ends).find((c) => c.stone.id === '2-5')!;

    const seatTerm = scoreMove(seats, starving).terms.find((t) => t.label === 'starve:B')!;
    const namedTerm = scoreMove(named, starving).terms.find((t) => t.label === 'starve:B')!;

    expect(seatTerm.reason).toMatch(/^B has already passed/);
    expect(namedTerm.reason).toMatch(/^Resad has already passed/);
    // A name is a label: it may not move a score.
    expect(namedTerm.value).toBe(seatTerm.value);
    expect(rankMoves(named).map((m) => m.candidate.key)).toEqual(
      rankMoves(seats).map((m) => m.candidate.key),
    );
  });

  it('names your partner when it weighs feeding them', () => {
    const named = {
      ...scenarioContext(scenario),
      names: { A: 'Dunay', B: 'Resad', C: 'Aysel', D: 'Kamran' },
    };
    const move = legalMoves(named.hand, named.ends).find((c) => c.stone.id === '2-3')!;
    const term = scoreMove(named, move).terms.find((t) => t.label === 'feedPartner')!;
    expect(term.reason).toContain('Aysel');
    expect(term.reason).not.toMatch(/\bC\b/);
  });
});

describe('the rationale speaks the reader language', () => {
  const hand = [s(2, 5), s(2, 3)];
  const unseen = [s(1, 1), s(4, 4), s(0, 6), s(1, 6), s(4, 6), s(3, 6)];
  const scenario = {
    played: complementOf(hand, unseen),
    hand,
    ends: { left: 2 as const, right: 2 as const },
    counts: { B: 2, C: 2, D: 2 },
    banned: { B: [2 as const, 5 as const] },
  };
  const names = { A: 'Dunay', B: 'Resad', C: 'Aysel', D: 'Kamran' };

  it('writes the reasons in Azerbaijani without touching the ranking', () => {
    const english = { ...scenarioContext(scenario), names };
    const azeri = { ...english, messages: az };
    const starving = legalMoves(english.hand, english.ends).find((c) => c.stone.id === '2-5')!;

    const inEnglish = scoreMove(english, starving);
    const inAzeri = scoreMove(azeri, starving);

    const englishStarve = inEnglish.terms.find((t) => t.label === 'starve:B')!;
    const azeriStarve = inAzeri.terms.find((t) => t.label === 'starve:B')!;
    // Playing 2-5 onto 2 | 2 leaves 5 and 2 open, and B has passed on both.
    expect(englishStarve.reason).toBe(
      'Resad has already passed on 5 and 2, so Resad must pass again.',
    );
    expect(azeriStarve.reason).toBe(
      'Resad artıq 5 və 2 üzərində pas verib, deməli yenə pas verməlidir.',
    );

    // Same score, same order, same terms — only the prose differs.
    expect(inAzeri.score).toBe(inEnglish.score);
    expect(labels(inAzeri.terms)).toEqual(labels(inEnglish.terms));
    expect(rankMoves(azeri).map((m) => m.candidate.key)).toEqual(
      rankMoves(english).map((m) => m.candidate.key),
    );
  });

  it('joins two open-end values with the right word', () => {
    const ctx = { ...scenarioContext(scenario), names, messages: az };
    const move = legalMoves(ctx.hand, ctx.ends).find((c) => c.stone.id === '2-5')!;
    const prose = scoreMove(ctx, move).terms.map((t) => t.reason).join(' ');
    expect(prose).toContain('5 və 2');
    expect(prose).not.toContain(' and ');
  });

  it('leaves no English in an Azerbaijani rationale', () => {
    const ctx = { ...scenarioContext(scenario), names, messages: az };
    const english = /\b(the|and|your|you|stone|stones|pips|pass|team)\b/;
    for (const move of rankMoves(ctx)) {
      for (const term of move.terms) {
        expect(term.reason, term.label).not.toMatch(english);
      }
    }
  });
});
