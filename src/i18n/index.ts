import { createContext, useContext } from 'react';
import { CATALOGS } from './catalogs';
import { en } from './en';
import { LANGS, type Lang, type Messages } from './types';

export type { Lang, Messages };
export { CATALOGS, LANGS };

const STORAGE_KEY = 'ai-domino-lang';

function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as string[]).includes(value);
}

/**
 * The chosen language, else the browser's if we speak it, else English.
 *
 * Guarded throughout: storage throws outright in a browser set to block site
 * data, and picking a language must never be the thing that fails to load.
 */
export function loadLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // fall through to the browser's preference
  }
  try {
    const preferred = navigator.languages ?? [navigator.language];
    for (const tag of preferred) {
      const base = tag.toLowerCase().split('-')[0];
      if (isLang(base)) return base;
    }
  } catch {
    // no navigator (a test environment, say)
  }
  return 'en';
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // The choice still applies to this session; it just will not be remembered.
  }
}

export interface I18nValue {
  lang: Lang;
  t: Messages;
  setLang: (lang: Lang) => void;
}

export const I18nContext = createContext<I18nValue>({ lang: 'en', t: en, setLang: () => {} });

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

/** The strings for the current language. */
export function useMessages(): Messages {
  return useContext(I18nContext).t;
}
