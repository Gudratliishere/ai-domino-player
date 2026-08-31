import { describe, expect, it } from 'vitest';
import { type Stone, makeStone } from '../types/domino';
import type { LoggedMove, PlayerId, Side } from '../types/game';
import { PLAYER_ORDER, nextPlayer } from '../types/game';
import { IllegalMoveError, applyMove, initialState, logMove, replay, replayPlies } from './replay';

interface Step {
  playerId: PlayerId;
  type: 'play' | 'pass';
  stone?: Stone;
  side?: Side;
}

const play = (playerId: PlayerId, stone: Stone, side?: Side): Step => ({
  playerId,
  type: 'play',
  stone,
  side,
});
const pass = (playerId: PlayerId): Step => ({ playerId, type: 'pass' });

function run(opener: PlayerId, steps: Step[]) {
  let state = initialState(opener);
  const log: LoggedMove[] = [];
  for (const step of steps) {
    const move = logMove(state, step);
    log.push(move);
    state = applyMove(state, move);
  }
  return { state, log };
}

describe('turn order', () => {
  it('runs clockwise around the table: A bottom, D left, C top, B right', () => {
    expect(PLAYER_ORDER).toEqual(['A', 'D', 'C', 'B']);
    expect(nextPlayer('A')).toBe('D');
    expect(nextPlayer('D')).toBe('C');
    expect(nextPlayer('C')).toBe('B');
    expect(nextPlayer('B')).toBe('A');
  });

  it('keeps partners opposite and the teams alternating', () => {
    expect(nextPlayer(nextPlayer('A'))).toBe('C');
    expect(nextPlayer(nextPlayer('B'))).toBe('D');
  });
});

describe('replaying a game opened by B', () => {
  const steps: Step[] = [
    play('B', makeStone(1, 1)),
    play('A', makeStone(1, 4), 'right'),
    play('D', makeStone(4, 4), 'right'),
    play('C', makeStone(1, 3), 'left'),
    pass('B'),
    play('A', makeStone(3, 6), 'left'),
  ];

  it('tracks ends, counts and turn', () => {
    const { state } = run('B', steps);
    expect(state.ends).toEqual({ left: 6, right: 4 });
    expect(state.chain).toHaveLength(5);
    expect(state.counts).toEqual({ A: 5, B: 6, C: 6, D: 6 });
    expect(state.turn).toBe('D');
    expect(state.passStreak).toBe(0);
  });

  it('snapshots the ends each move was chosen against', () => {
    const { log } = run('B', steps);
    expect(log[0].endsBefore).toEqual({ left: null, right: null });
    expect(log[4].endsBefore).toEqual({ left: 3, right: 4 });
  });

  it('reproduces the exact board state at every ply', () => {
    const { state, log } = run('B', steps);
    const plies = replayPlies('B', log);
    expect(plies).toHaveLength(log.length + 1);
    for (let i = 0; i < log.length; i++) {
      expect(plies[i].ends).toEqual(log[i].endsBefore);
      expect(plies[i].turn).toBe(log[i].playerId);
    }
    expect(replay('B', log)).toEqual(state);
  });

  it('records a pass as a permanent ban on both end values', () => {
    const { state } = run('B', steps);
    expect([...state.banned.B].sort()).toEqual([3, 4]);
    expect(state.banned.A.size).toBe(0);
  });
});

describe('terminal states', () => {
  it('blocks after four consecutive passes', () => {
    const { state } = run('A', [
      play('A', makeStone(6, 6)),
      pass('D'),
      pass('C'),
      pass('B'),
      pass('A'),
    ]);
    expect(state.blocked).toBe(true);
    expect(state.passStreak).toBe(4);
  });

  it('declares a winner when a hand empties', () => {
    let state = initialState('A');
    state = applyMove(state, logMove(state, { playerId: 'A', type: 'play', stone: makeStone(0, 0) }));
    state.counts.A = 1;
    const rest: Step[] = [
      play('D', makeStone(0, 1), 'right'),
      play('C', makeStone(1, 2), 'right'),
      play('B', makeStone(2, 3), 'right'),
      play('A', makeStone(3, 5), 'right'),
    ];
    for (const step of rest) {
      state = applyMove(state, logMove(state, step));
    }
    expect(state.winner).toBe('A');
  });
});

describe('illegal moves', () => {
  it('rejects a move out of turn', () => {
    const state = initialState('B');
    expect(() =>
      applyMove(state, logMove(state, { playerId: 'A', type: 'play', stone: makeStone(1, 1) })),
    ).toThrow(IllegalMoveError);
  });

  it('rejects a pass on an empty table', () => {
    const state = initialState('B');
    expect(() => applyMove(state, logMove(state, { playerId: 'B', type: 'pass' }))).toThrow(
      /cannot pass/,
    );
  });

  it('rejects a stone that matches neither end, and one already played', () => {
    const { state } = run('B', [play('B', makeStone(1, 1))]);
    expect(() =>
      applyMove(state, logMove(state, { playerId: 'A', type: 'play', stone: makeStone(2, 3), side: 'right' })),
    ).toThrow(/matches neither/);
    expect(() =>
      applyMove(state, logMove(state, { playerId: 'A', type: 'play', stone: makeStone(1, 1), side: 'right' })),
    ).toThrow(/already on the table/);
  });
});
