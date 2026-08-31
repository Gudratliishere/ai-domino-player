import type { Messages } from './types';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const en: Messages = {
  lang: 'en',
  nativeName: 'English',
  shortName: 'EN',
  decimal: (value, digits) => value.toFixed(digits),

  app: {
    title: 'AI Domino Player',
    tagline: 'Track a live domino game and get a recommendation for your turn.',
    languageLabel: 'Language',
  },

  role: { you: 'You', partner: 'Partner', opponent: 'Opponent' },
  side: { left: 'left', right: 'right' },

  common: {
    back: 'Back',
    done: 'Done',
    showAllAnyway: 'Show all anyway',
  },

  names: {
    heading: 'Player names',
    hint: 'Seating and turn order, clockwise from you. Blank falls back to the seat letter.',
    reset: 'Reset to A–D',
    summary: (order) => `Players: ${order}`,
    edit: 'Edit names',
    duplicateWarning: (quoted) =>
      `Two seats are called ${quoted} — the move log will be hard to read.`,
  },

  home: {
    scoreHeading: (us, them) => `You ${us} – ${them} Them`,
    teams: (us, them) => `${us} vs ${them}`,
    matchWon: (winner, target) =>
      `${winner === 'us' ? 'You won the match.' : 'They won the match.'} First to ${target} points.`,
    playingTo: (target) => `Playing to ${target}.`,
    openerNote: (previousWinner) =>
      previousWinner === null
        ? 'The last game was level, so either side may open.'
        : previousWinner === 'us'
          ? 'You won the last game — your team opens.'
          : 'They won the last game — their team opens.',
    airLabel: 'In the air:',
    airYou: (points) => `you ${points}`,
    airThem: (points) => `them ${points}`,
    airExplain: (threshold) =>
      `Won but not written — a win worth ${threshold} or more banks your own and wipes theirs.`,
    potNote: (pot) =>
      `${pot} points are in the pot from the seka — whoever wins the next game takes them as well.`,
    intro: (target, threshold) =>
      `A match runs to ${target} points. The team that wins a game scores the pips left in the ` +
      `opponents' hands — but a game worth less than ${threshold} is not written down until a ` +
      `later win of ${threshold} or more banks it.`,
    startGame: 'Start Game',
    startNumberedGame: (game) => `Start Game ${game}`,
    resetMatch: 'Reset match',
    newMatch: 'New match',
  },

  newGame: {
    handHeading: 'Enter Your Hand',
    handCount: (selected, total) =>
      `Select the ${total} stones you were dealt (${selected}/${total})`,
    handRuleHint:
      "A hand can hold at most 4 stones of a given number, or 5 if that number's double is among them.",
    next: 'Next: who opens',
    openerHeading: 'Who Opens?',
    openerStatus: (game, target, us, them) =>
      `Game ${game} · first to ${target} · you ${us}–${them} them`,
    seatNote: (role, seat) => `${role} · seat ${seat}`,
    forcedStone: (stoneId) =>
      `The opening stone is fixed at ${stoneId} — log it as the first move.`,
    start: 'Start Game',
  },

  game: {
    heading: (game) => `Game ${game}`,
    header: ({ me, partner, opponents, us, them, opener }) =>
      `You are ${me} · Partner ${partner} · Opponents ${opponents} · Series ${us}–${them} · ` +
      `${opener} opened`,
    impossibleLog:
      'No legal deal fits this move log — something was probably logged wrong. Undo the last ' +
      'move and check it. Recommendations fall back to plain counting until it is fixed.',
    seka: 'Seka — nobody scores',
    weScore: (points) => `Your team scores ${points}`,
    theyScore: (points) => `The other team scores ${points}`,
    wentOut: (name, team) =>
      `${name} ran out of stones, so ${team} take the pips left in the opponents' hands.`,
    blocked: "Game blocked — the lighter team wins and scores the opponents' pips.",
    pipsHeld: ({ usTeam, usPips, themTeam, themPips }) =>
      `Your team (${usTeam}) held ${usPips} pips · their team (${themTeam}) held ${themPips}`,
    potCollected: (pot) => `Including ${pot} points collected from the seka pot.`,
    sekaCarry: (carry) =>
      `Both teams level, so ${carry} points go into the pot for whoever wins next.`,
    wroteWithAir: (threshold, collected) =>
      `Worth ${threshold} or more, so it goes on the board — along with ${collected} that were ` +
      `in the air.`,
    wrote: (threshold) => `Worth ${threshold} or more, so it goes straight on the board.`,
    notWritten: (threshold) =>
      `Under ${threshold}, so nothing is written — it hangs in the air until a win of ` +
      `${threshold} or more banks it.`,
    wiped: (points) => ` Their ${points} in the air is wiped.`,
    matchStanding: (us, them, target) => `Match: you ${us} – ${them} them, playing to ${target}`,
    airStanding: (us, them) => ` · in the air: you ${us}, them ${them}`,
    recordScore: 'Record score & continue match',
    nothingFits: 'Nothing in your hand fits either end — log a pass.',
    engineFailed: () =>
      'You do have a legal move, but the engine failed to rank your options. Play whichever ' +
      'stone you judge best — do not pass.',
    undo: 'Undo last move',
    abandon: 'Abandon Game',
  },

  table: {
    waitingFirstStone: 'Waiting for the first stone',
    placeHere: (stone) => `Place ${stone} here`,
    tap: 'tap',
    mismatch: (stone) =>
      `${stone} doesn't match either open end. Pick a different stone, or log a pass.`,
  },

  logger: {
    myHint: 'Tap a stone in your rack, then tap the glowing end on the table.',
    myForcedHint: (stoneId) => `You must open with ${stoneId} — tap it, then tap the table.`,
    turnHeading: (name) => `${name}'s turn`,
    forcedOpen: (name, stoneId) => `${name} opens with ${stoneId} — tap it to log the move.`,
    selectPlayed: (name) => `Select the stone ${name} played on the table:`,
    hiddenNotice: (hidden, name) =>
      `${hidden} ${plural(hidden, 'stone', 'stones')} not shown — the log rules ` +
      `${plural(hidden, 'it', 'them')} out of ${name}'s hand.`,
    allRuledOut: (name) =>
      `Every stone that fits the ends is ruled out of ${name}'s hand, so ${name} must pass.`,
    noneMatch: (name) => `No remaining stone matches the open ends — ${name} must pass.`,
    passButton: (name) => `${name} passes / can't play`,
  },

  history: {
    heading: 'Move log',
    passed: 'passed',
    played: (stone, side) => `played ${stone}${side ? ` (${side})` : ''}`,
    onEnds: (ends) => `on ${ends}`,
    emptyTable: 'empty table',
  },

  reveal: {
    headingBlocked: 'Game blocked — enter the remaining stones to score it',
    headingWentOut: 'Game over — enter the remaining stones to score it',
    selectFor: (name, selected, total) =>
      `Select ${name}'s remaining stones (${selected}/${total})`,
    hiddenNotice: (hidden) =>
      `${hidden} ${plural(hidden, 'stone', 'stones')} hidden — the move log rules ` +
      `${plural(hidden, 'it', 'them')} out.`,
    nextFor: (name) => `Next: ${name}'s stones`,
    leftoverFor: (name, count, total) =>
      `${name} gets whichever stones are left over (${count}/${total})`,
    finish: 'Finish & Score',
  },

  recommendations: {
    heading: 'Recommended',
    searching: 'Searching…',
    basis: (deals) => `from ${deals} simulated deals`,
    searchingShort: 'searching…',
    rank: (index) => ['Best', '2nd', '3rd'][index] ?? `${index + 1}th`,
    placementOpening: (stone, left, right) => `${stone} open with it — leaves ${left} | ${right}`,
    placementOnSide: (stone, side, left, right) =>
      `${stone} on the ${side} end — leaves ${left} | ${right}`,
    proven: 'proven',
    solved: 'solved',
    expectedPoints: 'expected pts',
    winRate: (percent) => `${percent}% win`,
    weakerHidden: (count) => `${count} weaker ${plural(count, 'move', 'moves')} not shown.`,
  },

  reasons: {
    andJoin: ' and ',
    lastStone: 'This is your last stone — playing it ends the game and wins it.',
    lastStoneShort: 'Last stone.',
    forcedBlockGood: (values, points) =>
      `Kills the game outright: every ${values} is on the table, so all four players pass. ` +
      `You are the lighter team, worth roughly ${points} points.`,
    forcedBlockBad: (values, points) =>
      `Blocks the game on ${values}, but your team is the heavier half — it would hand them ` +
      `about ${points} points.`,
    suitControl: (playable, remaining) =>
      `Keeps ${playable} of your ${remaining} remaining stones playable on the open ends.`,
    selfBlockNone:
      'Nothing left in your hand fits either end — you would likely have to pass next turn.',
    selfBlockThin: 'Only one of your stones fits — you are one bad end away from passing.',
    stuckPassed: (name, values) =>
      `${name} has already passed on ${values}, so ${name} must pass again.`,
    stuckRuledOut: (name, values) =>
      `${name} cannot hold anything that fits ${values} — the log rules it out.`,
    starveLikely: (name, percent) =>
      `${name} probably cannot answer this — roughly ${percent}% chance of a pass.`,
    partnerShutOut: (name) => `This shuts your partner ${name} out — they cannot answer it.`,
    feedPartnerAhead: (name, ahead) =>
      `Leaves an end ${name} can probably answer — and they are ${ahead} stone` +
      `${ahead === 1 ? '' : 's'} closer to going out than you, so it is their hand worth feeding.`,
    feedPartner: (name) => `Leaves an end your partner ${name} can probably answer.`,
    partnerSuit: (name, stones, values) =>
      `${name} has already played ${stones} stone${stones === 1 ? '' : 's'} carrying ${values}, ` +
      `so that is likely their strong suit — worth leaving open for them.`,
    pipShed: (pips) => `Sheds ${pips} pips from your team's count.`,
    deadDouble: (stone, value) =>
      `Strands your ${stone}: no other ${value} is left anywhere on the table or in a hand.`,
    thinDouble: (stone, value, outside) =>
      `Your ${stone} is getting hard to place — only ${outside} other ${value} is unaccounted for.`,
  },

  a11y: {
    stone: (label) => `${label} domino`,
  },

  opening: {
    orJoin: ' or ',
    iHoldItFirstGame: 'You were dealt 1-1, so you open the first game and must play it.',
    iHoldItAgain: 'Nothing is on the board yet, so 1-1 opens again — and you were dealt it.',
    whoHoldsItFirstGame: 'The first game is opened with 1-1. Who was dealt it?',
    whoHoldsItAgain:
      'Nothing is on the board yet, so this game opens with 1-1 again. Who was dealt it?',
    afterSeka: 'The last game was a seka, so nobody won it — record who opened this one.',
    weWon: (names) => `Your team won the last game, so ${names} opens with any stone.`,
    theyWon: (names) => `The other team won the last game, so ${names} opens with any stone.`,
  },
};
