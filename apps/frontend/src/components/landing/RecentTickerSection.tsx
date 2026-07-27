import { useLanguage } from '@/lib/i18n/LanguageContext';
import { getRecommendationMeta } from '@/lib/trading-ui';
import { useRecentPublicAnalyses } from '@/hooks/useRecentPublicAnalyses';

type Signal = 'BUY' | 'SELL' | 'HOLD';

/** Mínimo de análises reais para a esteira existir. Abaixo disso, não renderiza. */
const MIN_ITEMS = 4;

const SIGNAL_LABELS: Record<'pt' | 'en', Record<Signal, string>> = {
  en: { BUY: 'BUY', SELL: 'SELL', HOLD: 'WAIT' },
  pt: { BUY: 'COMPRA', SELL: 'VENDA', HOLD: 'AGUARDAR' },
};

const signalClass = (signal: Signal) => {
  if (signal === 'BUY') return 'tag-compra';
  if (signal === 'SELL') return 'tag-venda';
  return 'tag-aguardar';
};

const RecentTickerSection = () => {
  const { t, language } = useLanguage();
  const { analyses, loading, failed } = useRecentPublicAnalyses();
  const labels = SIGNAL_LABELS[language === 'pt' ? 'pt' : 'en'];

  // Dados reais ou nada. Nenhum símbolo/confiança hardcoded nesta vitrine.
  if (loading || failed || analyses.length < MIN_ITEMS) return null;

  // Duplicado só para o loop visual da esteira ser contínuo.
  const items = [...analyses, ...analyses];

  return (
    <section className="border-y border-[var(--border-subtle)] bg-[rgba(5,5,8,0.9)] py-4 [backdrop-filter:blur(8px)]">
      <div className="container flex items-center gap-4">
        <span className="shrink-0 rounded-full border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] px-3 py-1 font-terminal text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          {t.landing.ticker.recent}
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="ticker-track flex items-center gap-4 font-terminal text-xs">
            {items.map((item, index) => {
              const signal = getRecommendationMeta(item.recommendation).label as Signal;
              return (
                <div
                  key={`${item.id}-${index}`}
                  className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5"
                >
                  <span className="text-[var(--text-primary)]">{item.symbol}</span>
                  {item.timeframe ? <span className="text-[var(--text-secondary)]">{item.timeframe}</span> : null}
                  <span className={signalClass(signal)}>
                    {signal === 'BUY' ? '▲' : signal === 'SELL' ? '▼' : '—'} {labels[signal]}
                  </span>
                  <span className="text-[var(--text-secondary)]">{Math.round(item.confidence)}%</span>
                  <span className="text-[var(--text-muted)]">•</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

export default RecentTickerSection;
