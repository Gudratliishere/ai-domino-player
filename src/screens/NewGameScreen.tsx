import { useMemo, useState } from 'react';
import { StonePicker } from '../components/StonePicker';
import { openingRule } from '../lib/matchRules';
import { HAND_SIZE } from '../lib/replay';
import type { Stone } from '../types/domino';
import { PlayerNamesEditor } from '../components/PlayerNamesEditor';
import { useMessages } from '../i18n';
import type { MatchState, PlayerId, PlayerNames } from '../types/game';
import { displayName, roleOf } from '../types/game';

const MY_PLAYER_ID: PlayerId = 'A';

interface NewGameScreenProps {
  match: MatchState;
  names: PlayerNames;
  onRename: (names: PlayerNames) => void;
  onStart: (setup: { hand: Stone[]; opener: PlayerId }) => void;
  onCancel: () => void;
}

export function NewGameScreen({ match, names, onRename, onStart, onCancel }: NewGameScreenProps) {
  const t = useMessages();
  const [hand, setHand] = useState<Stone[]>([]);
  const [step, setStep] = useState<'hand' | 'opener'>('hand');
  const [opener, setOpener] = useState<PlayerId | null>(null);

  const rule = useMemo(
    () => openingRule(match, hand, MY_PLAYER_ID, { names, messages: t }),
    [match, hand, names, t],
  );
  const handComplete = hand.length === HAND_SIZE;

  function toggleStone(stone: Stone) {
    setHand((prev) => {
      const exists = prev.some((s) => s.id === stone.id);
      if (exists) return prev.filter((s) => s.id !== stone.id);
      if (prev.length >= HAND_SIZE) return prev;
      return [...prev, stone];
    });
  }

  if (step === 'opener') {
    const only = rule.candidates.length === 1 ? rule.candidates[0] : null;
    const chosen = only ?? opener;

    return (
      <section className="screen new-game-screen">
        <h1>{t.newGame.openerHeading}</h1>
        <p>
          {t.newGame.openerStatus(
            match.gameNumber,
            match.target,
            match.seriesScore.us,
            match.seriesScore.them,
          )}
        </p>
        <p className="hint">{rule.explanation}</p>

        <div className="opener-choices">
          {rule.candidates.map((playerId) => (
            <button
              key={playerId}
              type="button"
              className={`opener-btn ${chosen === playerId ? 'selected' : ''}`}
              onClick={() => setOpener(playerId)}
            >
              <span className="opener-id">{displayName(names, playerId)}</span>
              <span className="opener-label">
                {t.newGame.seatNote(t.role[roleOf(playerId, MY_PLAYER_ID)], playerId)}
              </span>
            </button>
          ))}
        </div>

        {rule.forcedStoneId && (
          <p className="hint">{t.newGame.forcedStone(rule.forcedStoneId)}</p>
        )}

        <div className="actions">
          <button type="button" className="secondary-btn" onClick={() => setStep('hand')}>
            {t.common.back}
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={chosen === null}
            onClick={() => onStart({ hand, opener: chosen! })}
          >
            {t.newGame.start}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="screen new-game-screen">
      <h1>{t.newGame.handHeading}</h1>
      <p>{t.newGame.handCount(hand.length, HAND_SIZE)}</p>
      <p className="hint">{t.newGame.handRuleHint}</p>
      <StonePicker selected={hand} max={HAND_SIZE} onToggle={toggleStone} />
      <PlayerNamesEditor names={names} me={MY_PLAYER_ID} onChange={onRename} />
      <div className="actions">
        <button type="button" className="secondary-btn" onClick={onCancel}>
          {t.common.back}
        </button>
        <button
          type="button"
          className="primary-btn"
          disabled={!handComplete}
          onClick={() => setStep('opener')}
        >
          {t.newGame.next}
        </button>
      </div>
    </section>
  );
}
