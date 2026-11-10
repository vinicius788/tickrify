import { messageText } from '@/lib/i18n/messages';
// /try, demo anônima de 1 tela (Fase 0 de ativação).
//
// Princípio: valor primeiro, cadastro depois. O visitante chega, já existe um
// gráfico de exemplo carregado e UM botão. Clica → recebe uma análise REAL do
// motor da plataforma em segundos → CTA de cadastro. Zero tela em branco.
//
// Todo o enforcement (cota 1/device, rate limit, anti-bot) é do SERVIDOR.
// Esta página apenas coleta fingerprint + token e mostra o resultado.
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
  waitForDemoResult,
  requestDemoAnalysis,
  saveDemoResult,
} from '@/lib/demo-api';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { ReadModePanel } from '@/components/dashboard/ReadModePanel';
import { LOCALES, type Language } from '@/lib/i18n';
import { entrySide, getScenarioMeta, resolveSignalState, signalStateLabel, signalStateTone } from '@/lib/trading-ui';
import { warmupPaymentsApi } from '@/lib/api';
import { shrinkChartImage } from '@/lib/chart-image';
import { chartFileError } from '@/lib/chart-upload';
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

function formatDemoPrice(value: number | null, language: Language): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return value.toLocaleString(LOCALES[language], {
    minimumFractionDigits: value < 10 ? 4 : 2,
    maximumFractionDigits: value < 10 ? 4 : 2,
  });
}

const SignupCta = ({ headline, sub }: { headline: string; sub: string }) => {
  const { t } = useLanguage();
  return (
  <div className="site-try-cta">
    <h3>{headline}</h3>
    <p>{sub}</p>
    <SignedOut>
      <SignUpButton mode="modal" forceRedirectUrl="/dashboard" signInForceRedirectUrl="/dashboard">
        <button type="button" onClick={markDemoSource} className="site-btn site-btn-primary">{t.demoUi.createAccount}</button>
      </SignUpButton>
    </SignedOut>
    <SignedIn>
      <Link to="/dashboard" className="site-btn site-btn-primary">{t.demoUi.dashboard}</Link>
    </SignedIn>
    <SignedOut>
      <p className="site-try-fine">{t.demoUi.eligibility}</p>
    </SignedOut>
  </div>
  );
};

