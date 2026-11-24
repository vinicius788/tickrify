import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { track } from '@/lib/analytics';
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
    expect(screen.getByText('Your entry chart')).toBeTruthy();
  });

  it('timeframe maior rejeitado informa limite e preserva o grafico principal', async () => {
    render(<LanguageProvider><NewAnalysis onStartAnalysis={start} /></LanguageProvider>);
    drop(file('image/png'));
    await screen.findByText('Your entry chart');
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file('image/png', MAX_CHART_BYTES + 1)] } });
    expect(screen.getByRole('alert').textContent).toContain('10 MB');
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByText('Your entry chart')).toBeTruthy();
  });

  describe('qual ativo e este (lista do My assets)', () => {
    const choices = { symbols: ['XAUUSD', 'BTCUSDT'], timeframe: '5m', timeframes: ['1m', '5m', '15m', '1h', '4h'] };
    const onHint = vi.fn();
    const open = async (props: Record<string, unknown> = {}) => {
      render(<LanguageProvider><NewAnalysis onStartAnalysis={start} assetChoices={choices} onAssetHintChange={onHint} {...props} /></LanguageProvider>);
      drop(file('image/png'));
      await screen.findByText('Your entry chart');
    };

    it('sem lista, a pergunta nao aparece', async () => {
      render(<LanguageProvider><NewAnalysis onStartAnalysis={start} /></LanguageProvider>);
      drop(file('image/png'));
      await screen.findByText('Your entry chart');
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

  describe('prints extras por papel (top-down)', () => {
    const open = async () => {
      render(<LanguageProvider><NewAnalysis onStartAnalysis={start} /></LanguageProvider>);
      drop(file('image/png'));
      await screen.findByText('Your entry chart');
    };

    it('os 3 espacos tem rotulo e dica', async () => {
      await open();
      expect(screen.getByText("The timeframe you'll trade. Your plan (entry, stop, target) comes from this one.")).toBeTruthy();
      expect(screen.getByText('Higher timeframe: direction')).toBeTruthy();
      expect(screen.getByText('About 4 to 6 times your entry timeframe or more. Example: 4H for a 5m entry.')).toBeTruthy();
      expect(screen.getByText('Middle timeframe: setup')).toBeTruthy();
      expect(screen.getByText('Between the two. Example: 1H for a 5m entry.')).toBeTruthy();
    });

    it('o guia comeca fechado, abre e fecha com um clique e conta so a abertura', async () => {
      await open();
      const toggle = screen.getByRole('button', { name: 'How to choose your charts' });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByText('5m entry: 4H for direction, 1H for setup')).toBeNull();
      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText('1H entry: Daily for direction, 4H for setup')).toBeTruthy();
      expect(screen.getByText(/already checks a higher timeframe from live market data when it's available/)).toBeTruthy();
      fireEvent.click(toggle);
      expect(screen.queryByText('5m entry: 4H for direction, 1H for setup')).toBeNull();
      expect(vi.mocked(track).mock.calls.filter(([name]) => name === 'upload_guide_opened')).toHaveLength(1);
    });

    it('cada print extra vai na ordem do papel, e tirar o de direcao nao muda o do setup', async () => {
      await open();
      fireEvent.change(screen.getByLabelText('Middle timeframe: setup'), { target: { files: [file('image/png')] } });
      fireEvent.change(screen.getByLabelText('Higher timeframe: direction'), { target: { files: [file('image/png')] } });
      expect(screen.getByText('Top-down analysis with 3 charts')).toBeTruthy();
      fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
      expect(screen.getByText('Top-down analysis with 2 charts')).toBeTruthy();
      expect(screen.getByRole('img', { name: 'Middle timeframe: setup' })).toBeTruthy();
      expect(screen.getByLabelText('Higher timeframe: direction')).toBeTruthy();
    });

    describe('aviso de tempo menor que o do principal', () => {
      const choices = { symbols: ['XAUUSD'], timeframe: '1h', timeframes: ['5m', '15m', '1h', '4h'] };
      const openWithHint = async (withHint: boolean) => {
        render(<LanguageProvider><NewAnalysis onStartAnalysis={start} assetChoices={choices} /></LanguageProvider>);
        drop(file('image/png'));
        await screen.findByText('Your entry chart');
        if (withHint) fireEvent.click(screen.getByRole('button', { name: 'XAUUSD' }));
        fireEvent.change(screen.getByLabelText('Higher timeframe: direction'), { target: { files: [file('image/png')] } });
        return within(screen.getByRole('group', { name: 'Timeframe of this chart: Higher timeframe: direction' }));
      };
      const warning = 'Extra charts work best on higher timeframes than your entry chart.';

      it('aparece com extra menor que o principal, some ao corrigir e nao bloqueia o envio', async () => {
        const chips = await openWithHint(true);
        expect(screen.queryByText(warning)).toBeNull();
        fireEvent.click(chips.getByRole('button', { name: '15m' }));
        expect(screen.getByText(warning)).toBeTruthy();
        fireEvent.click(chips.getByRole('button', { name: '4h' }));
        expect(screen.queryByText(warning)).toBeNull();
        fireEvent.click(chips.getByRole('button', { name: '5m' }));
        expect((screen.getByRole('button', { name: 'Analyze chart' }) as HTMLButtonElement).disabled).toBe(false);
      });

      it('mesmo tempo do principal nao avisa', async () => {
        const chips = await openWithHint(true);
        fireEvent.click(chips.getByRole('button', { name: '1h' }));
        expect(screen.queryByText(warning)).toBeNull();
      });

      it('sem o tempo do principal (sem dica de ativo) nao avisa', async () => {
        const chips = await openWithHint(false);
        fireEvent.click(chips.getByRole('button', { name: '5m' }));
        expect(screen.queryByText(warning)).toBeNull();
      });
    });

    it('sem acesso a prints extras, nada disso aparece', async () => {
      render(<LanguageProvider><NewAnalysis onStartAnalysis={start} allowHigherTimeframes={false} /></LanguageProvider>);
      drop(file('image/png'));
      await screen.findByText('Your entry chart');
      expect(screen.queryByText('Higher timeframe: direction')).toBeNull();
      expect(screen.queryByRole('button', { name: 'How to choose your charts' })).toBeNull();
    });
  });
});
