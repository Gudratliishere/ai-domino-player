import { PlayerNamesEditor } from '../components/PlayerNamesEditor';
import { useMessages } from '../i18n';
import type { MatchState, PlayerId, PlayerNames } from '../types/game';
import { matchWinner, teamLabel } from '../types/game';
import { WRITE_THRESHOLD } from '../lib/scoring';

const MY_PLAYER_ID: PlayerId = 'A';

interface HomeScreenProps {
  match: MatchState;
  names: PlayerNames;
  onRename: (names: PlayerNames) => void;
  onNewGame: () => void;
  onResetMatch: () => void;
}

export function HomeScreen({ match, names, onRename, onNewGame, onResetMatch }: HomeScreenProps) {
  const t = useMessages();
  const matchInProgress = match.gameNumber > 1;
  const winner = matchWinner(match);

  return (
    <section className="screen home-screen">
      <h1>{t.app.title}</h1>
      <p>{t.app.tagline}</p>

      <PlayerNamesEditor names={names} me={MY_PLAYER_ID} onChange={onRename} />

      {matchInProgress ? (
        <div className={`series-score ${winner ? `match-over ${winner}` : ''}`}>
          <h2>{t.home.scoreHeading(match.seriesScore.us, match.seriesScore.them)}</h2>
          <p className="hint teams">
            {t.home.teams(teamLabel(names, 'us'), teamLabel(names, 'them'))}
          </p>
          {winner ? (
            <p className="hint">{t.home.matchWon(winner, match.target)}</p>
          ) : (
            <>
              <p className="hint">
                {t.home.playingTo(match.target)} {t.home.openerNote(match.previousWinner)}
              </p>
              {(match.air.us > 0 || match.air.them > 0) && (
                <p className="hint air">
                  {t.home.airLabel}{' '}
                  {match.air.us > 0 && <strong>{t.home.airYou(match.air.us)}</strong>}
                  {match.air.us > 0 && match.air.them > 0 && ', '}
                  {match.air.them > 0 && <strong>{t.home.airThem(match.air.them)}</strong>}.{' '}
                  {t.home.airExplain(WRITE_THRESHOLD)}
                </p>
              )}
              {match.pot > 0 && <p className="hint pot">{t.home.potNote(match.pot)}</p>}
            </>
          )}
        </div>
      ) : (
        <p className="hint">{t.home.intro(match.target, WRITE_THRESHOLD)}</p>
      )}

      <div className="actions">
        {!winner && (
          <button type="button" className="primary-btn" onClick={onNewGame}>
            {matchInProgress ? t.home.startNumberedGame(match.gameNumber) : t.home.startGame}
          </button>
        )}
        {matchInProgress && (
          <button
            type="button"
            className={winner ? 'primary-btn' : 'secondary-btn'}
            onClick={onResetMatch}
          >
            {winner ? t.home.newMatch : t.home.resetMatch}
          </button>
        )}
      </div>
    </section>
  );
}
