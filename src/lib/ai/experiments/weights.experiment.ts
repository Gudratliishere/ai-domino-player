import { describe, it } from 'vitest';
import { formatPaired, pairedLadder } from '../experiment';
import { heuristicAgent, pimcAgent, weightedPimcAgent } from '../harness';
import { DEFAULT_WEIGHTS, type Weights } from '../features';

/**
 * §13 found `doubles-first` beating the shipped weights by +0.45 ± 0.19 on
 * held-out deals. That style moves three weights at once, so this file asks the
 * two questions needed before anything is adopted:
 *
 *  1. Which term carries it, and where does its curve peak?
 *  2. Does the gain survive at the search level, which is what actually ships?
 *
 * Every sweep picks its winner on the training seed and re-measures it on a seed
 * it has never seen. A sweep that quotes only its own best cell is measuring the
 * maximum of a noisy sample, which is how §5's first tuning run fooled itself.
 */

declare const process: { env: Record<string, string | undefined> };

const SWEEP_DEALS = Number(process.env.SWEEP_DEALS ?? 3000);
const HELD_OUT_DEALS = Number(process.env.HELD_OUT_DEALS ?? 6000);
const SEARCH_DEALS = Number(process.env.SEARCH_DEALS ?? 400);
const SEARCH_WORLDS = Number(process.env.SEARCH_WORLDS ?? 60);
// The weighted agent oversamples 4x and weights every ply, so it gets its own,
// smaller budget rather than a share of the plain run's.
const WEIGHTED_DEALS = Number(process.env.WEIGHTED_DEALS ?? 400);
const TRAIN_SEED = 31415926;
const HELD_OUT_SEED = 27182818;

const variant = (overrides: Partial<Weights>): Weights => ({ ...DEFAULT_WEIGHTS, ...overrides });

/** Net points/game for a weight variant against the shipped weights, as a heuristic. */
function versusShipped(weights: Weights, deals: number, seed: number) {
  return pairedLadder(() => heuristicAgent(weights), () => heuristicAgent(), deals, seed);
}

function sweep(key: keyof Weights, values: number[]) {
  console.log(`\n  ${key} (shipped: ${DEFAULT_WEIGHTS[key]}), ${SWEEP_DEALS} deals per point:`);
  const rows = values.map((value) => {
    const result = versusShipped(variant({ [key]: value }), SWEEP_DEALS, TRAIN_SEED);
    console.log(
      `    ${String(value).padStart(6)}  ${result.netPoints >= 0 ? '+' : ''}` +
        `${result.netPoints.toFixed(2)} ± ${result.standardError.toFixed(2)}  ` +
        `(z=${result.z.toFixed(1)})`,
    );
    return { value, result };
  });
  const best = rows.reduce((a, b) => (b.result.netPoints > a.result.netPoints ? b : a));
  console.log(`    peak at ${key}=${best.value}`);
  return best;
}

