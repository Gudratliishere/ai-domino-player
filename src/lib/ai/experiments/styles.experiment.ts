import { describe, it } from 'vitest';
import { formatPaired, pairedLadder, roundRobin } from '../experiment';
import { believingAgent, heuristicAgent, pimcAgent, randomAgent } from '../harness';
import { STYLES, styleByName } from '../styles';

/**
 * Which style of play actually wins?
 *
 * Run with `npm run experiment`. Not part of `npm test`: these take minutes, and
 * a measurement is not a regression test.
 *
 * Two rules this file follows, both learned the hard way in §5:
 *  - every number carries a standard error, and
 *  - the seeds that pick a winner are never the seeds that measure it.
 */

// Declared rather than pulled from @types/node: the app's tsconfig deliberately
// does not carry node globals, and this is the only line that wants one.
declare const process: { env: Record<string, string | undefined> };

const DEALS = Number(process.env.DEALS ?? 2000);
const HELD_OUT_DEALS = Number(process.env.HELD_OUT_DEALS ?? 4000);
const TRAIN_SEED = 20260831;
const HELD_OUT_SEED = 77712345;

function table(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows
    .map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join('  '))
    .join('\n');
}

describe('playing styles, head to head', () => {
  it('runs a round-robin and then checks the winner on held-out deals', () => {
    const contenders = STYLES.map((style) => ({
      name: style.name,
      agent: () => heuristicAgent(style.weights),
    }));

    console.log(`\nRound-robin: ${contenders.length} styles, ${DEALS} deals per pair`);
    console.log('(each deal played twice, seats swapped, shared random stream)\n');

    const { entries, standings } = roundRobin(contenders, DEALS, TRAIN_SEED, (entry) => {
      console.log(
        `  ${entry.a.padEnd(14)} vs ${entry.b.padEnd(14)} ${formatPaired(entry.result)}`,
      );
    });

    console.log('\nStandings — mean net points per game against the field:\n');
    console.log(
      table([
        ['style', 'pts/game', '±', 'idea'],
        ...standings.map((s) => [
          s.name,
          `${s.netPoints >= 0 ? '+' : ''}${s.netPoints.toFixed(2)}`,
          s.standardError.toFixed(2),
          styleByName(s.name).idea,
        ]),
      ]),
    );

    // The field average hides who beat whom; the shipped row is the one that
    // decides whether anything here is worth adopting.
    const vsShipped = entries.filter((e) => e.a === 'shipped' || e.b === 'shipped');
    console.log('\nAgainst the shipped weights (positive = the challenger is better):\n');
    console.log(
      table([
        ['challenger', 'pts/game for challenger', 'z'],
        ...vsShipped.map((e) => {
          const challenger = e.a === 'shipped' ? e.b : e.a;
          const net = e.a === 'shipped' ? -e.result.netPoints : e.result.netPoints;
          return [challenger, `${net >= 0 ? '+' : ''}${net.toFixed(2)}`, e.result.z.toFixed(1)];
        }),
      ]),
    );

    const best = standings[0];
    if (best.name === 'shipped') {
      console.log('\nThe shipped weights top the field. Nothing to validate.');
      return;
    }

    console.log(
      `\nHeld-out check: ${best.name} vs shipped, ${HELD_OUT_DEALS} fresh deals, unseen seed`,
    );
    const heldOut = pairedLadder(
      () => heuristicAgent(styleByName(best.name).weights),
      () => heuristicAgent(styleByName('shipped').weights),
      HELD_OUT_DEALS,
      HELD_OUT_SEED,
    );
    console.log(`  ${best.name} vs shipped: ${formatPaired(heldOut)}`);
    console.log(
      heldOut.z > 2
        ? '  Real on held-out deals.'
        : '  Not significant on held-out deals — the round-robin lead was selection noise.',
    );
  });
});

describe('sanity: the ladder can see differences it should see', () => {
  it('measures the shipped heuristic against random-legal play', () => {
    const result = pairedLadder(() => heuristicAgent(), randomAgent, 400, TRAIN_SEED + 1);
    console.log(`\n  heuristic vs random-legal: ${formatPaired(result)}`);
  });

  it('measures search against the heuristic it uses for playouts', () => {
    // Small n: PIMC costs a few hundred playouts per move.
    const result = pairedLadder(() => pimcAgent(60), () => believingAgent(), 60, TRAIN_SEED + 2);
    console.log(`  PIMC(60 worlds) vs believing heuristic: ${formatPaired(result)}`);
  });
});
