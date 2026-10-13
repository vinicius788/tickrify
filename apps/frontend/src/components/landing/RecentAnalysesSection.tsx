import { Link } from 'react-router-dom';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { getRecommendationMeta, getScenarioMeta } from '@/lib/trading-ui';
import { useRecentPublicAnalyses, useScoredPublicAnalyses, type ScoredPublicAnalysis } from '@/hooks/useRecentPublicAnalyses';

/** Mínimo de análises reais para a seção existir. Abaixo disso, não renderiza.
 *  Sem dado real não existe seção: nunca inventar análise para preencher. */
const MIN_ITEMS = 3;

function formatPrice(v: number | null) {
  if (v === null || v === undefined) return '·';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 }).format(v);
}

function timeAgo(dateStr: string, l: { now: string; mAgo: string; hAgo: string; dAgo: string }) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return l.now;
  if (diff < 3600) return `${Math.floor(diff / 60)}${l.mAgo}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}${l.hAgo}`;
  return `${Math.floor(diff / 86400)}${l.dAgo}`;
}

/** Data e hora em UTC, curtas: "Sep 28, 14:05 UTC". É o carimbo da leitura. */
function formatUtc(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '·';
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${day}, ${d.toISOString().slice(11, 16)} UTC`;
}

const OUTCOME_CLASS: Record<ScoredPublicAnalysis['outcome'], string> = {
  WIN: 'site-long',
  LOSS: 'site-short',
  NO_FILL: '',
  TIMEOUT: '',
};

/**
 * As últimas leituras, em tabela.
 *
 * Antes eram duas seções: uma esteira rolando no topo e um grid de cartões
 * embaixo, ambas alimentadas pelo mesmo endpoint. Virou uma tabela só, que é
 * como um trader lê uma lista de calls, e as que disseram WAIT aparecem junto.
 */
const RecentAnalysesSection = () => {
  const { t } = useLanguage();
  const r = t.landing.recent;
  const f = t.landing.footer;
  const { analyses, loading, failed } = useRecentPublicAnalyses();
  // O recibo (30/09/2026): o que o mercado fez 48h depois. A lista de cima só
  // tem leitura recente, que ainda não tem resultado. Sem dado, some sozinha.
  const { scored, failed: scoredFailed } = useScoredPublicAnalyses();

  if (failed) return null;
  if (!loading && analyses.length < MIN_ITEMS) return null;

  const items = analyses.slice(0, 6);
  const showScored = !scoredFailed && scored.length >= MIN_ITEMS;
  const outcomeLabel: Record<ScoredPublicAnalysis['outcome'], string> = {
    WIN: r.outcomeWin,
    LOSS: r.outcomeLoss,
    NO_FILL: r.outcomeNoFill,
    TIMEOUT: r.outcomeTimeout,
  };

  return (
    <section id="reads" className="site-dark">
      <div className="site-wrap">
        <div className="site-shead site-shead-btn">
          <div className="site-scol">
            <span className="site-eyebrow">{r.label}</span>
            <h2>{r.title} {r.highlight}</h2>
          </div>
          <Link to="/accuracy" className="site-btn site-btn-ghost">{f.accuracy}</Link>
        </div>

        <div className="site-tablewrap">
          <table className="site-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>TF</th>
                <th>{t.analysis.bias} / {t.analysis.action}</th>
                <th>{r.entry}</th>
                <th>{r.stop}</th>
                <th>{r.readAt}</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 4 }, (_, i) => (
                    <tr key={`sk-${i}`}>
                      <td colSpan={6}>
                        <span className="block h-3 w-full animate-pulse rounded bg-white/5" />
                      </td>
                    </tr>
                  ))
                : items.map((a) => {
                    const meta = getRecommendationMeta(a.recommendation);
                    const scenario = getScenarioMeta(a.bias, a.recommendation);
                    const isHold = meta.tone === 'hold';
                    const chip = scenario.tone === 'buy' ? 'site-chip-long' : scenario.tone === 'sell' ? 'site-chip-short' : 'site-chip-wait';
                    const actionLabel = meta.tone === 'buy'
                      ? t.analysis.buy
                      : meta.tone === 'sell'
                        ? t.analysis.sell
                        : t.analysis.hold;

                    return (
                      <tr key={a.id}>
                        <td className="site-sym-cell">{a.symbol}</td>
                        <td>{a.timeframe || '·'}</td>
                        <td>
                          <div className="flex flex-col items-start gap-1">
                            <span className={`site-chip ${chip}`}>{scenario.icon} {scenario.label}</span>
                            <span className="site-hero-note">{t.analysis.action}: {actionLabel}</span>
                          </div>
                        </td>
                        <td>{isHold ? '·' : formatPrice(a.entry)}</td>
                        <td className={isHold ? '' : 'site-short'}>{isHold ? '·' : formatPrice(a.stopLoss)}</td>
                        <td>{timeAgo(a.createdAt, r)}</td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>

        <p className="site-hero-note" style={{ marginTop: '20px' }}>{r.footnote}</p>

        {showScored ? (
          <>
            <div className="site-sblk" style={{ marginTop: '48px' }}>
              <span className="site-eyebrow">{r.scoredLabel}</span>
              <h2>{r.scoredTitle}</h2>
              <p className="site-hero-note" style={{ marginTop: '12px' }}>{r.scoredSubtitle}</p>
            </div>

            <div className="site-tablewrap">
              <table className="site-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>TF</th>
                    <th>{t.analysis.action}</th>
                    <th>{r.entry}</th>
                    <th>{r.stop}</th>
                    <th>TP1</th>
                    <th>{r.readAt}</th>
                    <th>{r.result}</th>
                  </tr>
                </thead>
                <tbody>
                  {scored.slice(0, 6).map((a) => {
                    const meta = getRecommendationMeta(a.recommendation);
                    const actionLabel = meta.tone === 'buy' ? t.analysis.buy : t.analysis.sell;
                    return (
                      <tr key={a.id}>
                        <td className="site-sym-cell">{a.symbol}</td>
                        <td>{a.timeframe || '·'}</td>
                        <td className={meta.tone === 'buy' ? 'site-long' : 'site-short'}>{actionLabel}</td>
                        <td>{formatPrice(a.entry)}</td>
                        <td>{formatPrice(a.stopLoss)}</td>
                        <td>{formatPrice(a.takeProfit1)}</td>
                        <td>{formatUtc(a.createdAt)}</td>
                        <td className={OUTCOME_CLASS[a.outcome] ?? ''}><b>{outcomeLabel[a.outcome] ?? a.outcome}</b></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="site-hero-note" style={{ marginTop: '20px' }}>{r.scoredFootnote}</p>
          </>
        ) : null}
      </div>
    </section>
  );
};

export default RecentAnalysesSection;
