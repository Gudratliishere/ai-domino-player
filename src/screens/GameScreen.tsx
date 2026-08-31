import { useMemo, useState } from 'react';
import { GameTable } from '../components/GameTable';
import { MoveLogger } from '../components/MoveLogger';
import { MoveHistory } from '../components/MoveHistory';
import { RevealHandsScreen, type RevealedHands } from '../components/RevealHandsScreen';
import { PlayerNamesEditor } from '../components/PlayerNamesEditor';
import { Recommendations } from '../components/Recommendations';
import { useRecommendations } from '../hooks/useRecommendations';
import { useI18n } from '../i18n';
import { generateFullSet } from '../lib/dominoSet';
import { candidatesFor, deriveBeliefs } from '../lib/ai/beliefs';
import { legalMoves } from '../lib/ai/moveGen';
import { openingRule } from '../lib/matchRules';
import { applyMove, logMove, replay } from '../lib/replay';
import {
  type GameScore,
  type Standing,
  WRITE_THRESHOLD,
  applyGameScore,
  pipSum,
  scoreGame,
} from '../lib/scoring';
import type { Stone } from '../types/domino';
import type {
  GameResult,
  LoggedMove,
  MatchState,
  PlayerId,
  PlayerNames,
  Side,
  TeamId,
} from '../types/game';
import { ALL_PLAYERS, TEAMMATE, displayName, teamLabel, teamOf } from '../types/game';

const MY_PLAYER_ID: PlayerId = 'A';
const ALL_STONES = generateFullSet();

interface GameScreenProps {
  initialHand: Stone[];
  opener: PlayerId;
  match: MatchState;
  names: PlayerNames;
  onRename: (names: PlayerNames) => void;
  onFinish: (score: GameScore) => void;
  onQuit: () => void;
}

