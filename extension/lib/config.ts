export const SITE_URL = 'https://tickrify.com';
// Mesmo VITE_API_URL do site em producao. WXT_API_URL troca so para teste local.
export const API_URL = import.meta.env.WXT_API_URL || 'https://tickrify.onrender.com';
// O Clerk de producao guarda a sessao no dominio do Frontend API, nao no site.
export const CLERK_SYNC_HOST = 'https://clerk.tickrify.com';
export const CLERK_PUBLISHABLE_KEY: string = import.meta.env.WXT_CLERK_PUBLISHABLE_KEY ?? '';
// So no build de teste contra a API falsa local (_local/extensao/fake-api): pula
// o Clerk. A API de verdade recusa esse token, entao nao abre nada se vazar.
export const TEST_TOKEN: string = import.meta.env.WXT_TEST_TOKEN ?? '';

export const SIGN_IN_URL = `${SITE_URL}/sign-in`;
export const PLANS_URL = `${SITE_URL}/dashboard/plans`;
export const analysisUrl = (id: string) => `${SITE_URL}/dashboard/analysis/${encodeURIComponent(id)}`;
