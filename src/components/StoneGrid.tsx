import { generateFullSet } from '../lib/dominoSet';
import type { Stone } from '../types/domino';
import { DominoTile } from './DominoTile';
import './StoneGrid.css';

const ALL_STONES = generateFullSet();

interface StoneGridProps {
  stones?: Stone[];
  selectedIds: Set<string>;
  disabledIds?: Set<string>;
  onToggle: (stone: Stone) => void;
}

export function StoneGrid({ stones = ALL_STONES, selectedIds, disabledIds, onToggle }: StoneGridProps) {
  return (
    <div className="stone-grid">
      {stones.map((stone) => (
        <DominoTile
          key={stone.id}
          stone={stone}
          orientation="vertical"
          size="medium"
          selected={selectedIds.has(stone.id)}
          disabled={disabledIds?.has(stone.id) ?? false}
          onClick={() => onToggle(stone)}
        />
      ))}
    </div>
  );
}
