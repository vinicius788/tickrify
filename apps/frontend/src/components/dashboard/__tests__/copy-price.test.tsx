import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyPrice, PriceTemplate } from '@/components/dashboard/CopyPrice';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import en from '@/lib/i18n/en';

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  cleanup();
});

describe('CopyPrice', () => {
  it('copia o valor cru, sem separador nem moeda, e mostra Copied', async () => {
    render(<LanguageProvider><CopyPrice value={74470.5} text="$74,470.50" /></LanguageProvider>);
    const button = screen.getByRole('button', { name: `${en.analysis.result.copyPrice}: $74,470.50` });
    await userEvent.click(button);
    expect(writeText).toHaveBeenCalledWith('74470.5');
    expect((await screen.findByRole('status')).textContent).toBe(en.analysis.result.copied);
  });

  it('funciona pelo teclado com Enter e Espaco', async () => {
    render(<LanguageProvider><CopyPrice value={1.0855} text="1.0855" /></LanguageProvider>);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button'));
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenLastCalledWith('1.0855');
  });

  it('sem valor numerico vira so texto', () => {
    render(<LanguageProvider><CopyPrice value={null} text="n/a" /></LanguageProvider>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('n/a')).toBeTruthy();
  });

  it('PriceTemplate troca cada marcador por um botao de copiar', async () => {
    render(
      <LanguageProvider>
        <PriceTemplate template="Stop {stop} · Target {target}" prices={{ stop: { value: 74310, text: '$74,310' }, target: { value: 74710, text: '$74,710' } }} />
      </LanguageProvider>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(2);
    await userEvent.click(screen.getAllByRole('button')[1]);
    expect(writeText).toHaveBeenCalledWith('74710');
  });
});
