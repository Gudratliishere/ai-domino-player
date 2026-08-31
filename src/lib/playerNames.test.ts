import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_NAMES,
  NAME_MAX_LENGTH,
  displayName,
  duplicateNames,
  roleOf,
  shortName,
  teamLabel,
} from '../types/game';
import { sanitizeNames } from './playerNames';

describe('display names', () => {
  const names = { A: 'Dunay', B: 'Rəşad', C: 'Aysel', D: 'Kamran' };

  it('falls back to the seat letter when a name is blank', () => {
    expect(displayName({ ...names, B: '   ' }, 'B')).toBe('B');
    expect(displayName(undefined, 'C')).toBe('C');
    expect(displayName(names, 'A')).toBe('Dunay');
  });

  it('names the two teams', () => {
    expect(teamLabel(names, 'us')).toBe('Dunay & Aysel');
    expect(teamLabel(names, 'them')).toBe('Rəşad & Kamran');
  });

  it('shortens a name for the marker on a played stone', () => {
    expect(shortName(names, 'D')).toBe('Kam');
    expect(shortName(DEFAULT_PLAYER_NAMES, 'D')).toBe('D');
  });

  it('reads roles from my seat, not from the names', () => {
    expect(roleOf('A', 'A')).toBe('you');
    expect(roleOf('C', 'A')).toBe('partner');
    expect(roleOf('B', 'A')).toBe('opponent');
    expect(roleOf('D', 'A')).toBe('opponent');
  });

  it('spots two seats sharing a name, ignoring case', () => {
    expect(duplicateNames(names)).toEqual([]);
    expect(duplicateNames({ ...names, D: 'dunay' })).toEqual(['dunay']);
  });
});

describe('sanitizing stored names', () => {
  it('keeps the seat letters for anything missing or not a string', () => {
    expect(sanitizeNames(null)).toEqual(DEFAULT_PLAYER_NAMES);
    expect(sanitizeNames({ A: 42, B: null, C: 'Aysel' })).toEqual({
      ...DEFAULT_PLAYER_NAMES,
      C: 'Aysel',
    });
  });

  it('trims and caps a name, ignoring keys that are not seats', () => {
    const long = 'x'.repeat(NAME_MAX_LENGTH + 10);
    const clean = sanitizeNames({ A: '  Dunay  ', B: long, E: 'nobody' });
    expect(clean.A).toBe('Dunay');
    expect(clean.B).toBe('x'.repeat(NAME_MAX_LENGTH));
    expect(clean).not.toHaveProperty('E');
  });
});
