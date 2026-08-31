/**
 * Just enough Azerbaijani noun morphology to put a player's name into a case.
 *
 * "Aysel's turn" is "Ayselin növbəsi", but "Kamran's" is "Kamranın" and "Aslı's"
 * is "Aslının" — the suffix follows vowel harmony and whether the name ends in a
 * vowel. Concatenating a fixed suffix reads as broken Azerbaijani to a native
 * speaker, so the rules are applied properly here and the catalog calls them.
 */

const VOWELS = 'aeəiıoöuü';
const BACK_UNROUNDED = 'aı';
const FRONT_UNROUNDED = 'eəi';
const BACK_ROUNDED = 'ou';

/** The seat letters are read out as letters, so they take a hyphen and the suffix of their sound. */
const SEAT_LETTER_STEMS: Record<string, string> = { A: 'a', B: 'be', C: 'ce', D: 'de' };

function isSeatLetter(name: string): boolean {
  return name.length === 1 && name.toUpperCase() in SEAT_LETTER_STEMS;
}

/** The name as it sounds, which is what the suffix agrees with. */
function stemOf(name: string): string {
  const trimmed = name.trim();
  if (isSeatLetter(trimmed)) return SEAT_LETTER_STEMS[trimmed.toUpperCase()];
  return trimmed.toLowerCase();
}

function lastVowelOf(stem: string): string {
  for (let i = stem.length - 1; i >= 0; i--) {
    if (VOWELS.includes(stem[i])) return stem[i];
  }
  // No vowel at all (an initialism, say) — front harmony is the safer default.
  return 'e';
}

/** Four-way harmony: ı / i / u / ü. */
function high(stem: string): string {
  const vowel = lastVowelOf(stem);
  if (BACK_UNROUNDED.includes(vowel)) return 'ı';
  if (FRONT_UNROUNDED.includes(vowel)) return 'i';
  if (BACK_ROUNDED.includes(vowel)) return 'u';
  return 'ü';
}

/** Two-way harmony: a / ə. */
function low(stem: string): string {
  const vowel = lastVowelOf(stem);
  return BACK_UNROUNDED.includes(vowel) || BACK_ROUNDED.includes(vowel) ? 'a' : 'ə';
}

function endsInVowel(stem: string): boolean {
  return VOWELS.includes(stem[stem.length - 1] ?? '');
}

function join(name: string, suffix: string): string {
  const trimmed = name.trim();
  return isSeatLetter(trimmed) ? `${trimmed.toUpperCase()}-${suffix}` : `${trimmed}${suffix}`;
}

/** Possessive: "Ayselin", "Kamranın", "A-nın". */
export function genitive(name: string): string {
  const stem = stemOf(name);
  const vowel = high(stem);
  return join(name, endsInVowel(stem) ? `n${vowel}n` : `${vowel}n`);
}

/** To whom: "Aysele", "Kamrana", "A-ya". */
export function dative(name: string): string {
  const stem = stemOf(name);
  const vowel = low(stem);
  return join(name, endsInVowel(stem) ? `y${vowel}` : vowel);
}

/** The object of a verb: "Ayseli", "Kamranı", "A-nı". */
export function accusative(name: string): string {
  const stem = stemOf(name);
  const vowel = high(stem);
  return join(name, endsInVowel(stem) ? `n${vowel}` : vowel);
}

/** Whose it is, as a predicate: "Ayseldə", "Kamranda" — the locative. */
export function locative(name: string): string {
  const stem = stemOf(name);
  return join(name, `d${low(stem)}`);
}
