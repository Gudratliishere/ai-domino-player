import { describe, expect, it } from 'vitest';
import { az } from './az';
import { en } from './en';
import { accusative, dative, genitive } from './azMorphology';

describe('Azerbaijani name suffixes', () => {
  it('follows vowel harmony after a consonant', () => {
    expect(genitive('Aysel')).toBe('Ayselin');
    expect(genitive('Kamran')).toBe('Kamranın');
    expect(genitive('Rəşad')).toBe('Rəşadın');
    expect(genitive('Bahruz')).toBe('Bahruzun');
    expect(genitive('Gülşən')).toBe('Gülşənin');
  });

  it('inserts the buffer consonant after a vowel', () => {
    expect(genitive('Ayla')).toBe('Aylanın');
    expect(genitive('Aslı')).toBe('Aslının');
    expect(genitive('Nino')).toBe('Ninonun');
    expect(genitive('Ülvi')).toBe('Ülvinin');
  });

  it('spells a seat letter out with a hyphen, agreeing with how it is said', () => {
    expect(genitive('A')).toBe('A-nın');
    expect(genitive('B')).toBe('B-nin');
    expect(genitive('C')).toBe('C-nin');
    expect(genitive('D')).toBe('D-nin');
  });

  it('handles the dative and the accusative too', () => {
    expect(dative('Kamran')).toBe('Kamrana');
    expect(dative('Aysel')).toBe('Ayselə');
    expect(dative('Ayla')).toBe('Aylaya');
    expect(dative('A')).toBe('A-ya');
    expect(dative('B')).toBe('B-yə');
    expect(accusative('Kamran')).toBe('Kamranı');
    expect(accusative('Nino')).toBe('Ninonu');
  });

  it('reads naturally in the sentences that use it', () => {
    expect(az.logger.turnHeading('Aysel')).toBe('Ayselin növbəsi');
    expect(az.logger.turnHeading('A')).toBe('A-nın növbəsi');
    expect(az.reveal.nextFor('Kamran')).toBe('Növbəti: Kamranın daşları');
    expect(az.reveal.leftoverFor('Kamran', 3, 3)).toBe('Qalan daşlar Kamrana gedir (3/3)');
  });
});

describe('Azerbaijani ordinals', () => {
  it('takes the suffix from the last digit, as a speaker does', () => {
    expect(az.game.heading(1)).toBe('1-ci oyun');
    expect(az.game.heading(2)).toBe('2-ci oyun');
    expect(az.game.heading(3)).toBe('3-cü oyun');
    expect(az.game.heading(4)).toBe('4-cü oyun');
    expect(az.game.heading(6)).toBe('6-cı oyun');
    expect(az.game.heading(9)).toBe('9-cu oyun');
    expect(az.game.heading(10)).toBe('10-cu oyun');
    expect(az.game.heading(20)).toBe('20-ci oyun');
    expect(az.game.heading(100)).toBe('100-cü oyun');
  });
});

describe('the two catalogs stay in step', () => {
  type Node = Record<string, unknown>;

  function shapeOf(value: unknown, path: string): string[] {
    if (typeof value === 'function') return [`${path}:fn/${value.length}`];
    if (value !== null && typeof value === 'object') {
      return Object.keys(value as Node)
        .sort()
        .flatMap((key) => shapeOf((value as Node)[key], `${path}.${key}`));
    }
    return [`${path}:${typeof value}`];
  }

  it('has the same keys, of the same kinds, taking the same arguments', () => {
    // TypeScript already requires this; the walk catches a shape that only looks
    // right because a signature was widened on one side.
    expect(shapeOf(az, 'az').map((k) => k.replace(/^az/, ''))).toEqual(
      shapeOf(en, 'en').map((k) => k.replace(/^en/, '')),
    );
  });

  it('formats decimals for its own locale', () => {
    expect(en.decimal(5.42, 1)).toBe('5.4');
    expect(az.decimal(5.42, 1)).toBe('5,4');
    expect(az.decimal(-2, 1)).toBe('-2,0');
  });

  it('leaves no English behind in the Azerbaijani strings', () => {
    const english = /\b(the|and|stone|stones|points|turn|Game|Player|Match)\b/;
    const offenders: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value === 'string') {
        if (english.test(value)) offenders.push(`${path}: ${value}`);
        return;
      }
      if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value as Node)) walk(child, `${path}.${key}`);
      }
    };
    walk(az, 'az');
    expect(offenders).toEqual([]);
  });
});