describe('what carries the doubles finding', () => {
  it('shows the double terms are inert', () => {
    // Measured first, and both curves are flat to two decimal places: from -25
    // to -160 the result never leaves +0.00 ± 0.00. The guards on these terms —
    // the value must be off both new ends AND unservable from the rest of your
    // hand — fire so rarely that the weight barely reaches a decision. The
    // mirrored ladder makes that visible instead of burying it in noise: when a
    // weight changes no decision, the paired difference is exactly zero.
    sweep('deadDouble', [-25, -60, -120, -160]);
    sweep('thinDouble', [-7, -25, -55, -75]);
    console.log(
      '\n  Both flat, so `doubles-first` was never about doubles: it also raised' +
        '\n  pipShed from 0.6 to 1.5, and that is the next test.',
    );
  });

  it('sweeps the terms that actually reach decisions', () => {
    // pipShed prices every stone on the board and starveOpponent fires on most
    // moves, so these are where a mis-set weight would cost real points. §5's
    // tuner drifted both upward (pipShed 1.0, starve 47) before its held-out
    // result came back flat; worth asking again with tighter error bars.
    const pips = sweep('pipShed', [0.2, 0.6, 1, 1.5, 2.5, 4]);
    const starve = sweep('starveOpponent', [25, 40, 55, 70, 90]);

    // Terms interact, so the pair is measured rather than assumed additive.
    const combined = variant({
      pipShed: pips.value,
      starveOpponent: starve.value,
    });
    const both = versusShipped(combined, SWEEP_DEALS, TRAIN_SEED);
    console.log(
      `\n  both at their peaks (pipShed=${pips.value}, starveOpponent=${starve.value}): ` +
        `${formatPaired(both)}`,
    );

    const candidates = [
      {
        name: `pipShed=${pips.value}`,
        weights: variant({ pipShed: pips.value }),
        score: pips.result.netPoints,
      },
      {
        name: `starveOpponent=${starve.value}`,
        weights: variant({ starveOpponent: starve.value }),
        score: starve.result.netPoints,
      },
      { name: 'both', weights: combined, score: both.netPoints },
    ];
    const winner = candidates.reduce((a, b) => (b.score > a.score ? b : a));

    console.log(
      `\n  Held-out check: ${winner.name} vs shipped, ${HELD_OUT_DEALS} fresh deals, unseen seed`,
    );
    const heldOut = versusShipped(winner.weights, HELD_OUT_DEALS, HELD_OUT_SEED);
    console.log(`    ${formatPaired(heldOut)}`);
    console.log(
      heldOut.z > 2
        ? '    Holds up as a heuristic. Next question is whether the search agrees.'
        : '    Does not hold up — the sweep peak was selection noise.',
    );
    console.log(
      `\n  CANDIDATE: pipShed=${winner.weights.pipShed} ` +
        `starveOpponent=${winner.weights.starveOpponent}`,
    );
  });
});

describe('does it survive the search', () => {
  it('measures the candidate inside PIMC, which is what ships', () => {
    // Set CANDIDATE_PIPSHED / CANDIDATE_STARVE from the sweep above. Here the
    // weights drive the playout policy rather than the final ranking, and §8's
    // lesson is that the two are not the same thing.
    const candidate = variant({
      pipShed: Number(process.env.CANDIDATE_PIPSHED ?? DEFAULT_WEIGHTS.pipShed),
      starveOpponent: Number(process.env.CANDIDATE_STARVE ?? DEFAULT_WEIGHTS.starveOpponent),
    });
    if (
      candidate.pipShed === DEFAULT_WEIGHTS.pipShed &&
      candidate.starveOpponent === DEFAULT_WEIGHTS.starveOpponent
    ) {
      console.log('\n  No candidate set (CANDIDATE_PIPSHED / CANDIDATE_STARVE) — skipping.');
      return;
    }

    console.log(
      `\n  Candidate: pipShed=${candidate.pipShed}, starveOpponent=${candidate.starveOpponent}`,
    );
    console.log(
      `  PIMC(${SEARCH_WORLDS} worlds): ${SEARCH_DEALS} paired deals plain, ` +
        `${WEIGHTED_DEALS} weighted`,
    );
    const plain = pairedLadder(
      () => pimcAgent(SEARCH_WORLDS, candidate),
      () => pimcAgent(SEARCH_WORLDS),
      SEARCH_DEALS,
      HELD_OUT_SEED + 1,
    );
    console.log(`    plain PIMC:    ${formatPaired(plain)}`);

    // The shipped configuration is the weighted one; it costs more per move, so
    // it gets its own smaller run rather than sharing this one's budget.
    const weighted = pairedLadder(
      () => weightedPimcAgent(SEARCH_WORLDS, candidate),
      () => weightedPimcAgent(SEARCH_WORLDS),
      WEIGHTED_DEALS,
      HELD_OUT_SEED + 2,
    );
    console.log(`    weighted PIMC: ${formatPaired(weighted)}`);
  });
});
