import { useEffect, useRef, useState } from 'react';
import { DominoTile } from './DominoTile';
import { playableSides } from '../lib/gameLogic';
import { computeSnakePosition } from '../lib/snakeLayout';
import { useMessages } from '../i18n';
import type { Stone } from '../types/domino';
import type { ChainEnds, PlacedStone, PlayerId, PlayerNames, Side } from '../types/game';
import { displayName, roleOf, shortName } from '../types/game';
import './GameTable.css';

interface GameTableProps {
  chain: PlacedStone[];
  ends: ChainEnds;
  currentPlayer: PlayerId;
  myPlayerId: PlayerId;
  names: PlayerNames;
  counts: Record<PlayerId, number>;
  hand: Stone[];
  pendingStone: Stone | null;
  /** Set when the rules force the opening stone (game 1's 1-1). */
  mustOpenWithId?: string | null;
  onPlace: (side?: Side) => void;
  onSelectHandStone: (stone: Stone) => void;
}

type SeatPosition = 'top' | 'right' | 'bottom' | 'left';

const SEAT_POSITIONS: Record<SeatPosition, PlayerId> = {
  top: 'C',
  right: 'B',
  bottom: 'A',
  left: 'D',
};

const TILE_COL_WIDTH = 60;
const SURFACE_PADDING = 32;
const MIN_ROW_LEN = 3;

export function GameTable({
  chain,
  ends,
  currentPlayer,
  myPlayerId,
  names,
  counts,
  hand,
  pendingStone,
  mustOpenWithId,
  onPlace,
  onSelectHandStone,
}: GameTableProps) {
  const t = useMessages();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [rowLen, setRowLen] = useState(MIN_ROW_LEN);

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth;
      const usable = width - SURFACE_PADDING;
      const computed = Math.floor(usable / TILE_COL_WIDTH) - 1;
      setRowLen(Math.max(MIN_ROW_LEN, computed));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const boardEmpty = ends.left === null;
  const sides = pendingStone && !boardEmpty ? playableSides(pendingStone, ends) : [];
  const canLeft = !boardEmpty && sides.includes('left');
  const canRight = !boardEmpty && sides.includes('right');
  const canStart = boardEmpty && pendingStone !== null;
  const invalid = pendingStone !== null && !boardEmpty && sides.length === 0;
  const isMyTurn = currentPlayer === myPlayerId;

  function renderSeat(position: SeatPosition) {
    const playerId = SEAT_POSITIONS[position];
    const isActive = playerId === currentPlayer;
    const isMe = playerId === myPlayerId;
    const count = counts[playerId];

    return (
      <div className={`seat seat-${position} ${isActive ? 'active' : ''}`}>
        <div className="seat-name">
          <span className="seat-id" title={displayName(names, playerId)}>
            {displayName(names, playerId)}
          </span>
          <span className="seat-label">{t.role[roleOf(playerId, myPlayerId)]}</span>
          <span className="seat-count">{count}</span>
        </div>
        {!isMe && (
          <div className={`tile-rack rack-${position}`}>
            {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
              <span key={i} className="tile-back" />
            ))}
          </div>
        )}
      </div>
    );
  }

  const nextPos = computeSnakePosition(chain.length, rowLen);

  return (
    <div className="game-table">
      {renderSeat('top')}
      <div className="table-middle">
        {renderSeat('left')}

        <div className="table-surface" ref={surfaceRef}>
          {boardEmpty ? (
            <button
              type="button"
              className={`drop-zone ${canStart ? 'active' : ''}`}
              disabled={!canStart}
              onClick={() => onPlace(undefined)}
            >
              {pendingStone
                ? t.table.placeHere(`${pendingStone.a}-${pendingStone.b}`)
                : t.table.waitingFirstStone}
            </button>
          ) : (
            <div
              className="chain-grid"
              style={{ gridTemplateColumns: `repeat(${rowLen + 1}, ${TILE_COL_WIDTH}px)` }}
            >
              <button
                type="button"
                className={`end-zone ${canLeft ? 'active' : ''}`}
                disabled={!canLeft}
                onClick={() => onPlace('left')}
                style={{ gridRow: 1, gridColumn: 1 }}
              >
                <span className="end-value">{ends.left}</span>
                {canLeft && <span className="end-hint">{t.table.tap}</span>}
              </button>

              {chain.map((placed, i) => {
                const pos = computeSnakePosition(i, rowLen);
                const isDoubleTile = placed.displayA === placed.displayB;
                const vertical = pos.vertical || isDoubleTile;
                const flip = !pos.vertical && pos.direction === -1;
                const stoneForRender = flip
                  ? { id: placed.stone.id, a: placed.displayB, b: placed.displayA }
                  : { id: placed.stone.id, a: placed.displayA, b: placed.displayB };
                return (
                  <div
                    key={i}
                    className="chain-stone"
                    style={{ gridRow: pos.row + 1, gridColumn: pos.col + 2 }}
                  >
                    <DominoTile
                      stone={stoneForRender}
                      orientation={vertical ? 'vertical' : 'horizontal'}
                      size="small"
                    />
                    {/* Room for about three characters, so the marker is a short
                        form of the name with the full one on hover. */}
                    <span className="played-by" title={displayName(names, placed.playerId)}>
                      {shortName(names, placed.playerId)}
                    </span>
                  </div>
                );
              })}

              <button
                type="button"
                className={`end-zone ${canRight ? 'active' : ''}`}
                disabled={!canRight}
                onClick={() => onPlace('right')}
                style={{ gridRow: nextPos.row + 1, gridColumn: nextPos.col + 2 }}
              >
                <span className="end-value">{ends.right}</span>
                {canRight && <span className="end-hint">{t.table.tap}</span>}
              </button>
            </div>
          )}

          {invalid && (
            <p className="table-warning">
              {t.table.mismatch(`${pendingStone!.a}-${pendingStone!.b}`)}
            </p>
          )}
        </div>

        {renderSeat('right')}
      </div>
      {renderSeat('bottom')}

      <div className={`hand-tray ${isMyTurn ? 'active' : ''}`}>
        {hand.map((stone) => {
          const playable = boardEmpty
            ? !mustOpenWithId || stone.id === mustOpenWithId
            : playableSides(stone, ends).length > 0;
          return (
            <DominoTile
              key={stone.id}
              stone={stone}
              orientation="vertical"
              size="medium"
              selected={pendingStone?.id === stone.id}
              disabled={!isMyTurn || !playable}
              onClick={() => onSelectHandStone(stone)}
            />
          );
        })}
      </div>
    </div>
  );
}
