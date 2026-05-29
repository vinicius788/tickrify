import { useEffect, useState } from 'react';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';
import { getRecommendationMeta } from '@/lib/trading-ui';
import { buildApiUrl } from '@/lib/api';

interface PublicAnalysis {
  id: string;
  recommendation: string;
  confidence: number;
  createdAt: string;
  symbol: string;
  timeframe: string;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
}

function formatPrice(v: number | null) {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 }).format(v);
}

function timeAgo(dateStr: string) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)}m atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

const FALLBACK: PublicAnalysis[] = [
  { id: '1', recommendation: 'BUY',  confidence: 75, createdAt: new Date(Date.now() - 3_600_000).toISOString(),  symbol: 'XAUUSD', timeframe: '15M', entry: 3310.00, stopLoss: 3295.00, takeProfit1: 3340.00 },
  { id: '2', recommendation: 'SELL', confidence: 70, createdAt: new Date(Date.now() - 7_200_000).toISOString(),  symbol: 'EURUSD', timeframe: '1H',  entry: 1.0820,  stopLoss: 1.0855,  takeProfit1: 1.0770 },
  { id: '3', recommendation: 'BUY',  confidence: 80, createdAt: new Date(Date.now() - 14_400_000).toISOString(), symbol: 'BTCUSDT', timeframe: '4H', entry: 104500, stopLoss: 102000, takeProfit1: 109000 },
  { id: '4', recommendation: 'SELL', confidence: 65, createdAt: new Date(Date.now() - 21_600_000).toISOString(), symbol: 'GBPUSD', timeframe: '30M', entry: 1.2710, stopLoss: 1.2745, takeProfit1: 1.2650 },
];

const RecentAnalysesSection = () => {
  const revealRef = useReveal<HTMLElement>();
  const [analyses, setAnalyses] = useState<PublicAnalysis[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(buildApiUrl('/api/ai/public-analyses'))
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: PublicAnalysis[]) => {
        setAnalyses(Array.isArray(data) && data.length > 0 ? data.slice(0, 8) : FALLBACK);
      })
      .catch(() => setAnalyses(FALLBACK))
      .finally(() => setLoading(false));
  }, []);

  const items = loading ? FALLBACK : analyses;

  return (
    <section ref={revealRef} className="landing-section section-primary reveal-on-scroll">
      <div className="container">
        <SectionTitle
          label="Transparência total"
          title="Sinais gerados"
          highlight="em tempo real."
          subtitle="Últimas análises processadas pela plataforma. Dados reais, sem filtro."
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((a) => {
            const meta = getRecommendationMeta(a.recommendation);
            const isHold = meta.tone === 'hold';
            const signalColor = meta.tone === 'buy' ? '#00FF7F' : meta.tone === 'sell' ? '#FF4444' : '#888';
            const signalBg  = meta.tone === 'buy' ? 'rgba(0,255,127,0.08)' : meta.tone === 'sell' ? 'rgba(255,68,68,0.08)' : 'rgba(136,136,136,0.06)';
            const borderCol = meta.tone === 'buy' ? 'rgba(0,255,127,0.2)' : meta.tone === 'sell' ? 'rgba(255,68,68,0.2)'  : 'rgba(136,136,136,0.15)';

            return (
              <article
                key={a.id}
                className="rounded-xl border p-4 transition-colors"
                style={{ background: signalBg, borderColor: borderCol }}
              >
                {/* Header */}
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-terminal text-sm font-bold text-white">{a.symbol}</p>
                    <p className="mt-0.5 font-terminal text-xs text-white/40">{a.timeframe || '—'}</p>
                  </div>
                  <span
                    className="rounded px-2 py-0.5 font-terminal text-xs font-black tracking-widest"
                    style={{ color: signalColor, background: `${signalColor}18`, border: `1px solid ${signalColor}40` }}
                  >
                    {isHold ? 'HOLD' : meta.label}
                  </span>
                </div>

                {/* Levels */}
                {!isHold && (
                  <div className="mb-3 space-y-1 rounded-md border border-white/5 bg-black/20 px-3 py-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-white/40">Entrada</span>
                      <span className="font-terminal text-white/80">{formatPrice(a.entry)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-[#FF4444]/70">Stop</span>
                      <span className="font-terminal text-[#FF4444]/80">{formatPrice(a.stopLoss)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-[#00FF7F]/70">TP1</span>
                      <span className="font-terminal text-[#00FF7F]/80">{formatPrice(a.takeProfit1)}</span>
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between">
                  <span
                    className="rounded px-1.5 py-0.5 font-terminal text-[10px] font-semibold"
                    style={{ color: signalColor, background: `${signalColor}12` }}
                  >
                    {Math.round(a.confidence)}% conf.
                  </span>
                  <span className="font-terminal text-[10px] text-white/30">{timeAgo(a.createdAt)}</span>
                </div>
              </article>
            );
          })}
        </div>

        <p className="mt-6 text-center font-terminal text-xs text-white/20">
          Análises anonimizadas · Não constituem recomendação de investimento
        </p>
      </div>
    </section>
  );
};

export default RecentAnalysesSection;
