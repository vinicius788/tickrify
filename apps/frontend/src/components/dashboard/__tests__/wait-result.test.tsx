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

const at = (text: string, s: string) => text.indexOf(s);

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

  it('WAIT mostra a acao, a explicacao de risco, a leitura e depois o plano, tudo antes do grafico', () => {
    renderResult('WAIT');
    const text = document.body.textContent ?? '';
    expect(screen.getByTestId('verdict-action').textContent).toBe('WAIT');
    expect(text).toContain('Waiting is a risk decision, not a forecast.');
    expect(text).toContain('Price is stuck mid range with no confirmation.');
    expect(text).toContain('A close above 2365 would set up a long.');
    // Ordem: acao, explicacao, leitura, plano, grafico.
    const at = (s: string) => text.indexOf(s);
    expect(at('Waiting is a risk decision')).toBeLessThan(at('Price is stuck mid range'));
    expect(at('Price is stuck mid range')).toBeLessThan(at('A close above 2365'));
    expect(at('A close above 2365')).toBeLessThan(at('Analyzed chart'));
    // A explicacao aparece uma vez so, e "Por que nao o outro lado" nao se
    // repete no painel tecnico (ja esta no plano).
    expect(text.split('Waiting is a risk decision').length).toBe(2);
    expect(text.split('No bearish structure break yet.').length).toBe(2);
  });

  it('acao e vies ficam separados: a acao e o destaque, o vies e secundario', () => {
    renderResult('WAIT');
    expect(screen.getByTestId('verdict-action').textContent).toBe('WAIT');
    expect(document.body.textContent).toContain('Current bias: Neutral');
    // Nenhum selo de cenario em maiusculas competindo com a acao.
    expect(screen.queryByText('NEUTRAL')).toBeNull();
    expect(screen.queryByText('HOLD')).toBeNull();
  });

  it('preco sai sem cifrao fixo e a ordem limitada explica a espera pela entrada', () => {
    renderResult('BUY');
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('$');
    expect(text).toContain('Limit order: the trade only exists if price reaches 2,350.50.');
    expect(at(text, 'BUY')).toBeLessThan(at(text, 'Operation Levels'));
    expect(at(text, 'Operation Levels')).toBeLessThan(at(text, 'Risk and reward'));
    expect(at(text, 'Risk and reward')).toBeLessThan(at(text, 'Analyzed chart'));
  });

  it('BUY continua com o card de niveis', () => {
    renderResult('BUY');
    expect(screen.getByTestId('levels-card')).toBeTruthy();
  });
});
