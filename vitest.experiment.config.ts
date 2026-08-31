import { defineConfig } from 'vitest/config';

/**
 * Experiments, not tests. They take minutes and print tables; `npm test` must
 * stay fast and silent, so they live behind their own config and their own
 * `.experiment.ts` suffix (which the default include pattern never matches).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.experiment.ts'],
    // A round-robin over seven styles is a long single test by design.
    testTimeout: 3_600_000,
    hookTimeout: 60_000,
    // One process: the measurements are CPU-bound and comparable only if they
    // are not fighting each other for cores.
    pool: 'threads',
    maxWorkers: 1,
    minWorkers: 1,
    // The tables are the output — they go straight to the terminal rather than
    // being buffered and attributed to a test.
    disableConsoleIntercept: true,
  },
});
