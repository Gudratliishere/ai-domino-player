import type { PlayerNames } from '../types/game';
import { ALL_PLAYERS, DEFAULT_PLAYER_NAMES, NAME_MAX_LENGTH } from '../types/game';

const STORAGE_KEY = 'ai-domino-player-names';

/**
 * Names outlive a match — the same four people usually sit down again — so they
 * are remembered, while the score is not. Every access is guarded: storage
 * throws outright in a browser set to block site data.
 */
export function loadPlayerNames(): PlayerNames {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PLAYER_NAMES;
    return sanitizeNames(JSON.parse(raw));
  } catch {
    return DEFAULT_PLAYER_NAMES;
  }
}

export function savePlayerNames(names: PlayerNames): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeNames(names)));
  } catch {
    // Names not surviving a reload is a small loss; failing to start a game is not.
  }
}

/** Anything could be in storage, so a stored value is trusted only after this. */
export function sanitizeNames(value: unknown): PlayerNames {
  const source = (value ?? {}) as Record<string, unknown>;
  const names = { ...DEFAULT_PLAYER_NAMES };
  for (const player of ALL_PLAYERS) {
    const stored = source[player];
    if (typeof stored !== 'string') continue;
    const trimmed = stored.trim().slice(0, NAME_MAX_LENGTH);
    if (trimmed) names[player] = trimmed;
  }
  return names;
}
