import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { ClerkProvider } from '@clerk/clerk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { LanguageProvider } from './lib/i18n/LanguageContext.tsx';
import { initAnalytics } from './lib/analytics';
import { AnalyticsIdentify } from './components/providers/AnalyticsIdentify';
import './styles/trading-tokens.css';
import './index.css';

initAnalytics();

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
        <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
          <LanguageProvider>
            <AnalyticsIdentify />
            <App />
          </LanguageProvider>
        </ClerkProvider>
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
