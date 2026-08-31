import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CATALOGS, I18nContext, type I18nValue, type Lang, loadLang, saveLang } from '.';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(loadLang);

  // Screen readers and hyphenation both read the lang attribute, and the tab
  // title is as much part of the UI as anything on the page.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = CATALOGS[lang].app.title;
  }, [lang]);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      t: CATALOGS[lang],
      setLang: (next) => {
        setLangState(next);
        saveLang(next);
      },
    }),
    [lang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
