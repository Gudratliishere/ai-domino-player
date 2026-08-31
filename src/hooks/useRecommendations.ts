import { useEffect, useRef, useState } from 'react';
import type { Stone } from '../types/domino';
import type { LoggedMove, PlayerId, PlayerNames } from '../types/game';
import type { PimcMove } from '../lib/ai/pimc';
import type { Standing } from '../lib/scoring';
import type { RecommendRequest, RecommendResponse } from '../lib/ai/worker';
import type { Lang } from '../i18n';

interface Options {
  opener: PlayerId;
  moves: LoggedMove[];
  hand: Stone[];
  me: PlayerId;
  enabled: boolean;
  worlds?: number;
  /** Set when the rules forced the opening stone, so it is not read as a tell. */
  forcedOpeningStoneId?: string | null;
  /** Where the match stands, including points in the air. */
  standing?: Standing;
  /** Only affects how the reasons read, never how the moves rank. */
  names?: PlayerNames;
  /** Likewise: the language the reasons are written in. */
  lang?: Lang;
}

export interface RecommendationState {
  moves: PimcMove[];
  thinking: boolean;
  sampled: number;
  ms: number;
  error: string | null;
}

/**
 * Runs the search in a worker, keeping only the answer to the latest question.
 *
 * Results from a superseded position are dropped rather than rendered: a stale
 * recommendation is worse than none, because it looks current.
 */
export function useRecommendations(options: Options): RecommendationState {
  const {
    opener,
    moves,
    hand,
    me,
    enabled,
    worlds,
    forcedOpeningStoneId,
    standing,
    names,
    lang,
  } = options;
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const [state, setState] = useState<RecommendationState>({
    moves: [],
    thinking: false,
    sampled: 0,
    ms: 0,
    error: null,
  });

  useEffect(() => {
    const worker = new Worker(new URL('../lib/ai/worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<RecommendResponse>) => {
      if (event.data.id !== requestId.current) return;
      // The engine's message is an internal diagnostic, and English. It belongs
      // in the console; the screen says what went wrong in the user's language.
      if (event.data.error) console.error('[recommendations]', event.data.error);
      setState({
        moves: event.data.moves,
        thinking: false,
        sampled: event.data.sampled,
        ms: event.data.ms,
        error: event.data.error ?? null,
      });
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Identifies the position without deep-comparing the log every render. Length
  // alone would miss an undo followed by a different move of the same length.
  // Renaming a player or switching language does not change the position, but it
  // does change the text the answer carries, so the question is asked again.
  const namesKey = names ? Object.values(names).join('|') : '';
  const signature = `${moves.length}:${moves.map((m) => m.stone?.id ?? 'x').join('')}`;
  useEffect(() => {
    if (!enabled) {
      requestId.current++;
      setState({ moves: [], thinking: false, sampled: 0, ms: 0, error: null });
      return;
    }
    const worker = workerRef.current;
    if (!worker) return;

    const id = ++requestId.current;
    setState((prev) => ({ ...prev, thinking: true }));
    const request: RecommendRequest = {
      id,
      opener,
      moves,
      hand,
      me,
      worlds,
      forcedOpeningStoneId,
      standing,
      names,
      lang,
    };
    worker.postMessage(request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    opener,
    me,
    signature,
    worlds,
    forcedOpeningStoneId,
    standing?.written.us,
    standing?.written.them,
    standing?.air.us,
    standing?.air.them,
    namesKey,
    lang,
  ]);

  return state;
}
