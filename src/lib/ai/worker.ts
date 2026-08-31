import type { Stone } from '../../types/domino';
import type { LoggedMove, PlayerId, PlayerNames } from '../../types/game';
import { replay } from '../replay';
import type { Standing } from '../scoring';
import { type PimcMove, recommend } from './pimc';
import type { Lang } from '../../i18n/types';
import { CATALOGS } from '../../i18n/catalogs';

export interface RecommendRequest {
  id: number;
  opener: PlayerId;
  moves: LoggedMove[];
  /** The hand as dealt; anything already played is filtered out on arrival. */
  hand: Stone[];
  me: PlayerId;
  worlds?: number;
  /**
   * The stone the rules obliged the opener to play, when they did. Without it
   * the likelihood model reads a forced opening as a tell (see §2.7).
   */
  forcedOpeningStoneId?: string | null;
  /** Where the match stands, so the search can see the target and the 13 threshold. */
  standing?: Standing;
  /** Display names, so the rationale a move carries reads in the players' names. */
  names?: PlayerNames;
  /** The language the rationale is written in. A tag, not the catalog: this is postMessage. */
  lang?: Lang;
}

export interface RecommendResponse {
  id: number;
  moves: PimcMove[];
  sampled: number;
  ms: number;
  error?: string;
}

/**
 * The search runs off the main thread so a few hundred milliseconds of playouts
 * never shows up as a dropped frame.
 *
 * The request carries the move log rather than a game state: the log is plain
 * data, and rebuilding the state here keeps the two sides from disagreeing about
 * what a position means.
 */
self.onmessage = (event: MessageEvent<RecommendRequest>) => {
  const { id, opener, moves, hand, me, worlds, forcedOpeningStoneId, standing, names, lang } =
    event.data;
  try {
    const state = replay(opener, moves);
    // The log drives Phase 4's likelihood weighting; the endgame solver switches
    // itself on when the position is small enough.
    const result = recommend(state, hand, me, {
      worlds,
      log: { opener, moves },
      likelihood: { forcedOpeningStoneId },
      standing,
      names,
      messages: lang ? CATALOGS[lang] : undefined,
    });
    const response: RecommendResponse = {
      id,
      moves: result.moves,
      sampled: result.sampled,
      ms: result.ms,
    };
    self.postMessage(response);
  } catch (error) {
    const response: RecommendResponse = {
      id,
      moves: [],
      sampled: 0,
      ms: 0,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
