import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';
import { getRecommendationMeta } from '@/lib/trading-ui';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useRecentPublicAnalyses } from '@/hooks/useRecentPublicAnalyses';

/** Mínimo de análises reais para a seção existir. Abaixo disso, não renderiza. */
const MIN_ITEMS = 3;

function formatPrice(v: number | null) {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 }).format(v);
}

function timeAgo(dateStr: string, l: { now: string; mAgo: string; hAgo: string; dAgo: string }) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return l.now;
  if (diff < 3600) return `${Math.floor(diff / 60)}${l.mAgo}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}${l.hAgo}`;
  return `${Math.floor(diff / 86400)}${l.dAgo}`;
}

const SkeletonCard = () => (
  <article className="animate-pulse rounded-xl border border-white/5 bg-white/[0.02] p-4">
    <div className="mb-3 flex items-start justify-between gap-2">
      <div className="space-y-1.5">
        <div className="h-3.5 w-20 rounded bg-white/10" />
        <div className="h-2.5 w-10 rounded bg-white/5" />
      </div>
      <div className="h-5 w-14 rounded bg-white/10" />
    </div>
    <div className="mb-3 space-y-2 rounded-md border border-white/5 bg-black/20 px-3 py-2">
      <div className="h-2.5 w-full rounded bg-white/5" />
      <div className="h-2.5 w-full rounded bg-white/5" />
      <div className="h-2.5 w-full rounded bg-white/5" />
    </div>
    <div className="flex items-center justify-between">
      <div className="h-3 w-16 rounded bg-white/5" />
      <div className="h-3 w-10 rounded bg-white/5" />
    </div>
  </article>
);

const RecentAnalysesSection = () => {
  const revealRef = useReveal<HTMLElement>();
  const { t } = useLanguage();
  const r = t.landing.recent;
  const { analyses, loading, failed } = useRecentPublicAnalyses();

  // Sem dado real não existe seção. Nunca inventar análise para preencher.
  if (failed) return null;
  if (!loading && analyses.length < MIN_ITEMS) return null;

  const items = analyses.slice(0, 6);

  return (
    <section ref={revealRef} className="landing-section section-primary reveal-on-scroll">
      <div className="container">
        <SectionTitle
          label={r.label}
          title={r.title}
          highlight={r.highlight}
          subtitle={r.subtitle}
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {loading
            ? Array.from({ length: 4 }, (_, i) => <SkeletonCard key={`sk-${i}`} />)
            : items.map((a) => {
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
                          <span className="text-white/40">{r.entry}</span>
                          <span className="font-terminal text-white/80">{formatPrice(a.entry)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-[#FF4444]/70">{r.stop}</span>
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
                        {Math.round(a.confidence)}% {r.conf}
                      </span>
                      <span className="font-terminal text-[10px] text-white/30">{timeAgo(a.createdAt, r)}</span>
                    </div>
                  </article>
                );
              })}
        </div>

        <p className="mt-6 text-center font-terminal text-xs text-white/20">
          {r.footnote}
        </p>
      </div>
    </section>
  );
};

export default RecentAnalysesSection;
