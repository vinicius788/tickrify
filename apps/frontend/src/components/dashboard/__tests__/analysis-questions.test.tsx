import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AnalysisQuestions from '@/components/dashboard/AnalysisQuestions';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { getTranslations } from '@/lib/i18n';
import { APIError } from '@/lib/api';

const listQuestions = vi.fn();
const askQuestion = vi.fn();
const track = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  useAPIClient: () => ({ listQuestions, askQuestion }),
}));
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  track: (...args: unknown[]) => track(...args),
}));

const en = getTranslations('en').askAnalysis;

function renderBox(signalState: 'WATCH' | 'NO_TRADE' | 'ENTER_NOW' | 'ARMED' = 'WATCH') {
  window.localStorage.setItem('tickrify-language', 'en');
  return render(
    <LanguageProvider>
      <AnalysisQuestions analysisId="a1" signalState={signalState} />
    </LanguageProvider>,
  );
}

/** Igual ao translate-safety.test.tsx: troca cada no de texto por <font>. */
function simulateGoogleTranslate(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.nodeValue?.trim()) nodes.push(node);
  }
  for (const node of nodes) {
    const font = document.createElement('font');
    font.textContent = `(pt) ${node.nodeValue}`;
    node.parentNode?.replaceChild(font, node);
  }
}

describe('Ask about this analysis', () => {
  beforeEach(() => {
    listQuestions.mockReset().mockResolvedValue({ items: [], remaining: 3, perAnalysis: 3 });
    askQuestion.mockReset();
    track.mockReset();
  });
  afterEach(() => cleanup());

  it.each([
    ['WATCH', ['Why wait instead of entering?', 'What has to happen to enter?']],
    ['ARMED', ['Why wait instead of entering?', 'What has to happen to enter?']],
    ['NO_TRADE', ['Why no trade here?', 'What would change this?']],
    ['ENTER_NOW', ['Why enter now?', 'What invalidates this trade?']],
  ] as const)('sugestoes pelo estado %s, contador e aviso fixo', async (state, expected) => {
    renderBox(state);
    expect(await screen.findByText(en.title)).toBeTruthy();
    for (const s of expected) expect(screen.getByRole('button', { name: s })).toBeTruthy();
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('type') === 'button')).toHaveLength(3);
    expect(screen.getByTestId('questions-left').textContent).toBe('3 questions left');
    expect(screen.getByText('Explains this analysis. Educational, not financial advice.')).toBeTruthy();
    const input = screen.getByRole('textbox');
    expect(input.className).toContain('text-base');
  });

  it('sugestao clicada pergunta, mostra o historico e desce o contador', async () => {
    askQuestion.mockResolvedValue({ item: { id: 'q1', question: 'Why wait instead of entering?', answer: 'Price is stretched above the range.', createdAt: '2026-11-25T10:00:00Z' }, remaining: 1, perAnalysis: 3 });
    renderBox('WATCH');
    fireEvent.click(await screen.findByRole('button', { name: 'Why wait instead of entering?' }));
    expect(await screen.findByText('Price is stretched above the range.')).toBeTruthy();
    expect(askQuestion).toHaveBeenCalledWith('a1', 'Why wait instead of entering?');
    expect(track).toHaveBeenCalledWith('analysis_question_clicked', { suggestion: true });
    expect(screen.getByTestId('questions-left').textContent).toBe('1 question left');
  });

  it('pergunta digitada manda suggestion=false; curta nao sai', async () => {
    askQuestion.mockResolvedValue({ item: { id: 'q2', question: 'Is the stop far?', answer: 'The stop sits below the swing.', createdAt: '2026-11-25T10:00:00Z' }, remaining: 2, perAnalysis: 3 });
    renderBox('ENTER_NOW');
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: en.send }));
    expect(await screen.findByText(en.tooShort)).toBeTruthy();
    expect(askQuestion).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Is the stop far?' } });
    fireEvent.click(screen.getByRole('button', { name: en.send }));
    expect(await screen.findByText('The stop sits below the swing.')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('analysis_question_clicked', { suggestion: false });
  });

  it('falha mostra a mensagem e o contador nao muda; limite do dia fecha a caixa', async () => {
    askQuestion.mockRejectedValueOnce(new APIError("Couldn't answer right now, try again", 503, 'question_failed'));
    renderBox('NO_TRADE');
    fireEvent.click(await screen.findByRole('button', { name: 'Why no trade here?' }));
    expect(await screen.findByText(en.error)).toBeTruthy();
    expect(screen.getByTestId('questions-left').textContent).toBe('3 questions left');
    askQuestion.mockRejectedValueOnce(new APIError('Question limit reached', 429, 'question_limit', undefined, { scope: 'day' }));
    fireEvent.click(screen.getByRole('button', { name: 'What would change this?' }));
    expect(await screen.findByText(en.noneDay)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('sem perguntas restantes: mostra o historico e nao o campo; 402 esconde a caixa', async () => {
    listQuestions.mockResolvedValueOnce({ items: [{ id: 'q1', question: 'Why wait?', answer: 'Stretched.', createdAt: '2026-11-25T10:00:00Z' }], remaining: 0, perAnalysis: 3 });
    renderBox('WATCH');
    expect(await screen.findByText('Stretched.')).toBeTruthy();
    expect(screen.getByText(en.noneAnalysis)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    cleanup();
    listQuestions.mockRejectedValueOnce(new APIError('locked', 402, 'free_quota_exhausted'));
    const { container } = renderBox('WATCH');
    await waitFor(() => expect(listQuestions).toHaveBeenCalledTimes(2));
    expect(container.querySelector('[data-testid="analysis-questions"]')).toBeNull();
  });

  it('com a pagina traduzida pelo navegador, perguntar e falhar nao derruba a tela', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    askQuestion.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const { container } = renderBox('WATCH');
    await screen.findByText(en.title);
    simulateGoogleTranslate(container);
    fireEvent.click(container.querySelectorAll('button[type="button"]')[0]);
    await act(async () => {
      resolve({ item: { id: 'q1', question: 'Why wait?', answer: 'Stretched.', createdAt: '2026-11-25T10:00:00Z' }, remaining: 0, perAnalysis: 3 });
    });
    expect(container.textContent).toContain('Stretched.');
    expect(container.textContent).toContain(en.noneAnalysis);
  });
});
