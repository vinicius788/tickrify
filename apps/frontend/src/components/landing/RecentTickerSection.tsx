const recentAnalyses = [
  { symbol: 'BTCUSDT', timeframe: 'H4', signal: 'COMPRA', confidence: '87%' },
  { symbol: 'EURUSD', timeframe: 'M15', signal: 'VENDA', confidence: '74%' },
  { symbol: 'XAUUSD', timeframe: 'M30', signal: 'COMPRA', confidence: '80%' },
  { symbol: 'AAPL', timeframe: 'D1', signal: 'AGUARDAR', confidence: '61%' },
  { symbol: 'PETR4', timeframe: 'H1', signal: 'COMPRA', confidence: '79%' },
  { symbol: 'WINFUT', timeframe: 'M5', signal: 'VENDA', confidence: '71%' },
];

const signalClass = (signal: string) => {
  if (signal === 'COMPRA') return 'text-[var(--signal-buy)]';
  if (signal === 'VENDA') return 'text-[var(--signal-sell)]';
  return 'text-[var(--signal-hold)]';
};

const RecentTickerSection = () => {
  const items = [...recentAnalyses, ...recentAnalyses];

  return (
    <section className="border-y border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-4">
      <div className="container flex items-center gap-4">
        <span className="shrink-0 font-terminal text-[11px] uppercase tracking-widest text-[var(--text-secondary)]">
          Análises recentes
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="marquee-track flex items-center gap-4 font-terminal text-xs">
            {items.map((item, index) => (
              <div key={`${item.symbol}-${index}`} className="inline-flex items-center gap-2 whitespace-nowrap">
                <span className="text-[var(--text-primary)]">{item.symbol}</span>
                <span className="text-[var(--text-secondary)]">{item.timeframe}</span>
                <span className={`${signalClass(item.signal)} font-semibold`}>
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
