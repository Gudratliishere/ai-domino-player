# Domino Recommendation Engine — Design & Build Plan

Status: all phases (0-5) complete. Rebuilt for points scoring on 2026-08-28 after the
real match rules came to light — see §1 and §9.
This doc is the shared reference for building the engine. Edit it as we go.

**What actually runs:** deduction (Phase 2) → 1200 sampled deals, weighted by how well they
explain the play and resampled to 300 (Phases 3 and 4) → heuristic rollouts → rank by
expected value with common random numbers, in a Web Worker. Phase 5's exact endgame solver
is built and tested but **off**: it measured worse, for a reason §5 explains. §8 summarises
every head-to-head number. §9 records the scoring correction that reshaped all of it, §10 the writing threshold, and
§11 the validation applied to every player's moves.

---

## 0. What we are building

An **advisor**, not a bot. The user is player `A`. They enter their own 7 stones, then
log every move made by all four players. The engine's job, on every one of A's turns, is
to answer:

> Of the moves I can legally make right now, which one is best — and why?

The "why" is not optional. A human is reading this mid-game and has to trust it fast.

The core difficulty is **imperfect information**. We see 7 of 28 stones, plus whatever
has been played. The rest is hidden across three hands. Almost all of the engineering
effort goes into shrinking that uncertainty and then reasoning correctly about what
remains.

---

## 1. The ruleset (confirmed)

| Rule | Value |
|---|---|
| Set | Double-six, 28 stones, 168 pips total |
| Players | 4, fixed partnerships: **A+C** vs **B+D** |
| Deal | All 28 stones dealt, 7 each. **No boneyard, no drawing.** |
| Deal constraint | A hand holds at most **4** stones of any given value — or **5** if that value's double is among them. Applies to **every** player. |
| Deal constraint | A hand holds at most **4 doubles**. |
| Opening, game 1 of a match | Holder of `1-1` opens, and must open with `1-1`. |
| Opening, later games | Once a team has **written** points, the winner of the previous game opens — either partner, any stone. While the board still reads 0-0, every game opens with `1-1` again, however much is in the air. |
| Turn order | Clockwise, `A -> D -> C -> B` — A sits at the bottom, D left, C top, B right |
| Passing | Forced — you may only pass if you have no legal move. |
| Win | A player empties their hand → **their team wins**. |
| Block | All four pass consecutively → team with the **lower** total pips wins. Ties possible. |
| **Scoring** | The winning team scores the pips left in the **opponents'** hands. Their own partner's stones do not count against them. |
| **Match** | First team to **101 points**. The number of games is not fixed. |
| **Writing threshold** | A game worth **less than 13** is not written down. It hangs "in the air" against that team and accumulates. A later win of 13 or more banks the lot; an opponent's win of 13 or more wipes it. |
| **Seka** | A block level on pips scores nothing; both teams' pips go into a pot, and the next game's winner collects it on top of their own score. |

**Conventions (practice, never law — must be modelled as soft priors, not rules):**
- Open with the double of your longest suit.
- Play from strength, to keep serving the ends you control.
- Choosing one end over another hints you are weak in the end you avoided.

---

## 2. Foundations

Eight observations the whole design rests on. Understanding these is most of
understanding the engine.

### 2.1 The chain is cosmetic

Nothing in this game depends on the layout of the played stones — only on the two open
ends. `resolvePlacement` already reflects this. The complete game state is:

```
(leftEnd, rightEnd, the four hands, whose turn, pass streak)
```

Two consequences:

- **Moves that produce the same end-pair are the same move.** Playing a double on the
  left or the right is one move, not two. When both ends are equal, every stone has one
  distinct move, not two.
- **The position is symmetric under swapping left and right.** For evaluation, normalise
  the end-pair as unordered. Keep the side for *display* — the user still has to know
  where to physically place the stone.

Real branching factor after dedupe is usually 2–4, not 14.

### 2.2 Closed accounting

No boneyard means nothing leaks. At every moment:

```
unknown = 28 − myHand − played        (exact)
|B| + |C| + |D| = |unknown|           (exact)
```

Every deduction below is only possible because this is exact.

### 2.3 Pip conservation collapses block scoring to one number

The full set is 168 pips. Therefore at any moment:

```
myTeamPips + theirTeamPips = 168 − playedPips     ← known exactly
```

So a blocked game is won iff `myTeamPips < (168 − playedPips) / 2`. The evaluator never
has to estimate the opponents' pips — it only tracks **our own team's share against a
known threshold**. Much easier target, and it removes a whole class of error.

*Still true, and still used — but note what it does **not** settle. Winning the block is
only half the question, because the winner scores the opponents' pips (§1): the same
conservation identity gives that number too, since `theirPips = 168 − playedPips −
ourPips`. Knowing our own share is enough to price the block, not merely to call it.*

### 2.4 Suit death is computable

Each value appears on exactly 7 stones. Once all 7 stones containing `v` are on the
table, the `v` suit is **dead** — nobody can ever play it again. If you can make both
ends `v`, every player passes and the game blocks immediately.

That is not a probability. It is a certainty you can *engineer*. Any decent engine must
see forced blocks.

### 2.5 The 4/5 cap is a deduction engine, not just a validator

`handRules.ts` currently uses this rule to validate the user's own input. It is worth far
more. For every player `P` and value `v`:

```
dealtCap(P, v)  = 5 if v-v was in P's dealt hand, else 4
stillHeld(P, v) ≤ dealtCap(P, v) − playedCount(P, v)
```

Worked example: B has played `0-5`, `1-5`, `3-5`, `5-6` — four fives, no double. If `5-5`
is in your hand or already on the table, B's cap was 4, so **B holds zero fives.
Certain.** No pass needed. If `5-5` is still unaccounted for, B holds at most one more
five and it can only be `5-5`.

Combine with the global count and you get a small integer-feasibility problem per value:

```
remaining(v) = 7 − played(v) − myHand(v)
distribute across B, C, D subject to:
  pass constraints:  P passed on v  ⇒  stillHeld(P, v) = 0
  caps:              stillHeld(P, v) ≤ dealtCap − played
  hand sizes:        Σ over v consistent with |P|
```

When the caps sum tight against `remaining(v)`, assignments become **forced**. Mid-to-late
game this pins exact stones surprisingly often.

### 2.6 Passes are permanent certainties

Passing is forced, so a pass is never noise. If B passes while the ends are `{3, 5}`,
B holds **zero** 3s and **zero** 5s — and because hands only shrink, that stays true for
the rest of the game.

### 2.7 Choice reveals; forced moves reveal nothing

A move carries information only to the extent the player had alternatives. If a player
had exactly one legal move, observing it tells you only that it was legal. This matters
for correctness — forced moves must not inject fake signal — and for cost: skipping them
removes most of the work in Phase 4.

### 2.8 The opening is the highest-information event in the game

Every other move is constrained by the ends. The opening is a free choice among all 7
stones — the largest choice set in the game, therefore the most informative when
observed. And because of the "open your longest double" convention, that choice is
strongly correlated with hand shape.

An opening of `5-5` should make 5-heavy worlds dominate our model of that player **for the
rest of the game**, until hard evidence says otherwise.

---

## 3. Architecture

```
src/lib/ai/
  moveGen.ts     enumerate legal moves, dedupe by resulting end-pair
  beliefs.ts     replay the log → hard constraints + propagation to fixed point
  sampler.ts     constraints → N consistent deals of the hidden stones
  features.ts    heuristic scoring of a position (also used as the policy)
  playout.ts     simulate a world to a terminal state under a policy
  weights.ts     likelihood weighting of sampled worlds (soft tells)
  endgame.ts     exact minimax when the space is small enough
  recommend.ts   orchestrator → ranked moves + rationale
  worker.ts      Web Worker entry point
```

As built, the orchestrator lives in `pimc.ts` (exporting `recommend()`) rather than
`recommend.ts`, plus five files this sketch did not anticipate: `context.ts` (the
public-information view handed to a policy), `harness.ts`, `rng.ts`, `deal.ts`,
`scenario.ts` (hand-built positions for tests) and `tuning.ts`. Everything else landed
where the sketch put it.

The final pipeline on each of A's turns:

