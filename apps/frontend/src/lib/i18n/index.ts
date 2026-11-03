import pt from './pt';
import en from './en';
import es from './es';
import fr from './fr';
import de from './de';
import ja from './ja';

export type Language = 'pt' | 'en' | 'es' | 'fr' | 'de' | 'ja';

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ja', label: '日本語' },
];

const translations = { pt, en, es, fr, de, ja };

type Widen<T> = T extends string ? string : T extends readonly (infer U)[] ? readonly Widen<U>[] : { [K in keyof T]: Widen<T[K]> };
export type Translations = Widen<typeof pt>;

export function getTranslations(lang: Language): Translations {
  return (translations[lang] ?? translations.en) as Translations;
}

export const STORAGE_KEY = 'tickrify-language';

export function getStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Language | null;
    if (isLanguage(stored)) return stored;
  } catch {
    // localStorage indisponível (navegação privada, cookies bloqueados).
    // Cai no padrão em vez de quebrar a página inteira por causa do idioma.
  }
  // Padrão: Inglês para todos os novos visitantes (trocável pelo seletor de idioma,
  // e a escolha manual fica salva). Sem auto-detecção do navegador.
  return 'en';
}

export function setStoredLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Idem: não conseguir LEMBRAR o idioma não pode impedir de TROCAR o idioma.
  }
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(translations, value);
}

export const LOCALES: Record<Language, string> = {
  en: 'en-US', pt: 'pt-BR', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

export function formatNumber(value: number, language: Language, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(LOCALES[language], options).format(value);
}

export function interpolate(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => String(params[key] ?? match));
}
