import type { PipValue, Stone } from './domino';

export type PlayerId = 'A' | 'B' | 'C' | 'D';

/**
 * Turn order, clockwise around the table as it is drawn: A is seated at the
 * bottom, D on the left, C at the top, B on the right. Play runs A -> D -> C -> B.
 * Partners still sit opposite each other and the two teams still alternate.
 */
export const PLAYER_ORDER: PlayerId[] = ['A', 'D', 'C', 'B'];

/** Alphabetical, for stable UI listings that should not follow the turn order. */
export const ALL_PLAYERS: PlayerId[] = ['A', 'B', 'C', 'D'];

export const TEAMMATE: Record<PlayerId, PlayerId> = {
  A: 'C',
  C: 'A',
  B: 'D',
  D: 'B',
};

/** Teams are fixed: A+C ("us", the seat we advise) vs B+D ("them"). */
export type TeamId = 'us' | 'them';

export function teamOf(playerId: PlayerId): TeamId {
  return playerId === 'A' || playerId === 'C' ? 'us' : 'them';
}

export function playersOfTeam(team: TeamId): PlayerId[] {
  return team === 'us' ? ['A', 'C'] : ['B', 'D'];
}

export function nextPlayer(playerId: PlayerId): PlayerId {
  return PLAYER_ORDER[(PLAYER_ORDER.indexOf(playerId) + 1) % PLAYER_ORDER.length];
}

export type Side = 'left' | 'right';

export interface PlacedStone {
  stone: Stone;
  playerId: PlayerId;
  displayA: PipValue;
  displayB: PipValue;
  /**
   * The value(s) this placement left showing on the table.
   *
   * The half a stone *answers* is forced — you play a 1 because a 1 was open.
   * The half it *exposes* is the choice, and so the only half that says anything
   * about what somebody is long in. The opening stone exposes both.
   */
  exposed: PipValue[];
}

export interface LoggedMove {
  playerId: PlayerId;
  type: 'play' | 'pass';
  stone?: Stone;
  side?: Side;
  /**
   * The open ends immediately before this move. Derivable by replay, but stored
   * so the log is self-describing: a pass only carries information when you know
   * which two values were refused, and the engine reads that on every ply.
   */
  endsBefore: ChainEnds;
}

export interface ChainEnds {
  left: PipValue | null;
  right: PipValue | null;
}

/** A game ends with one team winning, or level on pips after a block. */
export type GameResult = TeamId | 'draw';

export interface MatchState {
  /** 1 means the "holder of 1-1 opens with 1-1" rule applies. */
  gameNumber: number;
  /** Match score in **points**, not games won. */
  seriesScore: Record<TeamId, number>;
  /** Winner of the previous game — they open this one. Null on game 1 or after a seka. */
  previousWinner: TeamId | null;
  /** Points needed to take the match. */
  target: number;
  /**
   * Pips potted by a tied block and not yet collected. The next game's winner
   * takes this on top of their own score.
   */
  pot: number;
  /**
   * Points won but not written down, because the game that won them was worth
   * less than 13. They bank on a later 13+ win and are wiped by the opponent's.
   */
  air: Record<TeamId, number>;
}

/** The team that has already reached the target, if any. */
export function matchWinner(match: MatchState): TeamId | null {
  if (match.seriesScore.us >= match.target) return 'us';
  if (match.seriesScore.them >= match.target) return 'them';
  return null;
}

export const INITIAL_MATCH: MatchState = {
  gameNumber: 1,
  seriesScore: { us: 0, them: 0 },
  previousWinner: null,
  target: 101,
  pot: 0,
  air: { us: 0, them: 0 },
};

/**
 * What each seat is called on screen. Seats stay A–D everywhere in the engine
 * and the move log — a name is a label, never an identity, so renaming a player
 * mid-match cannot invalidate a log or a saved position.
 */
export type PlayerNames = Record<PlayerId, string>;

/** The seat letters double as the default names, so an unnamed table reads as it always did. */
export const DEFAULT_PLAYER_NAMES: PlayerNames = { A: 'A', B: 'B', C: 'C', D: 'D' };

export const NAME_MAX_LENGTH = 16;

/** The name to show for a seat, falling back to the seat letter when it is blank. */
export function displayName(names: PlayerNames | undefined, playerId: PlayerId): string {
  const name = names?.[playerId]?.trim();
  return name ? name : playerId;
}

/** A tight form for the marker on a played stone, where there is room for ~3 characters. */
export function shortName(names: PlayerNames | undefined, playerId: PlayerId): string {
  return displayName(names, playerId).slice(0, 3);
}

/** "Ali & Nino" — the two players of a team, named. */
export function teamLabel(names: PlayerNames | undefined, team: TeamId): string {
  return playersOfTeam(team)
    .map((p) => displayName(names, p))
    .join(' & ');
}

export type SeatRole = 'you' | 'partner' | 'opponent';

/** What a seat is to me — the key of a label, which the language supplies. */
export function roleOf(playerId: PlayerId, me: PlayerId): SeatRole {
  if (playerId === me) return 'you';
  if (playerId === TEAMMATE[me]) return 'partner';
  return 'opponent';
}

/**
 * Seats sharing a name, case-insensitively. Two players called "Ali" make the
 * move log ambiguous to read, so the editor warns rather than forbidding it.
 */
export function duplicateNames(names: PlayerNames): string[] {
  const seen = new Map<string, number>();
  for (const p of ALL_PLAYERS) {
    const key = displayName(names, p).toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key);
}
