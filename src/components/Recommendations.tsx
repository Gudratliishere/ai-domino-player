import { DominoTile } from './DominoTile';
import type { PimcMove } from '../lib/ai/pimc';
import type { Stone } from '../types/domino';
import { useMessages } from '../i18n';
import type { Messages } from '../i18n';
import './Recommendations.css';

interface RecommendationsProps {
  moves: PimcMove[];
  pendingStone: Stone | null;
  thinking: boolean;
  sampled: number;
  onSelect: (move: PimcMove) => void;
}

function placement(move: PimcMove, t: Messages): string {
  const { stone, side, resultEnds } = move.candidate;
  const label = `${stone.a}-${stone.b}`;
  return side === undefined
    ? t.recommendations.placementOpening(label, resultEnds.left, resultEnds.right)
    : t.recommendations.placementOnSide(
        label,
        t.side[side],
        resultEnds.left,
        resultEnds.right,
      );
}

export function Recommendations({
  moves,
  pendingStone,
  thinking,
  sampled,
  onSelect,
}: RecommendationsProps) {
  const t = useMessages();
  if (moves.length === 0) {
    return thinking ? (
      <div className="recommendations">
        <h3>{t.recommendations.heading}</h3>
        <p className="hint">{t.recommendations.searching}</p>
      </div>
    ) : null;
  }
  const top = moves.slice(0, 3);

  return (
    <div className={`recommendations ${thinking ? 'stale' : ''}`}>
      <h3>
        {t.recommendations.heading}
        {sampled > 0 && (
          <span className="rec-basis">
            {thinking ? t.recommendations.searchingShort : t.recommendations.basis(sampled)}
          </span>
        )}
      </h3>
      <ol className="recommendation-list">
        {top.map((move, i) => (
          <li key={move.candidate.key}>
            <button
              type="button"
              // While a new search is running these are last position's answers,
              // kept on screen for continuity but not safe to act on — clicking
              // one would select a stone that may already have been played.
              disabled={thinking}
              className={`recommendation ${i === 0 ? 'best' : ''} ${
                pendingStone?.id === move.candidate.stone.id ? 'selected' : ''
              }`}
              onClick={() => onSelect(move)}
            >
              <span className="rec-head">
                <span className="rec-rank">{t.recommendations.rank(i)}</span>
                <DominoTile stone={move.candidate.stone} orientation="vertical" size="small" />
                <span className="rec-placement">
                  {placement(move, t)}
                  {move.proven.length > 0 && (
                    <span className="rec-proven">{t.recommendations.proven}</span>
                  )}
                  {move.worlds > 0 && move.exactWorlds === move.worlds && (
                    <span className="rec-solved">{t.recommendations.solved}</span>
                  )}
                </span>
                <span className="rec-score">
                  {move.worlds > 0 ? (
                    <>
                      {/* Points, not win rate: the game is scored in the pips the
                          losers are caught holding, so a big win really is worth
                          more than a narrow one. */}
                      <span className={`rec-points ${move.points < 0 ? 'negative' : ''}`}>
                        {move.points >= 0 ? '+' : ''}
                        {t.decimal(move.points, 1)}
                      </span>
                      <span className="rec-win-label">{t.recommendations.expectedPoints}</span>
                      <span className="rec-winrate">
                        {t.recommendations.winRate(Math.round(move.winRate * 100))}
                      </span>
                    </>
                  ) : (
                    Math.round(move.score)
                  )}
                </span>
              </span>
              {/* Spans, not a list: a button may only contain phrasing content. */}
              <span className="rec-reasons">
                {move.reasons.map((reason) => (
                  <span
                    key={reason}
                    className={`rec-reason ${move.proven.includes(reason) ? 'proven' : ''}`}
                  >
                    {reason}
                  </span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {moves.length > top.length && (
        <p className="hint">{t.recommendations.weakerHidden(moves.length - top.length)}</p>
      )}
    </div>
  );
}
