import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecentAnalysesSection from '@/components/landing/RecentAnalysesSection';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import en from '@/lib/i18n/en';

/**
 * A tabela "48 hours later" é o recibo público da vitrine (30/09/2026). Duas
 * coisas nela não podem quebrar caladas: perda e entrada não atingida aparecem
 * junto com o ganho (nada escolhido a dedo), e sem dado real a parte some em
 * vez de mostrar algo inventado.
 */

const recent = vi.fn();
const scored = vi.fn();
vi.mock('@/hooks/useRecentPublicAnalyses', () => ({
  useRecentPublicAnalyses: () => recent(),
  useScoredPublicAnalyses: () => scored(),
}));

const read = (id: string) => ({
  id, recommendation: 'BUY', bias: 'bullish', createdAt: new Date().toISOString(),
  symbol: 'BTCUSDT', timeframe: '1H', entry: 100, stopLoss: 95, takeProfit1: 110,
});
const result = (id: string, outcome: string) => ({
  id, recommendation: 'SELL', createdAt: '2026-09-28T14:05:00.000Z', outcome, outcomeAt: '2026-09-30T15:00:00.000Z',
  symbol: 'XAUUSD', timeframe: '15M', entry: 4261.4, stopLoss: 4280, takeProfit1: 4230,
});

const renderSection = () =>
  render(
    <MemoryRouter>
      <LanguageProvider>
        <RecentAnalysesSection />
      </LanguageProvider>
    </MemoryRouter>,
  );

describe('RecentAnalysesSection, recibos de 48h', () => {
  beforeEach(() => {
    window.localStorage.setItem('tickrify-language', 'en');
    recent.mockReturnValue({ analyses: [read('a'), read('b'), read('c')], loading: false, failed: false });
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('mostra ganho, perda e entrada não atingida lado a lado, com a hora da leitura em UTC', () => {
    scored.mockReturnValue({
      scored: [result('w', 'WIN'), result('l', 'LOSS'), result('n', 'NO_FILL')],
      loading: false,
      failed: false,
    });
    renderSection();
    const r = en.landing.recent;
    expect(screen.getByText(r.scoredTitle)).toBeTruthy();
    expect(screen.getByText(r.outcomeWin)).toBeTruthy();
    expect(screen.getByText(r.outcomeLoss)).toBeTruthy();
    expect(screen.getByText(r.outcomeNoFill)).toBeTruthy();
    expect(screen.getAllByText('Sep 28, 14:05 UTC')).toHaveLength(3);
  });

  it('some quando não há resultado suficiente, sem preencher com nada', () => {
    scored.mockReturnValue({ scored: [result('w', 'WIN')], loading: false, failed: false });
    renderSection();
    expect(screen.queryByText(en.landing.recent.scoredTitle)).toBeNull();
  });

  it('não mostra confiança em lugar nenhum da lista', () => {
    scored.mockReturnValue({ scored: [], loading: false, failed: true });
    const { container } = renderSection();
    expect(container.textContent).not.toMatch(/\d+%/);
  });
});
