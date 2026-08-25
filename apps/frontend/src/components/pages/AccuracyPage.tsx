import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import SiteLayout from '@/components/layout/SiteLayout';
import { buildApiUrl } from '@/lib/api';
import { seoFor, useJsonLd, useSeo } from '@/hooks/useSeo';

/**
 * Página pública de acurácia, Fase 5 da auditoria de 24/07/2026.
 *
 * Esta é a página que o resto do site precisa poder sustentar. Nenhum
 * concorrente do nicho publica calibração real; publicar os números feios é o
 * ativo mais raro que a Tickrify tem. Por isso ela obedece três regras:
 *
 *  1. Nenhum número sem n e sem intervalo de confiança.
 *  2. Recorte com n < 20 mostra o n e diz que ainda não dá pra concluir.
 *  3. Se a API não responder, a página diz isso, nunca inventa número.
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
  band60to69: '60 to 69',
  band70plus: '70 and above',
  unknown: 'Not recorded',
};

const BAND_NOTE: Record<string, string> = {
  below60: 'Low conviction',
  band60to69: 'Shown as "Read" in the product',
  band70plus: 'Shown as "Signal" in the product',
  unknown: '',
};

/** Um número medido. Sem n suficiente, mostra o n, nunca uma taxa. */
const Kpi = ({ interval, label }: { interval: Interval; label: string }) =>
  interval.publishable && interval.rate !== null ? (
    <div className="site-kpi">
      <b>{interval.rate}%</b>
      <div className="site-kpi-label">{label}</div>
      <div className="site-kpi-note">
        95% CI {interval.low}% to {interval.high}% · n = {interval.n}
      </div>
    </div>
  ) : (
    <div className="site-kpi">
      <b>n = {interval.n}</b>
      <div className="site-kpi-label">{label}</div>
      <div className="site-kpi-note">Too few resolved trades to publish a rate yet</div>
    </div>
  );

