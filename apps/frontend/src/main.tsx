import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App.tsx';
import './styles/trading-tokens.css';
import './index.css';

const PUBLISHABLE_KEY = String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '').trim();
const API_URL = String(import.meta.env.VITE_API_URL || '').trim();
const rootElement = document.getElementById('root')!;
const missingVars: string[] = [];

if (!PUBLISHABLE_KEY) {
  missingVars.push('VITE_CLERK_PUBLISHABLE_KEY');
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
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
      <App />
    </ClerkProvider>
  </StrictMode>,
);
