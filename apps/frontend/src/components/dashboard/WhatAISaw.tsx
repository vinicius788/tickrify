import type { AIAnalysisResponse } from '@/lib/api';
import { biasArguments, directionTimeframe, type BiasLineKey } from '@/lib/code-summary';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { CopyPrice } from './CopyPrice';

type Full = NonNullable<AIAnalysisResponse['fullResponse']>;

interface Props {
  fullResponse: Full;
  formatPrice: (value: number | null) => string;
}

/**
 * "What the AI saw": o que as velas reais entregaram, montado so dos dados.
 * Sem velas reais ou sem dado, a linha (ou o bloco) nao aparece.
 */
export function WhatAISaw({ fullResponse, formatPrice }: Props) {
  const { t } = useLanguage();
  const s = t.analysis.result.aiSaw;
  if (fullResponse.dataMode !== 'real_data') return null;

  const bias = fullResponse.candleBias ?? null;
  const location = fullResponse.location ?? null;
  const calendar = fullResponse.evidence?.calendar;
  const tf = directionTimeframe(bias);
  const htf = bias?.htfTrend ?? location?.htfTrend ?? null;

  const rows: Array<{ key: string; label: string; value: string; raw?: number }> = [];
  if (htf) rows.push({ key: 'htf', label: s.trendTf.replace('{tf}', tf), value: s.htf[htf] });
  if (bias?.timeframes) {
    const { chart, direction, setup } = bias.timeframes;
    rows.push({ key: 'timeframes', label: s.timeframes, value: s.timeframesValue.replace('{chart}', chart).replace('{direction}', direction).replace('{setup}', setup) });
  }
  if (bias?.structure) rows.push({ key: 'structure', label: s.structure, value: s.structureValues[bias.structure] });
  const ema = [
    bias?.vsEma50 ? s.emaChart.replace('{side}', s.sides[bias.vsEma50]) : '',
    bias?.htfVsEma50 ? s.emaHtf.replace('{side}', s.sides[bias.htfVsEma50]).replace('{tf}', tf) : '',
  ].filter(Boolean);
  if (ema.length) rows.push({ key: 'ema', label: s.ema, value: ema.join(', ') });
  if (typeof bias?.rsi14 === 'number') rows.push({ key: 'rsi', label: s.rsi, value: bias.rsi14.toFixed(0) });
  // Forex e metal spot nao tem volume: o servidor so manda em cripto.
  if (typeof bias?.relVolumeLast === 'number') {
    rows.push({ key: 'volume', label: s.volume, value: s.volumeValue.replace('{x}', bias.relVolumeLast.toFixed(1)) });
  }
  if (location?.support) rows.push({ key: 'support', label: s.support, value: formatPrice(location.support.price), raw: location.support.price });
  if (location?.resistance) rows.push({ key: 'resistance', label: s.resistance, value: formatPrice(location.resistance.price), raw: location.resistance.price });
  if (calendar) rows.push({ key: 'calendar', label: s.calendar, value: s.calendarValues[calendar] });

  const args = biasArguments(bias);
  const hasArgs = bias !== null;
  if (!rows.length && !hasArgs) return null;

  const column = (title: string, keys: BiasLineKey[], testId: string) => (
    <div data-testid={testId} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <p className="mb-1 text-xs font-medium text-[var(--text-secondary)]">{title}</p>
      {keys.length ? (
        <ul className="space-y-1 text-sm leading-relaxed text-[var(--text-primary)]">
          {keys.map((k) => <li key={k}>{s.lines[k].replace('{tf}', tf)}</li>)}
        </ul>
      ) : (
        <p className="text-sm leading-relaxed text-[var(--text-tertiary)]">{s.none}</p>
      )}
    </div>
  );

  return (
    <section data-testid="what-ai-saw" className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-3">
      <h4 className="tk-display mb-2 text-sm text-[var(--text-primary)]">{s.title}</h4>
      {rows.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.key} className="flex justify-between gap-3">
              <dt className="tk-meta">{row.label}</dt>
              <dd className="tabular-nums text-right text-[var(--text-primary)]"><CopyPrice value={row.raw} text={row.value} /></dd>
            </div>
          ))}
        </dl>
      )}
      {hasArgs && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {column(s.forBuy, args.buy, 'ai-saw-buy')}
          {column(s.forSell, args.sell, 'ai-saw-sell')}
        </div>
      )}
      <p className="tk-meta mt-2">{s.note}</p>
    </section>
  );
}
