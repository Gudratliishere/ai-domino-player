# AI Domino Player

An **advisor** for a live game of partnership dominoes, not a bot that plays for you.

You are player `A`. Enter the seven stones you were dealt, then log every move all four
players make. On each of your turns the app ranks your legal moves and explains why.

```
npm install
npm run dev        # the app
npm test           # unit tests, belief soundness, and the self-play ladder
npm run build
npm run experiment # self-play measurements: styles, weights, search knobs (minutes)
```

Language: English and Azerbaijani, switchable in the top-right corner.

## The rules it assumes

Double-six set, 28 stones, all dealt, no boneyard. Four players in fixed partnerships,
**A+C against B+D**, playing clockwise `A → D → C → B` (A sits at the bottom of the table,
D on the left, C at the top, B on the right). Passing is forced — you may only pass with no
legal move. A player emptying their hand wins for their team; if all four pass in a row the
team with fewer pips wins.

**Scoring.** The winning team scores the pips left in the **opponents'** hands — a partner's
remaining stones do not count against you. A match runs to **101 points**, so the number of
games is not fixed.

Two wrinkles the app handles for you:

- **A game worth less than 13 is not written down.** It hangs "in the air" and builds up.
  Win a later game by 13 or more and you bank the lot; lose one by 13 or more and it is gone.
- **A block where both teams hold equal pips is a *seka*.** Nobody scores, both sides' pips
  go into a pot, and whoever wins next takes it as well.

A game is opened with `1-1` by whoever holds it until a team gets points **on the board**.
From then on the winner of the previous game opens, either partner, with any stone. Points
in the air do not count for this — while the score reads 0-0, `1-1` keeps opening.

Two dealing constraints matter a great deal, because the app reasons from them: a hand holds
at most 4 stones of any value (or 5 if that value's double is among them), and at most 4
doubles in total.

## How the recommendation is made

```
move log + your hand
   → beliefs     what the log proves about the hidden hands
   → sampler     consistent deals of the 21 stones you cannot see
   → weights     how well each deal explains the play, then resample
   → playout     heuristic rollout to a finished game
   → rank by expected value, in a Web Worker
```

For the opponents, nothing about "he played a six so he probably has more sixes" is coded
anywhere. The weighting step asks which deals would have made the moves people actually
played likely, and that behaviour falls out of it.

Your **partner** is the exception, and is read directly: an end they have chosen to expose
before is one they can probably serve again, so it is worth leaving standing rather than
consuming. Only the half of a stone they *chose* counts — answering a 1 because a 1 was the
only open end says nothing about their 1s. A pass clears the read outright.

Each recommendation shows the **expected points** it is worth — the size of a win is most
of its value when the match runs to 101 — plus the share of simulated deals it wins and
plain-language reasons. Two badges distinguish confidence:

- **proven** — a deduction, not an estimate. "B has already passed on 6 and 4, so B must
  pass again" is a certainty, and is shown differently from a 60% guess.
- **solved** — every sampled deal was decided exactly rather than simulated. In practice
  this means the move ends the game: an exact endgame solver exists but is off by default,
  because solving a *guessed* deal assumes your opponents can see it too.

If you mis-log a move, the app usually notices: when no legal deal can explain the log at
all, it says so and falls back to plain counting.

`ENGINE_DESIGN.md` is the full design, including what was measured at each step — and which
ideas turned out not to help.

## Layout

```
src/lib/            game rules, replay, match rules  (pure, no React)
src/lib/ai/         the engine
src/components/     table, tiles, move logger, recommendations
src/screens/        home, new game, game
```

Everything under `src/lib/` is a pure function over plain data. That is what makes the
self-play harness — and therefore every claim in the design doc — possible.