```
log + hand
   → beliefs        hard constraints, propagated to a fixed point
   → sampler        1200 consistent deals (4x the playout budget)
   → weights        likelihood of each deal, resampled down to 300
   → playout        heuristic rollout to a terminal state
     / endgame      exact solve, available but off by default
   → pimc           rank by expected value, common random numbers
   → worker         off the main thread
```

Data flow on each of A's turns:

```
moveLog + myHand
      │
      ▼
  beliefs.ts ──── hard constraints, propagated ────┐
      │                                            │
      ▼                                            ▼
  sampler.ts ── N candidate worlds ──> weights.ts ── weighted worlds
                                                     │
  moveGen.ts ── candidate moves ─────────────────────┤
                                                     ▼
                                              playout.ts / endgame.ts
                                                     │
                                                     ▼
                                              recommend.ts → UI
```

Everything under `src/lib/ai/` is **pure functions over plain data**. No React, no side
effects. That is what makes the self-play harness in §5 possible.

---

## 4. Build plan

Six phases in dependency order. Each is independently useful and independently testable.
Do not start a phase before the one above it works.

---

### Phase 0 — Close the data-model gaps  ✅ DONE

**Why first:** the engine cannot be correct without this data, and two of these are
information we are currently *discarding*. Retrofitting later means a data migration.

**Gap 1 — the opener is hardcoded.**
`src/screens/GameScreen.tsx` has `useState(0)` for `turnIndex` with
`PLAYER_ORDER = ['A','B','C','D']`, so player A always starts. `NewGameScreen` only
collects the hand. Per §2.8 the opening move is our single richest signal, and right now
the app cannot even represent someone else making it.

Needs: a "who opens" selector, `turnIndex` initialised from it, and — when the opener
isn't A — their opening stone logged as a normal move.

**Gap 2 — there is no match/series state.**
The `1-1` rule applies only to game 1; afterwards the winning team opens. The app has no
concept of a match, so it cannot tell which regime it is in, cannot apply "winning team
opens" automatically, and does not know the series score.

The series score matters beyond bookkeeping: **risk tolerance should depend on match
position.** Down badly near the end of a match, a high-variance line that might go out
beats a safe block you will probably lose narrowly. That is a Phase 5 refinement, but the
data has to be captured now.

**Gap 3 — `LoggedMove` does not snapshot the ends.**
Derivable by replay, so nothing is lost — but Phase 4 replays the history once per
sampled world, and a snapshot removes that cost and makes the log self-describing.

```ts
interface MatchState {
  gameNumber: number;                     // 1 ⇒ the 1-1 opening rule applies
  seriesScore: { us: number; them: number };
}

interface LoggedMove {
  playerId: PlayerId;
  type: 'play' | 'pass';
  stone?: Stone;
  side?: Side;
  endsBefore: ChainEnds;                  // NEW
}
```

**Done when:** a game opened by B is logged correctly end-to-end, and replaying the log
reproduces the exact board state at every ply.

**Built:** `lib/matchRules.ts` (who opens, with what), `lib/replay.ts` (pure log → state,
strict on illegal moves, `replayPlies` for per-ply positions), `MatchState` + `teamOf` in
`types/game.ts`, opener step in `NewGameScreen`, series score in `App`/`HomeScreen`. Forced
1-1 openings are enforced in both the rack and the opponent logger. `GameScreen` now derives
the whole board from the log via `replay` rather than keeping parallel `useState`, which is
what makes `endsBefore` unfalsifiable — and made undo a one-liner.

**Deviation from the sketch above:** `MatchState` also carries `previousWinner`, without
which "the winning team opens" cannot be applied. Draws leave it null and any player may
be recorded as opener (see the open question in §6).

---

### Phase 1 — Move generation + heuristic scoring  ✅ DONE

**Goal:** a genuinely useful advisor, shipped, with no search and no probability.

**Why this order:** this heuristic becomes the *policy* reused by every later phase — as
the playout policy in Phase 3 and as the likelihood model in Phase 4. Building it first
means everything downstream improves whenever it improves.

```ts
interface Candidate {
  stone: Stone;
  side: Side | undefined;      // undefined for the opening move
  resultEnds: ChainEnds;       // dedupe key, normalised as unordered
}

function legalMoves(hand: Stone[], ends: ChainEnds): Candidate[];
function scoreMove(c: Candidate, ctx: Context): { score: number; reasons: string[] };
```

Starting feature set:

| Feature | Intuition |
|---|---|
| Suit control | How many of my *remaining* stones serve each new end |
| Self-block risk | Does this leave me likely unable to move next turn? |
| Opponent starvation | Given known passes, does this make both ends dead for B/D? |
| Partner feed | Does this leave an end C can likely serve? |
| Pip shed | Dump high-pip stones early — see §2.3 |
| Double safety | Don't strand yourself on a double whose suit is dying |
| Count-out | A forced path to emptying my hand dominates everything else |

Weights are hand-set for now, tuned automatically in Phase 5.

**Done when:** the UI shows the top 3 moves with scores and a plain-language reason for
each, and it beats a random-legal baseline convincingly in the §5 harness.

**Built:** `ai/moveGen.ts` (legal moves, deduped on stone + unordered end-pair),
`ai/context.ts` (`PolicyContext` — own hand plus public history, nothing else),
`ai/features.ts` (the scorer, `chooseMove` as the playout policy, `policyDistribution`
ready for Phase 4), `ai/rng.ts`, `ai/deal.ts`, `ai/harness.ts`, `ai/scenario.ts` for
hand-built positions, and the `Recommendations` component. Vitest added; 39 tests,
including Phase 0's checks made permanent.

**Measured:** heuristic vs random-legal is **66.2%** over 2000 games x 3 held-out seeds
(66.4 / 64.7 / 67.6). Mirror match is 51.1%, so the harness is not seat-biased.

An ablation (each weight zeroed, 4500 games per row) says where the strength actually
is — worth knowing before Phase 3 tries to beat it:

| Term | Cost of removing it |
|---|---|
| `starveOpponent` | **-10.5 pts** — nearly the whole edge |
| `selfBlockNone` | -2.5 pts |
| `pipShed` | -2.3 pts |
| everything else | within noise (SE ~0.7 pts) |

`countOut` measures as zero because when you hold one stone it is almost always your
only legal move — the term is right, it just rarely changes the choice. The forced-block
terms are near zero for the same reason: the situation is rare. Both matter more once
Phase 3 is searching.

**Deferred to Phase 5, deliberately:** the sweep over `suitControl` x `starveOpponent`
moved results by less than 2 points across the whole grid, which is 1-2 standard errors.
Weights were set to sensible mid-range values rather than fitted to that noise.

---

### Phase 2 — The certainty engine  ✅ DONE

**Best payoff-to-effort ratio in the whole plan.** Pure deduction: deterministic, fully
unit-testable, zero tuning, no guessing. Given this ruleset it resolves a genuinely
surprising amount of the hidden state on its own.

Implements §2.2, §2.5, §2.6, plus the "who holds `1-1`" refinement from game 1.

```ts
interface Belief {
  handSize:   Record<PlayerId, number>;
  suitBanned: Record<PlayerId, Set<PipValue>>;             // from passes — certain
  maxHeld:    Record<PlayerId, Record<PipValue, number>>;  // from the 4/5 caps
  possible:   Map<string /* stoneId */, Set<PlayerId>>;    // after propagation
  known:      Map<string /* stoneId */, PlayerId>;         // forced assignments
}

function deriveBeliefs(log: LoggedMove[], myHand: Stone[], me: PlayerId): Belief;
```

Propagate to a fixed point:

1. A pass by `P` on ends `{x,y}` removes `P` from `possible` for every stone containing
   `x` or `y`.
2. Cap arithmetic per `(player, value)` bounds `maxHeld`; a bound of 0 removes that player
   from every stone in the suit.
3. A stone with exactly one possible holder is **assigned**.
4. A player whose possible-stone count equals their hand size holds **all** of them —
   remove them from everyone else.
5. Per-value feasibility: if `remaining(v)` equals the sum of surviving caps, every one of
   those slots is forced.
6. Repeat until nothing changes.

**Done when:** unit tests over hand-built scenarios produce the exact deductions worked
out on paper, including the §2.5 example, and the UI can flag a move as *certain* rather
than merely recommended.

