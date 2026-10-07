import { createClerkClient } from '@clerk/chrome-extension/client';
import { ApiError, createApi, type Usage } from '@/lib/api';
import { API_URL, CLERK_PUBLISHABLE_KEY, CLERK_SYNC_HOST, TEST_TOKEN, userLanguage } from '@/lib/config';
import { cropRectToPixels, fitWithin, type Rect } from '@/lib/crop';
import { strings } from '@/lib/i18n';
import type { CaptureReply, ErrorReason, PanelView, ToBackground, ToContent } from '@/lib/messages';
import { detectPlatform, type PageMeta, type Platform } from '@/lib/platform';

const MENU_ID = 'tickrify-analyze';
const MENU_LAST = 'tickrify-last';
// Ultimo resultado por aba (storage.session: some ao fechar o navegador).
const lastKey = (tabId: number) => `last:${tabId}`;
// Abas com analise em andamento. Segundo clique (ou atalho) durante a analise
// nao captura nem cobra de novo: o painel ja mostra "Analyzing".
const busyTabs = new Set<number>();
const MAX_SIDE = 1600;

/**
 * Sessao do Clerk sincronizada com tickrify.com (syncHost). Um cliente novo a
 * cada gesto: o modo background le o cookie de sessao no `load`, entao quem
 * acabou de entrar no site ja aparece logado sem reiniciar a extensao.
 */
async function getToken(): Promise<string | null> {
  if (TEST_TOKEN) return TEST_TOKEN;
  if (!CLERK_PUBLISHABLE_KEY) return null;
  const clerk = await createClerkClient({ publishableKey: CLERK_PUBLISHABLE_KEY, syncHost: CLERK_SYNC_HOST, background: true });
  return clerk.session ? await clerk.session.getToken() : null;
}

const api = createApi({ baseUrl: API_URL, getToken });

/**
 * Logo apos a injecao o painel pode ainda nao estar ouvindo. Em pagina pesada
 * recem-carregada (TradingView, Binance) isso passou de 2 s no teste
 * automatizado e o clique se perdia calado; tenta por ~10 s.
 */
async function sendToTab(tabId: number, message: ToContent): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await browser.tabs.sendMessage(tabId, message);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

const showView = (tabId: number, view: PanelView) => sendToTab(tabId, { type: 'tk:view', view });

/** Texto curto do erro para o painel e o console. Erros do Clerk trazem `errors[0].code`. */
function errorDetail(err: unknown): string {
  const clerk = (err as { errors?: Array<{ code?: string; longMessage?: string; message?: string }> })?.errors?.[0];
  const text = clerk ? [clerk.code, clerk.longMessage || clerk.message].filter(Boolean).join(': ') : err instanceof Error ? err.message : String(err);
  return text.slice(0, 180);
}

/** Erro mostrado no painel, com o detalhe tecnico (e registrado no console do service worker). */
function errorView(err: unknown): PanelView {
  console.error('[Tickrify]', err);
  return { kind: 'error', reason: reasonFrom(err), detail: errorDetail(err) };
}

function reasonFrom(err: unknown): ErrorReason {
  if (err instanceof ApiError) {
    if (err.kind === 'quota') return 'failed';
    return err.kind;
  }
  const text = err instanceof Error ? err.message : String(err);
  return /activeTab|all_urls|permission|Cannot access/i.test(text) ? 'permission' : 'failed';
}

/**
 * Garante o painel na aba. Injetar de novo numa pagina que ja tem o painel faz
 * o WXT desmontar o antigo, e o novo nao nasce (bug de 06/10, pego no teste
 * automatizado: depois da 1a analise o icone parava de funcionar na pagina).
 * So injeta quando o painel nao responde. false = pagina onde nada pode rodar
 * (do proprio navegador, da loja) ou permissao recolhida.
 */
async function ensurePanel(tabId: number): Promise<boolean> {
  const alive = await browser.tabs.sendMessage(tabId, { type: 'tk:ping' } satisfies ToContent).then(
    (reply) => reply === true,
    () => false,
  );
  if (alive) return true;
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/content.js'] });
    return true;
  } catch {
    return false;
  }
}

/** Gesto do trader (icone, atalho ou menu): so aqui o Chrome libera a aba. */
async function start(tab: { id?: number; url?: string }, again = false): Promise<void> {
  if (!tab.id || busyTabs.has(tab.id)) return;
  const tabId = tab.id;
  if (!(await ensurePanel(tabId))) {
    if (again) await showView(tabId, { kind: 'error', reason: 'permission' });
    return;
  }

  let usage: Usage;
  try {
    usage = await api.usage();
  } catch (err) {
    if (err instanceof ApiError && err.kind === 'auth') return showView(tabId, { kind: 'signin' });
    return showView(tabId, errorView(err));
  }
  // Mesma trava do servidor: sem analise disponivel, nada e capturado.
  if (!usage.canAnalyze) return showView(tabId, { kind: 'paywall', usage });

  const platform: Platform = detectPlatform(tab.url ?? '');
  await sendToTab(tabId, { type: 'tk:start', platform, usage });
}

/** Print da aba visivel, recortado na area do grafico e reduzido. */
async function captureChart(
  windowId: number,
  rect: Rect,
  viewport: { width: number; height: number },
): Promise<{ blob: Blob; rect: Rect }> {
  const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const px = cropRectToPixels(rect, viewport, bitmap);
  if (!px) throw new Error('empty crop');
  const size = fitWithin(px.w, px.h, MAX_SIDE);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bitmap, px.x, px.y, px.w, px.h, 0, 0, size.width, size.height);
  bitmap.close();
  return { blob: await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 }), rect };
}

