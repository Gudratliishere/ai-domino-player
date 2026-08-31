import { stoneId } from '../types/domino';
import type { Stone } from '../types/domino';
import type { MatchState, PlayerId, PlayerNames } from '../types/game';
import { ALL_PLAYERS, displayName, playersOfTeam } from '../types/game';
import type { Messages } from '../i18n/types';
import { en } from '../i18n/en';

/** Game 1 must be opened with this stone, by whoever was dealt it. */
export const FIRST_GAME_OPENING_STONE_ID = stoneId(1, 1);

export interface OpeningRule {
  /** Who is allowed to open this game. */
  candidates: PlayerId[];
  /** Set when the opening stone is forced (game 1 only). */
  forcedStoneId: string | null;
  /** Plain-language explanation, shown in the UI. */
  explanation: string;
}

/**
 * Who opens, and with what.
 *
 * Game 1: the holder of 1-1 opens and must play it. If it is in our hand that
 * settles both questions; otherwise we only need to be told which opponent has it.
 * Later games: either member of the winning team opens, with any stone.
 */
export function openingRule(
  match: MatchState,
  myHand: Stone[],
  me: PlayerId = 'A',
  /**
   * Names and language reach the explanation text only — who may open and with
   * what is decided by the seats and the score, in any language.
   */
  options: { names?: PlayerNames; messages?: Messages } = {},
): OpeningRule {
  const { names, messages: t = en } = options;
  // "The winning team opens" only takes effect once a team has actually written
  // something down. While the board still reads 0-0 every game opens with 1-1,
  // however much either side has hanging in the air — air is not a score.
  const nothingWritten = match.seriesScore.us === 0 && match.seriesScore.them === 0;

  if (nothingWritten) {
    const first = match.gameNumber === 1;
    const iHoldIt = myHand.some((s) => s.id === FIRST_GAME_OPENING_STONE_ID);
    if (iHoldIt) {
      return {
        candidates: [me],
        forcedStoneId: FIRST_GAME_OPENING_STONE_ID,
        explanation: first ? t.opening.iHoldItFirstGame : t.opening.iHoldItAgain,
      };
    }
    return {
      candidates: ALL_PLAYERS.filter((p) => p !== me),
      forcedStoneId: FIRST_GAME_OPENING_STONE_ID,
      explanation: first ? t.opening.whoHoldsItFirstGame : t.opening.whoHoldsItAgain,
    };
  }

  if (match.previousWinner === null) {
    return {
      candidates: [...ALL_PLAYERS],
      forcedStoneId: null,
      explanation: t.opening.afterSeka,
    };
  }

  const winners = playersOfTeam(match.previousWinner);
  const named = winners.map((p) => displayName(names, p)).join(t.opening.orJoin);
  return {
    candidates: winners,
    forcedStoneId: null,
    explanation:
      match.previousWinner === 'us' ? t.opening.weWon(named) : t.opening.theyWon(named),
  };
}