const AccuracyPage = () => {
  // Esta página era órfã até 10/08/2026: fora do sitemap, sem meta própria e
  // sem link de lugar nenhum além do rodapé. É o ativo mais raro do site,
  // nenhum concorrente do nicho publica acurácia medida, e o Google não
  // sabia que ela existia.
  useSeo(seoFor('/accuracy'));

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

  /**
   * Dataset schema. Esta pagina publica numero medido, com n e intervalo de
   * confianca, e Dataset e o tipo que descreve exatamente isso. Serve para o
   * Google Dataset Search e, mais relevante hoje, para buscador de IA citar a
   * fonte quando alguem pergunta "how accurate is AI chart analysis".
   *
   * Regra da propria pagina aplicada ao markup: nada declarado que a pagina
   * nao mostre. dateModified e temporalCoverage so entram quando a API
   * respondeu; sem `distribution`, porque o endpoint nao e um download publico
   * documentado e declarar um seria afirmar o que nao da pra verificar.
   */
  const jsonLd = useMemo<Record<string, unknown>>(() => {
    const base: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      name: 'Tickrify AI accuracy: measured hit rate',
      description:
        'The measured hit rate of Tickrify’s AI chart analysis, published with sample size and 95% Wilson confidence intervals, including the results that look bad. Every analysis is re-checked against real market candles 48 hours after it was produced.',
      url: 'https://tickrify.com/accuracy',
      isAccessibleForFree: true,
      creator: { '@type': 'Organization', name: 'Tickrify', url: 'https://tickrify.com' },
      measurementTechnique:
        'Each published analysis is scored automatically against real candles 48 hours later, with no human in the loop. Rates below n = 20 are shown as sample size only.',
      variableMeasured: [
        {
          '@type': 'PropertyValue',
          name: 'Hit rate',
          description: 'Share of resolved analyses that reached target before stop, with a 95% Wilson confidence interval.',
        },
        {
          '@type': 'PropertyValue',
          name: 'Abstention rate',
          description: 'Share of analyses where the model returned "wait" instead of a directional call.',
        },
        {
          '@type': 'PropertyValue',
          name: 'Sample size (n)',
          description: 'Number of resolved analyses behind each published rate.',
        },
      ],
    };
    if (data?.updatedAt) base.dateModified = data.updatedAt;
    if (data?.groundingLiveSince) base.temporalCoverage = `${data.groundingLiveSince.slice(0, 10)}/..`;
    return base;
  }, [data]);

  useJsonLd('accuracy', jsonLd);

  return (
    <SiteLayout active="accuracy">
      <section className="site-dark site-phead">
        <div className="site-wrap">
          <span className="site-eyebrow">Measured, not claimed</span>
          <h1>We score our own AI and publish the losses.</h1>
          <p>
            Every analysis Tickrify produces is re-checked against real candles 48 hours later, automatically, with
            no human in the loop. This page is that raw scoreboard. It moves on its own, it includes the results
            that look bad, and it uses the same maths as our internal backtest.
          </p>
          {data ? (
            <span className="site-updated">
              Updated {new Date(data.updatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC · recalculated hourly
            </span>
          ) : null}
        </div>
      </section>

      {isLoading ? (
        <section className="site-dark site-body-tight">
          <div className="site-wrap">
            <p className="site-note">Loading the scoreboard.</p>
          </div>
        </section>
      ) : null}

      {isError ? (
        <section className="site-dark site-body-tight">
          <div className="site-wrap">
            <div className="site-callout">
              <h3>The numbers are not loading right now.</h3>
              <p>
                Our API sleeps when idle and can take up to a minute to wake up. Refresh in a moment. We would
                rather show you nothing than show you a number we did not measure.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {data ? (
        <>
          <div className="site-kpis">
            <Kpi interval={data.overall} label="Reached target before stop" />
            <div className="site-kpi">
              <b>{data.abstention.rate === null ? 'n/a' : `${data.abstention.rate}%`}</b>
              <div className="site-kpi-label">Charts the AI refused to call</div>
              <div className="site-kpi-note">
                {data.abstention.wait} of {data.abstention.total} analyses returned WAIT
              </div>
            </div>
            <div className="site-kpi">
              <b>{data.overall.wins}</b>
              <div className="site-kpi-label">Wins counted</div>
              <div className="site-kpi-note">Entry filled, then target before stop</div>
            </div>
            <div className="site-kpi">
              <b>{data.overall.losses}</b>
              <div className="site-kpi-label">Losses counted</div>
              <div className="site-kpi-note">Nothing quietly dropped to flatter the rate</div>
            </div>
          </div>

          <section className="site-dark">
            <div className="site-wrap site-prose">
              <h2 id="hit-rate">What counts as a hit</h2>
              <p>
                A hit is an analysis whose entry actually filled and then reached the first target before the stop.
                Losses, unfilled entries and abstentions are counted separately below. Nothing is quietly dropped to
                make the number look better.
              </p>

              <h2 id="confidence">Does the confidence score mean anything?</h2>
              <p>
                This is the part that matters. If the number next to a call carries no information, the whole
                product is theatre. Here is the hit rate split by the confidence the AI assigned at the time:
              </p>

              <div className="site-tablewrap">
                <table className="site-table">
                  <thead>
                    <tr>
                      <th>Confidence</th>
                      <th>Resolved</th>
                      <th>Hit rate</th>
                      <th>95% CI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byConfidence
                      .filter((band) => band.n > 0)
                      .map((band) => (
                        <tr key={band.band}>
                          <td className="site-sym-cell">
                            {BAND_LABEL[band.band]}
                            {BAND_NOTE[band.band] ? <span className="site-cell-note">{BAND_NOTE[band.band]}</span> : null}
                          </td>
                          <td>{band.n}</td>
                          <td>{band.publishable && band.rate !== null ? `${band.rate}%` : 'n/a'}</td>
                          <td>
                            {band.publishable && band.low !== null ? `${band.low}% to ${band.high}%` : 'n too small'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <p>
                The product uses 70 as its threshold: below it a call is labelled "Read", a market reading; at or
                above it, "Signal". That split came out of our blind backtest, where the two bands separated
                sharply, 25% below versus 56% above.
              </p>
              <p>
                <strong>In production so far, they have not separated.</strong> The confidence intervals in the
                table overlap almost entirely, which means we cannot yet claim the score predicts anything on live
                traffic. We are publishing that instead of hiding it. If the gap does not open as the sample grows,
                the score is what changes, not this page.
              </p>

              <h2 id="grounding">Before and after live candle grounding</h2>
              <p>
                On 17 July 2026 we started feeding the AI real candles, price, RSI(14), range position and momentum
                pulled from live exchange feeds, before it reads your screenshot. We split the record on that date so
                you can judge the change instead of taking our word for it.
              </p>
              {data.byGrounding.before.n > 0 && data.byGrounding.after.n > 0 ? (
                <div className="site-kpis site-kpis-inline">
                  <Kpi interval={data.byGrounding.before} label="Before grounding" />
                  <Kpi interval={data.byGrounding.after} label="After grounding" />
                </div>
              ) : (
                <div className="site-callout">
                  <h3>Comparison not available yet</h3>
                  <p>
                    {data.byGrounding.before.n} resolved before the change, {data.byGrounding.after.n} after. A trade
                    needs 48 hours to resolve, and at our current volume that side of the split is still empty. We
                    would rather leave a gap here than compute a comparison out of a handful of trades.
                  </p>
                </div>
              )}

              <h2 id="outcomes">How every outcome resolved</h2>
              <div className="site-chips">
                {Object.entries(data.breakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, value]) => (
                    <span key={key}>
                      {key} · {value}
                    </span>
                  ))}
              </div>
              <p>
                <strong>NO_FILL</strong> means price never reached the proposed entry. <strong>ABSTAIN</strong> means
                the AI declined to call the chart. <strong>UNTRACKABLE</strong> means we could not source reliable
                candles for that symbol. None of these count as a win or a loss.
              </p>

              <h2 id="method">Methodology</h2>
              <ul>
                <li>
                  A sweeper runs hourly and evaluates every analysis completed at least 48 hours earlier. No manual
                  selection, no cherry-picking of which trades get scored.
                </li>
                <li>
                  Resolution rule: the entry must fill first. Then the first target races the stop on 30-minute
                  candles. If a single candle contains both the target and the stop, it is recorded as a{' '}
                  <strong>loss</strong>, the pessimistic reading.
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
                  Only outcomes written by the automatic sweeper are counted. Verdicts users tag by hand in their own
                  trade journal are excluded. Self-reporting is not measurement.
                </li>
                <li>Demo and anonymous trial analyses are excluded entirely.</li>
              </ul>

              <h2 id="excluded">What these numbers do not include</h2>
              <ul>
                <li>
                  <strong>No trading costs.</strong> Spread, slippage, commissions and funding are not deducted. Your
                  real result will be worse than this page.
                </li>
                <li>
                  The sample is small and skewed toward the instruments our early users happen to chart. It is not a
                  representative sample of all markets.
                </li>
                <li>
                  A hit rate is not profitability. Reward-to-risk matters as much, and Tickrify does not know whether
                  you actually took the trade, at what size, or when you exited.
                </li>
              </ul>

              <div className="site-callout">
                <h3>Read this next</h3>
                <p>
                  Past results do not guarantee future results. Nothing on this page is investment advice. Tickrify
                  is a second opinion on a chart you are already reading: the decision, the size and the risk are
                  yours. The full <Link to="/risk">risk disclosure</Link> spells out what can go wrong.
                </p>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </SiteLayout>
  );
};

export default AccuracyPage;
