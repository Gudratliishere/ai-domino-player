import { useState } from 'react';
import { useMessages } from '../i18n';
import type { PlayerId, PlayerNames } from '../types/game';
import {
  DEFAULT_PLAYER_NAMES,
  NAME_MAX_LENGTH,
  PLAYER_ORDER,
  displayName,
  duplicateNames,
  roleOf,
} from '../types/game';
import './PlayerNamesEditor.css';

interface PlayerNamesEditorProps {
  names: PlayerNames;
  /** The seat the app advises — labelled "You". */
  me: PlayerId;
  /** Collapsed to a one-line summary until opened. */
  startOpen?: boolean;
  onChange: (names: PlayerNames) => void;
}

export function PlayerNamesEditor({
  names,
  me,
  startOpen = false,
  onChange,
}: PlayerNamesEditorProps) {
  const t = useMessages();
  const [open, setOpen] = useState(startOpen);
  const duplicates = duplicateNames(names);
  const summary = PLAYER_ORDER.map((p) => displayName(names, p)).join(' → ');

  if (!open) {
    return (
      <p className="hint player-names-summary">
        {t.names.summary(summary)}{' '}
        <button type="button" className="link-btn" onClick={() => setOpen(true)}>
          {t.names.edit}
        </button>
      </p>
    );
  }

  return (
    <div className="player-names">
      <h3>{t.names.heading}</h3>
      <p className="hint">{t.names.hint}</p>
      <div className="player-name-rows">
        {PLAYER_ORDER.map((playerId) => (
          <label key={playerId} className="player-name-row">
            <span className="player-seat">{playerId}</span>
            <input
              type="text"
              className="player-name-input"
              value={names[playerId]}
              placeholder={playerId}
              maxLength={NAME_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onChange({ ...names, [playerId]: event.target.value })}
            />
            <span className={`player-role role-${roleOf(playerId, me)}`}>
              {t.role[roleOf(playerId, me)]}
            </span>
          </label>
        ))}
      </div>
      {duplicates.length > 0 && (
        <p className="hint player-names-warning">
          {t.names.duplicateWarning(duplicates.map((d) => `"${d}"`).join(', '))}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className="secondary-btn"
          onClick={() => onChange(DEFAULT_PLAYER_NAMES)}
        >
          {t.names.reset}
        </button>
        <button type="button" className="primary-btn" onClick={() => setOpen(false)}>
          {t.common.done}
        </button>
      </div>
    </div>
  );
}
