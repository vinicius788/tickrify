import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SetupMonitoring from '../SetupMonitoring';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { LANGUAGES, getTranslations } from '@/lib/i18n';
import type { SetupAlert, SetupVersion } from '@/lib/setups';

const NOW = Date.parse('2026-11-18T15:00:00Z');
const versions: SetupVersion[] = [
  { analysisId: 'new-analysis', version: 2, createdAt: '2026-11-18T14:00:00Z', recommendation: 'WAIT', entry: null, stopLoss: null, takeProfit1: null, takeProfit2: null, entryCondition: null,
    watch: { direction: 'long', level: 100, invalidation: 90, validForCandles: 12, expiresAt: '2026-11-18T18:00:00Z', outcome: 'pending', alertAvailable: true, plan: { entry: 100, stopLoss: 89, takeProfit1: 115, tp1R: 1.36 } } },
  { analysisId: 'old-analysis', version: 1, createdAt: '2026-11-18T12:00:00Z', recommendation: 'BUY', entry: 99, stopLoss: 89, takeProfit1: 109, takeProfit2: null, entryCondition: null },
];
const alert: SetupAlert = {
  id: 'alert-1', setupId: 'setup-1', analysisId: 'new-analysis', symbol: 'BTCUSDT', timeframe: '15m',
  level: 100, label: 'entry', side: 'above', status: 'active', createdAt: '2026-11-18T14:00:00Z',
  triggeredAt: null, triggerPrice: null, seenAt: null, lastPrice: 98, checkedAt: '2026-11-18T14:59:00Z', checkIntervalMs: 60_000,
};
const renderSection = (props: Partial<Parameters<typeof SetupMonitoring>[0]> = {}, language = 'en') => {
  localStorage.setItem('tickrify-language', language);
  return render(<MemoryRouter><LanguageProvider><SetupMonitoring versions={versions} alerts={[alert]} paused={false} loading={false} error={false} base="/dashboard" onCancel={vi.fn()} cancelling={false} {...props} /></LanguageProvider></MemoryRouter>);
};
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(NOW); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Acompanhamento: fatos salvos', () => {
  it('mostra plano WATCH, versao, preco, data completa UTC e distancia; so analises e disparos na timeline', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    renderSection({ alerts: [alert, { ...alert, id: 'old-trigger', analysisId: 'old-analysis', status: 'triggered', triggeredAt: '2026-11-18T13:00:00Z' }] });
    const section = screen.getByRole('region', { name: 'Monitoring' });
    expect(section.textContent).toContain('Version 2');
    expect(section.textContent).toContain('Plan level100');
    expect(section.textContent).toContain('Stop89');
    expect(section.textContent).toContain('Target 1115');
    expect(section.textContent).toContain('Last checked price: 98');
    expect(section.textContent).toContain('2026');
    expect(section.textContent).toContain('14:59');
    expect(screen.getByTestId('setup-monitoring-distance').textContent).toContain('2.04%');
    const timeline = within(section).getAllByRole('list')[1];
    expect(within(timeline).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/dashboard/analysis/new-analysis', '/dashboard/analysis/old-analysis', '/dashboard/analysis/old-analysis']);
    expect(section.textContent).not.toMatch(/enter now|buy|sell|move.stop|hold|ao vivo/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['stale', { ...alert, checkedAt: '2026-11-17T14:59:00Z' }],
    ['future', { ...alert, checkedAt: '2026-11-19T14:59:00Z' }],
    ['closed market', { ...alert, marketClosed: true }],
    ['no active alert', { ...alert, status: 'triggered' as const, triggeredAt: '2026-11-18T14:30:00Z' }],
  ])('%s: nao mostra distancia atual', (_name, quote) => {
    renderSection({ alerts: [quote] });
    expect(screen.queryByTestId('setup-monitoring-distance')).toBeNull();
  });

  it('nao usa preco de versao anterior nem converte expiracao em toque ausente', () => {
    renderSection({ alerts: [{ ...alert, analysisId: 'old-analysis' }], versions: [{ ...versions[0], watch: { ...versions[0].watch!, expiresAt: '2026-11-18T14:30:00Z' } }] });
    expect(screen.getByText('No checked price for this version.')).toBeTruthy();
    expect(screen.getByText('Plan validity ended; refer to recorded events.')).toBeTruthy();
    expect(screen.queryByTestId('setup-monitoring-distance')).toBeNull();
  });

  it.each(['paused', 'error'] as const)('%s: distingue indisponibilidade e nao mostra distancia', (kind) => {
    renderSection({ [kind]: true });
    expect(screen.getByText(kind === 'paused' ? 'Alerts paused for this account.' : 'Alerts could not be loaded.')).toBeTruthy();
    expect(screen.queryByTestId('setup-monitoring-distance')).toBeNull();
  });

  it.each(LANGUAGES)('titulo traduzido em $code, nunca "ao vivo"', ({ code }) => {
    renderSection({}, code);
    expect(screen.getByRole('region', { name: getTranslations(code).monitoring.title })).toBeTruthy();
  });
});
