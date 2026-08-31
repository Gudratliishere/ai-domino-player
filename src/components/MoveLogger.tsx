import { useState } from 'react';
import { StoneGrid } from './StoneGrid';
import { canPlay } from '../lib/gameLogic';
import { generateFullSet } from '../lib/dominoSet';
import { useMessages } from '../i18n';
import type { Stone } from '../types/domino';
import type { ChainEnds, PlayerId, PlayerNames } from '../types/game';
import { displayName } from '../types/game';
import './MoveLogger.css';

const ALL_STONES = generateFullSet();

interface MoveLoggerProps {
  currentPlayer: PlayerId;
  myPlayerId: PlayerId;
  names: PlayerNames;
  ends: ChainEnds;
  usedStoneIds: Set<string>;
  pendingStone: Stone | null;
  /** Set when the opening stone is forced by the rules (game 1's 1-1). */
  restrictToStoneId?: string | null;
  /**
   * Stones this player could still be holding, from the certainty engine — pass
   * bans, the 4-per-value cap, the four-doubles cap and everything they imply.
   * Null when the log is inconsistent and no deduction can be trusted.
   */
  possibleIds?: Set<string> | null;
  onSelectStone: (stone: Stone) => void;
  onPass: () => void;
}

export function MoveLogger({
  currentPlayer,
  myPlayerId,
  names,
  ends,
  usedStoneIds,
  pendingStone,
  restrictToStoneId,
  possibleIds,
  onSelectStone,
  onPass,
}: MoveLoggerProps) {
  const t = useMessages();
  const [showAll, setShowAll] = useState(false);
  const isMe = currentPlayer === myPlayerId;
  const who = displayName(names, currentPlayer);
  const boardEmpty = ends.left === null;

  // Everything unplayed that fits the open ends.
  const playable = ALL_STONES.filter((stone) => {
    if (usedStoneIds.has(stone.id)) return false;
    if (restrictToStoneId && stone.id !== restrictToStoneId) return false;
    return canPlay(stone, ends);
  });

  // Narrowed to what this player can actually be holding. If D has already
  // played four sixes they cannot produce a fifth, so there is no reason to
  // offer it — and offering it invites a mis-log.
  const shown =
    possibleIds && !showAll ? playable.filter((s) => possibleIds.has(s.id)) : playable;
  const hidden = playable.length - shown.length;

  return (
    <div className="move-logger">
      {isMe ? (
        <p className="hint">
          {restrictToStoneId ? t.logger.myForcedHint(restrictToStoneId) : t.logger.myHint}
        </p>
      ) : (
        <>
          <h3>{t.logger.turnHeading(who)}</h3>
          {shown.length > 0 ? (
            <>
              <p className="hint">
                {restrictToStoneId
                  ? t.logger.forcedOpen(who, restrictToStoneId)
                  : t.logger.selectPlayed(who)}
              </p>
              {hidden > 0 && (
                <p className="hint">
                  {t.logger.hiddenNotice(hidden, who)}{' '}
                  <button type="button" className="link-btn" onClick={() => setShowAll(true)}>
                    {t.common.showAllAnyway}
                  </button>
                </p>
              )}
              <StoneGrid
                stones={shown}
                selectedIds={pendingStone ? new Set([pendingStone.id]) : new Set()}
                onToggle={onSelectStone}
              />
            </>
          ) : (
            <p className="hint">
              {playable.length > 0 ? (
                <>
                  {t.logger.allRuledOut(who)}{' '}
                  <button type="button" className="link-btn" onClick={() => setShowAll(true)}>
                    {t.common.showAllAnyway}
                  </button>
                </>
              ) : (
                <>{t.logger.noneMatch(who)}</>
              )}
            </p>
          )}
        </>
      )}

      {!boardEmpty && (
        <div className="actions">
          <button type="button" className="secondary-btn" onClick={onPass}>
            {t.logger.passButton(who)}
          </button>
        </div>
      )}
    </div>
  );
}
