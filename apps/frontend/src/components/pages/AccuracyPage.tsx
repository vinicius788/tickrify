import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { buildApiUrl } from '@/lib/api';

/**
 * Página pública de acurácia — Fase 5 da auditoria de 24/07/2026.
 *
 * Esta é a página que o resto do site precisa poder sustentar. Nenhum
 * concorrente do nicho publica calibração real; publicar os números feios é o
 * ativo mais raro que a Tickrify tem. Por isso ela obedece três regras:
 *
 *  1. Nenhum número sem n e sem intervalo de confiança.
 *  2. Recorte com n < 20 mostra o n e diz que ainda não dá pra concluir.
 *  3. Se a API não responder, a página diz isso — nunca inventa número.
 *
 * O texto é em inglês (público global), como todo texto público do site.
 */

interface Interval {
  n: number;
  wins: number;
  losses: number;
  rate: number | null;
  low: number | null;
  high: number | null;
  publishable: boolean;
}

interface AccuracyPayload {
  updatedAt: string;
  groundingLiveSince: string;
  overall: Interval;
  byConfidence: Array<Interval & { band: 'below60' | 'band60to69' | 'band70plus' | 'unknown' }>;
  byGrounding: { before: Interval; after: Interval };
  abstention: { wait: number; total: number; rate: number | null };
  breakdown: Record<string, number>;
}

const BAND_LABEL: Record<string, string> = {
  below60: 'Below 60',
  band60to69: '60 – 69',
  band70plus: '70 and above',
  unknown: 'Not recorded',
};

const BAND_NOTE: Record<string, string> = {
  below60: 'Low conviction',
  band60to69: 'Shown as "Read" in the product',
  band70plus: 'Shown as "Signal" in the product',
  unknown: '',
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-12">
    <h2 className="mb-4 text-lg font-bold text-[var(--text-primary)]">{title}</h2>
    <div className="space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">{children}</div>
  </section>
);

const Stat = ({ interval, label }: { interval: Interval; label: string }) => (
  <div className="rounded-xl border border-[var(--border-card)] bg-[rgba(255,255,255,0.02)] p-5">
    <p className="font-terminal text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">{label}</p>
    {interval.publishable && interval.rate !== null ? (
      <>
        <p className="mt-2 font-terminal text-3xl font-bold text-[var(--text-primary)]">{interval.rate}%</p>
        <p className="mt-1 font-terminal text-xs text-[var(--text-secondary)]">
          95% CI {interval.low}% – {interval.high}% · n = {interval.n}
        </p>
      </>
    ) : (
      <>
        <p className="mt-2 font-terminal text-3xl font-bold text-[var(--text-muted)]">n = {interval.n}</p>
        <p className="mt-1 font-terminal text-xs text-[var(--text-secondary)]">
          Too few resolved trades to publish a rate yet.
        </p>
      </>
    )}
  </div>
);

