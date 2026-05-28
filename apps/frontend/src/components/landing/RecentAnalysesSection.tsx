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
  if (signal === 'COMPRA') return 'badge-compra';
  if (signal === 'VENDA') return 'badge-venda';
  return 'badge-aguardar';
};

const toneClass = (signal: string) => {
  if (signal === 'COMPRA') return 'compra';
  if (signal === 'VENDA') return 'venda';
  return 'aguardar';
};

const RecentAnalysesSection = () => {
  const revealRef = useReveal<HTMLElement>();

  return (
    <section ref={revealRef} className="landing-section section-primary reveal-on-scroll">
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
              className={`analysis-result-card ${toneClass(analysis.signal)}`}
            >
              <div className="analysis-header">
                <div>
                  <p className="analysis-pair">{analysis.asset}</p>
                  <p className="analysis-tf">{analysis.timeframe}</p>
                </div>
                <span className={signalClass(analysis.signal)}>{analysis.signal}</span>
              </div>

              <div className="analysis-data">
                <div className="analysis-row">
                  <span>Entry</span>
                  <span className="analysis-value">{analysis.entry}</span>
                </div>
                <div className="analysis-row">
                  <span>Resultado</span>
                  <span
                    className={
                      analysis.signal === 'VENDA'
                        ? 'analysis-value-negative'
                        : analysis.signal === 'AGUARDAR'
                          ? 'analysis-value'
                          : 'analysis-value-positive'
                    }
                  >
                    {analysis.result}
                  </span>
                </div>
                <div className="analysis-row">
                  <span>Bias</span>
                  <span className="analysis-value">{analysis.bias}</span>
                </div>
                <div className="analysis-row">
                  <span>Data</span>
                  <span className="analysis-value">{analysis.date}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default RecentAnalysesSection;
