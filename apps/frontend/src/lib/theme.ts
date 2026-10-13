import { useCallback, useSyncExternalStore } from 'react';
import { buildApiUrl } from './api';

/**
 * Tema da area logada (13/10/2026). Escuro e o padrao para quem nunca
 * escolheu; o claro so vale depois de escolhido em Configuracoes.
 *
 * Onde mora a escolha: no perfil do usuario no banco (vale em outro aparelho
 * e depois de sair e entrar) e no localStorage (para o script do index.html
 * pintar o tema certo ANTES do React, sem piscar o escuro). O servidor ganha
 * quando os dois divergem, porque e onde a pessoa escolheu por ultimo.
 *
 * So o painel muda (/dashboard, /demo, /admin): a vitrine, o blog e o
 * /affiliate (feito com o visual da vitrine) continuam escuros, por isso o
 * atributo sai ao navegar para fora. O script do index.html usa a mesma lista.
 */
export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'tickrify_theme';
const THEMED_AREA = /^\/(dashboard|demo|admin)(\/|$)/;
const THEME_EVENT = 'tickrify:theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Liga o tema guardado so na area logada. Chamado a cada troca de rota. */
export function applyThemeForPath(pathname: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (THEMED_AREA.test(pathname) && getStoredTheme() === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
}

/** Grava a escolha no aparelho e aplica na hora (sem recarregar). */
export function storeTheme(theme: Theme): void {
  try {
    if (theme === 'light') localStorage.setItem(THEME_STORAGE_KEY, 'light');
    else localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    /* sem storage: vale para esta aba e o servidor guarda */
  }
  if (typeof window !== 'undefined') {
    applyThemeForPath(window.location.pathname);
    window.dispatchEvent(new Event(THEME_EVENT));
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Tema atual, atualizado quando muda (inclusive em outra aba). */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, getStoredTheme, () => 'dark' as Theme);
  const set = useCallback((next: Theme) => storeTheme(next), []);
  return [theme, set];
}

/**
 * Depois do login: a escolha guardada na conta vence a do aparelho (outro
 * aparelho, ou outra pessoa que usou este navegador). null no servidor =
 * nunca escolheu = escuro. Falha de rede mantem o que o aparelho tem.
 */
export async function syncThemeFromServer(token: string): Promise<void> {
  try {
    const res = await fetch(buildApiUrl('/api/auth/preferences'), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const data = (await res.json()) as { theme?: unknown };
    const theme: Theme = isTheme(data?.theme) ? data.theme : 'dark';
    if (theme !== getStoredTheme()) storeTheme(theme);
  } catch {
    /* sem resposta: fica o tema do aparelho */
  }
}

/** Grava a escolha na conta (o evento theme_changed sai do servidor). */
export async function saveThemeToServer(token: string, theme: Theme): Promise<boolean> {
  try {
    const res = await fetch(buildApiUrl('/api/auth/preferences'), {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Componentes da Clerk dentro da area logada (menu da conta e "Manage
 * account") no tema claro. O provider em main.tsx segue escuro para os
 * modais de login da vitrine; aqui se repete cada `element` que la tem cor
 * fixa, senao o escuro vazaria por cima.
 */
export const clerkLightAppearance = {
  variables: {
    colorPrimary: '#0b0d12',
    colorBackground: '#ffffff',
    colorText: '#0b0d12',
    colorTextSecondary: '#5b616b',
    colorTextOnPrimaryBackground: '#ffffff',
    colorNeutral: '#0b0d12',
    colorInputBackground: '#ffffff',
    colorInputText: '#0b0d12',
    colorDanger: '#c62828',
    colorSuccess: '#06844a',
    colorWarning: '#9a6700',
  },
  elements: {
    card: { border: '1px solid rgba(15,17,22,0.1)', boxShadow: 'none' },
    headerTitle: { color: '#0b0d12', fontWeight: 500 },
    headerSubtitle: { color: '#5b616b' },
    socialButtonsBlockButton: {
      border: '1px solid rgba(15,17,22,0.14)',
      backgroundColor: 'rgba(15,17,22,0.02)',
      color: '#0b0d12',
    },
    socialButtonsBlockButtonText: { color: '#0b0d12', fontWeight: 500 },
    dividerLine: { backgroundColor: 'rgba(15,17,22,0.12)' },
    dividerText: { color: '#5b616b' },
    formFieldLabel: { color: '#5b616b' },
    formFieldInput: { border: '1px solid rgba(15,17,22,0.14)', color: '#0b0d12' },
    formFieldInputShowPasswordButton: { color: '#5b616b' },
    formButtonPrimary: {
      backgroundColor: '#0b0d12',
      color: '#ffffff',
      textTransform: 'none' as const,
      fontWeight: 500,
      boxShadow: 'none',
    },
    footerActionText: { color: '#5b616b' },
    footerActionLink: { color: '#0b0d12', fontWeight: 500 },
    identityPreviewText: { color: '#0b0d12' },
    identityPreviewEditButton: { color: '#5b616b' },
    formResendCodeLink: { color: '#0b0d12' },
    otpCodeFieldInput: { border: '1px solid rgba(15,17,22,0.14)', color: '#0b0d12' },
    badge: { backgroundColor: 'rgba(15,17,22,0.06)', color: '#5b616b' },
    userButtonPopoverCard: { border: '1px solid rgba(15,17,22,0.1)', boxShadow: '0 8px 24px rgba(15,17,22,0.08)' },
    userButtonPopoverActionButton: { color: '#0b0d12' },
    userButtonPopoverActionButtonText: { color: '#0b0d12' },
  },
};
