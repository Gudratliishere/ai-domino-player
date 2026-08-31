import { useState } from 'react';
import { StonePicker } from './StonePicker';
import type { Stone } from '../types/domino';
import type { PlayerNames } from '../types/game';
import { displayName } from '../types/game';
import { useMessages } from '../i18n';
import './RevealHandsScreen.css';

export interface RevealedHands {
  B: Stone[];
  C: Stone[];
  D: Stone[];
}

interface RevealHandsScreenProps {
  unseenStones: Stone[];
  names: PlayerNames;
  countB: number;
  countC: number;
  countD: number;
  /**
   * Stone ids each player could still be holding, from the certainty engine.
   * Null when the log is inconsistent and no deduction can be trusted.
   */
  possibleFor?: Record<'B' | 'C' | 'D', Set<string>> | null;
  /** Why the game ended — the score is worked out the same way either way. */
  reason?: 'blocked' | 'went-out';
  onComplete: (assignments: RevealedHands) => void;
}

export function RevealHandsScreen({
  unseenStones,
  names,
  countB,
  countC,
  countD,
  possibleFor,
  reason = 'blocked',
  onComplete,
}: RevealHandsScreenProps) {
  const [step, setStep] = useState<'B' | 'C'>('B');
  const [assignedB, setAssignedB] = useState<Stone[]>([]);
  const [assignedC, setAssignedC] = useState<Stone[]>([]);
  const t = useMessages();
  const [showAll, setShowAll] = useState(false);
  const nameB = displayName(names, 'B');
  const nameC = displayName(names, 'C');
  const nameD = displayName(names, 'D');

  function toggle(list: Stone[], setList: (s: Stone[]) => void, max: number) {
    return (stone: Stone) => {
      const exists = list.some((s) => s.id === stone.id);
      if (exists) {
        setList(list.filter((s) => s.id !== stone.id));
      } else if (list.length < max) {
        setList([...list, stone]);
      }
    };
  }

  // Only offer stones the log has not already ruled out for that player — the
  // deduction is certain *given a correct log*, which is the catch: a mis-logged
  // move that never produced a contradiction could hide a stone the user really
  // is holding, so the filter is always escapable.
  const poolFor = (player: 'B' | 'C' | 'D', from: Stone[]) => {
    const allowed = possibleFor?.[player];
    return allowed && !showAll ? from.filter((s) => allowed.has(s.id)) : from;
  };

  const heading = reason === 'blocked' ? t.reveal.headingBlocked : t.reveal.headingWentOut;

  const hiddenNotice = (shown: number, total: number) =>
    shown < total ? (
      <p className="hint">
        {t.reveal.hiddenNotice(total - shown)}{' '}
        <button type="button" className="link-btn" onClick={() => setShowAll(true)}>
          {t.common.showAllAnyway}
        </button>
      </p>
    ) : null;

  if (step === 'B') {
    const poolB = poolFor('B', unseenStones);
    return (
      <div className="reveal-hands">
        <h3>{heading}</h3>
        <p className="hint">{t.reveal.selectFor(nameB, assignedB.length, countB)}</p>
        {hiddenNotice(poolB.length, unseenStones.length)}
        <StonePicker
          pool={poolB}
          selected={assignedB}
          max={countB}
          onToggle={toggle(assignedB, setAssignedB, countB)}
        />
        <div className="actions">
          <button
            type="button"
            className="primary-btn"
            disabled={assignedB.length !== countB}
            onClick={() => setStep('C')}
          >
            {t.reveal.nextFor(nameC)}
          </button>
        </div>
      </div>
    );
  }

  const poolC = poolFor(
    'C',
    unseenStones.filter((s) => !assignedB.some((b) => b.id === s.id)),
  );
  const assignedD = unseenStones.filter(
    (s) => !assignedB.some((b) => b.id === s.id) && !assignedC.some((c) => c.id === s.id),
  );

  return (
    <div className="reveal-hands">
      <h3>{heading}</h3>
      <p className="hint">{t.reveal.selectFor(nameC, assignedC.length, countC)}</p>
      {hiddenNotice(
        poolC.length,
        unseenStones.filter((s) => !assignedB.some((b) => b.id === s.id)).length,
      )}
      <StonePicker
        pool={poolC}
        selected={assignedC}
        max={countC}
        onToggle={toggle(assignedC, setAssignedC, countC)}
      />
      <p className="hint">{t.reveal.leftoverFor(nameD, assignedD.length, countD)}</p>
      <div className="actions">
        <button type="button" className="secondary-btn" onClick={() => setStep('B')}>
          {t.common.back}
        </button>
        <button
          type="button"
          className="primary-btn"
          disabled={assignedC.length !== countC}
          onClick={() => onComplete({ B: assignedB, C: assignedC, D: assignedD })}
        >
          {t.reveal.finish}
        </button>
      </div>
    </div>
  );
}