**Built:** `ai/beliefs.ts` (`deriveBeliefs` + the fixed-point propagation), belief-aware
`pCannotPlay`, `contextWithBeliefs`, a `proven` list on every `MoveScore`, the PROVEN
badge in the UI, and an impossible-log warning. 50 tests.

**The cap rule is simpler than §2.5 suggests.** "At most 4 of a value, or 5 with the
double" says the same thing twice about the *non-doubles*: with the double, 4 + 1 = 5;
without it, 4. So the entire dealing constraint is one number — **at most 4 non-double
stones carrying any value** — and it applies whether or not we know where the double is,
which is what makes it usable before the double surfaces. The worked example falls out
directly: B played four non-double fives, so B holds no more, and a fifth five could only
ever be `5-5` itself.

**Soundness is the property that matters, and it is tested against ground truth.** The
harness replays real games and checks every deduction against the actual deal: 3794
stones pinned across 16476 positions, zero false claims, zero false contradictions. That
test immediately caught a genuine bug — the pair-saturation rule was eliminating the
wrong players, which would have produced confidently *wrong* certainties.

**It does not make the engine play better. Measured, not assumed:**

| Matchup | Result |
|---|---|
| believing vs Phase 1 heuristic | **50.32% ± 0.64** (95% CI, n=23,470) |

That is a dead heat. The reason is visible in the ablation from Phase 1: `starveOpponent`
carried the whole edge, and it was already driven by *passes*, which Phase 0 had recorded
and Phase 1 already used. The cap and saturation rules add real certainties, but they fire
late and rarely change which move is best.

**§2.5's "pins exact stones surprisingly often" does not hold up.** Fraction of hidden
stones pinned, by stage:

| Stones played | 0 | 8 | 16 | 20 | 22 | 24 |
|---|---|---|---|---|---|---|
| Pinned | 0% | 0.8% | 3.3% | 6.5% | 12.1% | 14.0% |

Average possible holders per unresolved stone only falls from 3.00 to 2.64 by the end.
The game simply does not generate many hard constraints: passes are the only rich source
and there are roughly three per game.

**This changes the plan for Phase 3.** §3 warns that "naive rejection sampling collapses
once constraints get tight — which is exactly the late game". On this evidence constraints
never get tight, so rejection sampling should be fine and the most-constrained-first
sampler with backtracking may be unnecessary complexity. Build the simple sampler first
and measure its rejection rate before writing the clever one.

**Where the value actually is:** correct *certainty* claims in the UI (the PROVEN badge,
which now distinguishes a deduction from a 60% guess), a reliable mis-logged-move warning,
a valid constraint set for Phase 3's sampler to respect, and one quiet but real usability
win — the blocked-game reveal screen now only offers each player the stones the log has not
already ruled out for them, which is the most error-prone input in the app. Not playing
strength.

---

### Phase 3 — Sampler + Monte Carlo determinization (PIMC)  ✅ DONE

Where the engine starts genuinely outplaying a strong human. Blocking, starving the
opponents, and counting out all **emerge** here — none of them are hand-coded.

```
for each candidate move:
    sample K consistent worlds  (K ≈ 200–500)
    play each out to a terminal state under the Phase 1 policy
    score:  go out → +1 · block, our pips lower → +1 · tie → 0 · else → −1
            plus a small pip-margin term as a tiebreaker, so the search has a
            gradient instead of a cliff
    average
pick the highest expected value
```

Three details that decide whether this works or quietly produces garbage:

- **Propagate before sampling.** Run Phase 2 to a fixed point first. Naive rejection
  sampling collapses once constraints get tight — which is exactly the late game, where
  accuracy matters most. Assign the **most-constrained stones first**, with backtracking.
  A bug here silently poisons every recommendation above it, so test the sampler in
  isolation: every world it emits must satisfy every hard constraint, including the 4/5
  cap.
- **Use the Phase 1 heuristic as the playout policy, not random play.** Random playouts
  massively undervalue blocking.
- **Simulated players see only their own hand.** If they play as though they know the
  determinized deal you get *strategy fusion* — the engine overrates traps a real
  opponent would simply see coming.

Cost is roughly `4 moves × 300 worlds × ~20 plies` ≈ 25k cheap steps. Comfortably
sub-second in JS, but put it in a **Web Worker** so the UI never janks.

**Done when:** it beats the Phase 1 heuristic head-to-head over thousands of harness
games, and finds forced blocks (§2.4) reliably.

**Built:** `ai/sampler.ts`, `ai/playout.ts`, `ai/pimc.ts`, `ai/worker.ts` and the
`useRecommendations` hook. The UI now reports a win rate over simulated deals instead of
a heuristic score, and keeps the heuristic's reasons as the rationale — the search ranks,
the heuristic explains.

**It clears the rung.** Both seats, seeds 7 and 8, 200 games each:

| Matchup | Result |
|---|---|
| PIMC(40 worlds) vs Phase 2 agent | **56.5% ± 3.5** (n=784) |
| PIMC(100 worlds) vs Phase 2 agent | **55.5% ± 3.5** (n=786) |
| PIMC(100 worlds, CRN) vs Phase 2 agent | **57.9% ± 3.4** (n=788) |
| PIMC(300 worlds, CRN) vs Phase 2 agent | **58.9% ± 3.4** (n=783) |
| PIMC(100 worlds) vs random | **79.5%** (heuristic manages 66%) |

**More worlds barely helped at first** — 40 and 100 were indistinguishable — because
sampling noise was swamping the difference. Once common random numbers removed that noise,
300 worlds did beat 100. The remaining bottleneck is the quality of the playout policy.

**The sampler is simple, and §3's warning did not apply.** Phase 2 measured constraints as
loose, so rejection sampling was tried first: **0.41% of attempts get stuck and restart**,
across 5368 worlds sampled over 671 real positions. The most-constrained-first ordering
with capacity-weighted choice is enough; the backtracking sampler §3 asks for would have
been unnecessary complexity. Every emitted world is checked against every hard constraint —
hand sizes, the 28-stone partition, the 4/5 cap including already-played stones, pass bans,
and every proven assignment.

**The search prices risk the heuristic cannot.** In the §2.4 block scenario the heuristic
says "we are about 6 pips on the right side of the split", working from the average hidden
pip. The search says 93.3%, and that number is exactly right: of the C(6,2) = 15 pairs
partner C could hold, exactly one — `6-6` + `5-6`, 23 pips against our 3 — loses the block.
14/15 = 93.3%. The unit test asserts this, because it is the clearest demonstration of what
determinization buys over a point estimate.

**Common random numbers, and they are worth real points.** Every candidate is evaluated
against the same sampled deals *and the same policy coin-flips*, by seeding a fresh RNG per
world and reusing it across candidates. Without this, one move can simply draw luckier
playouts than another. Measured against the Phase 2 agent:

| Worlds | Shared stream | Per-world seeds (CRN) |
|---|---|---|
| 100 | 55.5% | **57.9%** |
| 300 | — | **58.9%** |

Note that with CRN the search also starts to reward more worlds, which it did not before —
variance was masking the signal.

**Cost:** a 300-world search over 3 candidate moves takes ~190 ms, in a Web Worker, so the
UI never blocks. Beliefs are derived once per decision, never inside a playout — that alone
would cost more than the playouts it informs.

---

### Phase 4 — Likelihood weighting: the soft tells  ✅ DONE

Handles "partner played a 6, so he probably has more 6s" and "he took the 6 end over the
2 end, so he may have no 2" — **without hand-coding either rule.**

Instead of hard-filtering worlds, weight them by how well they explain the observed play:

```
weight(world) = ∏  P_policy( observed_move | that player's hand in this world, position then )
```

`P_policy` is the Phase 1 heuristic, softmaxed into a distribution. Then average the
Phase 3 evaluations *weighted* by this. It is a particle filter, and both examples fall
out of it for free:

- Worlds where partner is 6-heavy assign higher probability to his 6-play → upweighted.
- Worlds where partner held a playable 2 would have given that move real probability
  mass; observing the 6-play instead makes them less likely → downweighted.

**The opening move gets its own likelihood model**, because it answers a different
question — hand shape, not end control:

```
P(open s | hand H) ∝ exp( β · openScore(s, H) )
openScore(v-v) ≈ count of v in H              // doubles preferred
openScore(a-b) ≈ max(count a, count b) − δ    // non-doubles penalised
```

