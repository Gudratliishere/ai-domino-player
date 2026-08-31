import { CATALOGS, LANGS, useI18n } from '../i18n';
import './LanguageSwitcher.css';

/** Two languages, so a segmented pair beats a dropdown: one tap either way. */
export function LanguageSwitcher() {
  const { lang, t, setLang } = useI18n();

  return (
    <div className="language-switcher" role="group" aria-label={t.app.languageLabel}>
      {LANGS.map((option) => (
        <button
          key={option}
          type="button"
          className={`language-btn ${option === lang ? 'selected' : ''}`}
          aria-pressed={option === lang}
          title={CATALOGS[option].nativeName}
          onClick={() => setLang(option)}
        >
          {CATALOGS[option].shortName}
        </button>
      ))}
    </div>
  );
}
