import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MarketPlanCard } from '@/components/dashboard/WatchPlanCard';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

const levels = { entry: 74535, stopLoss: 74380, takeProfit1: 74768, takeProfit2: null, tp1R: 1.5, riskAtr: 1.3 };
const price = (value: number | null) => (value === null ? '' : `$${value.toLocaleString('en-US')}`);

function renderCard(direction: 'long' | 'short', language = 'en') {
  window.localStorage.setItem('tickrify-language', language);
  return render(
    <LanguageProvider>
      <MarketPlanCard direction={direction} levels={levels} formatPrice={price} />
    </LanguageProvider>,
  );
}

describe('plano a mercado ao lado do WATCH', () => {
  afterEach(cleanup);

  it('mostra entrada, stop, alvo, risco em ATR e o R, com a direcao do plano', () => {
    renderCard('long');
    expect(screen.getByText('Or enter at the current price')).toBeTruthy();
    expect(screen.getByText('Buy now')).toBeTruthy();
    expect(screen.getByText('$74,535')).toBeTruthy();
    expect(screen.getByText('$74,380')).toBeTruthy();
    expect(screen.getByText('$74,768')).toBeTruthy();
    expect(screen.getByText('1.3 ATR')).toBeTruthy();
    expect(screen.getByText('1.5R')).toBeTruthy();
  });

  it('diz que o checklist segurou a entrada e que nenhum plano tem vantagem medida', () => {
    renderCard('short');
    expect(screen.getByText('Sell now')).toBeTruthy();
    const note = screen.getByText(/Neither plan has a measured edge over the other/);
    expect(note.textContent).toContain('the read stays Watch');
    expect(note.textContent).toContain('The decision is yours.');
    expect(document.body.textContent?.includes('—')).toBe(false);
  });

  it('texto traduzido (portugues)', () => {
    renderCard('long', 'pt');
    expect(screen.getByText('Ou entrar ao preço de agora')).toBeTruthy();
    expect(screen.getByText('Comprar agora')).toBeTruthy();
  });
});
