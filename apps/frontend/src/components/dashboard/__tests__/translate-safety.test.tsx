import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NewAnalysis from '@/components/dashboard/NewAnalysis';
import ProtectedRoute from '@/components/routing/ProtectedRoute';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { getTranslations } from '@/lib/i18n';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
}));

/**
 * O que o Google Translate faz com a pagina: troca cada no de texto por
 * `<font><font>texto traduzido</font></font>` e marca o <html> com
 * `translated-ltr`. O React continua com a referencia do no de texto ANTIGO;
 * quando tenta remover ou inserir ao lado dele, o navegador lanca
 * "Failed to execute 'removeChild' on 'Node'" e o painel cai no ErrorBoundary.
 */
function simulateGoogleTranslate(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.nodeValue?.trim()) textNodes.push(node);
  }
  for (const node of textNodes) {
    const outer = document.createElement('font');
    const inner = document.createElement('font');
    inner.textContent = `(pt) ${node.nodeValue}`;
    outer.appendChild(inner);
    node.parentNode?.replaceChild(outer, node);
  }
  document.documentElement.classList.add('translated-ltr');
}

function dragEvent() {
  const file = new File(['x'], 'chart.png', { type: 'image/png' });
  return {
    dataTransfer: { files: [file], items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], types: ['Files'] },
  };
}

describe('painel com a pagina traduzida pelo navegador', () => {
  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove('translated-ltr');
  });

  it('arrastar o grafico sobre a area de envio nao derruba a tela', async () => {
    window.localStorage.setItem('tickrify-language', 'en');
    const { container } = render(
      <LanguageProvider>
        <NewAnalysis onStartAnalysis={() => undefined} />
      </LanguageProvider>,
    );
    simulateGoogleTranslate(container);

    const dropzone = container.querySelector('input[type="file"]')!.parentElement!;
    await act(async () => {
      fireEvent.dragEnter(dropzone, dragEvent());
    });
    await act(async () => {
      fireEvent.dragLeave(dropzone, dragEvent());
    });

    expect(screen.getByRole('heading', { level: 3 })).toBeTruthy();
  });

  it.each(['pt', 'en', 'es', 'fr', 'de', 'ja'] as const)('guia dos prints extras abre e fecha com a pagina traduzida (%s)', async (lang) => {
    window.localStorage.setItem('tickrify-language', lang);
    const u = getTranslations(lang).analysis.upload;
    for (const key of ['mainChartHint', 'directionChart', 'directionChartHint', 'setupChart', 'setupChartHint', 'optional', 'guideTitle', 'guideIntro', 'guideExamplesTitle', 'guideSingle', 'extraTimeframeLabel', 'lowerTfWarning'] as const) {
      expect(u[key].trim().length).toBeGreaterThan(0);
      expect(u[key]).not.toMatch(/\u2014/);
    }
    expect(u.guideExamples).toHaveLength(3);
    URL.createObjectURL = vi.fn(() => 'blob:chart');
    const { container } = render(
      <LanguageProvider>
        <NewAnalysis onStartAnalysis={() => undefined} />
      </LanguageProvider>,
    );
    const drop = dragEvent();
    Object.defineProperty(drop.dataTransfer.files[0], 'arrayBuffer', { value: async () => new ArrayBuffer(1) });
    await act(async () => {
      fireEvent.drop(container.querySelector('[role="presentation"]')!, drop);
    });
    const toggle = await screen.findByRole('button', { name: u.guideTitle });
    simulateGoogleTranslate(container);
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(screen.getByText(u.guideSingle)).toBeTruthy();
    simulateGoogleTranslate(container);
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('area logada desliga a traducao do navegador e devolve ao sair', () => {
    const { unmount } = render(
      <MemoryRouter>
        <ProtectedRoute>
          <p>painel</p>
        </ProtectedRoute>
      </MemoryRouter>,
    );
    expect(document.documentElement.getAttribute('translate')).toBe('no');
    expect(document.documentElement.classList.contains('notranslate')).toBe(true);

    unmount();
    expect(document.documentElement.hasAttribute('translate')).toBe(false);
    expect(document.documentElement.classList.contains('notranslate')).toBe(false);
  });
});