Worth a small extra term: **which** partner opens in a later game is weak evidence that
their hand is the more concentrated one — a free prior at ply zero, when we know least.

**Why soft weights instead of rules:** the conventions are practice, not law. If B opens
`5-5` and then passes on fives, the Phase 2 constraint drives every 5-heavy world to
weight zero and the prior is overwritten automatically. The soft prior governs while it is
the only evidence; hard deduction evicts it the moment it is wrong. No special-casing.

**Two correctness traps:**
- Skip forced moves entirely (§2.7) — weight factor 1. Both correct and most of the
  speedup.
- Score each historical move from *that player's* information at *that* time. Using
  knowledge they did not have inverts the tells.

**Done when:** planted-tell scenarios shift the posterior in the right direction, and it
beats Phase 3 head-to-head in the harness.

**Built:** `ai/weights.ts` — the likelihood model, the opening model, tempering, systematic
resampling and Kish's effective sample size — wired into `recommend()` behind the move log.

**The tells work.** Measured directly against ground truth, over 11,972 hidden stones in
real positions: the probability the posterior assigns to a stone's *true* holder, versus
the uniform baseline of 39.2%.

| Setting | Posterior accuracy | Effective sample size |
|---|---|---|
| uniform (Phase 3) | 39.2% | 120 / 120 |
| β 0.06, temper 0.5 | 42.6% | 76 |
| β 0.15, temper 0.5 | 44.9% | 50 |
| β 0.30, temper 1.0 | 49.4% | 18 |
| β 0.60, temper 1.0 | **50.6%** | 13 |

That is up to a **29% relative improvement** in locating hidden stones, with no rule about
sixes or ends written anywhere — it falls out of asking which deals would have made the
observed moves likely.

**But there is a tax, and it is the reason the first attempt gained nothing.** Sharper
likelihoods concentrate the weight on a handful of worlds, so the effective sample size
collapses — at β 0.6 a 120-world sample is worth 13. The search gets much better-aimed
worlds and much noisier estimates from them, and the two roughly cancelled: the first
weighted build measured **50.3% ± 3.5** against plain PIMC, a dead heat.

**Attempted fix: oversample and resample.** Sampling is cheap (~1 ms per 100 worlds) and
playouts are not. So draw a pool 4× the playout budget, weight it, then systematically
resample down to the budget. Every playout then lands on a world worth playing, and the
worlds arrive equally weighted again.

**It works — but only mild, and only with resampling.** Against plain PIMC, both seats,
150 games per seat per seed:

| Configuration | Result |
|---|---|
| β 0.06, temper 0.5, no resampling | 50.3% ± 3.5 |
| β 0.30, temper 1.0, 4× oversample + resample | 45.4% ± 4.0 |
| β 0.30, temper 1.0, 4× — after the forced-opening fix | 46.4% ± 4.0 |
| **β 0.06, temper 0.5, 4× — after the fix** | **56.2% ± 4.0** |

Three things had to be true at once, and getting any of them wrong made the whole phase look
worthless:

1. **Oversample and resample.** Weighting alone trades better-aimed worlds for a collapsed
   sample size and nets zero. Drawing a pool 4× the playout budget and systematically
   resampling down to it spends every playout on a world worth playing.
2. **Keep the likelihood mild.** Sharp settings locate hidden stones *better* (50.6% vs
   42.6% posterior accuracy) and still play *worse*, because they concentrate the mass on a
   handful of deals — resampling recovers the playout budget, not the lost information. A
   pool with an effective sample size of 18 resampled to 100 worlds is still 18 distinct
   deals wearing 100 hats.
3. **Do not read a forced opening as a tell.** See the fourth correctness trap below.

**Shipped on**, with the mild defaults. The intermediate conclusion — "Phase 4 does not
help, ship it off" — was drawn from measurements that were each individually sound and
collectively misleading, and it took the forced-opening bug turning up on review to prompt
the re-measurement that overturned it. Worth remembering: a null result from a pipeline with
three interacting settings is evidence about *that configuration*, not about the idea.

**Two correctness traps, both real:**
- Forced moves are skipped (§2.7) — weight factor 1.
- Historical moves are scored from *that player's* information at *that* time.

A third one the design did not anticipate, caught by the pass-tell test: the observed move
must be matched to a candidate **by the position it produces, not by the side it was played
on**. Move generation collapses the two sides when they lead to the same end-pair (§2.1),
so a stone logged on the right legitimately appears as a left-side candidate. Matching on
`side` silently scored those worlds as impossible — effective sample size 40 instead of 222.

And a fourth, found on review: **game 1's opening is forced, so it is not a tell either.**
The opening model treats the first move as a free choice among seven stones, which is right
for later games but wrong for game 1, where the opener must play `1-1`. Left uncorrected it
read a forced `1-1` as evidence of a one-heavy hand — precisely inverted. `WeightOptions`
now takes `forcedOpeningStoneId`, and there is a test showing the same position produces a
tell when the opening was free and none when it was forced.

**The partner-choice prior is implemented too** (`openerAlternative`): in a later game
either member of the winning team may open, and which one took it is weak evidence about
whose hand was the more concentrated. Weighted at 0.4 of the stone-choice signal, because
it is one bit at ply zero.

*Small known gap:* that term is skipped when the alternative opener is us. It need not be —
our own hand is known, so comparing it against the opener's hand in each world is still
informative, and `world.hands[me]` already holds the right thing. It was left alone rather
than shipped unmeasured, since the value of this whole phase had just been established by a
measurement of the current code.

---

### Phase 5 — Exact endgame + tuning  ✅ DONE

**Endgame solve.** Once hands are short and Phase 2 has pinned enough stones, the tree per
sampled world is small enough to solve exhaustively. Swap the playout for full minimax
with memoisation. Domino games are decided in the endgame, and this is where approximate
evaluation is weakest. When Phase 2 has resolved the deal completely, the answer is not a
recommendation but a **proof** — "forced win in 4" — and the UI should say so.

**Built** in `ai/endgame.ts`: memoised minimax over the four seats, with the position keyed
canonically (the chain is irrelevant, only the ends — §2.1), sides collapsed as in move
generation, a node budget so it can never hang, and a check for a hand that is already
empty when the caller hands over the position.

**Verified by playing its own answers out.** 266 solved positions were walked to the end
with every seat following the solver's own recommendation, and the game finished with the
exact value predicted at the root, every time. Comparing against a heuristic playout would
have proved nothing — "proven loss" means loses to *optimal* play, and a playout opponent
is not optimal. That distinction cost one wrong test before it was noticed.

**It is far cheaper than the design assumed.** Cost per solve, measured on sampled worlds
from real games, against a playout at roughly 0.2 ms:

| Stones left in play | 10 | 14 | 16 | 18 | 20 | 22 | 24 |
|---|---|---|---|---|---|---|---|
| Nodes | 9 | 43 | 84 | 200 | 638 | 1,857 | 5,969 |
| Time | 0.08 ms | 0.08 ms | 0.21 ms | 0.36 ms | 0.85 ms | 2.5 ms | 8.4 ms |

At 16 stones an exact solve costs about the same as the rollout it replaces, and every
sampled world solves inside the budget.

**The caveat the design does not mention.** Solving a *determinized* world exactly assumes
every opponent can see the whole deal — which is precisely the strategy fusion §3 warns
about for playouts. The playout policy deliberately shows each simulated player only their
own hand; an exact solver cannot. The design's escape hatch is "when Phase 2 has resolved
the deal completely" — but Phase 2 measured only 14% of stones pinned even at 24 played, so
that case effectively never arrives. Whether exact evaluation of guessed worlds helps or
hurts is therefore an empirical question, not a theoretical one, and it was measured rather
than assumed.

**Measured, and the fusion caveat is visible in the numbers.**

| Comparison | Result |
|---|---|
| endgame(16) vs plain PIMC | 51.8% ± 4.0 (n=591) |
| endgame(16) + weighting vs plain PIMC | 51.5% ± 4.0 (n=592) |
| endgame **off** vs random-legal | **77.5% ± 3.0** (n=742) |
| endgame **16** vs random-legal | **73.7% ± 3.2** (n=734) |

And the direct comparison, in the configuration the app actually ships, weighting on for
both sides:

| Comparison | Result |
|---|---|
| endgame(16) **vs** endgame(off), head to head | **47.5% ± 4.5** (n=474) |

