import type { Agent } from './harness';
import { playGame } from './harness';
import { dealHands } from './deal';
import { makeRandom } from './rng';

/**
 * Paired, mirrored self-play: the measurement tool the tuning work needed.
 *
 * `runLadder` compares two aggregates from two different sets of deals, so its
 * standard error is dominated by which hands each side happened to be dealt.
 * That is why §5's tuning runs needed ~12,000 games to resolve ±0.9%.
 *
 * Here every deal is played **twice** — once with A on the A+C seats, once with
 * the seats swapped — and the two plays share a random stream. The per-deal
 * statistic is A's net points averaged over the two seatings, which cancels both
 * the deal and the seat: identical agents score exactly zero on every deal
 * rather than merely averaging to zero, and the noise that remains is the part
 * that is actually about the difference between the agents.
 */
export interface PairedResult {
  /** Deals played; each was played twice, so twice this many games. */
  deals: number;
  /**
   * Mean net points per game for A, mirrored. **The metric that matters** — the
   * match is a race to 101 points, not to a number of games won.
   */
  netPoints: number;
  /** Standard error of `netPoints`, over the per-deal paired differences. */
  standardError: number;
  /** `netPoints / standardError`. Past about 2 the difference is real. */
  z: number;
  /** A's share of decisive games, over both seatings. Reported, not optimised. */
  winRate: number;
  blockedShare: number;
  avgPlies: number;
}

export type AgentSource = Agent | (() => Agent);

function instantiate(source: AgentSource): Agent {
  // A PIMC agent carries a seed counter, so a fresh one per ladder keeps the two
  // seatings from inheriting each other's state.
  return source.length === 0 ? (source as () => Agent)() : (source as Agent);
}

export function pairedLadder(
  a: AgentSource,
  b: AgentSource,
  deals: number,
  seed = 1,
): PairedResult {
  const dealStream = makeRandom(seed);
  const differences: number[] = [];
  let wins = 0;
  let losses = 0;
  let blocked = 0;
  let plies = 0;

  for (let i = 0; i < deals; i++) {
    const deal = dealHands(dealStream);
    // Common random numbers: both seatings get the same policy coin flips, so a
    // difference in outcome is the agents' doing.
    const playSeed = Math.floor(dealStream() * 0xffffffff);

    const agentA = instantiate(a);
    const agentB = instantiate(b);
    const first = playGame(
      deal,
      { A: agentA, C: agentA, B: agentB, D: agentB },
      makeRandom(playSeed),
    );

    const agentA2 = instantiate(a);
    const agentB2 = instantiate(b);
    const second = playGame(
      deal,
      { A: agentB2, C: agentB2, B: agentA2, D: agentA2 },
      makeRandom(playSeed),
    );

    // Both terms are from A's point of view: A held us in the first game and
    // them in the second.
    const netFirst = first.score.us - first.score.them;
    const netSecond = second.score.them - second.score.us;
    differences.push((netFirst + netSecond) / 2);

    if (first.result === 'us') wins++;
    else if (first.result === 'them') losses++;
    if (second.result === 'them') wins++;
    else if (second.result === 'us') losses++;

    if (first.blocked) blocked++;
    if (second.blocked) blocked++;
    plies += first.plies + second.plies;
  }

  const games = deals * 2;
  const n = differences.length;
  const mean = n > 0 ? differences.reduce((sum, d) => sum + d, 0) / n : 0;
  // Sample variance of the paired differences; the mirror has already removed
  // the deal, so this is the spread of the thing being measured.
  const variance =
    n > 1 ? differences.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (n - 1) : 0;
  const standardError = n > 1 ? Math.sqrt(variance / n) : 0;
  const decisive = wins + losses;

  return {
    deals: n,
    netPoints: mean,
    standardError,
    z: standardError > 0 ? mean / standardError : 0,
    winRate: decisive > 0 ? wins / decisive : 0.5,
    blockedShare: games > 0 ? blocked / games : 0,
    avgPlies: games > 0 ? plies / games : 0,
  };
}

/** `+5.4 ± 0.7 (z=7.7)`, the only summary worth reading out of a ladder. */
export function formatPaired(result: PairedResult): string {
  const sign = result.netPoints >= 0 ? '+' : '';
  return (
    `${sign}${result.netPoints.toFixed(2)} ± ${result.standardError.toFixed(2)} pts/game ` +
    `(z=${result.z.toFixed(1)}, n=${result.deals} deals)`
  );
}

/**
 * A round-robin over named agents, every pair measured once.
 *
 * Reported as points per game rather than win rate, and each cell carries its own
 * standard error — a table of point estimates with no error bars is how §5's
 * first tuning run fooled itself.
 */
export interface RoundRobinEntry {
  a: string;
  b: string;
  result: PairedResult;
}

export interface RoundRobinResult {
  entries: RoundRobinEntry[];
  /** Mean net points per game against the rest of the field, per name. */
  standings: { name: string; netPoints: number; standardError: number }[];
}

export function roundRobin(
  contenders: { name: string; agent: AgentSource }[],
  deals: number,
  seed = 1,
  onPair?: (entry: RoundRobinEntry) => void,
): RoundRobinResult {
  const entries: RoundRobinEntry[] = [];
  const totals = new Map<string, { sum: number; variance: number; count: number }>();
  for (const { name } of contenders) totals.set(name, { sum: 0, variance: 0, count: 0 });

  for (let i = 0; i < contenders.length; i++) {
    for (let j = i + 1; j < contenders.length; j++) {
      // Every pair sees the same deals, so the table is internally comparable.
      const result = pairedLadder(contenders[i].agent, contenders[j].agent, deals, seed);
      const entry = { a: contenders[i].name, b: contenders[j].name, result };
      entries.push(entry);
      onPair?.(entry);

      const forA = totals.get(contenders[i].name)!;
      forA.sum += result.netPoints;
      forA.variance += result.standardError ** 2;
      forA.count++;
      const forB = totals.get(contenders[j].name)!;
      forB.sum -= result.netPoints;
      forB.variance += result.standardError ** 2;
      forB.count++;
    }
  }

  const standings = contenders
    .map(({ name }) => {
      const t = totals.get(name)!;
      return {
        name,
        netPoints: t.count > 0 ? t.sum / t.count : 0,
        standardError: t.count > 0 ? Math.sqrt(t.variance) / t.count : 0,
      };
    })
    .sort((x, y) => y.netPoints - x.netPoints);

  return { entries, standings };
}
