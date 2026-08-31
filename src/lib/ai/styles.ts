import { DEFAULT_WEIGHTS, type Weights } from './features';

/**
 * Playing styles, as whole policies rather than nudges.
 *
 * §5's cross-entropy tuner perturbed the shipped weights by ~60% of their value
 * and found a plateau. That answers "is there a better point *near* this one",
 * which is not the same question as "is this the right *kind* of player". These
 * archetypes are the styles a domino player would recognise, each exaggerated
 * far past anything a local search would propose, so a round-robin between them
 * says which instinct actually pays under the real scoring.
 *
 * `countOut` is never touched: a forced win must always dominate. That is
 * structure, not taste.
 */
export interface Style {
  name: string;
  /** What a person following this style believes. */
  idea: string;
  weights: Weights;
}

const from = (overrides: Partial<Weights>): Weights => ({ ...DEFAULT_WEIGHTS, ...overrides });

export const STYLES: Style[] = [
  {
    name: 'shipped',
    idea: 'The hand-set weights the app ships. The baseline every style is judged against.',
    weights: DEFAULT_WEIGHTS,
  },
  {
    name: 'blocker',
    idea: 'Starve them. Leave ends nobody can answer and kill the game while you are light.',
    weights: from({
      starveOpponent: 120,
      forcedBlockPoints: 18,
      feedPartner: 8,
      pipShed: 0.2,
    }),
  },
  {
    name: 'shedder',
    idea: 'Dump pips. If the game blocks you want to be caught holding nothing.',
    weights: from({
      pipShed: 8,
      starveOpponent: 12,
      suitControl: 1,
      forcedBlockPoints: 3,
    }),
  },
  {
    name: 'partner-first',
    idea: 'Play for your partner: keep serving the suit they have shown and let them run out.',
    weights: from({
      feedPartner: 90,
      partnerSuit: 20,
      partnerAhead: 10,
      starveOpponent: 15,
    }),
  },
  {
    name: 'flexible',
    idea: 'Never get stuck. Keep as many of your own stones playable as possible.',
    weights: from({
      suitControl: 14,
      selfBlockNone: -140,
      selfBlockThin: -50,
      starveOpponent: 20,
    }),
  },
  {
    name: 'doubles-first',
    idea: 'Doubles are the stones that strand you. Get them down while their suit is alive.',
    weights: from({
      deadDouble: -120,
      thinDouble: -50,
      pipShed: 1.5,
    }),
  },
  {
    name: 'greedy-pips',
    idea: 'Only the count matters: shed weight, ignore who can answer what.',
    weights: from({
      pipShed: 20,
      starveOpponent: 0,
      feedPartner: 0,
      partnerSuit: 0,
      suitControl: 0,
      forcedBlockPoints: 0,
      deadDouble: 0,
      thinDouble: 0,
    }),
  },
];

export function styleByName(name: string): Style {
  const style = STYLES.find((s) => s.name === name);
  if (!style) throw new Error(`unknown style: ${name}`);
  return style;
}
