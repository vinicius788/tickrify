// /try, demo anônima de 1 tela (Fase 0 de ativação).
//
// Princípio: valor primeiro, cadastro depois. O visitante chega, já existe um
// gráfico de exemplo carregado e UM botão. Clica → recebe uma análise REAL do
// motor da plataforma em segundos → CTA de cadastro. Zero tela em branco.
//
// Todo o enforcement (cota 1/device, rate limit, anti-bot) é do SERVIDOR.
// Esta página apenas coleta fingerprint + token e mostra o resultado.
//
// Copy em inglês de propósito: mercado-alvo é EUA/UK/EU (decisão jun/2026).
//
// 24/08/2026: passou a usar a casca do site em modo `minimal` — logo, idioma e
// entrar, sem menu. Ganha rodapé (legal, que faltava numa página que pede
// cadastro) sem ganhar as saídas de um menu completo antes do "aha".
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SignUpButton, SignedOut, SignedIn } from '@clerk/clerk-react';
import SiteLayout from '@/components/layout/SiteLayout';
import AnalysisLoading from '@/components/dashboard/AnalysisLoading';
import { track, trackSignupStartedOnce } from '@/lib/analytics';
import { getDeviceFingerprint } from '@/lib/fingerprint';
import { getTurnstileToken } from '@/lib/turnstile';
import {
  DemoApiError,
  DemoAnalysisResult,
  fetchDemoStatus,
  requestDemoAnalysis,
  saveDemoResult,
} from '@/lib/demo-api';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { getScenarioMeta } from '@/lib/trading-ui';
import { warmupPaymentsApi } from '@/lib/api';
import { seoFor, useSeo } from '@/hooks/useSeo';
import exampleChart from '@/assets/demo-example-chart.png';
import afterChart from '@/assets/demo-after-chart.png';

type PageState = 'ready' | 'analyzing' | 'done' | 'locked';

/** Marca que o cadastro veio da demo, AnalyticsIdentify usa pra disparar signup_from_demo. */
function markDemoSource() {
  // O cadastro daqui abre num modal do Clerk, sem passar pela rota /sign-up:
  // sem este track o funil da demo perdia o degrau do cadastro.
  trackSignupStartedOnce('demo');
  try {
    localStorage.setItem('tickrify_demo_source', String(Date.now()));
  } catch {
    /* noop */
  }
}

function formatPrice(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: value < 10 ? 4 : 2,
    maximumFractionDigits: value < 10 ? 4 : 2,
  });
}

const SignupCta = ({ headline, sub }: { headline: string; sub: string }) => (
  <div className="site-try-cta">
    <h3>{headline}</h3>
    <p>{sub}</p>
    <SignedOut>
      <SignUpButton mode="modal" forceRedirectUrl="/dashboard" signInForceRedirectUrl="/dashboard">
        <button type="button" onClick={markDemoSource} className="site-btn site-btn-primary">
          Create free account
        </button>
      </SignUpButton>
    </SignedOut>
    <SignedIn>
      <Link to="/dashboard" className="site-btn site-btn-primary">
        Go to your dashboard
      </Link>
    </SignedIn>
    <SignedOut>
      <p className="site-try-fine">Free account · 3 free trade plans · WAIT reads don't count · no credit card</p>
    </SignedOut>
  </div>
);

