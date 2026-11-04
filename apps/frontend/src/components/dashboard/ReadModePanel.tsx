import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatNumber } from '@/lib/i18n';
import type { PriceLocation, WatchPlan, WatchReach } from '@/lib/api';
import { entrySide, signalStateLabel, type SignalStateCanonical } from '@/lib/trading-ui';

// Modo leitura (02/11/2026): toda analise mostra a leitura, onde o preco esta
// e a acao, nunca um "aguardar" vazio. Arquivo proprio porque a tela da
// analise e o /try mostram os mesmos tres blocos a partir de dados diferentes.
// Sem cores de compra/venda: a acao e o rotulo do estado, no cabecalho.

export interface ReadModeData {
  state: SignalStateCanonical;
  bias: 'bullish' | 'bearish' | 'neutral';
  strength: 'strong' | 'moderate' | 'weak' | null;
  /** O motivo principal da leitura, em uma linha. */
  reason: string;
  /** Calculado pelo codigo a partir do REAL DATA; null sem ele (analise antiga ou print). */
  location: PriceLocation | null;
  /** Preco lido do print, quando nao ha REAL DATA. */
  currentPrice: number | null;
  dataMode: 'real_data' | 'print' | null;
  levels: { entry: number | null; stopLoss: number | null; takeProfit1: number | null; takeProfit2: number | null };
  watchPlan: WatchPlan | null;
  watchReach: WatchReach | null;
  noTradeReason: string | null;
}

interface ReadModePanelProps {
  actionLabel?: string;
  data: ReadModeData;
  formatPrice: (value: number | null) => string;
}


export function ReadModePanel({ data, formatPrice, actionLabel }: ReadModePanelProps) {
  const { t, language } = useLanguage();
  const atrText = (n: number) => formatNumber(Math.round(n * 10) / 10, language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const m = t.analysis.result.readMode;
  const a = t.analysis;
  const loc = data.location;
  const plan = data.watchPlan;
  const long = plan ? plan.direction === 'long' : data.bias !== 'bearish';
  const invalidation = plan?.invalidation ?? loc?.invalidation?.price ?? null;
  const level = plan ? (plan.direction === 'long' ? plan.zoneHigh : plan.zoneLow) : null;
  // Direcao do plano; sem plano, a dos niveis (entrada acima do stop = compra).
  const { entry, stopLoss } = data.levels;
  const actionSide = entrySide(plan, null) ?? (entry !== null && stopLoss !== null && entry !== stopLoss ? (entry > stopLoss ? 'buy' : 'sell') : null);

  const distanceRows = loc
    ? ([
        [m.invalidation, loc.invalidation],
        [m.support, loc.support],
        [m.resistance, loc.resistance],
        [m.planLevel, loc.planLevel],
      ] as const).filter(([, d]) => d !== null)
    : [];

  const invalidLine = invalidation !== null
    ? (long ? m.invalidBelow : m.invalidAbove).replace('{price}', formatPrice(invalidation))
    : null;

  return (
    <div data-testid="read-mode" className="grid gap-3 md:grid-cols-3">
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-4">
        <h4 className="font-terminal text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">{m.readTitle}</h4>
        <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
          {data.strength ? `${m.bias[data.bias]}, ${m.strength[data.strength]}` : m.bias[data.bias]}
        </p>
        {data.reason && <p className="mt-1 text-sm leading-relaxed text-[var(--text-primary)]/85">{data.reason}</p>}
      </section>

      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-4">
        <h4 className="font-terminal text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">{m.whereTitle}</h4>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--text-secondary)]">{m.price}</dt>
            <dd className="text-right font-terminal text-[var(--text-primary)]">
              {formatPrice(loc?.price ?? data.currentPrice)}
              {loc?.rangePosPct !== null && loc?.rangePosPct !== undefined && (
                <span className="block text-[11px] text-[var(--text-secondary)]">{m.rangePosition.replace('{pct}', String(Math.round(loc.rangePosPct)))}</span>
              )}
            </dd>
          </div>
          {distanceRows.map(([label, d]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-[var(--text-secondary)]">{label}</dt>
              <dd className="text-right font-terminal text-[var(--text-primary)]">
                {formatPrice(d!.price)}
                <span className="block text-[11px] text-[var(--text-secondary)]">{m.atrAway.replace('{n}', atrText(d!.atr))}</span>
              </dd>
            </div>
          ))}
          {loc?.htfTrend && (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-secondary)]">{m.htfTrend}</dt>
              <dd className="font-terminal text-[var(--text-primary)]">{m.htf[loc.htfTrend]}</dd>
            </div>
          )}
        </dl>
        {!loc && data.dataMode === 'print' && <p data-testid="read-mode-estimated" className="mt-2 text-xs text-[var(--text-secondary)]">{t.analysis.result.levelsEstimated}</p>}
      </section>

      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-4">
        <h4 className="font-terminal text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">{m.actionTitle}</h4>
        <p data-testid="read-mode-action" className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{actionLabel ?? signalStateLabel(a, data.state, actionSide)}</p>
        {(data.state === 'ENTER_NOW' || data.state === 'ARMED') && (
          <dl className="mt-2 space-y-1 text-sm">
            {([
              [a.entry, data.levels.entry],
              [a.stopLoss, data.levels.stopLoss],
              ['TP1', data.levels.takeProfit1],
              ['TP2', data.levels.takeProfit2],
            ] as const).filter(([, v]) => v !== null).map(([label, v]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-[var(--text-secondary)]">{label}</dt>
                <dd className="font-terminal text-[var(--text-primary)]">{formatPrice(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {data.state === 'WATCH' && level !== null && (
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-primary)]/85">
            {m.unlocks.replace('{price}', formatPrice(level)).replace('{condition}', plan?.trigger || '')}
          </p>
        )}
        {data.state === 'WATCH' && data.watchReach && (
          <p data-testid="read-mode-reach" className="mt-1 text-xs text-[var(--text-secondary)]">
            {m.reach.replace('{pct}', String(Math.round(data.watchReach.probability * 100))).replace('{n}', String(data.watchReach.candles))}
          </p>
        )}
        {data.state !== 'NO_TRADE' && invalidLine && <p className="mt-2 text-xs text-[var(--text-secondary)]">{invalidLine}</p>}
        {data.state === 'NO_TRADE' && data.noTradeReason && (
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-primary)]/85">{data.noTradeReason}</p>
        )}
      </section>
    </div>
  );
}
