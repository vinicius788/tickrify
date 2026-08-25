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
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SignUpButton, SignedOut, SignedIn } from '@clerk/clerk-react';
import { ArrowRight, Lock, ShieldCheck, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics';
import { getDeviceFingerprint } from '@/lib/fingerprint';
import { getTurnstileToken } from '@/lib/turnstile';
import {
  DemoApiError,
  DemoAnalysisResult,
  fetchDemoStatus,
  requestDemoAnalysis,
} from '@/lib/demo-api';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { warmupPaymentsApi } from '@/lib/api';
import { seoFor, useSeo } from '@/hooks/useSeo';
import exampleChart from '@/assets/demo-example-chart.png';
import afterChart from '@/assets/demo-after-chart.png';
import logoOfficial from '@/assets/tickrify-logo-official.png';

type PageState = 'ready' | 'analyzing' | 'done' | 'locked';

const ANALYZING_STEPS = [
  'Reading the chart…',
  'Detecting market structure…',
  'Checking confluence…',
  'Building the trade plan…',
];

/** Marca que o cadastro veio da demo, AnalyticsIdentify usa pra disparar signup_from_demo. */
function markDemoSource() {
  try {
    localStorage.setItem('tickrify_demo_source', String(Date.now()));
  } catch {
    /* noop */
  }
}

function formatPrice(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: value < 10 ? 4 : 2,
    maximumFractionDigits: value < 10 ? 4 : 2,
  });
}