const TryPage = () => {
  // Página de maior conversão do funil (análise real sem cadastro) e a que
  // melhor responde à busca "free ai chart analysis", mas estava fora do
  // sitemap e servindo o title do home.
  useSeo(seoFor('/try'));

  const { language } = useLanguage();
  const [state, setState] = useState<PageState>('ready');
  const [result, setResult] = useState<DemoAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customImage, setCustomImage] = useState<{ blob: Blob; previewUrl: string } | null>(null);
  // Reveal "what happened next", só existe pro gráfico de exemplo (caso histórico real).
  const [showAfter, setShowAfter] = useState(false);
  const [analyzedExample, setAnalyzedExample] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fingerprintRef = useRef<string | null>(null);
  const viewTracked = useRef(false);

  // Chegou na demo: evento + acorda o backend (Render hiberna) + cota do device.
  useEffect(() => {
    if (!viewTracked.current) {
      viewTracked.current = true;
      track('demo_page_view');
    }
    warmupPaymentsApi();
    void (async () => {
      const fp = await getDeviceFingerprint();
      fingerprintRef.current = fp;
      const used = await fetchDemoStatus(fp);
      if (used) {
        setState((prev) => (prev === 'ready' ? 'locked' : prev));
        track('demo_limit_hit', { source: 'status_check' });
      }
    })();
  }, []);

  // Copia a imagem para a memoria na escolha, como no painel (NewAnalysis):
  // no Android, arquivo do Google Fotos ou de pasta na nuvem pode ficar
  // ilegivel ate o envio, e o erro saia como falha de rede.
  const handleFile = useCallback(async (file: File | undefined | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    let copy: Blob;
    try {
      copy = new Blob([await file.arrayBuffer()], { type: file.type });
    } catch (err) {
      track('upload_read_failed', {
        surface: 'try',
        fileType: file.type || null,
        fileBytes: file.size ?? null,
        errorName: err instanceof Error ? err.name : null,
      });
      setError(
        "We couldn't open this image. If it came from Google Photos or a cloud folder, save it to your device or take a new screenshot, then try again.",
      );
      return;
    }
    setError(null);
    setCustomImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { blob: copy, previewUrl: URL.createObjectURL(copy) };
    });
  }, []);

  // Colar print direto (Ctrl/Cmd+V), atrito mínimo pra quem veio do TradingView.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      );
      if (item) void handleFile(item.getAsFile());
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFile]);

  const runAnalysis = async () => {
    if (state === 'analyzing') return;
    setError(null);
    setState('analyzing');
    setShowAfter(false);
    setAnalyzedExample(!customImage);
    const chart = customImage ? 'own' : 'example';
    track('demo_analysis_started', { chart });

    try {
      const fingerprint = fingerprintRef.current ?? (await getDeviceFingerprint());
      fingerprintRef.current = fingerprint;

      // Gráfico do usuário, ou o exemplo pré-carregado (zero decisão).
      let image: Blob;
      if (customImage) {
        image = customImage.blob;
      } else {
        const exampleResponse = await fetch(exampleChart);
        image = await exampleResponse.blob();
      }

      const turnstileToken = await getTurnstileToken();
      const analysis = await requestDemoAnalysis({
        image,
        fingerprint,
        turnstileToken,
        userLanguage: language,
      });

      setResult(analysis);
      setState('done');
      saveDemoResult(analysis);
      track('demo_analysis_completed', {
        recommendation: analysis.recommendation,
        confidence: analysis.confidence,
        chart,
      });
    } catch (err) {
      track('demo_analysis_failed', {
        code: err instanceof DemoApiError ? err.code : 'client_error',
        chart,
      });
      if (err instanceof DemoApiError) {
        if (err.code === 'demo_limit_reached') {
          setState('locked');
          track('demo_limit_hit', { source: 'analyze' });
          return;
        }
        if (err.code === 'rate_limited') {
          setState('ready');
          setError('Too many attempts from your network. Please try again in about an hour.');
          return;
        }
        if (err.code === 'non_chart_image' || err.code === 'invalid_image') {
          setState('ready');
          setError('That image does not look like a trading chart. Upload a chart screenshot and try again.');
          return;
        }
        if (err.code === 'bot_check_failed') {
          setState('ready');
          setError('Human verification failed. Refresh the page and try again.');
          return;
        }
      }
      setState('ready');
      setError('The analysis failed. Your free analysis was NOT used. Please try again.');
    }
  };

  // A cor principal acompanha o cenário; a ação continua explícita e separada.
  const scenario = result ? getScenarioMeta(result.bias, result.recommendation) : null;
  const callClass =
    scenario?.tone === 'buy'
      ? 'site-chip-long'
      : scenario?.tone === 'sell'
        ? 'site-chip-short'
        : 'site-chip-wait';
  const actionClass = result?.recommendation === 'BUY'
    ? 'site-chip-long'
    : result?.recommendation === 'SELL'
      ? 'site-chip-short'
      : 'site-chip-wait';

  return (
    <SiteLayout minimal>
      <section className="site-dark site-phead">
        <div className="site-wrap site-try-head">
          <span className="site-eyebrow">Free demo</span>
          <h1>See a real AI chart analysis. No signup.</h1>
          <p>
            One click, and the same engine our subscribers use returns entry, stop, targets and risk on a
            real chart, or a WAIT with what would have to change.
          </p>
        </div>
      </section>

      <section className="site-dark site-body-tight">
        <div className="site-wrap site-try">
          {state === 'analyzing' && (
            <div className="site-card">
              {/* Mesma tela de espera do dashboard: o gráfico sendo varrido e as
                  fases embaixo. Quem vê a demo da vitrine reconhece isto aqui. */}
              <AnalysisLoading chart={customImage?.previewUrl ?? exampleChart} />
            </div>
          )}

          {state === 'ready' && (
            <div className="site-card">
              <div className="site-try-shot">
                <img
                  src={customImage?.previewUrl ?? exampleChart}
                  alt={customImage ? 'Your chart' : 'Example chart: XAUUSD (Gold) M30'}
                />
                {customImage && (
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(customImage.previewUrl);
                      setCustomImage(null);
                    }}
                    className="site-try-remove"
                    aria-label="Remove uploaded chart"
                  >
                    Remove
                  </button>
                )}
              </div>

              <p className="site-try-caption">
                {customImage
                  ? 'Your chart, ready to analyze.'
                  : 'Example loaded: XAUUSD (Gold) · M30, a real trader chart. Or use your own below.'}
              </p>

              {error && <p className="site-try-error">{error}</p>}

              <div className="site-try-actions">
                <button
                  type="button"
                  onClick={runAnalysis}
                  className="site-btn site-btn-primary site-btn-block"
                >
                  Analyze this chart now
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="site-try-upload"
                >
                  {customImage ? 'Choose a different chart' : 'Or upload / paste your own chart screenshot'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleFile(e.target.files?.[0])}
                />

                <p className="site-try-fine">1 free analysis per device · no account · no card</p>
                <p className="site-try-fine">After that, a free account adds 3 trade plans on your own charts.</p>
              </div>
            </div>
          )}

          {state === 'done' && result && (
            <div className="site-card">
              <div className="site-card-head">
                <span className="site-sym">
                  {result.symbol} · {result.timeframe}
                </span>
                <span className="site-chip">Real analysis</span>
              </div>

              <div className="site-verdict flex-wrap">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`site-call ${callClass}`}>{scenario?.icon} {scenario?.label}</span>
                  <span className={`site-chip ${actionClass}`}>Action: {result.recommendation}</span>
                </div>
                {result.riskReward && result.recommendation !== 'WAIT' ? (
                  <span className="site-conf">
                    R:R to TP1 <b>{result.riskReward}</b>
                  </span>
                ) : null}
              </div>

              {/* WAIT sem niveis: entrada, stop e alvos de um trade que o veredito
                  manda nao fazer contradizem a resposta (mesma regra do painel). */}
              {result.recommendation === 'WAIT' ? (
                <p className="site-demo-rationale">
                  WAIT means the AI found no clean entry on this chart right now. Staying out of a bad trade is part of
                  the job.
                </p>
              ) : (
              <div className="site-levels">
                {[
                  { label: 'Entry', value: result.entry },
                  { label: 'Stop', value: result.stopLoss },
                  { label: 'Target 1', value: result.takeProfit1 },
                  { label: 'Target 2', value: result.takeProfit2 },
                ].map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <strong>{formatPrice(item.value)}</strong>
                  </div>
                ))}
              </div>
              )}
              {result.recommendation !== 'WAIT' ? (
                <p className="site-try-fine">
                  Entry: where the plan starts. Stop: where the idea is proven wrong. Targets: where to take profit.
                  R:R to TP1: the potential reward for each unit of risk, up to the first target.
                </p>
              ) : null}

              {result.reasoning && <p className="site-demo-rationale">{result.reasoning}</p>}
              <div className="site-demo-meta">{result.disclaimer}</div>

              {/* Reveal "what happened next", só pro gráfico de exemplo, que é um caso
                  histórico real (XAUUSD 12/12/2025). Prova sem promessa: mostramos o que
                  o mercado fez e o visitante tira a própria conclusão. */}
              {analyzedExample && !showAfter && (
                <button
                  type="button"
                  onClick={() => {
                    setShowAfter(true);
                    track('demo_after_viewed');
                  }}
                  className="site-btn site-btn-ghost site-btn-block site-try-reveal"
                >
                  This chart is from Dec 12, 2025. See what the market did next.
                </button>
              )}
              {analyzedExample && showAfter && (
                <div className="site-try-after">
                  <div className="site-try-shot">
                    <img src={afterChart} alt="The same XAUUSD chart hours later" loading="lazy" decoding="async" width={1400} height={812} />
                  </div>
                  <p className="site-try-caption">
                    The same chart, hours later that day: gold ran from the 4,260s into the 4,340s.{' '}
                    <strong>You decide what the read was worth.</strong>
                  </p>
                  <p className="site-try-fine">
                    One hand-picked historical example, shown for illustration. Every market and moment is
                    different, never a promise of results.
                  </p>
                </div>
              )}

              <SignupCta
                headline="Want to analyze more charts?"
                sub="Create your free account and get 3 free trade plans on your own charts. WAIT reads don't count, and this read stays in your dashboard on this device."
              />
            </div>
          )}

          {state === 'locked' && (
            <div className="site-card site-try-locked">
              <h2>You already used your free analysis</h2>
              <p>
                It does not stop here. Create a free account and get 3 free trade plans on your own charts (WAIT
                reads don't count), no credit card needed.
              </p>
              <SignupCta
                headline="Keep analyzing for free"
                sub="3 free trade plans included with your free account."
              />
            </div>
          )}

          <p className="site-try-legal">
            Tickrify provides educational analysis only, not financial advice. Trading involves risk and you
            can lose your capital. The decision is always yours. Read the{' '}
            <Link to="/risk">risk disclosure</Link>.
          </p>
        </div>
      </section>
    </SiteLayout>
  );
};

export default TryPage;
