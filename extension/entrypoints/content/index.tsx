import { createRoot, type Root } from 'react-dom/client';
import logo from '@/public/icon/48.png?inline';
import type { PanelMessage, ToContent } from '@/lib/messages';
import { App, type Bus } from './App';
import styles from './styles.css?inline';

declare global {
  interface Window {
    __tickrifyLoaded?: boolean;
  }
}

/**
 * Injetado pelo service worker SO depois do clique do trader (activeTab). Nada
 * da Tickrify roda numa pagina antes disso. O painel mora num Shadow DOM: o CSS
 * da plataforma nao entra e o nosso nao sai.
 */
export default defineContentScript({
  registration: 'runtime',
  matches: [],
  cssInjectionMode: 'manual',
  async main(ctx) {
    // O mesmo arquivo e injetado a cada clique; o painel so nasce uma vez.
    if (window.__tickrifyLoaded) return;
    window.__tickrifyLoaded = true;

    const listeners = new Set<(message: PanelMessage) => void>();
    const bus: Bus = {
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
    // A mensagem do service worker pode chegar antes do React montar: guarda.
    const pending: PanelMessage[] = [];
    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (alive: boolean) => void) => {
      const m = message as ToContent;
      // O service worker pergunta antes de injetar de novo (ver background.ts).
      if (m?.type === 'tk:ping') {
        sendResponse(true);
        return;
      }
      if (m?.type !== 'tk:start' && m?.type !== 'tk:view' && m?.type !== 'tk:axis') return;
      if (listeners.size === 0) pending.push(m);
      else listeners.forEach((fn) => fn(m));
    });

    const ui = await createShadowRootUi<Root>(ctx, {
      name: 'tickrify-panel',
      position: 'inline',
      anchor: 'body',
      append: 'last',
      css: styles,
      isolateEvents: true,
      onMount(container) {
        // Esconde por DENTRO do Shadow DOM. No host nao funciona: o reset do WXT
        // (`:host { all: initial !important }`) ganha do estilo inline, e o
        // painel saia dentro do print (06/10, pego no teste automatizado).
        const setHidden = (hidden: boolean) => {
          container.style.visibility = hidden ? 'hidden' : '';
        };
        const root = createRoot(container);
        root.render(<App bus={bus} logo={logo} setHidden={setHidden} />);
        // Entrega o que chegou antes de montar, depois do primeiro render.
        setTimeout(() => {
          pending.splice(0).forEach((m) => listeners.forEach((fn) => fn(m)));
        }, 0);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