**Shipped off.** Three measurements: +1.8 against a heuristic opponent, −3.8 against a
random one, −2.5 head to head. Two of the three point the same way, the most direct one
points that way, and the theory predicted it before any of them were run. Solving a
*determinized* world assumes every opponent can see the deal and play perfectly, and that
assumption is wrong about the opponents it is applied to — more wrong about a random player
than a heuristic one, which is exactly the gradient the numbers show.

None of the three is individually significant, and it would have been easy to keep the
solver on the strength of the one positive result. The reason not to: the negative results
agree with the mechanism, and there is no mechanism by which fusion would help.

`endgame.ts`, its eight tests and the `exactWorlds` plumbing all stay.
`DEFAULT_ENDGAME_THRESHOLD` is 0; pass `endgameThreshold: 16` to enable it. The **solved** badge in the UI
still fires, because playing your last stone is resolved exactly by the same path.

**Weight tuning.** Hill-climbing or cross-entropy over the Phase 1 feature weights, scored
by win rate in the harness. Stop hand-guessing numbers.

**Built** in `ai/tuning.ts` — cross-entropy rather than hill climbing, because the fitness
signal is noisy and fitting a distribution over whole weight vectors copes with that far
better than trusting one noisy comparison per step. `countOut` is excluded from tuning: a
forced win must always dominate, and that is a structural fact, not a parameter.

**It found nothing. Twice.** Evaluated on held-out seeds, both seats, against the hand-set
weights:

| Run | Budget | Held-out result |
|---|---|---|
| 24 pop x 12 gen x 400 games | ~77k games | **50.00% ± 0.90** (n=11,773) |
| 24 pop x 10 gen x 2000 games | ~960k games | **49.62% ± 0.90** (n=11,757) |

The first run's in-training scores looked like progress — "best 55.0%" at generation 7 —
and that was **entirely selection noise**: 400 games gives a standard error near 2.5%, so
taking the maximum of 24 candidates buys about +5% for free. Raising the evaluation budget
5x removed the illusion, and the honest answer came out flat.

The tuned vectors are not absurd (starve 47 vs 40, pipShed 1.0 vs 0.6, selfBlock -66 vs
-34) — they simply do not play any better. **The hand-set weights were kept.**

Two things this says, both worth more than a tuned number would have been:
- The weights sit on a plateau. Phase 1's ablation already pointed here: three terms carry
  the signal and the rest are inside the noise, so there is little for a tuner to grip.
- Any future tuning report that quotes an in-training score is meaningless. Only held-out
  seeds count, and the harness now makes that easy.

**Match-aware risk.** Use `seriesScore` from Phase 0 to shift the risk/variance tradeoff
near match point.

**Implemented, after the ruleset was corrected.**

This was first written off. The reasoning was: a match is a race to N game-wins, games are
independent, so match-win probability is strictly increasing in per-game win probability at
every score, and variance never matters. That argument is sound — and it was answering the
wrong question, because the match is **not** a race to N game-wins. It is a race to 101
**points**, and a game is worth the pips the losers are caught holding.

Under the real rules margins are the payoff, so:

- `matchValue()` in `scoring.ts` discards points neither side can use. At 95–40, a 30-point
  game and a 6-point game both end the match, so there is nothing to gain by preferring the
  riskier line — and symmetrically, when a long way out, a 40-point win really is worth
  nearly seven times a 6-point win.
- The terminal value throughout the engine became points rather than a win flag. That is
  the deeper change; see §9.

**The lesson worth keeping** is not about dominoes. The original analysis was rigorous, and
its conclusion was still wrong, because it inherited an unverified premise about how the
game is scored — a premise §6 had flagged as an *open question* and which nobody had
answered. Rigour applied to an unchecked assumption produces confident, well-argued error.

---

## 5. Testing strategy

Build this **during Phase 1**, not at the end. Without it, every later phase is tuned
blind.

- **Self-play harness.** The game logic already exists; wrap it headless and run thousands
  of games. Engine-version vs engine-version gives an unambiguous answer to "did that
  change help?"
- **Baseline ladder.** random-legal → Phase 1 heuristic → Phase 3 PIMC → Phase 4 weighted.
  Each rung must beat the one below it by a clear margin. If it doesn't, something is
  wrong — usually the sampler.
- **Seeded RNG.** Every run reproducible, or debugging a bad recommendation is hopeless.
- **Belief unit tests.** Hand-built scenarios with the deductions worked out on paper.
  This is where correctness actually lives.
- **Sampler invariant test.** Every emitted world satisfies every hard constraint. Run it
  on the tightest late-game states you can construct.

---

## 6. Decided and deferred

**Decided: no deception.** Opening with your strongest double leaks information, but it is
genuinely strong play — it seizes the suit you can serve most often. Deception only pays
against opponents modelling you closely enough to exploit, and against humans playing the
convention, playing the convention is right.

**Deferred: opponent-specific modelling.** Per-player policy parameters learned across a
match ("D hoards doubles far longer than average") are a real edge, but they need Phase 4
working and a meaningful amount of logged play first.

**Closed: draws.** A tied block is a *seka* — nobody scores, both teams' pips go into a pot,
and the next winner collects it (§1). Implemented in `scoreGame`. Within a single game the
terminal value of a seka is 0, which is right: the pot's value belongs to a later game.

*Still open, and now it matters in three places.* The engine currently values a draw at 0,
between a win (+1) and a loss (−1), which is right if a tied block scores nothing for either
side and effectively means replaying. If instead a tie is broken somehow, or scores for one
side, then `playout.ts`'s `valueOf`, the endgame solver's `blockedValue`, and the
risk-neutrality argument in Phase 5 all need revisiting together.

**Closed, and it was wrong: the match is scored in points.** This was listed as the single
assumption that would most change the engine if wrong. It was wrong. See §9.

**Deferred, and the clearest remaining idea: solve the endgame as a best response, not as
minimax.** The exact solver assumes every opponent sees the whole deal and plays perfectly.
That is what makes it fusion-prone, and it shows up in the measurements — it gains slightly
against a heuristic opponent and loses against a random one, because the optimal-play
assumption is less wrong for the former. The principled fix is to keep exact search for
*our* moves but have opponents follow the Phase 1 policy from their own hand only, which is
expectimax against a fixed policy rather than minimax. That removes the fusion in the
opponent model while keeping the endgame exact where it matters, and every piece needed for
it already exists.

**Deferred, now unblocked: opponent-specific modelling.** Phase 4's machinery is the natural
home for it — `POLICY_BETA` is currently one global constant standing in for "how closely
does this player follow the heuristic", and it could be per-player and learned across a
match. Phase 4 measured no win-rate gain from better inference, so this should be expected
to improve the *displayed reasoning* more than the strength.

**Learned: measuring carefully is not the same as measuring the right thing.** Several phases
were correctly measured against an objective that turned out not to be the game's. See §8
for the ladder and §9 for what the correction changed.

---

## 7. Order of work, one line each

0. Fix the opener, add match state, snapshot the ends. **Stop discarding information.**
1. Move generation + explainable heuristics + the self-play harness. **Ship a useful advisor.**
2. The certainty engine. **Sound, and it powers the UI's certainty claims — but worth no measurable win rate on its own.**
3. Sampler + PIMC in a worker. **Strategy emerges — +5.5 points over Phase 2, and it prices risk the heuristic cannot.**
4. Likelihood-weighted worlds. **The soft tells are real, and worth +6 points — but only mild, and only once the pool is oversampled and resampled. Sharp weighting locates stones better and plays worse.**
5. Exact endgame + automated tuning. **The solver is exact and cheap and still shipped off — solving a guessed deal assumes opponents can see it. The tuner found nothing, twice, and the hand-set weights were kept.**

---

## 8. What the numbers actually said

Every claim below is a head-to-head measurement in the harness, both seats, on seeds not
used to make the decision. Read together they are a more useful summary of this engine than
the design was.

