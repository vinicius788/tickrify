import React, { createContext, useContext, useState, useCallback } from 'react';
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
