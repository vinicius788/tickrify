import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { buildApiUrl } from '../api';
import { toast } from '@/hooks/use-toast';
import { Language, Translations, getTranslations, getStoredLanguage, setStoredLanguage, isLanguage, STORAGE_KEY } from './index';

interface LanguageContextValue {
  language: Language;
  t: Translations;
  setLanguage: (lang: Language) => void;
}

/** Exportado so para o inspetor do /admin fixar o inglês na prévia do que a pessoa viu. */
export const LanguageContext = createContext<LanguageContextValue | null>(null);
type AccountConnection = { save: (language: Language) => void; revision: number };
const AccountContext = createContext<{
  connection: React.MutableRefObject<AccountConnection | null>;
  apply: (language: Language) => void;
} | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<Language>(getStoredLanguage);
  const connection = useRef<AccountConnection | null>(null);
  const apply = useCallback((lang: Language) => {
    setLang(lang);
    setStoredLanguage(lang);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const receive = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && isLanguage(event.newValue)) apply(event.newValue);
    };
    window.addEventListener('storage', receive);
    return () => window.removeEventListener('storage', receive);
  }, [apply]);

  const setLanguage = useCallback((lang: Language) => {
    apply(lang);
    if (connection.current) {
      connection.current.revision += 1;
      connection.current.save(lang);
    }
  }, [apply]);

  return (
    <LanguageContext.Provider value={{ language, t: getTranslations(language), setLanguage }}>
      <AccountContext.Provider value={{ connection, apply }}>{children}</AccountContext.Provider>
    </LanguageContext.Provider>
  );
}

/** Inside Clerk, outside App: account language is resolved before analysis screens mount. */
export function AccountLanguageSync({ children }: { children: React.ReactNode }) {
  const { isLoaded, userId, getToken } = useAuth();
  const account = useContext(AccountContext);
  if (!account) throw new Error('AccountLanguageSync must be used inside LanguageProvider');
  const { connection, apply } = account;
  const [resolvedAccount, setResolvedAccount] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !userId) {
      connection.current = null;
      setResolvedAccount(null);
      return;
    }
    let active = true;
    let writes = Promise.resolve();
    const current: AccountConnection = {
      revision: 0,
      save(language) {
        // Capture this session's token immediately, never send an old account's
        // pending choice with a token obtained after switching accounts.
        const token = getToken().catch(() => null);
        writes = writes.then(async () => {
          if (!active) return;
          try {
            const bearer = await token;
            if (!active) return;
            if (!bearer) throw new Error('Missing session');
            const res = await fetch(buildApiUrl('/api/auth/preferences'), {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ language }),
            });
            if (!res.ok) throw new Error('Preference not saved');
          } catch {
            if (active) toast({ description: getTranslations(language).common.languageSaveError, variant: 'destructive' });
          }
        });
      },
    };
    connection.current = current;
    void (async () => {
      try {
        const token = await getToken();
        if (!token || !active) return;
        const res = await fetch(buildApiUrl('/api/auth/preferences'), {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return;
        const data: { language?: unknown } = await res.json();
        // NULL means this account has never chosen: keep the visitor's local choice.
        if (active && current.revision === 0 && isLanguage(data.language)) apply(data.language);
      } catch {
        // Offline: keep the local choice. No write-back on login.
      } finally {
        if (active) setResolvedAccount(userId);
      }
    })();
    return () => {
      active = false;
      if (connection.current === current) connection.current = null;
    };
  }, [isLoaded, userId, getToken, connection, apply]);

  if (isLoaded && userId && resolvedAccount !== userId) return null;
  return <>{children}</>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}