| Step | Against | Result |
|---|---|---|
| Phase 1 heuristic | random-legal | 66.2% |
| Phase 2 certainty engine | Phase 1 | **50.3% ± 0.6** — no gain |
| Phase 3 PIMC | Phase 2 | **58.9% ± 3.4** |
| Phase 3 + common random numbers | Phase 2 | 55.5% → **57.9%** |
| Phase 4 weighting, mild, no resampling | Phase 3 | 50.3% ± 3.5 — no gain |
| Phase 4 weighting, sharp, resampled | Phase 3 | 46.4% ± 4.0 — worse |
| **Phase 4 weighting, mild, resampled** | Phase 3 | **56.2% ± 4.0** — shipped on |
| Phase 5 exact endgame at 16 stones | endgame off, head to head | **47.5% ± 4.5** — shipped off |
| Phase 5 tuned weights | hand-set weights | **49.6% ± 0.9** — no gain |
| Search only, weighting off | Phase 2 agent | 56.0% ± 4.0 |
| **Shipped engine** | Phase 2 agent | **64.9% ± 5.0** |
| **Shipped engine** | Phase 1 heuristic | **65.9% ± 5.0** |
| **Shipped engine** | random-legal | **77.9%** |

**Two of the six phases moved the number. Two produced nothing. One is shipped off because
it measured negative.** That is not a failure of the plan; it is the plan working. Each was
cheap to test precisely because Phase 1 built the harness first, and each verdict is a fact
rather than an opinion.

Three things are worth carrying out of this:

**The search is where the strength is.** Phase 3 moved the number, and the variance
reduction inside it (common random numbers) moved it again. Phase 4 only paid once it was
made to *preserve* sample size rather than trade it away.

**A null result is about a configuration, not an idea.** Phase 4 measured 50.3%, then 45.4%,
and was written off — the design doc said so in as many words. It is worth +6 points. What
changed was one bug and one variance fix, neither of which touched the idea. The same
caution now applies in the other direction to the endgame solver, which is shipped off on
three weak measurements that happen to agree with theory.

**Better knowledge is not automatically better play.** Phase 2 deduces soundly and gains
nothing. Sharp Phase 4 weighting locates hidden stones *better* than mild weighting and
plays *worse*. Exact endgame evaluation is more accurate than a rollout about a deal that is
mostly guessed, and costs points. Every one of those is the same lesson: the estimator has
to stay honest about what it does not know.

What Phase 2 and Phase 4 also buy is honesty in the interface: the PROVEN badge means a
deduction, the win rate means a count over deals, and the impossible-log warning means the
log genuinely cannot be explained.

---

## 9. The scoring correction

Everything above §9 was built against the wrong objective, and this section records
the correction because the mistake is more instructive than the fix.

**What was assumed:** a game is worth one point, and a match is a race to N game-wins.
Nobody ever said so. It was a plausible default, filled in when the ruleset in §1 did not
mention scoring, and then quietly load-bearing for six phases.

**What is actually true:** the winning team scores the pips left in the **opponents'**
hands — their partner's stones do not count against them — and the match runs to **101
points**. A block level on pips is a *seka*: nobody scores, both teams' pips go into a pot,
and the next game's winner collects it on top of their own score.

### What that changed

| Piece | Before | After |
|---|---|---|
| Terminal value | win +1, draw 0, loss −1, plus a 0.002/pip tiebreaker | the points actually scored |
| Blocked game | ±1 for the lighter team | the opponents' pips to the lighter team |
| Forced-block feature | "do we win the split?" | "what is the block worth in points?" |
| Ladder metric | win rate | **net points per game** |
| Tuner objective | win rate | net points per game |
| Match state | games won, first to 3/5/7 | points, first to 101, plus a seka pot |
| End of game | only a block asked for the hands | **every** game does — the score is the losers' pips |

The pip margin had been a *tiebreaker worth 0.002 per pip*, deliberately tiny, described in
Phase 3 as "a gradient instead of a cliff". It was the payoff the whole time.

### Measured again, on the metric that now matters

| Matchup | Net points per game |
|---|---|
| Phase 1 heuristic vs random | **+10.22** |
| Phase 2 certainty engine vs Phase 1 | +0.23 — still nothing |
| **Shipped engine vs Phase 2 agent** | **+8.06** |

The ordering survived the correction, which is reassuring but not surprising: playing to
win games and playing to win points agree most of the time. They part company exactly where
it matters — whether to dump `6-6` early, whether a narrow block beats a risky run at going
out — and those are the decisions the engine now gets right for the right reason.

### Two things this cost, and one it bought

**Cost:** Phase 5's match-aware risk analysis concluded, with a correct proof, that
risk-neutral play is optimal at every score. The proof assumed a race to N game-wins. It is
now implemented instead — `matchValue()` discards points neither side can use, so at 95–40
a 30-point game and a 6-point game are worth the same and the safer line wins.

**Cost:** §6 listed "is a game worth one point or the loser's pips?" as an open question
from the very first phase, and six phases were built on top of it anyway. The question was
asked and never chased.

**Bought:** the engine now reports **expected points** per move rather than a win rate, and
that is a far more useful number to a human — "+18 pts" says something "62% wins" cannot,
because at 101-a-match the size of a win is most of its value.

### The lesson

Ask about scoring before building an evaluator. An engine is a machine for maximising a
number; if the number is wrong, every measurement above it is measuring the wrong race
carefully. The harness, the ladder and the ~1M-game tuning runs were all sound — and all
pointed at a target nobody had confirmed.

---

## 10. The writing threshold

A second scoring rule, learned after §9: **a game worth less than 13 is not written down.**
It hangs in the air against the team that won it and accumulates there. A later win of 13 or
more banks everything hanging at once. A win of 13 or more by the *other* team wipes it.

### Why this is not a rounding rule

It makes the payoff **discontinuous**. Consider a team sitting on 30 in the air:

| This game is worth | Written | Air after |
|---|---|---|
| 12 | 0 | 42 |
| 13 | **43** | 0 |

One extra pip is worth 43 points. No amount of care with the average margin finds that —
an evaluator that maximises expected pips will happily take a line worth 12.4 over one worth
12.9, and both over a riskier line worth 13. `matchValue()` in `scoring.ts` now prices it:
a sub-threshold win is worth `AIR_WEIGHT × points`, a threshold win is worth
`points + your air + AIR_WEIGHT × their air`.

### The one judgement call

`AIR_WEIGHT = 0.5` — how much a point in the air is worth against a point on the board.
Everything else in this file is a rule; this is an estimate. Air is not yours yet: it needs a
later 13+ win to bank, and a 13+ win against you erases it. Half seems a fair price for that,
and it is a single constant to revisit if the engine looks too eager or too shy about small
wins.

### What it changes about play

The threshold gives the engine a reason to **prefer a bigger win over a surer one** when the
likely margin sits near 13, and a reason to **avoid conceding a 13+ game** when holding air —
which is exactly the moment a human would also play differently. Both fall out of the value
function; neither is coded as a rule.

### Where the assumption is

The rule was described as: *"if again score is less than 13, that team score is summed with
previous, but not written."* Read literally, the 13 test is on **each game's own score**, not
on the running total in the air — so 12 then 9 leaves 21 hanging rather than banking on the
second game. That is how it is implemented. If your table tests the *accumulated* total
against 13 instead, `applyGameScore` is the only place that changes.

---

## 11. Validation everywhere, not just for your own hand

The deduction engine has known since Phase 2 exactly which stones each opponent could still
be holding. Until now that knowledge only reached the recommendations. It now also drives
the move logger, which is where it prevents mistakes rather than merely informing them.

**When you log an opponent's move, only the stones they could actually hold are offered.**
Everything §2 proves is applied: values they have passed on, the four-per-value cap counted
against what they have already played, the four-doubles cap, hand sizes, and every
assignment those force. If D has already played four sixes, the fifth is not on the list —
only `6-6` is, exactly as the rules require.

That closes a real gap. The recommendation was already sound; the *input* was not, and a
mis-logged move poisons everything downstream — beliefs, sampling, the search, and the
impossible-log warning that is supposed to catch it.

**A new rule, and a new deduction: a hand holds at most four doubles.** Enforced in three
places that must agree, so they share one constant: entering your own hand (the fifth double
greys out), dealing in the harness, and `deriveBeliefs`, where "played four doubles" now
proves "holds no more". The belief soundness test still passes — 3,750 stones pinned across
16,456 real positions with zero false claims.

**Every filter is escapable.** A deduction is only as good as the log it rests on, and a
mis-logged move that never produced a contradiction could hide a stone a player really does
hold. Both the move logger and the blocked-game reveal say how many stones they are hiding
and offer *Show all anyway*. The engine should never be able to make the app unusable
because it is confident and wrong.