const AccuracyPage = () => {
  const { data, isLoading, isError } = useQuery<AccuracyPayload>({
    queryKey: ['accuracy'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/ai/accuracy'));
      if (!res.ok) throw new Error(`accuracy: ${res.status}`);
      return res.json();
    },
    staleTime: 600_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="container max-w-3xl py-16">
        <Link
          to="/"
          className="mb-10 inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <header className="mb-12">
          <p className="mb-2 font-terminal text-xs uppercase tracking-widest text-[var(--accent-green)]">
            Verified accuracy
          </p>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">
            We measure our own AI and publish the numbers.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-[var(--text-secondary)]">
            Every analysis Tickrify produces is re-checked against real candles 48 hours later — automatically,
            with no human in the loop. This page is that raw scoreboard. It is not a marketing number: it moves on
            its own, it includes the losses, and it is the same maths our internal backtest report uses.
          </p>
        </header>

        {isLoading && (
          <div className="space-y-4">
            <div className="h-28 animate-pulse rounded-xl border border-white/5 bg-white/[0.02]" />
            <div className="h-28 animate-pulse rounded-xl border border-white/5 bg-white/[0.02]" />
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-[var(--border-card)] bg-[rgba(255,255,255,0.02)] p-6 text-sm text-[var(--text-secondary)]">
            <p className="font-semibold text-[var(--text-primary)]">The numbers are not loading right now.</p>
            <p className="mt-2">
              Our API sleeps when idle and can take up to a minute to wake up. Refresh in a moment — we would
              rather show you nothing than show you a number we did not measure.
            </p>
          </div>
        )}

        {data && (
          <>
            <Section title="Hit rate in production">
              <div className="grid gap-4 sm:grid-cols-2">
                <Stat interval={data.overall} label="Trades that reached target before stop" />
                <div className="rounded-xl border border-[var(--border-card)] bg-[rgba(255,255,255,0.02)] p-5">
                  <p className="font-terminal text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                    Charts the AI refused to trade
                  </p>
                  <p className="mt-2 font-terminal text-3xl font-bold text-[var(--text-primary)]">
                    {data.abstention.rate === null ? '—' : `${data.abstention.rate}%`}
                  </p>
                  <p className="mt-1 font-terminal text-xs text-[var(--text-secondary)]">
                    {data.abstention.wait} of {data.abstention.total} analyses returned WAIT
                  </p>
                </div>
              </div>
              <p>
                A hit is an analysis whose entry actually filled and then reached the first target before the stop.
                Losses, unfilled entries and abstentions are all counted separately below — nothing is quietly
                dropped to make the number look better.
              </p>
            </Section>

            <Section title="Does the confidence score mean anything?">
              <p>
                This is the part that matters. If the number next to a call carries no information, the whole
                product is theatre. Here is the hit rate split by the confidence the AI assigned at the time:
              </p>
              <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border-card)]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[rgba(255,255,255,0.03)] font-terminal text-xs uppercase tracking-wider text-[var(--text-secondary)]">
                    <tr>
                      <th className="px-4 py-3">Confidence</th>
                      <th className="px-4 py-3">Resolved</th>
                      <th className="px-4 py-3">Hit rate</th>
                      <th className="px-4 py-3">95% CI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byConfidence
                      .filter((b) => b.n > 0)
                      .map((b) => (
                        <tr key={b.band} className="border-t border-[var(--border-subtle)]">
                          <td className="px-4 py-3">
                            <span className="text-[var(--text-primary)]">{BAND_LABEL[b.band]}</span>
                            {BAND_NOTE[b.band] ? (
                              <span className="block font-terminal text-[11px] text-[var(--text-muted)]">
                                {BAND_NOTE[b.band]}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 font-terminal">{b.n}</td>
                          <td className="px-4 py-3 font-terminal text-[var(--text-primary)]">
                            {b.publishable && b.rate !== null ? `${b.rate}%` : '—'}
                          </td>
                          <td className="px-4 py-3 font-terminal text-xs text-[var(--text-secondary)]">
                            {b.publishable && b.low !== null ? `${b.low}% – ${b.high}%` : 'n too small'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3">
                The product uses 70 as its threshold: below it a call is labelled "Read" (a market reading), at or
                above it, "Signal". That split came out of our blind backtest, where the two bands separated
                sharply — 25% below versus 56% above.
              </p>
              <p className="mt-3">
                <span className="text-[var(--text-primary)]">In production so far, they have not separated.</span>{' '}
                The confidence intervals in the table above overlap almost entirely, which means we cannot yet
                claim the score predicts anything on live traffic. We are publishing that instead of hiding it. If
                the gap does not open as the sample grows, the score is what changes — not this page.
              </p>
            </Section>

            <Section title="Before and after live candle grounding">
              <p>
                On 17 July 2026 we started feeding the AI real candles — price, RSI(14), range position and
                momentum pulled from live exchange feeds — before it reads your screenshot. We split the record on
                that date so you can judge the change instead of taking our word for it.
              </p>
              {data.byGrounding.before.n > 0 && data.byGrounding.after.n > 0 ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Stat interval={data.byGrounding.before} label="Before grounding" />
                  <Stat interval={data.byGrounding.after} label="After grounding" />
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-[var(--border-card)] bg-[rgba(255,255,255,0.02)] p-5">
                  <p className="font-terminal text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                    Comparison not available yet
                  </p>
                  <p className="mt-2 text-sm text-[var(--text-secondary)]">
                    {data.byGrounding.before.n} resolved before the change, {data.byGrounding.after.n} after. A
                    trade needs 48 hours to resolve, and at our current volume that side of the split is still
                    empty. We would rather leave a gap here than compute a comparison out of a handful of trades.
                  </p>
                </div>
              )}
            </Section>

            <Section title="How every outcome resolved">
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.breakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, value]) => (
                    <span
                      key={key}
                      className="rounded-full border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] px-3 py-1 font-terminal text-xs text-[var(--text-secondary)]"
                    >
                      {key} · {value}
                    </span>
                  ))}
              </div>
              <p className="mt-3">
                <span className="text-[var(--text-primary)]">NO_FILL</span> means price never reached the proposed
                entry. <span className="text-[var(--text-primary)]">ABSTAIN</span> means the AI declined to call the
                chart. <span className="text-[var(--text-primary)]">UNTRACKABLE</span> means we could not source
                reliable candles for that symbol. None of these count as a win or a loss.
              </p>
            </Section>

            <Section title="Methodology">
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  A sweeper runs hourly and evaluates every analysis completed at least 48 hours earlier. No manual
                  selection, no cherry-picking of which trades get scored.
                </li>
                <li>
                  Resolution rule: the entry must fill first. Then the first target races the stop on 30-minute
                  candles. If a single candle contains both the target and the stop, it is recorded as a
                  <span className="text-[var(--text-primary)]"> loss</span> — the pessimistic reading.
                </li>
                <li>
                  Window: 48 hours. An analysis that has neither hit target nor stop by then is a TIMEOUT and is
                  excluded from the hit rate.
                </li>
                <li>
                  Confidence intervals are Wilson score intervals at 95%, the same function our internal backtest
                  uses. Any cut with fewer than 20 resolved trades shows its n instead of a rate.
                </li>
                <li>
                  Only outcomes written by the automatic sweeper are counted. Verdicts users tag by hand in their
                  own trade journal are excluded — self-reporting is not measurement.
                </li>
                <li>Demo and anonymous trial analyses are excluded entirely.</li>
              </ul>
            </Section>

            <Section title="What these numbers do not include">
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <span className="text-[var(--text-primary)]">No trading costs.</span> Spread, slippage,
                  commissions and funding are not deducted. Your real result will be worse than this page.
                </li>
                <li>
                  The sample is small and skewed toward the instruments our early users happen to chart. It is not a
                  representative sample of all markets.
                </li>
                <li>
                  A hit rate is not profitability. Reward-to-risk matters as much, and Tickrify does not know
                  whether you actually took the trade, at what size, or when you exited.
                </li>
              </ul>
            </Section>

            <p className="border-t border-[var(--border-subtle)] pt-6 text-xs leading-relaxed text-[var(--text-muted)]">
              Past results do not guarantee future results. Nothing on this page is investment advice. Tickrify is a
              second opinion on a chart you are already reading — the decision, the size and the risk are yours.
              <br />
              <span className="font-terminal">
                Last updated {new Date(data.updatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC · recalculated hourly
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default AccuracyPage;
