import { describe, it } from 'vitest';
import { formatPaired, pairedLadder } from '../experiment';
import { configuredPimcAgent } from '../harness';
import { FIRST_GAME_OPENING_STONE_ID } from '../../matchRules';
import { ENDGAME_THRESHOLD } from '../endgame';

/**
 * Does exact endgame evaluation pay once the fusion is taken out of it?
 *
 * §5 shipped the minimax solver **off**: +1.8 points against a heuristic
 * opponent, −3.8 against a random one, −2.5 head to head, none of them
 * individually significant, all of them consistent with the mechanism —
 * solving a determinized world assumes every seat can see the deal.
 *
 * `bestResponse.ts` keeps the exact search for our own move and replaces the
 * other seats with the playout policy read from their own hand. Two variants are
 * worth separating:
 *
 *  - **opponents only** (`modelPartner: false`): B and D follow the policy, our
 *    two seats still coordinate perfectly. Removes half the fusion.
 *  - **honest** (`modelPartner: true`): the partner is modelled too, because
 *    they cannot see our hand either. Removes all of it, and gives up the
 *    coordinated-partner credit minimax was quietly taking.
 *
 * Every ladder here is against the same reference — the shipped configuration
 * with the endgame **off** — so the four numbers are directly comparable.
 */

declare const process: { env: Record<string, string | undefined> };

const DEALS = Number(process.env.ENDGAME_DEALS ?? 250);
const WORLDS = Number(process.env.BASE_WORLDS ?? 40);
const THRESHOLD = Number(process.env.ENDGAME_AT ?? ENDGAME_THRESHOLD);
const SEED = 5772156;

const LIKELIHOOD = { forcedOpeningStoneId: FIRST_GAME_OPENING_STONE_ID };

/** The reference: the shipped search, endgame off. */
const endgameOff = () => configuredPimcAgent({ worlds: WORLDS, likelihood: LIKELIHOOD });

const minimaxEndgame = () =>
  configuredPimcAgent({
    worlds: WORLDS,
    likelihood: LIKELIHOOD,
    endgameThreshold: THRESHOLD,
    endgameMode: 'minimax',
  });

const bestResponseEndgame = (modelPartner: boolean, beta?: number) => () =>
  configuredPimcAgent({
    worlds: WORLDS,
    likelihood: LIKELIHOOD,
    endgameThreshold: THRESHOLD,
    endgameMode: 'best-response',
    bestResponse: { modelPartner, beta },
  });

/**
 * The screen above put minimax at +1.03 ± 0.63 against the endgame-off
 * reference — the opposite sign to §5's decision to ship it off, on an error bar
 * seven times tighter than the one that decision was made with. That is worth a
 * proper run rather than a screen, on a seed the screen never saw.
 *
 * Gated: it takes the better part of an hour. `CONFIRM=1 npm run experiment`.
 */
describe.runIf(process.env.CONFIRM === '1')('confirmation: is the minimax endgame worth turning on', () => {
  it('runs one long ladder on a fresh seed', () => {
    const deals = Number(process.env.CONFIRM_DEALS ?? 1000);
    console.log(
      `
  minimax endgame at ${THRESHOLD} stones vs endgame off, ${deals} paired deals, fresh seed:`,
    );
    const result = pairedLadder(minimaxEndgame, endgameOff, deals, 8675309);
    console.log(`    ${formatPaired(result)}`);
    console.log(
      result.z > 2
        ? '    Real. The solver has been shipped off on a measurement that could not see this.'
        : '    Still inside the noise at this sample size.',
    );
  });
});

describe('best-response endgame', () => {
  it('measures every variant against the same endgame-off reference', () => {
    console.log(
      `\n  PIMC(${WORLDS} worlds), endgame at ${THRESHOLD} stones, ${DEALS} paired deals each.`,
    );
    console.log('  Reference: the same search with the endgame off.\n');

    const runs: [string, () => ReturnType<typeof configuredPimcAgent>][] = [
      ['minimax (shipped off, §5)', minimaxEndgame],
      ['best-response, opponents only', bestResponseEndgame(false)],
      ['best-response, honest', bestResponseEndgame(true)],
      // Greedy modelling is the sharper assumption and should measure worse than
      // it looks in-model; included because that gap is the interesting part.
      ['best-response, honest + greedy', bestResponseEndgame(true, Infinity)],
    ];

    for (const [label, agent] of runs) {
      const result = pairedLadder(agent, endgameOff, DEALS, SEED);
      console.log(`    ${label.padEnd(32)} ${formatPaired(result)}`);
    }
  });

  it('puts the best-response solver against minimax head to head', () => {
    // The most direct comparison, and the one §5 leaned on when shipping the
    // solver off.
    console.log(`\n  Head to head, ${DEALS} paired deals:`);
    const honest = pairedLadder(bestResponseEndgame(true), minimaxEndgame, DEALS, SEED + 1);
    console.log(`    honest best-response vs minimax   ${formatPaired(honest)}`);
    const opponentsOnly = pairedLadder(
      bestResponseEndgame(false),
      minimaxEndgame,
      DEALS,
      SEED + 2,
    );
    console.log(`    opponents-only vs minimax         ${formatPaired(opponentsOnly)}`);
  });
});
