const recentAnalyses = [
  { symbol: 'BTCUSDT', timeframe: 'H4', signal: 'COMPRA', confidence: '87%' },
  { symbol: 'EURUSD', timeframe: 'M15', signal: 'VENDA', confidence: '74%' },
  { symbol: 'XAUUSD', timeframe: 'M30', signal: 'COMPRA', confidence: '80%' },
  { symbol: 'AAPL', timeframe: 'D1', signal: 'AGUARDAR', confidence: '61%' },
  { symbol: 'PETR4', timeframe: 'H1', signal: 'COMPRA', confidence: '79%' },
  { symbol: 'WINFUT', timeframe: 'M5', signal: 'VENDA', confidence: '71%' },
];

const signalClass = (signal: string) => {
  if (signal === 'COMPRA') return 'tag-compra';
  if (signal === 'VENDA') return 'tag-venda';
  return 'tag-aguardar';
};

const RecentTickerSection = () => {
  const items = [...recentAnalyses, ...recentAnalyses];

  return (
    <section className="border-y border-[var(--border-subtle)] bg-[rgba(5,5,8,0.9)] py-4 [backdrop-filter:blur(8px)]">
      <div className="container flex items-center gap-4">
        <span className="shrink-0 rounded-full border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] px-3 py-1 font-terminal text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          Análises recentes
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
                  {item.signal === 'COMPRA' ? '▲' : item.signal === 'VENDA' ? '▼' : '—'} {item.signal}
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
