import { useState } from 'react';
import { HomeScreen } from './screens/HomeScreen';
import { NewGameScreen } from './screens/NewGameScreen';
import { GameScreen } from './screens/GameScreen';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import type { Stone } from './types/domino';
import type { MatchState, PlayerId, PlayerNames } from './types/game';
import { type GameScore, applyGameScore } from './lib/scoring';
import { INITIAL_MATCH } from './types/game';
import { loadPlayerNames, savePlayerNames } from './lib/playerNames';
import './App.css';

type Screen = 'home' | 'new-game' | 'game';

interface GameSetup {
  hand: Stone[];
  opener: PlayerId;
}

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [match, setMatch] = useState<MatchState>(INITIAL_MATCH);
  const [setup, setSetup] = useState<GameSetup | null>(null);
  // Names belong to the people at the table, not to a game, so they survive a
  // match, a reload and an abandoned game.
  const [names, setNames] = useState<PlayerNames>(loadPlayerNames);

  function renamePlayers(next: PlayerNames) {
    setNames(next);
    savePlayerNames(next);
  }

  function finishGame(score: GameScore) {
    setMatch((prev) => {
      // The write/air/wipe rule lives in scoring.ts, so the app and the engine
      // agree about what a game was actually worth.
      const next = applyGameScore(
        { written: prev.seriesScore, air: prev.air, target: prev.target },
        score,
      );
      return {
        ...prev,
        gameNumber: prev.gameNumber + 1,
        seriesScore: next.written,
        air: next.air,
        // A seka pots the pips instead of scoring them; anything else clears the
        // pot, because the winner has just collected it.
        pot: score.carry,
        previousWinner: score.us > 0 ? 'us' : score.them > 0 ? 'them' : null,
      };
    });
    setSetup(null);
    setScreen('home');
  }

  // The switcher sits outside the screens: it belongs to the app frame, and it
  // has to be reachable from every one of them.
  return (
    <>
      <LanguageSwitcher />
      {screen === 'new-game' ? (
        <NewGameScreen
          match={match}
          names={names}
          onRename={renamePlayers}
          onCancel={() => setScreen('home')}
          onStart={(next) => {
            setSetup(next);
            setScreen('game');
          }}
        />
      ) : screen === 'game' && setup ? (
        <GameScreen
          key={match.gameNumber}
          initialHand={setup.hand}
          opener={setup.opener}
          match={match}
          names={names}
          onRename={renamePlayers}
          onFinish={finishGame}
          onQuit={() => {
            setSetup(null);
            setScreen('home');
          }}
        />
      ) : (
        <HomeScreen
          match={match}
          names={names}
          onRename={renamePlayers}
          onNewGame={() => setScreen('new-game')}
          onResetMatch={() => setMatch(INITIAL_MATCH)}
        />
      )}
    </>
  );
}

export default App;