export function GameScreen({
  initialHand,
  opener,
  match,
  names,
  onRename,
  onFinish,
  onQuit,
}: GameScreenProps) {
  const { lang, t } = useI18n();
  const [moveLog, setMoveLog] = useState<LoggedMove[]>([]);
  const [pendingStone, setPendingStone] = useState<Stone | null>(null);
  const [revealed, setRevealed] = useState<RevealedHands | null>(null);

  // Every visible fact about the board is derived from the log, so the log and
  // the screen can never disagree — and the engine will read the same log.
  const state = useMemo(() => replay(opener, moveLog), [opener, moveLog]);
  const hand = useMemo(
    () => initialHand.filter((s) => !state.playedIds.has(s.id)),
    [initialHand, state],
  );

  const usedStoneIds = useMemo(
    () => new Set<string>([...state.playedIds, ...hand.map((s) => s.id)]),
    [state, hand],
  );

  const forcedStoneId = openingRule(match, initialHand, MY_PLAYER_ID, { names }).forcedStoneId;
  const mustOpenWithId = state.chain.length === 0 ? forcedStoneId : null;
  const isMyTurn = state.turn === MY_PLAYER_ID;

  // No advice to give when the rules leave you no choice, or the game is over.
  const advisable = isMyTurn && state.winner === null && !state.blocked && !mustOpenWithId;
  const search = useRecommendations({
    opener,
    moves: moveLog,
    hand: initialHand,
    me: MY_PLAYER_ID,
    enabled: advisable,
    forcedOpeningStoneId: forcedStoneId,
    standing: { written: match.seriesScore, air: match.air, target: match.target },
    names,
    lang,
  });

  // The deduction engine proves the log impossible only if it really is, so this
  // is a reliable "you logged something wrong" signal rather than a guess. Cheap
  // enough to run on the main thread; the search itself is in the worker.
  const belief = useMemo(
    () => deriveBeliefs(state, hand, MY_PLAYER_ID, { openingStoneId: forcedStoneId }),
    [state, hand, forcedStoneId],
  );
  const impossible = belief.contradiction;

  // Stones each player could still be holding. Narrows both the move logger and
  // the blocked-game reveal, so neither offers a stone the log has ruled out.
  const possibleFor = useMemo(() => {
    if (belief.contradiction) return null;
    return {
      B: new Set(candidatesFor(belief, 'B')),
      C: new Set(candidatesFor(belief, 'C')),
      D: new Set(candidatesFor(belief, 'D')),
    };
  }, [belief]);

  function record(move: { playerId: PlayerId; type: 'play' | 'pass'; stone?: Stone; side?: Side }) {
    const logged = logMove(state, move);
    applyMove(state, logged); // throws on an illegal move before anything is stored
    setMoveLog((prev) => [...prev, logged]);
    setPendingStone(null);
  }

  function handlePlace(side?: Side) {
    if (!pendingStone) return;
    // A selection can outlive the position it was made in — a recommendation
    // clicked just as the board moved on, for instance. Drop it rather than
    // logging a stone that is already down.
    if (state.playedIds.has(pendingStone.id)) {
      setPendingStone(null);
      return;
    }
    record({ playerId: state.turn, type: 'play', stone: pendingStone, side });
  }

  function handlePass() {
    record({ playerId: state.turn, type: 'pass' });
  }

  function handleSelectStone(stone: Stone) {
    setPendingStone((prev) => (prev?.id === stone.id ? null : stone));
  }

  function handleUndo() {
    setMoveLog((prev) => prev.slice(0, -1));
    setPendingStone(null);
    setRevealed(null);
  }

  const partner = TEAMMATE[MY_PLAYER_ID];
  const opponents = ALL_PLAYERS.filter((p) => p !== MY_PLAYER_ID && p !== partner);
  const unseenStones = ALL_STONES.filter((s) => !usedStoneIds.has(s.id));

  // The game is over once someone empties their hand or all four pass — but the
  // score is the pips left in the losers' hands, so it cannot be worked out until
  // those hands are entered. That is true of a normal win as much as a block.
  const over = state.winner !== null || state.blocked;
  const score: GameScore | null = revealed
    ? scoreGame({
        winner: state.winner,
        hands: { A: hand, B: revealed.B, C: revealed.C, D: revealed.D },
        pot: match.pot,
      })
    : null;

  const result: GameResult | null = score
    ? score.us > 0
      ? 'us'
      : score.them > 0
        ? 'them'
        : 'draw'
    : null;
  const bannerClass = result === 'us' ? 'win' : result === 'them' ? 'lose' : 'draw';

  const before: Standing = { written: match.seriesScore, air: match.air, target: match.target };
  const after = score ? applyGameScore(before, score) : before;
  // Whether this game's points actually went on the board, and what moved as a
  // result — the part of the scoring a player most needs spelled out.
  const scorer: TeamId | null = result === 'us' || result === 'them' ? result : null;
  const banked = score && scorer
    ? {
        wrote: score[scorer] >= WRITE_THRESHOLD,
        collected: before.air[scorer],
        wiped:
          score[scorer] >= WRITE_THRESHOLD ? before.air[scorer === 'us' ? 'them' : 'us'] : 0,
      }
    : null;

  return (
    <section className="screen game-screen">
      <h1>{t.game.heading(match.gameNumber)}</h1>
      <p className="hint">
        {t.game.header({
          me: displayName(names, MY_PLAYER_ID),
          partner: displayName(names, partner),
          opponents: opponents.map((p) => displayName(names, p)).join(' & '),
          us: match.seriesScore.us,
          them: match.seriesScore.them,
          opener: displayName(names, opener),
        })}
      </p>

      <PlayerNamesEditor names={names} me={MY_PLAYER_ID} onChange={onRename} />

      <GameTable
        chain={state.chain}
        ends={state.ends}
        currentPlayer={state.turn}
        myPlayerId={MY_PLAYER_ID}
        names={names}
        counts={state.counts}
        hand={hand}
        pendingStone={pendingStone}
        mustOpenWithId={mustOpenWithId}
        onPlace={handlePlace}
        onSelectHandStone={handleSelectStone}
      />

      {impossible && (
        <p className="log-warning">{t.game.impossibleLog}</p>
      )}

      {score !== null ? (
        <div className={`win-banner ${bannerClass}`}>
          <h2>
            {score.seka
              ? t.game.seka
              : result === 'us'
                ? t.game.weScore(score.us)
                : t.game.theyScore(score.them)}
          </h2>
          {state.winner !== null ? (
            <p>
              {t.game.wentOut(
                displayName(names, state.winner),
                teamLabel(names, teamOf(state.winner)),
              )}
            </p>
          ) : (
            <p>{t.game.blocked}</p>
          )}
          <p>
            {t.game.pipsHeld({
              usTeam: teamLabel(names, 'us'),
              usPips: pipSum(hand) + pipSum(revealed!.C),
              themTeam: teamLabel(names, 'them'),
              themPips: pipSum(revealed!.B) + pipSum(revealed!.D),
            })}
          </p>
          {match.pot > 0 && !score.seka && <p>{t.game.potCollected(match.pot)}</p>}
          {score.seka && <p>{t.game.sekaCarry(score.carry)}</p>}
          {banked !== null && (
            <p className="banked-note">
              {banked.wrote
                ? banked.collected > 0
                  ? t.game.wroteWithAir(WRITE_THRESHOLD, banked.collected)
                  : t.game.wrote(WRITE_THRESHOLD)
                : t.game.notWritten(WRITE_THRESHOLD)}
              {banked.wiped > 0 && t.game.wiped(banked.wiped)}
            </p>
          )}
          <p>
            {t.game.matchStanding(after.written.us, after.written.them, match.target)}
            {(after.air.us > 0 || after.air.them > 0) &&
              t.game.airStanding(after.air.us, after.air.them)}
          </p>
          <div className="actions">
            <button type="button" className="primary-btn" onClick={() => onFinish(score)}>
              {t.game.recordScore}
            </button>
          </div>
        </div>
      ) : over ? (
        <RevealHandsScreen
          unseenStones={unseenStones}
          names={names}
          countB={state.counts.B}
          countC={state.counts.C}
          countD={state.counts.D}
          possibleFor={possibleFor}
          reason={state.winner !== null ? 'went-out' : 'blocked'}
          onComplete={setRevealed}
        />
      ) : (
        <>
          <MoveLogger
            currentPlayer={state.turn}
            myPlayerId={MY_PLAYER_ID}
            names={names}
            ends={state.ends}
            usedStoneIds={usedStoneIds}
            pendingStone={pendingStone}
            restrictToStoneId={mustOpenWithId}
            possibleIds={
              state.turn === MY_PLAYER_ID || !possibleFor
                ? null
                : possibleFor[state.turn as 'B' | 'C' | 'D']
            }
            onSelectStone={handleSelectStone}
            onPass={handlePass}
          />

          {/* "No advice" and "no legal move" are completely different things, and
              telling you to pass when you can play is the worst thing this app
              could do. Check the rules directly rather than inferring from an
              empty result. */}
          {advisable && !search.thinking && search.moves.length === 0 && (
            legalMoves(hand, state.ends).length === 0 ? (
              <p className="hint">{t.game.nothingFits}</p>
            ) : (
              <p className="log-warning">{t.game.engineFailed()}</p>
            )
          )}
          <Recommendations
            moves={search.moves}
            pendingStone={pendingStone}
            thinking={search.thinking}
            sampled={search.sampled}
            onSelect={(move) => setPendingStone(move.candidate.stone)}
          />
        </>
      )}

      <MoveHistory moves={moveLog} names={names} />

      <div className="actions">
        <button
          type="button"
          className="secondary-btn"
          disabled={moveLog.length === 0}
          onClick={handleUndo}
        >
          {t.game.undo}
        </button>
        <button type="button" className="secondary-btn" onClick={onQuit}>
          {t.game.abandon}
        </button>
      </div>
    </section>
  );
}
