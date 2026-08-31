import { DEFAULT_WEIGHTS, type Weights } from './features';
import { type Agent, heuristicAgent, runLadder } from './harness';
import { type Random, makeRandom } from './rng';

/**
 * Cross-entropy tuning of the heuristic weights.
 *
 * Hand-set numbers were fine for shipping, but "does this weight help?" is an
 * empirical question and the harness can answer it far better than intuition —
 * Phase 1's ablation already showed two of the twelve carrying almost everything.
 *
 * Cross-entropy rather than hill climbing: the evaluation is noisy, and a method
 * that fits a distribution over whole weight vectors copes with that far better
 * than one that trusts a single noisy comparison at each step.
 */

export interface TuningOptions {
  /** Candidate weight vectors per generation. */
  population?: number;
  /** How many of the best to fit the next generation to. */
  elite?: number;
  generations?: number;
  /** Games per candidate evaluation. More games, less noise, more time. */
  games?: number;
  /** The opponent every candidate is scored against. */
  opponent?: () => Agent;
  /** Build an agent from a weight vector. */
  agentFor?: (weights: Weights) => Agent;
  seed?: number;
  onGeneration?: (info: GenerationInfo) => void;
}

export interface GenerationInfo {
  generation: number;
  bestScore: number;
  meanEliteScore: number;
  best: Weights;
}

export const TUNABLE_KEYS: (keyof Weights)[] = [
  'forcedBlockPoints',
  'suitControl',
  'selfBlockNone',
  'selfBlockThin',
  'starveOpponent',
  'feedPartner',
  'partnerAhead',
  'partnerSuit',
  'pipShed',
  'deadDouble',
  'thinDouble',
];

/** Standard deviation to start from, per key, as a fraction of the current value. */
const INITIAL_SPREAD = 0.6;
/** Never let a dimension collapse entirely — noise would freeze it at a bad value. */
const MIN_SPREAD = 0.02;

function sampleNormal(random: Random): number {
  // Box-Muller. Two uniforms in, one standard normal out.
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function tuneWeights(options: TuningOptions = {}): { best: Weights; history: GenerationInfo[] } {
  const population = options.population ?? 16;
  const elite = options.elite ?? 5;
  const generations = options.generations ?? 8;
  const games = options.games ?? 300;
  const random = makeRandom(options.seed ?? 12345);
  const opponent = options.opponent ?? (() => heuristicAgent());
  const agentFor = options.agentFor ?? ((w: Weights) => heuristicAgent(w));

  const mean: Weights = { ...DEFAULT_WEIGHTS };
  const spread = {} as Record<keyof Weights, number>;
  for (const key of TUNABLE_KEYS) {
    spread[key] = Math.max(Math.abs(DEFAULT_WEIGHTS[key]) * INITIAL_SPREAD, MIN_SPREAD);
  }

  const history: GenerationInfo[] = [];

  for (let generation = 0; generation < generations; generation++) {
    const candidates: Weights[] = [];
    // The current mean is always in the running, so a generation can never make
    // things worse than where it started.
    candidates.push({ ...mean });
    while (candidates.length < population) {
      const candidate: Weights = { ...mean };
      for (const key of TUNABLE_KEYS) {
        candidate[key] = mean[key] + spread[key] * sampleNormal(random);
      }
      candidates.push(candidate);
    }

    // Every candidate faces the same deals, so differences are about the weights.
    const evalSeed = Math.floor(random() * 0xffffff);
    const scored = candidates.map((weights) => {
      const a = runLadder(agentFor(weights), opponent(), games, evalSeed);
      const b = runLadder(opponent(), agentFor(weights), games, evalSeed);
      // Scored on net points, not win rate: the match is decided on points, and
      // an agent that wins fewer games by wider margins is the better one.
      const netPoints = a.pointsPerGame - b.pointsPerGame;
      return { weights, score: netPoints / 2 };
    });

    scored.sort((x, y) => y.score - x.score);
    const top = scored.slice(0, elite);

    for (const key of TUNABLE_KEYS) {
      const values = top.map((t) => t.weights[key]);
      const m = values.reduce((sum, v) => sum + v, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + (v - m) * (v - m), 0) / values.length;
      mean[key] = m;
      spread[key] = Math.max(Math.sqrt(variance), MIN_SPREAD);
    }

    const info: GenerationInfo = {
      generation,
      bestScore: top[0].score,
      meanEliteScore: top.reduce((sum, t) => sum + t.score, 0) / top.length,
      best: { ...top[0].weights },
    };
    history.push(info);
    options.onGeneration?.(info);
  }

  return { best: { ...mean }, history };
}

export function formatWeights(weights: Weights): string {
  const round = (n: number) => (Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 100) / 100);
  return Object.entries(weights)
    .map(([key, value]) => `  ${key}: ${round(value as number)},`)
    .join('\n');
}
