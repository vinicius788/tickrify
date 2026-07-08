import { useLanguage } from '@/lib/i18n/LanguageContext';

type Signal = 'BUY' | 'SELL' | 'WAIT';

// Global symbols only — the site targets an international audience.
const recentAnalyses: Array<{ symbol: string; timeframe: string; signal: Signal; confidence: string }> = [
  { symbol: 'BTCUSDT', timeframe: 'H4', signal: 'BUY', confidence: '87%' },
  { symbol: 'EURUSD', timeframe: 'M15', signal: 'SELL', confidence: '74%' },
  { symbol: 'XAUUSD', timeframe: 'M30', signal: 'BUY', confidence: '80%' },
  { symbol: 'AAPL', timeframe: 'D1', signal: 'WAIT', confidence: '61%' },
  { symbol: 'NVDA', timeframe: 'H1', signal: 'BUY', confidence: '79%' },
  { symbol: 'GBPUSD', timeframe: 'M5', signal: 'SELL', confidence: '71%' },
];

const SIGNAL_LABELS: Record<'pt' | 'en', Record<Signal, string>> = {
  en: { BUY: 'BUY', SELL: 'SELL', WAIT: 'WAIT' },
  pt: { BUY: 'COMPRA', SELL: 'VENDA', WAIT: 'AGUARDAR' },
};

const signalClass = (signal: Signal) => {
  if (signal === 'BUY') return 'tag-compra';
  if (signal === 'SELL') return 'tag-venda';
  return 'tag-aguardar';
};

const RecentTickerSection = () => {
  const { t, language } = useLanguage();
  const labels = SIGNAL_LABELS[language === 'pt' ? 'pt' : 'en'];
  const items = [...recentAnalyses, ...recentAnalyses];

  return (
    <section className="border-y border-[var(--border-subtle)] bg-[rgba(5,5,8,0.9)] py-4 [backdrop-filter:blur(8px)]">
      <div className="container flex items-center gap-4">
        <span className="shrink-0 rounded-full border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] px-3 py-1 font-terminal text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          {t.landing.ticker.recent}
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="ticker-track flex items-center gap-4 font-terminal text-xs">
            {items.map((item, index) => (
              <div
                key={`${item.symbol}-${index}`}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5"
              >
                <span className="text-[var(--text-primary)]">{item.symbol}</span>
                <span className="text-[var(--text-secondary)]">{item.timeframe}</span>
                <span className={signalClass(item.signal)}>
                  {item.signal === 'BUY' ? '▲' : item.signal === 'SELL' ? '▼' : '—'} {labels[item.signal]}
                </span>
                <span className="text-[var(--text-secondary)]">{item.confidence}</span>
                <span className="text-[var(--text-muted)]">•</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default RecentTickerSection;
