import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
  Language,
  Translations,
  getTranslations,
  getStoredLanguage,
  setStoredLanguage,
} from './index';

interface LanguageContextValue {
  language: Language;
  t: Translations;
  setLanguage: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<Language>(getStoredLanguage);
  const [t, setT] = useState<Translations>(() => getTranslations(getStoredLanguage()));

  // <html lang> acompanha o idioma escolhido. Ficava fixo em "en" (vem do
  // index.html) mesmo com o usuario lendo em pt/es/fr/de/ja — o que sinaliza
  // idioma errado para buscador, leitor de tela e para o "traduzir esta pagina"
  // do navegador. Uma linha, sem efeito visual nenhum.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((lang: Language) => {
    setLang(lang);
    setT(getTranslations(lang));
    setStoredLanguage(lang);
  }, []);

  return (
    <LanguageContext.Provider value={{ language, t, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}
