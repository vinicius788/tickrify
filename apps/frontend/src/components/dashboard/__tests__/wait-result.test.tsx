import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AnalysisResult from '@/components/dashboard/AnalysisResult';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { AIAnalysisResponse } from '@/lib/api';

// Dados externos da tela (calendario e mercado ao vivo) nao entram aqui.
vi.mock('@/hooks/useEconomicCalendar', () => ({ useEconomicCalendar: () => ({ events: [], loading: false, unreliable: false }) }));
vi.mock('@/hooks/useMarketContext', () => ({ useMarketContext: () => ({ data: undefined, isLoading: false }) }));

function analysis(recommendation: 'BUY' | 'WAIT'): AIAnalysisResponse {
  return {
    id: 'a1',
    status: 'completed',
    createdAt: '2026-09-28T12:00:00Z',
    updatedAt: '2026-09-28T12:00:00Z',
    recommendation,
    confidence: 55,
    fullResponse: {
      recommendation,
      bias: 'neutral',
      confidence: 55,
      reasoning: 'Range between two levels.',
      analysis: {
        symbol: 'XAUUSD',
        timeframe: '1H',
        entry: 2350.5,
        stopLoss: 2340.25,
        takeProfit1: 2370.75,
        takeProfit2: 2390.1,
        riskRewardRatio: '2:1',
        entryType: 'limit',
        executiveSummary: 'Price is stuck mid range with no confirmation.',
        entryCondition: 'A close above 2365 would set up a long.',
        invalidationNote: 'A break below 2330 kills the idea.',
        whyNotOpposite: 'No bearish structure break yet.',
      },
    } as unknown as AIAnalysisResponse['fullResponse'],
  };
}

function renderResult(rec: 'BUY' | 'WAIT') {
  return render(
    <LanguageProvider>
      <AnalysisResult analysisData={analysis(rec)} uploadedImage={null} />
    </LanguageProvider>,
  );
}

describe('resultado WAIT', () => {
  afterEach(cleanup);

  it('WAIT esconde o card de niveis e nenhum preco operavel aparece', () => {
    renderResult('WAIT');
    expect(screen.queryByTestId('levels-card')).toBeNull();
    const text = document.body.textContent ?? '';
    for (const price of ['2,350.5', '2350.5', '2,340.25', '2340.25', '2,370.75', '2370.75']) {
      expect(text).not.toContain(price);
    }
  });

  it('WAIT mostra a explicacao, o plano e a leitura logo abaixo do veredito', () => {
    renderResult('WAIT');
    const text = document.body.textContent ?? '';
    expect(text).toContain('No trade means the AI found no clean setup on this chart right now.');
    expect(text).toContain('A close above 2365 would set up a long.');
    expect(text).toContain('Price is stuck mid range with no confirmation.');
    // Ordem: explicacao, depois plano, depois leitura, tudo antes do grafico.
    // (a leitura tambem abre o painel do modo leitura, no topo: vale a ultima ocorrencia).
    const at = (s: string) => text.lastIndexOf(s);
    expect(at('No trade means')).toBeLessThan(at('A close above 2365'));
    expect(at('A close above 2365')).toBeLessThan(at('Price is stuck mid range'));
  });

  it('BUY continua com o card de niveis', () => {
    renderResult('BUY');
    expect(screen.getByTestId('levels-card')).toBeTruthy();
  });
});
