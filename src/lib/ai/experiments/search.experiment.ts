import { describe, it } from 'vitest';
import { formatPaired, pairedLadder } from '../experiment';
import { configuredPimcAgent } from '../harness';
import { FIRST_GAME_OPENING_STONE_ID } from '../../matchRules';
import { DEFAULT_OVERSAMPLE } from '../pimc';
import { POLICY_BETA, TEMPER } from '../weights';

/**
 * The search's own knobs.
 *
 * §8's summary is blunt about where the strength came from: "the search is where
 * the strength is". Phase 3 was worth +5.5 points, and the variance reduction
 * *inside* it (common random numbers) was worth another 2.4. Phase 4 swung from
 * −3.6 to +6.2 on nothing but how sharply it weighted and whether it resampled.
 *
 * Yet the knobs themselves were never swept. `POLICY_BETA`, `TEMPER` and
 * `DEFAULT_OVERSAMPLE` are single constants chosen from one "mild versus sharp"
 * comparison, and the world count was set to what fitted the frame budget. Each
 * is measured here against the shipped configuration, paired and error-barred.
 *
 * Run: `npm run experiment -- src/lib/ai/experiments/search.experiment.ts`
 * `WORLDS_DEALS`, `LIKELIHOOD_DEALS` and `BASE_WORLDS` size the runs.
 */

declare const process: { env: Record<string, string | undefined> };

/** Small by default so a full run is minutes, not hours. Raise for a verdict. */
const WORLDS_DEALS = Number(process.env.WORLDS_DEALS ?? 300);
const LIKELIHOOD_DEALS = Number(process.env.LIKELIHOOD_DEALS ?? 250);
const BASE_WORLDS = Number(process.env.BASE_WORLDS ?? 40);
const SEED = 16180339;

/** The harness always plays game 1, where the opening is forced and carries no tell. */
const SHIPPED_LIKELIHOOD = { forcedOpeningStoneId: FIRST_GAME_OPENING_STONE_ID };

const shipped = (worlds = BASE_WORLDS) =>
  configuredPimcAgent({ worlds, likelihood: SHIPPED_LIKELIHOOD });

function compare(label: string, challenger: () => ReturnType<typeof configuredPimcAgent>, reference: () => ReturnType<typeof configuredPimcAgent>, deals: number, seed: number) {
  const result = pairedLadder(challenger, reference, deals, seed);
  console.log(`    ${label.padEnd(30)} ${formatPaired(result)}`);
  return result;
}

describe('does more search buy strength', () => {
  it('doubles the world count, twice', () => {
    // The app ships 300 worlds because that fits comfortably inside a turn, not
    // because 300 was measured against 150. If the curve is still climbing, the
    // budget is the cheapest strength available; if it has flattened, the worker
    // can spend its time on something else.
    console.log(`\n  World count, ${WORLDS_DEALS} paired deals each:`);
    compare(
      `${BASE_WORLDS * 2} vs ${BASE_WORLDS} worlds`,
      () => shipped(BASE_WORLDS * 2),
      () => shipped(BASE_WORLDS),
      WORLDS_DEALS,
      SEED,
    );
    compare(
      `${BASE_WORLDS * 4} vs ${BASE_WORLDS * 2} worlds`,
      () => shipped(BASE_WORLDS * 4),
      () => shipped(BASE_WORLDS * 2),
      Math.round(WORLDS_DEALS / 2),
      SEED + 1,
    );
  });
});

describe('likelihood weighting parameters', () => {
  it('sweeps how sharply the play is read', () => {
    // POLICY_BETA is how closely a simulated opponent is assumed to follow the
    // heuristic. §4 found sharp weighting locates hidden stones better and plays
    // worse; this asks where between mild and sharp the turn actually is.
    console.log(`\n  POLICY_BETA (shipped: ${POLICY_BETA}), ${LIKELIHOOD_DEALS} deals each:`);
    for (const beta of [0.02, 0.15, 0.4]) {
      compare(
        `beta ${beta} vs ${POLICY_BETA}`,
        () => configuredPimcAgent({ worlds: BASE_WORLDS, likelihood: { ...SHIPPED_LIKELIHOOD, beta } }),
        () => shipped(),
        LIKELIHOOD_DEALS,
        SEED + 2,
      );
    }
  });

  it('sweeps tempering and oversampling', () => {
    // TEMPER flattens the weights before resampling; oversample decides how big
    // a pool is drawn before it is resampled down to the playout budget. §4's
    // whole swing from −3.6 to +6.2 lived in these two.
    console.log(`\n  TEMPER (shipped: ${TEMPER}), ${LIKELIHOOD_DEALS} deals each:`);
    for (const temper of [0.25, 0.75, 1]) {
      compare(
        `temper ${temper} vs ${TEMPER}`,
        () =>
          configuredPimcAgent({
            worlds: BASE_WORLDS,
            likelihood: { ...SHIPPED_LIKELIHOOD, temper },
          }),
        () => shipped(),
        LIKELIHOOD_DEALS,
        SEED + 3,
      );
    }

    console.log(
      `\n  oversample (shipped: ${DEFAULT_OVERSAMPLE}), ${LIKELIHOOD_DEALS} deals each:`,
    );
    for (const oversample of [1, 2, 8]) {
      compare(
        `oversample ${oversample} vs ${DEFAULT_OVERSAMPLE}`,
        () =>
          configuredPimcAgent({ worlds: BASE_WORLDS, likelihood: SHIPPED_LIKELIHOOD, oversample }),
        () => shipped(),
        LIKELIHOOD_DEALS,
        SEED + 4,
      );
    }
  });
});
