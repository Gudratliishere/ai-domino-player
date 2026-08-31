import { generateFullSet } from '../lib/dominoSet';
import { wouldExceedHandLimit } from '../lib/handRules';
import type { Stone } from '../types/domino';
import { StoneGrid } from './StoneGrid';

const ALL_STONES = generateFullSet();

interface StonePickerProps {
  pool?: Stone[];
  selected: Stone[];
  max: number;
  onToggle: (stone: Stone) => void;
}

export function StonePicker({ pool = ALL_STONES, selected, max, onToggle }: StonePickerProps) {
  const selectedIds = new Set(selected.map((s) => s.id));
  const atLimit = selected.length >= max;
  const disabledIds = new Set(
    pool.filter((s) => {
      if (selectedIds.has(s.id)) return false;
      if (atLimit) return true;
      return wouldExceedHandLimit(selected, s);
    }).map((s) => s.id),
  );

  return <StoneGrid stones={pool} selectedIds={selectedIds} disabledIds={disabledIds} onToggle={onToggle} />;
}
