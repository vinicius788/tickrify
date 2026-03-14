import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import './styles/trading-tokens.css';
import './index.css';

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
    <QueryClientProvider client={queryClient}>
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
        <App />
      </ClerkProvider>
    </QueryClientProvider>
  </StrictMode>,
);
