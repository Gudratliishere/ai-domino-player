import type { PipValue, Stone } from '../types/domino';
import { useMessages } from '../i18n';
import './DominoTile.css';

const PIP_LAYOUTS: Record<PipValue, string[]> = {
  0: [],
  1: ['mc'],
  2: ['tl', 'br'],
  3: ['tl', 'mc', 'br'],
  4: ['tl', 'tr', 'bl', 'br'],
  5: ['tl', 'tr', 'mc', 'bl', 'br'],
  6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
};

function PipFace({ value }: { value: PipValue }) {
  const active = new Set(PIP_LAYOUTS[value]);
  const cells = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
  return (
    <div className="pip-face">
      {cells.map((cell) => (
        <span key={cell} className={active.has(cell) ? 'pip-dot' : ''} />
      ))}
    </div>
  );
}

interface DominoTileProps {
  stone: Stone;
  orientation?: 'horizontal' | 'vertical';
  size?: 'small' | 'medium' | 'large';
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function DominoTile({
  stone,
  orientation = 'horizontal',
  size = 'medium',
  selected = false,
  disabled = false,
  onClick,
}: DominoTileProps) {
  const t = useMessages();
  const label = t.a11y.stone(`${stone.a}-${stone.b}`);
  const classes = [
    'domino-tile',
    orientation,
    size,
    selected ? 'selected' : '',
    disabled ? 'disabled' : '',
    onClick ? 'clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={selected}
      >
        <PipFace value={stone.a} />
        <div className="domino-divider" />
        <PipFace value={stone.b} />
      </button>
    );
  }

  return (
    <div className={classes} aria-label={label}>
      <PipFace value={stone.a} />
      <div className="domino-divider" />
      <PipFace value={stone.b} />
    </div>
  );
}
