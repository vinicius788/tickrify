import pt from './pt';
import en from './en';
import es from './es';
import fr from './fr';
import de from './de';
import ja from './ja';

export type Language = 'pt' | 'en' | 'es' | 'fr' | 'de' | 'ja';

export const LANGUAGES: { code: Language; label: string; flag: string }[] = [
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
];

export const LANGUAGE_AI_NAMES: Record<Language, string> = {
  pt: 'Portuguese (Brazil)',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
};

const translations = { pt, en, es, fr, de, ja };

export type Translations = typeof pt;

export function getTranslations(lang: Language): Translations {
  return translations[lang] ?? translations.pt;
}

const STORAGE_KEY = 'tickrify-language';

export function getStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Language | null;
    if (stored && stored in translations) return stored;
  } catch {}
  // Auto-detect from browser
  const browserLang = navigator.language?.slice(0, 2) as Language;
  if (browserLang in translations) return browserLang;
  return 'pt';
}

export function setStoredLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {}
}