const TryPage = () => {
  // Página de maior conversão do funil (análise real sem cadastro) e a que
  // melhor responde à busca "free ai chart analysis", mas estava fora do
  // sitemap e servindo o title do home.
  useSeo(seoFor('/try'));

  const { language, t } = useLanguage();
  const formatPrice = (value: number | null) => formatDemoPrice(value, language);
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
      const { used, result: previous } = await fetchDemoStatus(fp);
      if (previous) {
        // A leitura que este aparelho ja recebeu (talvez sem ver): mostra de
        // novo em vez de "voce ja usou".
        setResult(previous);
        setAnalyzedExample(false);
        setState((prev) => (prev === 'ready' ? 'done' : prev));
        saveDemoResult(previous);
        track('demo_result_recovered', { source: 'status_check' });
      } else if (used) {
        setState((prev) => (prev === 'ready' ? 'locked' : prev));
        track('demo_limit_hit', { source: 'status_check' });
      }
    })();
  }, []);

  // Copia a imagem para a memoria na escolha, como no painel (NewAnalysis):
  // no Android, arquivo do Google Fotos ou de pasta na nuvem pode ficar
  // ilegivel ate o envio, e o erro saia como falha de rede.
  const handleFile = useCallback(async (file: File | undefined | null) => {
    if (!file) return;
    const validationError = chartFileError(file);
    if (validationError) {
      setError(t.commercial[validationError]);
      return;
    }
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
        t.demoUi.openImage,
      );
      return;
    }
    setError(null);
    setCustomImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { blob: copy, previewUrl: URL.createObjectURL(copy) };
    });
  }, [t]);

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
        // Reduz como o painel ja faz: a foto do celular ia inteira pela rede
        // movel e o envio caia no meio (network_error).
        image = await shrinkChartImage(
          new File([customImage.blob], 'chart', { type: customImage.blob.type || 'image/png' }),
        );
      } else {
        const exampleResponse = await fetch(exampleChart);
        image = await exampleResponse.blob();
      }

      const send = async () =>
        requestDemoAnalysis({ image, fingerprint, turnstileToken: await getTurnstileToken(), userLanguage: language });
      let analysis: DemoAnalysisResult;
      try {
        analysis = await send();
      } catch (err) {
        if (!(err instanceof DemoApiError) || err.code !== 'network_error') throw err;
        // Conexao caiu (troca de app no celular): o servidor pode estar
        // analisando. Espera a leitura; se o envio nem chegou, envia de novo.
        track('demo_network_retry', { chart });
        const waited = await waitForDemoResult(fingerprint);
        if (waited.result) analysis = { ...waited.result, recovered: true };
        else if (waited.arrived) throw err;
        else analysis = await send();
      }

      setResult(analysis);
      setState('done');
      saveDemoResult(analysis);
      if (analysis.recovered) track('demo_result_recovered', { source: 'analyze' });
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
          setError(t.demoUi.rateLimited);
          return;
        }
        if (err.code === 'non_chart_image' || err.code === 'invalid_image') {
          setState('ready');
          setError(t.demoUi.nonChart);
          return;
        }
        if (err.code === 'bot_check_failed') {
          setState('ready');
          setError(t.demoUi.botCheck);
          return;
        }
      }
      setState('ready');
      setError(t.demoUi.failed);
    }
  };

  // Rotulo principal = estado do copiloto (pagina so em ingles); o cenario fica ao lado, neutro.
  const scenario = result ? getScenarioMeta(result.bias, result.recommendation) : null;
  const signalState = result ? resolveSignalState(result.signalState, result.recommendation) : 'NO_TRADE';
  const stateTone = result ? signalStateTone(signalState, result.recommendation) : 'hold';
  const callClass = stateTone === 'buy' ? 'site-chip-long' : stateTone === 'sell' ? 'site-chip-short' : 'site-chip-wait';

  return (
    <SiteLayout minimal>
      <section className="site-dark site-phead">
        <div className="site-wrap site-try-head">
          <span className="site-eyebrow">{t.demoUi.eyebrow}</span>
          <h1>{t.demoUi.title}</h1>
          <p>{t.demoUi.subtitle}</p>
        </div>
      </section>

      <section className="site-dark site-body-tight">
        <div className="site-wrap site-try">
          {state === 'analyzing' && (
            <div className="site-card">
              {/* Mesma tela de espera do dashboard: o gráfico sendo varrido e as
                  fases embaixo. Quem vê a demo da vitrine reconhece isto aqui. */}
              <AnalysisLoading chart={customImage?.previewUrl ?? exampleChart} />
              <p className="site-try-fine">{t.demoUi.keepOpen}</p>
            </div>
          )}

          {state === 'ready' && (
            <div className="site-card">
              <div className="site-try-shot">
                <img
                  src={customImage?.previewUrl ?? exampleChart}
                  alt={customImage ? t.demoUi.yourChart : t.demoUi.exampleChart}
                />
                {customImage && (
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(customImage.previewUrl);
                      setCustomImage(null);
                    }}
                    className="site-try-remove"
                    aria-label={t.demoUi.removeChart}
                  >{t.demoUi.remove}</button>
                )}
              </div>

              <p className="site-try-caption">
                {customImage
                  ? t.demoUi.ready
                  : t.demoUi.exampleReady}
              </p>

              {error && <p role="alert" className="site-try-error">{error}</p>}

              <div className="site-try-actions">
                <button
                  type="button"
                  onClick={runAnalysis}
                  className="site-btn site-btn-primary site-btn-block"
                >{t.demoUi.analyze}</button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="site-try-upload"
                >
                  {customImage ? t.demoUi.chooseDifferent : t.demoUi.upload}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }}
                />

                <p className="site-try-fine">{t.demoUi.freeAllowance}</p>
                <p className="site-try-fine">{t.commercial.freeEligibility}</p>
              </div>
            </div>
          )}

          {state === 'done' && result && (
            <div className="site-card">
              <div className="site-card-head">
                <span className="site-sym">
                  {result.symbol} · {result.timeframe}
                </span>
                <span className="site-chip">{t.demoUi.realAnalysis}</span>
              </div>

              <div className="site-verdict flex-wrap">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`site-call ${callClass}`}>{signalStateLabel(t.analysis, signalState, entrySide(result.watchPlan, result.recommendation))}</span>
                  <span className="site-chip">{`${t.analysis.bias}: ${t.scenarioLabels[scenario?.label ?? 'NEUTRAL']}`}</span>
                </div>
                {result.riskReward && result.recommendation !== 'WAIT' ? (
                  <span className="site-conf"><span>{t.demoUi.rr}</span>{' '}<b>{result.riskReward}</b>
                  </span>
                ) : null}
              </div>

              {/* WAIT sem niveis: entrada, stop e alvos de um trade que o veredito
                  manda nao fazer contradizem a resposta (mesma regra do painel). */}
              {result.recommendation === 'WAIT' ? (
                <p className="site-demo-rationale">
                  {signalState === 'WATCH' ? t.analysis.result.watchExplain : t.analysis.result.noTradeExplain}
                </p>
              ) : (
              <div className="site-levels">
                {[
                  { label: t.demoUi.entry, value: result.entry },
                  { label: t.demoUi.stop, value: result.stopLoss },
                  { label: t.demoUi.target1, value: result.takeProfit1 },
                  { label: t.demoUi.target2, value: result.takeProfit2 },
                ].map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <strong>{formatPrice(item.value)}</strong>
                  </div>
                ))}
              </div>
              )}
              {result.recommendation !== 'WAIT' ? (
                <p className="site-try-fine">{t.demoUi.levelGuide}</p>
              ) : null}

              <div className="my-4">
                <ReadModePanel
                  formatPrice={formatPrice}
                  data={{
                    state: signalState,
                    bias: result.bias,
                    strength: result.trendStrength ?? null,
                    reason: result.readLine ?? '',
                    location: result.location ?? null,
                    currentPrice: result.currentPrice,
                    dataMode: result.dataMode ?? null,
                    levels: { entry: result.entry, stopLoss: result.stopLoss, takeProfit1: result.takeProfit1, takeProfit2: result.takeProfit2 },
                    watchPlan: result.watchPlan ?? null,
                    watchReach: result.watchReach ?? null,
                    noTradeReason: result.readLine || null,
                  }}
                />
              </div>

              {result.reasoning && <p className="site-demo-rationale">{messageText(t, language, result.reasoningCode, {}, result.reasoning)}</p>}
              <div className="site-demo-meta">{messageText(t, language, result.disclaimerCode, {}, result.disclaimer)}</div>

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
                >{t.demoUi.reveal}</button>
              )}
              {analyzedExample && showAfter && (
                <div className="site-try-after">
                  <div className="site-try-shot">
                    <img src={afterChart} alt={t.demoUi.afterAlt} loading="lazy" decoding="async" width={1400} height={812} />
                  </div>
                  <p className="site-try-caption">{t.demoUi.after}{' '}
                    <strong>{t.demoUi.youDecide}</strong>
                  </p>
                  <p className="site-try-fine">{t.demoUi.historical}</p>
                </div>
              )}

              <SignupCta
                headline={t.demoUi.wantMore}
                sub={t.commercial.freeEligibility}
              />
            </div>
          )}

          {state === 'locked' && (
            <div className="site-card site-try-locked">
              <h2>{t.demoUi.used}</h2>
              <p>
                {t.commercial.freeEligibility}
              </p>
              <SignupCta
                headline={t.demoUi.keepAnalyzing}
                sub={t.demoUi.allowance}
              />
            </div>
          )}

          <p className="site-try-legal">
            <span>{t.interfaceExtras.tryLegal}</span>{' '}
            <Link to="/risk">{t.interfaceExtras.riskDisclosure}</Link>.
          </p>
        </div>
      </section>
    </SiteLayout>
  );
};

export default TryPage;