async function analyze(tabId: number, blob: Blob, rect: Rect, platform: Platform, meta: PageMeta): Promise<void> {
  await showView(tabId, { kind: 'analyzing', meta });
  try {
    const created = await api.analyze(blob, {
      platform,
      chartSymbol: meta.symbol,
      chartTimeframe: meta.timeframe,
      userLanguage: userLanguage(),
    });
    const analysis = await api.waitForAnalysis(created.id);
    if (analysis.status === 'failed') return showView(tabId, { kind: 'error', reason: 'failed' });
    const usage = await api.usage().catch(() => null);
    await showView(tabId, { kind: 'result', analysis, usage, rect, meta });
    busyTabs.delete(tabId); // a leitura do eixo abaixo nao segura um novo clique
    await browser.storage.session.set({ [lastKey(tabId)]: { analysis, usage, rect, meta } });
    // Linhas: so com a escala do eixo lida pelo servidor (o entryY/stopY do
    // motor errou ate ~82 px na medicao de 06/10). Sem escala, so os precos.
    const rec = String(analysis.recommendation ?? '').toUpperCase();
    if (rec === 'BUY' || rec === 'SELL') {
      const axis = await api.priceAxis(analysis.id).catch(() => null);
      if (axis && typeof axis.top === 'number' && typeof axis.bottom === 'number') {
        await sendToTab(tabId, { type: 'tk:axis', analysisId: analysis.id, axis: { top: axis.top, bottom: axis.bottom } });
      }
    }
  } catch (err) {
    if (err instanceof ApiError && err.kind === 'quota') {
      return showView(tabId, { kind: 'paywall', usage: await api.usage().catch(() => null) });
    }
    if (err instanceof ApiError && err.kind === 'auth') return showView(tabId, { kind: 'signin' });
    await showView(tabId, errorView(err));
  } finally {
    busyTabs.delete(tabId);
  }
}

/**
 * Menu "Show my last Tickrify analysis": reabre o ultimo resultado da aba (ate
 * depois de recarregar a pagina), sem analise nova e sem gastar nada.
 */
async function showLast(tab: { id?: number }): Promise<void> {
  if (!tab.id || !(await ensurePanel(tab.id))) return;
  const stored = (await browser.storage.session.get(lastKey(tab.id)))[lastKey(tab.id)] as
    | Omit<Extract<PanelView, { kind: 'result' }>, 'kind'>
    | undefined;
  await showView(tab.id, stored ? { kind: 'result', ...stored, restored: true } : { kind: 'empty' });
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    const t = strings();
    browser.contextMenus.create({ id: MENU_ID, title: t.menuAnalyze, contexts: ['all'] });
    browser.contextMenus.create({ id: MENU_LAST, title: t.menuLast, contexts: ['all'] });
  });

  browser.action.onClicked.addListener((tab) => void start(tab));
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID && tab) void start(tab);
    if (info.menuItemId === MENU_LAST && tab) void showLast(tab);
  });

  // sendResponse + `return true` (e nao Promise devolvida): funciona em todo Chrome MV3.
  browser.runtime.onMessage.addListener((raw: unknown, sender, sendResponse: (reply: CaptureReply) => void) => {
    const message = raw as ToBackground;
    const tab = sender.tab;
    if (!tab?.id) return undefined;
    const tabId = tab.id;

    if (message.type === 'tk:capture') {
      if (busyTabs.has(tabId)) {
        sendResponse({ ok: true });
        return undefined;
      }
      busyTabs.add(tabId);
      // Responde assim que o print sai (o painel volta a aparecer) e segue
      // com a analise sem segurar a mensagem.
      captureChart(tab.windowId, message.rect, message.viewport).then(
        ({ blob, rect }) => {
          void analyze(tabId, blob, rect, message.platform, message.meta);
          sendResponse({ ok: true });
        },
        (err) => {
          busyTabs.delete(tabId);
          console.error('[Tickrify] captura', err);
          sendResponse({ ok: false, reason: reasonFrom(err) });
        },
      );
      return true;
    }
    if (message.type === 'tk:again') {
      void start(tab, true);
      return undefined;
    }
    if (message.type === 'tk:remind') {
      void browser.storage.session.set({ [`remind:${tabId}`]: message.label });
      void browser.alarms.create(`remind:${tabId}`, { delayInMinutes: message.minutes });
      return undefined;
    }
    return undefined;
  });

  // Lembrete do WAIT: so avisa. Quem decide se analisa de novo e o trader.
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith('remind:')) return;
    const stored = await browser.storage.session.get(alarm.name);
    const t = strings();
    const label = String(stored[alarm.name] ?? t.yourChart);
    await browser.notifications.create(alarm.name, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: 'Tickrify',
      message: t.remindNotification(label),
    });
  });

  browser.notifications.onClicked.addListener(async (id) => {
    if (!id.startsWith('remind:')) return;
    const tabId = Number(id.slice('remind:'.length));
    const tab = await browser.tabs.update(tabId, { active: true }).catch(() => null);
    if (tab?.windowId) await browser.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
    await browser.notifications.clear(id);
  });

  browser.tabs.onRemoved.addListener((tabId) => void browser.storage.session.remove(lastKey(tabId)));

  // So no build de teste (API falsa, WXT_TEST_TOKEN): o Puppeteer nao clica em
  // item de menu de contexto, entao a suite chama o mesmo handler por aqui.
  if (TEST_TOKEN) (globalThis as { tickrifyTest?: unknown }).tickrifyTest = { showLast };
});
