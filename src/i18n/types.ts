import type { Side } from '../types/game';
import type { SeatRole } from '../types/game';

export type Lang = 'en' | 'az';

export const LANGS: Lang[] = ['en', 'az'];

/**
 * Every string the app shows, as one typed record per language.
 *
 * Functions rather than templates: Azerbaijani needs the verb last and case
 * suffixes on the players' names, so a sentence cannot be assembled from
 * fragments by the caller. The caller passes the values; the language decides
 * the shape.
 */
export interface Messages {
  lang: Lang;
  /** How this language names itself, for the switcher. */
  nativeName: string;
  /** Short form for the switcher button. */
  shortName: string;
  /** Locale-correct decimals: 5.4 in English, 5,4 in Azerbaijani. */
  decimal: (value: number, digits: number) => string;

  app: {
    title: string;
    tagline: string;
    languageLabel: string;
  };

  role: Record<SeatRole, string>;
  side: Record<Side, string>;

  common: {
    back: string;
    done: string;
    showAllAnyway: string;
  };

  names: {
    heading: string;
    hint: string;
    reset: string;
    summary: (order: string) => string;
    edit: string;
    duplicateWarning: (quoted: string) => string;
  };

  home: {
    scoreHeading: (us: number, them: number) => string;
    teams: (us: string, them: string) => string;
    matchWon: (winner: 'us' | 'them', target: number) => string;
    playingTo: (target: number) => string;
    openerNote: (previousWinner: 'us' | 'them' | null) => string;
    airLabel: string;
    airYou: (points: number) => string;
    airThem: (points: number) => string;
    airExplain: (threshold: number) => string;
    potNote: (pot: number) => string;
    intro: (target: number, threshold: number) => string;
    startGame: string;
    startNumberedGame: (game: number) => string;
    resetMatch: string;
    newMatch: string;
  };

  newGame: {
    handHeading: string;
    handCount: (selected: number, total: number) => string;
    handRuleHint: string;
    next: string;
    openerHeading: string;
    openerStatus: (game: number, target: number, us: number, them: number) => string;
    seatNote: (role: string, seat: string) => string;
    forcedStone: (stoneId: string) => string;
    start: string;
  };

  game: {
    heading: (game: number) => string;
    header: (parts: {
      me: string;
      partner: string;
      opponents: string;
      us: number;
      them: number;
      opener: string;
    }) => string;
    impossibleLog: string;
    seka: string;
    weScore: (points: number) => string;
    theyScore: (points: number) => string;
    wentOut: (name: string, team: string) => string;
    blocked: string;
    pipsHeld: (parts: {
      usTeam: string;
      usPips: number;
      themTeam: string;
      themPips: number;
    }) => string;
    potCollected: (pot: number) => string;
    sekaCarry: (carry: number) => string;
    wroteWithAir: (threshold: number, collected: number) => string;
    wrote: (threshold: number) => string;
    notWritten: (threshold: number) => string;
    wiped: (points: number) => string;
    matchStanding: (us: number, them: number, target: number) => string;
    airStanding: (us: number, them: number) => string;
    recordScore: string;
    nothingFits: string;
    engineFailed: () => string;
    undo: string;
    abandon: string;
  };

  table: {
    waitingFirstStone: string;
    placeHere: (stone: string) => string;
    tap: string;
    mismatch: (stone: string) => string;
  };

  logger: {
    myHint: string;
    myForcedHint: (stoneId: string) => string;
    turnHeading: (name: string) => string;
    forcedOpen: (name: string, stoneId: string) => string;
    selectPlayed: (name: string) => string;
    hiddenNotice: (hidden: number, name: string) => string;
    allRuledOut: (name: string) => string;
    noneMatch: (name: string) => string;
    passButton: (name: string) => string;
  };

  history: {
    heading: string;
    passed: string;
    played: (stone: string, side: string | undefined) => string;
    onEnds: (ends: string) => string;
    emptyTable: string;
  };

  reveal: {
    headingBlocked: string;
    headingWentOut: string;
    selectFor: (name: string, selected: number, total: number) => string;
    hiddenNotice: (hidden: number) => string;
    nextFor: (name: string) => string;
    leftoverFor: (name: string, count: number, total: number) => string;
    finish: string;
  };

  recommendations: {
    heading: string;
    searching: string;
    basis: (deals: number) => string;
    searchingShort: string;
    rank: (index: number) => string;
    placementOpening: (stone: string, left: number | null, right: number | null) => string;
    placementOnSide: (
      stone: string,
      side: string,
      left: number | null,
      right: number | null,
    ) => string;
    proven: string;
    solved: string;
    expectedPoints: string;
    winRate: (percent: number) => string;
    weakerHidden: (count: number) => string;
  };

  /**
   * The rationale a ranked move carries. Written by the engine, read by a
   * person: every one of these is a sentence shown in a recommendation card.
   */
  reasons: {
    /** Joins the open-end values a reason talks about: "3 and 5". */
    andJoin: string;
    lastStone: string;
    lastStoneShort: string;
    forcedBlockGood: (values: string, points: number) => string;
    forcedBlockBad: (values: string, points: number) => string;
    suitControl: (playable: number, remaining: number) => string;
    selfBlockNone: string;
    selfBlockThin: string;
    stuckPassed: (name: string, values: string) => string;
    stuckRuledOut: (name: string, values: string) => string;
    starveLikely: (name: string, percent: number) => string;
    partnerShutOut: (name: string) => string;
    feedPartnerAhead: (name: string, ahead: number) => string;
    feedPartner: (name: string) => string;
    partnerSuit: (name: string, stones: number, values: string) => string;
    pipShed: (pips: number) => string;
    deadDouble: (stone: string, value: number) => string;
    thinDouble: (stone: string, value: number, outside: number) => string;
  };

  /** Labels only a screen reader sees. */
  a11y: {
    stone: (label: string) => string;
  };

  /** The opening rule's explanation, shown on the "who opens" step. */
  opening: {
    /** Joins the two players allowed to open: "A or C". */
    orJoin: string;
    iHoldItFirstGame: string;
    iHoldItAgain: string;
    whoHoldsItFirstGame: string;
    whoHoldsItAgain: string;
    afterSeka: string;
    weWon: (names: string) => string;
    theyWon: (names: string) => string;
  };
}
