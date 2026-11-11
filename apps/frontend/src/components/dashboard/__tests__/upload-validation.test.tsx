import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewAnalysis from '../NewAnalysis';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { MAX_CHART_BYTES } from '@/lib/chart-upload';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
const start = vi.fn();
function file(type: string, size = 10) {
  const f = new File(['image'], type === 'image/png' ? 'chart.png' : 'chart.gif', { type });
  Object.defineProperty(f, 'size', { value: size });
  Object.defineProperty(f, 'arrayBuffer', { value: async () => new ArrayBuffer(10) });
  return f;
}
function drop(f: File) {
  fireEvent.drop(document.querySelector('[role="presentation"]')!, {
    dataTransfer: { files: [f], items: [{ kind: 'file', type: f.type, getAsFile: () => f }], types: ['Files'] },
  });
}

describe('chart upload validation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:chart');
  });
  afterEach(cleanup);

  it.each([
    ['image/gif', 10, 'Unsupported file. Choose a PNG, JPG/JPEG or WEBP image.'],
    ['image/png', MAX_CHART_BYTES + 1, 'File too large. Maximum size: 10 MB per image.'],
  ])('arquivo principal rejeitado mostra o motivo sem chamar a IA: %s', async (type, size, message) => {
    render(<LanguageProvider><NewAnalysis onStartAnalysis={start} /></LanguageProvider>);
    drop(file(type, size));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(start).not.toHaveBeenCalled();
    drop(file('image/png'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText('Main chart (execution timeframe)')).toBeTruthy();
  });

  it('timeframe maior rejeitado informa limite e preserva o grafico principal', async () => {
    render(<LanguageProvider><NewAnalysis onStartAnalysis={start} /></LanguageProvider>);
    drop(file('image/png'));
    await screen.findByText('Main chart (execution timeframe)');
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file('image/png', MAX_CHART_BYTES + 1)] } });
    expect(screen.getByRole('alert').textContent).toContain('10 MB');
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByText('Main chart (execution timeframe)')).toBeTruthy();
  });

  describe('qual ativo e este (lista do My assets)', () => {
    const choices = { symbols: ['XAUUSD', 'BTCUSDT'], timeframe: '5m', timeframes: ['1m', '5m', '15m', '1h', '4h'] };
    const onHint = vi.fn();
    const open = async (props: Record<string, unknown> = {}) => {
      render(<LanguageProvider><NewAnalysis onStartAnalysis={start} assetChoices={choices} onAssetHintChange={onHint} {...props} /></LanguageProvider>);
      drop(file('image/png'));
      await screen.findByText('Main chart (execution timeframe)');
    };

    it('sem lista, a pergunta nao aparece', async () => {
      render(<LanguageProvider><NewAnalysis onStartAnalysis={start} /></LanguageProvider>);
      drop(file('image/png'));
      await screen.findByText('Main chart (execution timeframe)');
      expect(screen.queryByText('Which asset is this? (optional)')).toBeNull();
    });

    it('comeca em Auto; escolher um ativo manda a dica com o tempo grafico da lista', async () => {
      await open();
      expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'XAUUSD' }));
      expect(onHint).toHaveBeenLastCalledWith({ symbol: 'XAUUSD', timeframe: '5m' });
      fireEvent.click(screen.getByRole('button', { name: '15m' }));
      expect(onHint).toHaveBeenLastCalledWith({ symbol: 'XAUUSD', timeframe: '15m' });
    });

    it('voltar para Auto ou trocar de grafico tira a dica', async () => {
      await open();
      fireEvent.click(screen.getByRole('button', { name: 'BTCUSDT' }));
      fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
      expect(onHint).toHaveBeenLastCalledWith(null);
      fireEvent.click(screen.getByRole('button', { name: 'BTCUSDT' }));
      fireEvent.click(screen.getByRole('button', { name: 'Change' }));
      expect(onHint).toHaveBeenLastCalledWith(null);
    });
  });
});
