import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { ClerkProvider } from '@clerk/clerk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { initAnalytics } from './lib/analytics';
import { getConsent } from './lib/consent';
import { AnalyticsIdentify } from './components/providers/AnalyticsIdentify';
import './styles/trading-tokens.css';
import './index.css';

// PostHog e Meta Pixel só sobem com consentimento (ver lib/consent.ts). Sem
// escolha registrada, nada de analytics carrega e o banner do CookieConsent
// aparece; aceitar chama initAnalytics() na hora, sem recarregar a página.
if (getConsent() === 'granted') {
  initAnalytics();
}

/**
 * Tema do Clerk, aplicado no provider para valer também nos modais de
 * cadastro e login abertos pelo cabeçalho. Sem isto, o Clerk desenhava um
 * cartão claro padrão em cima do site escuro: era a única superfície do
 * produto que não parecia da Tickrify, e aparecia justo no momento do
 * cadastro. Os valores são os mesmos tokens do .tk-site (index.css).
 *
 * `colorNeutral` é a chave e não é óbvia: o Clerk DERIVA quase toda a escala
 * de cinza dele a partir dessa cor (texto secundário, bordas, rótulo de campo,
 * texto do botão do Google). O padrão é preto, então num cartão escuro o
 * "Continue with Google" saía preto sobre preto, praticamente invisível.
 * Invertendo para branco, a escala inteira inverte junto.
 *
 * Os `elements` abaixo existem só onde a derivação não basta. Nada de cor
 * chapada em cima do que já funciona.
 */
const clerkAppearance = {
  variables: {
    colorPrimary: '#f7f7f5',
    colorBackground: '#0e1012',
    colorText: '#f7f7f5',
    colorTextSecondary: '#8b9099',
    colorTextOnPrimaryBackground: '#08090a',
    colorNeutral: '#ffffff',
    colorInputBackground: '#08090a',
    colorInputText: '#f7f7f5',
    colorDanger: '#e5484d',
    colorSuccess: '#34c77b',
    colorWarning: '#d9a21b',
    borderRadius: '12px',
  },
  elements: {
    card: { border: '1px solid rgba(255,255,255,0.09)', boxShadow: 'none' },
    modalContent: { boxShadow: 'none' },
    headerTitle: { color: '#f7f7f5', fontWeight: 500 },
    headerSubtitle: { color: '#8b9099' },
    socialButtonsBlockButton: {
      border: '1px solid rgba(255,255,255,0.14)',
      backgroundColor: 'rgba(255,255,255,0.03)',
      color: '#f7f7f5',
    },
    socialButtonsBlockButtonText: { color: '#f7f7f5', fontWeight: 500 },
    dividerLine: { backgroundColor: 'rgba(255,255,255,0.12)' },
    dividerText: { color: '#8b9099' },
    formFieldLabel: { color: '#8b9099' },
    formFieldInput: { border: '1px solid rgba(255,255,255,0.12)', color: '#f7f7f5' },
    formFieldInputShowPasswordButton: { color: '#8b9099' },
    formButtonPrimary: {
      backgroundColor: '#f7f7f5',
      color: '#08090a',
      textTransform: 'none',
      fontWeight: 500,
      boxShadow: 'none',
    },
    footerActionText: { color: '#8b9099' },
    footerActionLink: { color: '#f7f7f5', fontWeight: 500 },
    identityPreviewText: { color: '#f7f7f5' },
    identityPreviewEditButton: { color: '#8b9099' },
    formResendCodeLink: { color: '#f7f7f5' },
    otpCodeFieldInput: { border: '1px solid rgba(255,255,255,0.14)', color: '#f7f7f5' },
    badge: { backgroundColor: 'rgba(255,255,255,0.08)', color: '#8b9099' },
    userButtonPopoverCard: { border: '1px solid rgba(255,255,255,0.09)', boxShadow: 'none' },
    userButtonPopoverActionButton: { color: '#f7f7f5' },
    userButtonPopoverActionButtonText: { color: '#f7f7f5' },
    userButtonPopoverFooter: { display: 'none' },
  },
};
const SENTRY_DSN = String(import.meta.env.VITE_SENTRY_DSN || '').trim();
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: String(import.meta.env.VITE_APP_ENV || import.meta.env.MODE || 'development'),
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    tracesSampleRate: 0.2,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.0,
  });
}

const PUBLISHABLE_KEY = String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '').trim();
const API_URL = String(import.meta.env.VITE_API_URL || '').trim();
const rootElement = document.getElementById('root')!;
const missingVars: string[] = [];
const queryClient = new QueryClient();

if (!PUBLISHABLE_KEY || PUBLISHABLE_KEY.includes('YOUR_CLERK')) {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0A0B0D;color:#E8ECF4;font-family:sans-serif;flex-direction:column;gap:12px;">
      <p style="color:#FF3B5C;font-size:14px;">
        ⚠️ VITE_CLERK_PUBLISHABLE_KEY não configurada.
      </p>
      <p style="color:#8892A4;font-size:12px;">
        Configure a variável de ambiente no Vercel e faça redeploy.
      </p>
    </div>
  `;
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY não configurada.');
}

if (!API_URL) {
  missingVars.push('VITE_API_URL');
}

if (missingVars.length > 0) {
  document.body.innerHTML = `
    <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #0f172a; padding: 24px;">
      <div style="max-width: 680px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; padding: 20px;">
        <h1 style="margin-top: 0; margin-bottom: 8px; font-size: 20px;">Erro de configuração</h1>
        <p style="margin: 0 0 8px 0;">Variáveis obrigatórias ausentes: <strong>${missingVars.join(', ')}</strong>.</p>
        <p style="margin: 0;">Contate o suporte da plataforma.</p>
      </div>
    </div>
  `;

  throw new Error(`${missingVars.join(', ')} is not defined`);
}

createRoot(rootElement).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<div style={{ padding: 24, color: '#E8ECF4', background: '#0A0B0D', minHeight: '100vh' }}>Algo deu errado. Recarregue a página.</div>}>
      <QueryClientProvider client={queryClient}>
        <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/" appearance={clerkAppearance}>
          <LanguageProvider>
            <AnalyticsIdentify />
            <App />
          </LanguageProvider>
        </ClerkProvider>
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
