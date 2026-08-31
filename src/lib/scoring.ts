import type { Stone } from '../types/domino';
import type { PlayerId, TeamId } from '../types/game';
import { teamOf } from '../types/game';

export function pipSum(stones: Stone[]): number {
  return stones.reduce((sum, s) => sum + s.a + s.b, 0);
}

/** Points needed to take the match. */
export const MATCH_TARGET = 101;

/**
 * The smallest game score that actually goes on the board.
 *
 * Win a game for less than this and nothing is written down: the points hang in
 * the air against your name. Win again for 13 or more and you collect everything
 * you have hanging, all at once. Lose to a 13-or-more game and the lot is wiped.
 *
 * So 13 is not a rounding threshold, it is a cliff — a game worth 12 banks
 * nothing, and a game worth 13 can bank 40. The evaluator has to see that.
 */
export const WRITE_THRESHOLD = 13;

export interface GameScore {
  /** Points scored this game by A+C. */
  us: number;
  /** Points scored this game by B+D. */
  them: number;
  /**
   * Pips carried into the next game because this one was a tied block — a
   * "seka". Nobody scores, the pot waits, and whoever wins next takes it on top
   * of their own score.
   */
  carry: number;
  /** True when this game was a tied block. */
  seka: boolean;
}

export interface GameOutcomeInput {
  /** The player who emptied their hand, or null when the game was blocked. */
  winner: PlayerId | null;
  /** Stones still held at the end, by player. */
  hands: Record<PlayerId, Stone[]>;
  /** Pips already potted by an earlier seka. */
  pot?: number;
}

/**
 * Scores one finished game.
 *
 * The winning team takes the pips left in the **opponents'** hands — their own
 * partner's remaining stones do not count against them. That is what makes this
 * a points game rather than a race: winning by 48 is worth eight times winning
 * by 6, and losing while holding `6-6` is far worse than losing while holding
 * `0-1`. The whole engine's terminal value follows from this function.
 */
export function scoreGame({ winner, hands, pot = 0 }: GameOutcomeInput): GameScore {
  const usPips = pipSum(hands.A) + pipSum(hands.C);
  const themPips = pipSum(hands.B) + pipSum(hands.D);

  if (winner !== null) {
    const won = teamOf(winner);
    const gained = (won === 'us' ? themPips : usPips) + pot;
    return {
      us: won === 'us' ? gained : 0,
      them: won === 'them' ? gained : 0,
      carry: 0,
      seka: false,
    };
  }

  // Blocked: the lighter team wins and still scores the opponents' pips.
  if (usPips < themPips) return { us: themPips + pot, them: 0, carry: 0, seka: false };
  if (themPips < usPips) return { us: 0, them: usPips + pot, carry: 0, seka: false };

  // Level on pips — a seka. Both sides' pips go into the pot and wait.
  return { us: 0, them: 0, carry: usPips + themPips + pot, seka: true };
}

/**
 * Points this game is worth to us, as a single signed number.
 *
 * This is the quantity the search maximises. A seka is zero *for this game* —
 * the pot it creates is worth something, but who eventually collects it is a
 * later game's question.
 */
export function pointsSwing(score: GameScore): number {
  return score.us - score.them;
}

export interface Standing {
  /** Points on the board. */
  written: Record<TeamId, number>;
  /** Points won but not yet written, because no game has reached the threshold. */
  air: Record<TeamId, number>;
  target?: number;
}

/**
 * How air is valued against a written point.
 *
 * Points in the air are not yours yet — they need a later 13+ win to bank, and a
 * 13+ win by the other side erases them. Half a written point is a deliberately
 * rough estimate of that; it is the one number here that is a judgement call
 * rather than a rule.
 */
export const AIR_WEIGHT = 0.5;

/** Applies one game's score to a standing, following the write/air/wipe rule. */
export function applyGameScore(standing: Standing, score: GameScore): Standing {
  const target = standing.target;
  const written = { ...standing.written };
  const air = { ...standing.air };

  for (const team of ['us', 'them'] as TeamId[]) {
    const gained = score[team];
    if (gained <= 0) continue;
    const other: TeamId = team === 'us' ? 'them' : 'us';

    if (gained >= WRITE_THRESHOLD) {
      // Big enough to write: bank it along with everything hanging, and the
      // other side loses whatever they had hanging.
      written[team] += gained + air[team];
      air[team] = 0;
      air[other] = 0;
    } else {
      // Too small to write — it joins whatever is already in the air.
      air[team] += gained;
    }
  }

  return { written, air, target };
}

/**
 * What a game outcome is worth to us, accounting for both the match target and
 * the writing threshold.
 *
 * Two separate non-linearities, and the evaluator needs both:
 *
 * - **The target.** At 95–40, a 30-point game and a 6-point game both end the
 *   match, so there is nothing to gain from the riskier line.
 * - **The threshold.** A 12-point win banks nothing; a 13-point win banks 13
 *   *plus everything in the air* and wipes the opponent's. Sitting on 30 in the
 *   air, the gap between scoring 12 and 13 is worth 43 points.
 */
export function matchValue(score: GameScore, standing: Standing): number {
  const target = standing.target ?? MATCH_TARGET;
  const useful = (points: number, already: number) =>
    Math.min(points, Math.max(target - already, 0));

  const value = (team: TeamId) => {
    const gained = score[team];
    if (gained <= 0) return 0;
    const other: TeamId = team === 'us' ? 'them' : 'us';
    if (gained >= WRITE_THRESHOLD) {
      // Banked, plus the opponent's air destroyed — worth as much as denying it.
      return useful(gained + standing.air[team], standing.written[team]) +
        AIR_WEIGHT * standing.air[other];
    }
    return AIR_WEIGHT * gained;
  };

  return value('us') - value('them');
}
