import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';

const RECENT_ANALYSES = [
  {
    asset: 'XAUUSD',
    timeframe: 'M30',
    signal: 'COMPRA',
    entry: '4,261.40',
    result: '+0.91%',
    date: '07/03/2026',
    bias: 'BULLISH',
  },
  {
    asset: 'EURUSD',
    timeframe: 'M15',
    signal: 'VENDA',
    entry: '1.08420',
    result: '+0.74%',
    date: '07/03/2026',
    bias: 'BEARISH',
  },
  {
    asset: 'PETR4',
    timeframe: 'H1',
    signal: 'AGUARDAR',
    entry: '-',
    result: 'Aguardando setup',
    date: '07/03/2026',
    bias: 'NEUTRAL',
  },
];

const signalClass = (signal: string) => {
  if (signal === 'COMPRA') return 'text-[var(--signal-buy)] border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)]';
  if (signal === 'VENDA') return 'text-[var(--signal-sell)] border-[var(--signal-sell-border)] bg-[var(--signal-sell-bg)]';
  return 'text-[var(--signal-hold)] border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)]';
};

const RecentAnalysesSection = () => {
  const revealRef = useReveal<HTMLElement>();

  return (
    <section ref={revealRef} className="reveal-on-scroll py-28">
      <div className="container">
        <SectionTitle
          label="Análises recentes"
          title="Evidência de"
          highlight="execução."
          subtitle="Análises reais geradas pela plataforma nas últimas horas."
        />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {RECENT_ANALYSES.map((analysis) => (
            <article
              key={`${analysis.asset}-${analysis.timeframe}-${analysis.signal}`}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="font-terminal text-sm text-[var(--text-primary)]">
                  {analysis.asset} <span className="text-[var(--text-secondary)]">{analysis.timeframe}</span>
                </p>
                <span
                  className={`rounded border px-2 py-1 font-terminal text-[10px] uppercase tracking-widest ${signalClass(analysis.signal)}`}
                >
                  {analysis.signal}
                </span>
              </div>

              <div className="space-y-2 font-terminal text-xs text-[var(--text-secondary)]">
                <p>
                  Entry: <span className="text-[var(--text-primary)]">{analysis.entry}</span>
                </p>
                <p>
                  Resultado: <span className="text-[var(--text-primary)]">{analysis.result}</span>
                </p>
                <p>
                  Bias: <span className="text-[var(--text-primary)]">{analysis.bias}</span>
                </p>
                <p>
                  Data: <span className="text-[var(--text-primary)]">{analysis.date}</span>
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default RecentAnalysesSection;