const SignupCta = ({ headline, sub }: { headline: string; sub: string }) => (
  <div className="mt-6 rounded-2xl border border-[var(--border-subtle)] bg-[rgba(124,92,255,0.06)] p-6 text-center">
    <p className="text-lg font-semibold text-[var(--text-primary)]">{headline}</p>
    <p className="mt-1 text-sm text-[var(--text-secondary)]">{sub}</p>
    <SignedOut>
      <SignUpButton mode="modal" forceRedirectUrl="/dashboard" signInForceRedirectUrl="/dashboard">
        <Button
          onClick={markDemoSource}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-[#F7F7F5] font-medium text-[#08090A] transition-colors hover:bg-white mt-4 h-12 rounded-xl px-8 text-sm font-bold"
        >
          Create free account <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </SignUpButton>
    </SignedOut>
    <SignedIn>
      <Button asChild className="inline-flex items-center justify-center gap-2 rounded-full bg-[#F7F7F5] font-medium text-[#08090A] transition-colors hover:bg-white mt-4 h-12 rounded-xl px-8 text-sm font-bold">
        <Link to="/dashboard">
          Go to your dashboard <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </Button>
    </SignedIn>
    <p className="mt-3 text-xs text-[var(--text-secondary)]">
      Free account · 3 more analyses included · no credit card
    </p>
  </div>
);

const TryPage = () => {
  // Página de maior conversão do funil (análise real sem cadastro) e a que
  // melhor responde à busca "free ai chart analysis", mas estava fora do
  // sitemap e servindo o title do home.
  useSeo(seoFor('/try'));

  const { language } = useLanguage();
  const [state, setState] = useState<PageState>('ready');
  const [stepIndex, setStepIndex] = useState(0);
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

  // Passos animados enquanto a análise real roda (~10–30s).
  useEffect(() => {
    if (state !== 'analyzing') return;
    setStepIndex(0);
    const timer = setInterval(
      () => setStepIndex((i) => Math.min(i + 1, ANALYZING_STEPS.length - 1)),
      6000,
    );
    return () => clearInterval(timer);
  }, [state]);

  const handleFile = useCallback((file: File | undefined | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    setError(null);
    setCustomImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { blob: file, previewUrl: URL.createObjectURL(file) };
    });
  }, []);

  // Colar print direto (Ctrl/Cmd+V), atrito mínimo pra quem veio do TradingView.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      );
      if (item) handleFile(item.getAsFile());
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
    track('demo_analysis_started', { chart: customImage ? 'own' : 'example' });

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
      track('demo_analysis_completed', {
        recommendation: analysis.recommendation,
        confidence: analysis.confidence,
        chart: customImage ? 'own' : 'example',
      });
    } catch (err) {
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

  const recColor =
    result?.recommendation === 'BUY'
      ? 'text-[var(--accent-green)] border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)]'
      : result?.recommendation === 'SELL'
        ? 'text-red-400 border-red-500/40 bg-red-500/10'
        : 'text-amber-300 border-amber-400/40 bg-amber-400/10';

  return (
    <div className="min-h-screen bg-[#050508] pb-16">
      {/* Header mínimo: logo + login. Nada que distraia do botão único. */}
      <header className="container flex items-center justify-between py-5">
        <Link to="/" className="flex items-center gap-2">
          <img src={logoOfficial} alt="Tickrify" className="h-8 w-auto" />
        </Link>
        <SignedOut>
          <Link
            to="/sign-in"
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Sign in
          </Link>
        </SignedOut>
      </header>

      <main className="container max-w-3xl">
        <div className="text-center">
          <h1
            className="mx-auto max-w-xl"
            style={{
              fontSize: 'clamp(2rem, 5vw, 3rem)',
              fontWeight: 500,
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              fontFamily: 'var(--font-serif)',
              color: 'var(--text-primary)',
            }}
          >
            See a real AI chart analysis. Free. No signup.
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-[var(--text-secondary)]">
            One click. The same engine our subscribers use: entry, stop, targets,
            risk/reward and confidence on a real chart.
          </p>
        </div>

        {/* ── Estado: pronto / analisando ─────────────────────────────── */}
        {(state === 'ready' || state === 'analyzing') && (
          <div className="mt-8 rounded-2xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] p-4 sm:p-6">
            <div className="relative overflow-hidden rounded-xl border border-[var(--border-subtle)]">
              <img
                src={customImage?.previewUrl ?? exampleChart}
                alt={customImage ? 'Your chart' : 'Example chart: XAUUSD (Gold) M30'}
                className="w-full"
              />
              {customImage && state === 'ready' && (
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(customImage.previewUrl);
                    setCustomImage(null);
                  }}
                  className="absolute right-2 top-2 rounded-full bg-black/70 p-1.5 text-white hover:bg-black"
                  aria-label="Remove uploaded chart"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {state === 'analyzing' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-[2px]">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent-green)] border-t-transparent" />
                  <p className="mt-4 text-sm font-medium text-white">
                    {ANALYZING_STEPS[stepIndex]}
                  </p>
                  <p className="mt-1 text-xs text-white/60">Real analysis in progress, usually 10–30s</p>
                </div>
              )}
            </div>

            <p className="mt-2 text-center text-xs text-[var(--text-secondary)]">
              {customImage ? 'Your chart, ready to analyze.' : 'Example loaded: XAUUSD (Gold) · M30, a real trader chart. Or use your own below.'}
            </p>

            {error && (
              <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center text-sm text-red-300">
                {error}
              </p>
            )}

            <div className="mt-4 flex flex-col items-center gap-3">
              <Button
                type="button"
                onClick={runAnalysis}
                disabled={state === 'analyzing'}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#F7F7F5] font-medium text-[#08090A] transition-colors hover:bg-white h-14 w-full max-w-md rounded-xl text-base font-bold sm:text-lg"
              >
                {state === 'analyzing' ? 'Analyzing…' : 'Analyze this chart now'}
                {state !== 'analyzing' && <ArrowRight className="ml-2 h-5 w-5" />}
              </Button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={state === 'analyzing'}
                className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] underline-offset-4 hover:text-[var(--text-primary)] hover:underline disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {customImage ? 'Choose a different chart' : 'Or upload / paste your own chart screenshot'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />

              <p className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <ShieldCheck className="h-3.5 w-3.5" />
                1 free analysis per device · no account · no card
              </p>
            </div>
          </div>
        )}

        {/* ── Estado: resultado (o "aha") ─────────────────────────────── */}
        {state === 'done' && result && (
          <div className="mt-8 rounded-2xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                  {result.symbol} · {result.timeframe}
                </p>
                <span
                  className={`mt-2 inline-flex items-center rounded-full border px-4 py-1.5 text-lg font-bold ${recColor}`}
                >
                  {result.recommendation}
                </span>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Confidence</p>
                <p className="text-2xl font-bold text-[var(--text-primary)]">{result.confidence}%</p>
                {result.riskReward && (
                  <p className="text-xs text-[var(--text-secondary)]">R:R {result.riskReward}</p>
                )}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'ENTRY', value: result.entry },
                { label: 'STOP LOSS', value: result.stopLoss },
                { label: 'TARGET 1', value: result.takeProfit1 },
                { label: 'TARGET 2', value: result.takeProfit2 },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-[var(--border-subtle)] bg-black/30 p-3 text-center"
                >
                  <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                    {item.label}
                  </p>
                  <p className="mt-1 font-terminal text-sm font-semibold text-[var(--text-primary)]">
                    {formatPrice(item.value)}
                  </p>
                </div>
              ))}
            </div>

            {result.reasoning && (
              <p className="mt-5 rounded-xl border border-[var(--border-subtle)] bg-black/20 p-4 text-sm leading-relaxed text-[var(--text-secondary)]">
                {result.reasoning}
              </p>
            )}

            <p className="mt-3 text-center text-[11px] text-[var(--text-secondary)]">
              {result.disclaimer}
            </p>

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
                className="mt-5 w-full rounded-xl border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] py-3.5 text-sm font-bold text-[var(--accent-green)] transition hover:brightness-110"
              >
                This chart is from Dec 12, 2025, see what the market did next →
              </button>
            )}
            {analyzedExample && showAfter && (
              <div className="mt-5">
                <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
                  <img src={afterChart} alt="The same XAUUSD chart hours later" className="w-full" />
                </div>
                <p className="mt-2 text-center text-sm text-[var(--text-secondary)]">
                  The same chart, hours later that day: gold ran from the 4,260s into the
                  4,340s. <span className="text-[var(--text-primary)]">You decide what the read was worth.</span>
                </p>
                <p className="mt-1 text-center text-[11px] text-[var(--text-secondary)]">
                  One hand-picked historical example, shown for illustration. Every market and
                  moment is different, never a promise of results.
                </p>
              </div>
            )}

            <SignupCta
              headline="Want to analyze more charts?"
              sub="Create your free account and get 3 more analyses, your charts, any market."
            />
          </div>
        )}

        {/* ── Estado: limite atingido ─────────────────────────────────── */}
        {state === 'locked' && (
          <div className="mt-8 rounded-2xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] p-8 text-center">
            <Lock className="mx-auto h-10 w-10 text-[var(--text-secondary)]" />
            <h2 className="mt-4 text-xl font-semibold text-[var(--text-primary)]">
              You already used your free analysis
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-secondary)]">
              Good news: it doesn't stop here. Create a free account and get 3 more
              analyses on your own charts, no credit card needed.
            </p>
            <SignupCta
              headline="Keep analyzing for free"
              sub="3 more analyses included with your free account."
            />
          </div>
        )}

        <p className="mt-10 text-center text-[11px] leading-relaxed text-[var(--text-secondary)]">
          Tickrify provides educational analysis only, not financial advice. Trading involves
          risk. The decision is always yours.
        </p>
      </main>
    </div>
  );
};

export default TryPage;
