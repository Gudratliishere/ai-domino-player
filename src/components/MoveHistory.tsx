import type { ChainEnds, LoggedMove, PlayerNames } from '../types/game';
import { displayName } from '../types/game';
import { useMessages } from '../i18n';
import type { Messages } from '../i18n';
import './MoveHistory.css';

interface MoveHistoryProps {
  moves: LoggedMove[];
  names: PlayerNames;
}

function endsLabel(ends: ChainEnds, t: Messages): string {
  if (ends.left === null || ends.right === null) return t.history.emptyTable;
  return `${ends.left} | ${ends.right}`;
}

export function MoveHistory({ moves, names }: MoveHistoryProps) {
  const t = useMessages();
  if (moves.length === 0) return null;

  return (
    <div className="move-history">
      <h3>{t.history.heading}</h3>
      <ol>
        {moves.map((move, i) => (
          <li key={i}>
            <span className="move-player">{displayName(names, move.playerId)}</span>{' '}
            {move.type === 'pass'
              ? t.history.passed
              : t.history.played(
                  `${move.stone!.a}-${move.stone!.b}`,
                  move.side ? t.side[move.side] : undefined,
                )}{' '}
            <span className="move-ends">{t.history.onEnds(endsLabel(move.endsBefore, t))}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