---

## 12. Playing for your partner

The engine scored every position as if it were playing alone. It knew who its partner was —
`feedPartner` had always penalised shutting them out — but it had no notion that a partner
is a *resource*, and it never read anything from what the partner chose to play.

The report was concrete: "D started with 1-1. C (partner) played 1-6. B played 6-6. In my
hand there are 1-6, 1-2, 6-2. You recommend to hit 6. But ideally in practice it is good to
play for partner, because he is beyond me — he has 6 stones left, I have 7, he can clear his
hand earlier than me. So why should I hit 6? My partner played 6 and the chance is bigger he
has more 6s in hand." With the caveat that makes it a real rule rather than a hunch: "if he
passes on 6-6, of course this is cleared."

That is two separate claims, and they did not measure the same.

### The half of a stone that means something

The first attempt tallied both halves of every stone the partner had played. It measured
neutral, and a hand-built test of the reported position showed why: `1-6` contributed a 1
*and* a 6, so both candidate moves scored identically and the term cancelled.

The fix is §2.7 applied one level down. C did not choose to play a 1 — a 1 was the only
open end, so that half was forced. What C chose was which of their 1s to spend, and the
answer was the one carrying a 6. **The half a stone answers is forced; the half it exposes
is the choice, and only the choice carries information.**

So `PlacedStone` now records `exposed` — the value(s) the placement left showing, both for
an opening stone, one for everything after. `playedByPlayer` tallies that instead of the
whole stone. The same distinction Phase 4 already made about whole moves, made about the
two halves of one move.

With the corrected signal the term went from nothing to worth having.

### What measured, and what did not

Sweeps of both weights, 6,000 games each on tuning seeds, confirmed on 12,000 games of
held-out seeds, always against the identical engine with the terms switched off:

| | value |
|---|---|
| `partnerSuit` — read their long suit and leave it standing | **+0.66 net points/game** at 4 |
| `partnerAhead` — feed the partner harder when they are closer to out | **0.00** at 2, **−0.5** by 12 |

The suit read is real and the curve is smooth, peaking at 4 and falling off either side.
The "he is closer to going out" tilt is not: it is free at 2 and costs half a point a game
by 12.

The reason is worth stating, because the intuition is not silly. Ends rotate through all
four players. Leaving an end your partner can answer does not hand them a turn they would
not otherwise get — it changes *which* stone they spend on a turn they were going to take
anyway. Being three stones ahead makes their hand more valuable to protect, but not three
times more valuable to feed, and the existing `feedPartner` term was already paying for
most of it.

It ships at 2. It is worth nothing measurable there and it keeps the reasoning visible in
the explanation, which is the thing the user is actually reading. Where the table and the
intuition disagreed about magnitude, the table set the number.

### The pass clears it

A pass beats the read outright, in both halves and by construction. `pCannotPlay` already
returns 1 for a value a player has passed on, so `feedPartner` collapses to a shut-out
penalty. And the suit tally skips banned values entirely, so the moment C passes on 6 the
bonus for leaving a 6 standing disappears — not decayed, gone. Exactly as reported: "if he
passes in 6-6, of course this changes is cleared, and don't open any 6 for partner anymore,
if need play for yourself."

There is a permanent test for each of those, built on the reported position.

### Verified in the app, on the reported position

Logged through the UI exactly as described — D opens `1-1`, C plays `1-6`, B plays `6-6` —
the recommendation now reverses. `1-2 on the right end — leaves 6 | 2` is **BEST** at −2.4
expected points, ahead of `2-6 on the left end` at −4.4. That is the move that leaves the 6
standing instead of consuming it, which is what was asked for, and the reasons say so:

> - Leaves an end C can probably answer — and they are 1 stone closer to going out than
>   you, so it is their hand worth feeding.
> - C has already played 1 stone carrying 6, so that is likely their strong suit — worth
>   leaving open for them.
### Inside the search, it is not measurable either way

The heuristic is only the prior and the playout policy once Phase 3 is running, so the
number that matters for the *shipped* engine is a search-level one. That ladder — the full
weighted PIMC agent against itself with the partner terms switched off, 1,000 games at 80
worlds — came back at **−0.03 net points/game**.

Dead centre, and honestly uninformative: at that sample size the noise is far wider than
the effect being looked for, so this run does not distinguish a small gain from a small
loss. A larger paired run with an actual error bar was started and stopped before it
produced data, so that number stands as the only search-level evidence there is.

The most likely reading is the one §8 already recorded for Phase 2: the search decides by
simulating outcomes, so a better prior moves the ranking less than it moves the standalone
heuristic. What is established is narrower than "this makes the engine stronger":

- The suit read is worth **+0.66 net points/game as the heuristic** — measured, held out.
- Inside the search it is **not shown to help, and not shown to hurt**.
- It changes the recommendation on the reported position, in the direction asked for, and
  explains itself in the user's own terms.

It ships on the strength of the first and third. The second is an open question, not a
result, and it should not be written up as one.

---

## 13. Styles, and a measurement tool that can see small differences

§5's tuner ran roughly a million games and found nothing. That verdict stands, but it was
answering a narrow question with a blunt instrument, and both halves of that are worth
fixing.

### The instrument: paired, mirrored deals

`runLadder` plays one set of deals with A on A+C and a *different* set with the seats
swapped, then compares two aggregates. Most of what it measures is which hands each side was
dealt, which is why §5 needed ~12,000 games to resolve ±0.9%.

`experiment.ts` plays every deal **twice** — once each way round, sharing the random stream —
and takes A's net points averaged over the two seatings as the per-deal statistic. The deal
and the seat both cancel. Identical agents now score *exactly* zero on every deal, not zero
on average, which is asserted as a test rather than hoped for.

The gain is large. Error bars per pair, previously ±0.9% win rate over ~12k games:

| Deals | Games | Standard error |
|---|---|---|
| 2,000 | 4,000 | ±0.3 net points/game |
| 4,000 | 8,000 | ±0.19 net points/game |

Roughly a third of the games for an error bar tight enough to see half a point.

### The question: styles, not perturbations

The tuner sampled weight vectors around the shipped point at ~60% spread. That asks "is
there a better point *near* this one". It never asks whether the shipped weights are the
right *kind* of player. `styles.ts` defines seven archetypes a domino player would name,
each pushed far past anything a local search would propose.

Round-robin, 2,000 deals per pair, every pair on the same deals, heuristic agents:

| Style | vs field | vs shipped, head to head |
|---|---|---|
| **doubles-first** | **+3.69** | **+0.20** (z=0.8, not significant) |
| shipped | +3.36 | — |
| blocker | +2.58 | −0.88 (z=2.7) |
| shedder | −0.56 | −3.31 |
| flexible | −1.05 | −3.50 |
| greedy-pips | −2.99 | −5.29 |
| partner-first | −5.02 | −7.40 |

**Held out**, 4,000 fresh deals on an unseen seed: `doubles-first` vs shipped =
**+0.45 ± 0.19 net points/game (z=2.3)**.

Three things this says.

**The shipped weights are nearly the best of the styles, and the field ordering is not
noise.** Every archetype except one is worse, most of them by margins of 3 to 7 points a
game. The plateau §5 found is a plateau near a good point, not a flat landscape.

**`partner-first` is the most expensive instinct on the board** — −7.4 points a game against
the shipped weights. That is the same finding §12 recorded for `partnerAhead` from the other
direction: the ends rotate through all four players, so feeding your partner does not
shorten their hand the way it feels like it should. Pushed to an extreme it is a disaster.

**Doubles may be underweighted.** `doubles-first` differs from shipped in three weights
(`deadDouble` −120 vs −25, `thinDouble` −50 vs −7, `pipShed` 1.5 vs 0.6) and beats it by half
a point a game on held-out deals. This is the first positive tuning signal the project has.

### What it is not, yet

The result is at the **heuristic** level. The app ships PIMC, where these weights shape the
playout policy and the displayed rationale rather than the final ranking directly, and §8's
lesson is that heuristic-level gains do not automatically survive contact with the search —
Phase 2 deduced better and gained nothing, and §12's suit read measured +0.66 as a heuristic
and dead flat inside the search.

So this is not adopted. What is needed before it is:

