import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { ClerkProvider } from '@clerk/clerk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { initAnalytics, initAnonymousAnalytics, revokeAnalyticsConsent } from './lib/analytics';
import { CONSENT_EVENT, getConsent } from './lib/consent';
import { AnalyticsIdentify } from './components/providers/AnalyticsIdentify';
import { isLoggedAreaPath, isPageTranslated, setPageTranslatable } from './lib/utils';
import './styles/trading-tokens.css';
import './index.css';

// Com aceite: PostHog completo, Meta Pixel e Google tag. Sem aceite: só o
// PostHog em modo sem cookies, depois do `load` para não pesar na primeira
// pintura (ver lib/analytics.ts). Aceitar no banner chama initAnalytics() na
// hora, sem recarregar a página.
if (getConsent() === 'granted') {
  initAnalytics();
} else {
  const loadAnonymous = () => window.setTimeout(() => void initAnonymousAnalytics(), 1000);
  if (document.readyState === 'complete') loadAnonymous();
  else window.addEventListener('load', loadAnonymous, { once: true });
}
// Recusa no banner ou "Change my choice" na /cookies: volta ao modo sem cookies.
window.addEventListener(CONSENT_EVENT, () => {
  if (getConsent() !== 'granted') revokeAnalyticsConsent();
});

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

/**
 * O ambiente reportado ao Sentry.
 *
 * A versão anterior era `VITE_APP_ENV || MODE || 'development'`, e o painel
 * do Sentry mostrava os erros de PRODUÇÃO marcados como `development`. Um
 * erro de produção com esse rótulo é o mesmo que erro nenhum: ninguém filtra
 * por esse ambiente ao investigar, e alertas por ambiente nunca disparam.
 *
 * Agora um build de produção NÃO CONSEGUE mais se rotular como development,
 * qualquer que seja o valor da env var na Vercel. `import.meta.env.PROD` é
 * resolvido pelo Vite no build, não lido do ambiente, então não há env var
 * mal configurada capaz de mentir sobre isso.
 *
 * Um valor próprio continua valendo (`staging`, por exemplo): só a
 * combinação "build de produção dizendo development" é corrigida.
 */
const APP_ENV = String(import.meta.env.VITE_APP_ENV || '').trim();
const SENTRY_ENV = import.meta.env.PROD
  ? APP_ENV && APP_ENV !== 'development'
    ? APP_ENV
    : 'production'
  : APP_ENV || 'development';

/**
 * Ruído conhecido que não é bug do produto. Filtrado no cliente de propósito,
 * e não por regra no painel: evento descartado aqui não gasta cota do plano.
 *
 * O `removeChild` do Google Translate SAIU desta lista em 05/10/2026. Ele era
 * descartado como "o usuário sequer percebe", mas derrubava o painel inteiro no
 * ErrorBoundary (reproduzido ao arrastar o gráfico com a página traduzida).
 * Agora o painel não é traduzível (`setPageTranslatable`) e o erro chega ao
 * Sentry com `page_translated` e a rota, para ver se sobrou em algum lugar.
 *
 * WebView do Instagram: o navegador embutido do app quebra APIs que o Chrome
 * tem, e o tráfego de anúncio do Instagram cai todo lá dentro. Vale reavaliar
 * se um erro de conversão aparecer só nesse ambiente.
 */
const RUIDO_CONHECIDO = [
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded',
];

// Área logada aberta direto (ou recarregada): marca "não traduzir" antes da
// primeira pintura, antes de o navegador decidir traduzir a página. Navegar
// dentro do app é coberto pelo ProtectedRoute.
if (isLoggedAreaPath(window.location.pathname)) setPageTranslatable(false);

function ehWebViewDoInstagram(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Instagram|FBAN|FBAV/i.test(navigator.userAgent);
}

// Code splitting: paginas como o painel sao arquivos separados. Depois de um
// deploy, uma aba aberta ainda tem o arquivo principal ANTIGO, que aponta para
// pedacos que nao existem mais; abrir o painel falharia com tela em branco. O
// Vite avisa com `vite:preloadError`: recarregamos UMA vez para pegar a versao
// nova. A marca na sessao impede loop se o erro for outro (ex.: rede fora).
window.addEventListener('vite:preloadError', (event) => {
  try {
    const key = 'tickrify_chunk_reload_at';
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENV,
    // Replay (gravacao so em sessao com erro) sai do arquivo principal: ~250 kB
    // de codigo que todo visitante baixava antes de ver a pagina. Ele e
    // carregado logo abaixo, depois do `load`. Erro antes disso nao tem
    // gravacao, mas continua reportado normalmente.
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.2,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.0,
    ignoreErrors: RUIDO_CONHECIDO,
    beforeSend(event) {
      /* A mensagem do Translate nem sempre chega no `message`: às vezes vem só
       * no valor da exceção, e aí o `ignoreErrors` acima não pega. */
      const valores = event.exception?.values ?? [];
      const texto = [event.message, ...valores.map((v) => v.value)].filter(Boolean).join(' | ');
      if (RUIDO_CONHECIDO.some((padrao) => texto.includes(padrao))) return null;

      /* Marcado, não descartado: o volume do WebView some do ruído mas
       * continua auditável pela tag quando alguém for investigar conversão. */
      if (ehWebViewDoInstagram()) {
        event.tags = { ...event.tags, webview: 'instagram' };
      }
      event.tags = {
        ...event.tags,
        page_translated: isPageTranslated() ? 'yes' : 'no',
        route: window.location.pathname,
      };
      return event;
    },
  });

  // Replay sob demanda (ver comentario em `integrations`). Mesmas taxas do
  // init: a integracao le replaysOnErrorSampleRate/replaysSessionSampleRate
  // da configuracao do cliente. Falha ao baixar = sem replay, nada mais.
  const loadReplay = () => {
    void Sentry.lazyLoadIntegration('replayIntegration')
      .then((replayIntegration) => Sentry.addIntegration(replayIntegration()))
      .catch(() => undefined);
  };
  if (document.readyState === 'complete') {
    window.setTimeout(loadReplay, 2000);
  } else {
    window.addEventListener('load', () => window.setTimeout(loadReplay, 2000), { once: true });
  }
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
    <Sentry.ErrorBoundary
      fallback={
        <div style={{ padding: 24, color: '#E8ECF4', background: '#0A0B0D', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
          <p style={{ margin: '0 0 12px' }}>Something went wrong. Reload the page to continue.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #3a3f47', background: '#f7f7f5', color: '#08090a', cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      }
    >
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