1. **Attribute it.** Three weights moved; sweep `deadDouble` and `thinDouble` one at a time
   to find where the curve actually peaks, rather than adopting an archetype whole.
2. **Re-measure at the search level.** `pimcAgent(w)` against `pimcAgent(DEFAULT)`, paired,
   with an error bar tight enough to see half a point — about 1,000 deals at 60 worlds.
3. Only then change `DEFAULT_WEIGHTS`.

Run any of it with `npm run experiment` (`DEALS`, `HELD_OUT_DEALS` override the defaults).

---

## 14. Attributing the one positive weight result

§13's round-robin left a candidate: `doubles-first` beat the shipped weights by
+0.45 ± 0.19 on held-out deals. That style moves three weights at once, so the first job was
to find out which one carried it. Sweeps are on 3,000 paired deals per point, heuristic
agents, all against the shipped weights.

**The double terms are inert.**

| `deadDouble` | −25 (shipped) | −60 | −120 | −160 |
|---|---|---|---|---|
| net pts/game | 0.00 | +0.00 | +0.00 | +0.00 |

| `thinDouble` | −7 (shipped) | −25 | −55 | −75 |
|---|---|---|---|---|
| net pts/game | 0.00 | +0.00 | +0.00 | +0.00 |

Flat to two decimal places across a six-fold change. The guards on these terms are the
reason: the double's value must be off *both* new ends **and** unservable from the rest of
the hand before the term fires at all, which happens rarely enough that the weight almost
never reaches a decision. The mirrored ladder makes this legible instead of burying it —
when a weight changes no decision, the paired difference is exactly zero, so the answer
arrives as `0.00 ± 0.00` rather than as a small number inside a wide error bar.

**So `doubles-first` was never about doubles.** It also raised `pipShed` from 0.6 to 1.5.

| `pipShed` | 0.2 | 0.6 (shipped) | 1.0 | 1.5 | 2.5 | 4.0 |
|---|---|---|---|---|---|---|
| net pts/game | **−0.43** | 0.00 | +0.04 | +0.20 | **+0.22** | +0.17 |

| `starveOpponent` | 25 | 40 (shipped) | 55 | 70 | 90 |
|---|---|---|---|---|---|
| net pts/game | **−0.90** | 0.00 | +0.06 | −0.01 | −0.24 |

Both curves are single-peaked and both punish being set too low far harder than too high.
`starveOpponent` at 40 is essentially at its peak — worth noting, because it is the term
Phase 1's ablation identified as carrying most of the signal, and it was hand-set.

Together at their peaks (`pipShed: 2.5`, `starveOpponent: 55`):

| | net pts/game |
|---|---|
| training seed, 3,000 deals | +0.46 ± 0.25 (z=1.8) |
| **held-out seed, 6,000 deals** | **+0.62 ± 0.18 (z=3.4)** |

That is the first real positive weight result the project has, and it is worth being precise
about what it is: **half a point a game to the standalone heuristic**, on 12,000 games it has
never seen, from a change that mostly says *shed pips a little more eagerly than 0.6*.

It is also small enough to be beneath §5's old instrument entirely. A ±0.9% win-rate ladder
could not have seen it; that is why the tuner's two runs came back flat rather than pointing
here.

### And it does not survive the search

The candidate was then measured where it actually matters: the same weights driving the
playout policy inside PIMC, paired and mirrored, against the shipped weights doing the same
job.

| Configuration | Deals | Result |
|---|---|---|
| plain PIMC, 40 worlds | 2,000 | **−0.02 ± 0.35 pts/game** (z=−0.1) |
| likelihood-weighted PIMC, 40 worlds (the shipped shape) | 500 | −0.23 ± 0.73 (z=−0.3) |

Dead flat, and this time the error bar is tight enough to mean something: ±0.35 would have
shown a +0.62 effect at nearly two sigma, and the point estimate is −0.02. The half point the
heuristic gains is simply not there once a search is deciding.

**`DEFAULT_WEIGHTS` was left alone.** This is the fourth time the same pattern has come back
in this project, and it is now the most reliable thing known about it:

| Change | As the heuristic | Inside the search |
|---|---|---|
| Phase 2 certainty engine (§8) | sound deductions | 50.3% — nothing |
| Sharp likelihood weighting (§8) | locates stones better | plays worse |
| Partner's shown suit (§12) | +0.66 pts/game | flat |
| `pipShed` / `starveOpponent` (§14) | **+0.62 pts/game** | **−0.02 ± 0.35** |

The mechanism is the same every time. The search decides by simulating outcomes many times
over; the heuristic is a *prior* on those simulations, and improving a prior that is already
roughly right moves the argmax of an average far less than it moves a single greedy choice.
Anything that improves the standalone heuristic should now be assumed neutral inside the
search until measured, not the other way round.

One narrow exception is worth recording rather than acted on: the heuristic *is* what runs
when the move log is contradictory and the search is disabled, and it is the ordering behind
the fallback recommendation. `pipShed: 2.5, starveOpponent: 55` is worth +0.62 there and
costs nothing elsewhere. That is a real but small argument, it changes no ranking the user
normally sees, and it was left as a decision rather than taken quietly.

---

## 15. The best-response endgame: built, measured, and wrong in an interesting way

§6 called this the clearest remaining idea. `endgame.ts` solves a determinized world by
minimax, which assumes all four seats can see the deal — the strategy fusion §3 warns about,
and the reason the solver ships off. `bestResponse.ts` keeps the exact search for our own
move and replaces the other seats with the Phase 1 policy read from their own hand only.

**Building it turned up a modelling error the design doc shares.** The stated justification
was the inequality max_a min_b ≤ max_a E_{b~π}: replacing perfectly-playing opponents with a
fixed policy cannot be worth less to us. That was asserted as a test and it **failed** —
correctly. Minimax does not only give the opponents perfect play; it also gives *us* a
partner who plays perfectly on information they cannot possibly have. Taking that away is a
second, opposite change, and it can only reduce the value.

So the partner is a knob, and both variants are measured:

- `modelPartner: false` — B and D follow the policy, our seats still coordinate. The
  inequality applies to this one, and it holds on every random endgame tested.
- `modelPartner: true` — the honest model: the partner cannot see our hand either.

**Measured at 40 worlds, endgame at 16 stones, 250 paired deals each, all against the same
endgame-off reference.**

| Variant | vs endgame off |
|---|---|
| **minimax** (the fusion-prone one, shipped off) | **+1.03 ± 0.63** (z=1.6) |
| best-response, opponents only | −0.06 ± 0.62 |
| best-response, honest | −0.81 ± 0.61 |
| best-response, honest + greedy opponent model | −1.25 ± 0.57 (z=−2.2) |

| Head to head | Result |
|---|---|
| honest best-response vs minimax | −0.44 ± 0.69 |
| opponents-only vs minimax | −1.65 ± 0.77 (z=−2.1) |

**The ordering is monotone in exactly the wrong direction.** The more fusion is removed, the
worse it plays: +1.03, −0.06, −0.81, −1.25. Individually most of these are one to two sigma,
but four points falling in a straight line, with both head-to-heads agreeing in sign, is not
what a null looks like.

**Why, and it is not a defect in the implementation.** The opponent in these ladders is
another PIMC agent — it searches. A fixed heuristic policy is a *bad model of a searching
opponent*, and minimax's "they play perfectly" is a considerably better one. The fusion
critique is real, but it bites in proportion to how weak the opponent actually is, and §5's
own numbers already showed that gradient without it being read that way: minimax gained
+1.8 against a heuristic opponent and lost −3.8 against a random one. Strong opponent,
pessimism pays; weak opponent, pessimism throws away the traps they would walk into.

The lesson generalises past dominoes: an opponent model is not better for being more
principled. It is better for being closer to the opponent.

**What this changes about the endgame solver.** §5 shipped it off on three weak
measurements (+1.8, −3.8, −2.5) with error bars around ±4. This screen puts it at
**+1.03 ± 0.63** — same sign as the two positive ones, on a bar seven times tighter. That is
now the most likely-looking unclaimed gain in the engine, and it is a *configuration* change,
not new code. A confirmation ladder on a fresh seed is gated behind `CONFIRM=1`.

`bestResponse.ts` and its six tests stay: the honest model is the right tool the moment the
opponent is a person following convention rather than a searcher, and §6's opponent-modelling
work would make it the natural evaluator.
