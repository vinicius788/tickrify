// Tres analises de exemplo antes das gratis: uma de compra, uma de venda e
// uma de espera. Textos em `t.samples` (6 idiomas).
//
// Por que existe: 53 de 80 pessoas tomaram WAIT na primeira analise em set/26
// e muitas leram isso como "a ferramenta nao respondeu". Ver antes um BUY, um
// SELL e um WAIT de verdade, com o que o mercado fez depois, mostra que o
// resultado depende do grafico, nao de a Tickrify forcar um lado.
//
// Nada aqui chama a API: os dados sao fixos (lib/sample-analyses.ts), entao
// abrir os tres quantas vezes quiser nao toca na cota gratis. A tela e o mesmo
// AnalysisResult das analises normais, em modo `sample`.
import { ArrowDown, ArrowLeft, ArrowUp, Check, Minus, PlusCircle } from 'lucide-react';
import AnalysisResult from './AnalysisResult';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { getRecommendationMeta } from '@/lib/trading-ui';
import type { SampleAnalysis, SampleKind } from '@/lib/sample-analyses';

const KIND_ICON = { bullish: ArrowUp, bearish: ArrowDown, neutral: Minus } as const;
const KIND_TONE = {
  bullish: 'border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] text-[var(--signal-buy)]',
  bearish: 'border-[var(--signal-sell-border)] bg-[var(--signal-sell-bg)] text-[var(--signal-sell)]',
  neutral: 'border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)] text-[var(--signal-hold)]',
} as const;

function sampleLabel(sample: SampleAnalysis): string {
  const response = sample.analysis.fullResponse;
  const analysis = (response as { analysis?: { symbol?: string; timeframe?: string } } | undefined)?.analysis;
  const symbol = analysis?.symbol || response?.symbol || '';
  const timeframe = analysis?.timeframe || response?.timeframe || '';
  return [symbol, timeframe].filter(Boolean).join(' · ');
}

/** Rotulo da ACAO no idioma da tela, o mesmo do resultado (nunca BUY cru em pt). */
function useActionLabel() {
  const { t } = useLanguage();
  return (sample: SampleAnalysis): string => {
    const tone = getRecommendationMeta(sample.analysis.recommendation).tone;
    return tone === 'buy' ? t.analysis.buy : tone === 'sell' ? t.analysis.sell : t.analysis.hold;
  };
}

const TurnCta = ({ freeLeft, onAnalyze }: { freeLeft: number; onAnalyze: () => void }) => {
  const { t } = useLanguage();
  const c = t.samples;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-accent)] bg-[var(--bg-card)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-base font-semibold text-[var(--text-primary)]">{c.turnTitle}</p>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{c.turnDesc.replace('{left}', String(freeLeft))}</p>
      </div>
      <button
        type="button"
        onClick={onAnalyze}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#050508] transition-opacity hover:opacity-90"
      >
        <PlusCircle className="h-4 w-4" /> {c.turnCta}
      </button>
    </div>
  );
};

/** Botoes dos tres exemplos. Os ja abertos ganham "Vista". */
const SampleButtons = ({
  samples,
  viewed,
  current,
  onOpen,
}: {
  samples: SampleAnalysis[];
  viewed: ReadonlySet<SampleKind>;
  current?: SampleKind;
  onOpen: (kind: SampleKind) => void;
}) => {
  const { t } = useLanguage();
  const c = t.samples;
  const actionOf = useActionLabel();
  return (
    <div className="grid grid-cols-3 gap-2">
      {samples.map((sample) => {
        const Icon = KIND_ICON[sample.kind];
        const active = sample.kind === current;
        return (
          <button
            key={sample.kind}
            type="button"
            onClick={() => onOpen(sample.kind)}
            aria-current={active ? 'true' : undefined}
            className={`flex min-w-0 flex-col items-start gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
              active
                ? 'border-[var(--border-accent)] bg-white/[0.06]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-overlay)] hover:bg-white/[0.04]'
            }`}
          >
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold tracking-wider ${KIND_TONE[sample.kind]}`}>
              <Icon className="h-3 w-3" strokeWidth={2.5} />
              {actionOf(sample)}
            </span>
            <span className="w-full break-words font-terminal text-[11px] leading-tight text-[var(--text-secondary)]">{sampleLabel(sample)}</span>
            {viewed.has(sample.kind) && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                <Check className="h-3 w-3" /> {c.viewed}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

/** Bloco da tela "Nova analise", acima do envio do grafico. */
export const SamplePicker = ({
  samples,
  viewed,
  freeLeft,
  onOpen,
  onAnalyze,
}: {
  samples: SampleAnalysis[];
  viewed: ReadonlySet<SampleKind>;
  freeLeft: number;
  onOpen: (kind: SampleKind) => void;
  onAnalyze: () => void;
}) => {
  const { t } = useLanguage();
  const c = t.samples;
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
        <p className="text-sm font-semibold text-[var(--text-primary)]">{c.pickerTitle}</p>
        <p className="mb-3 mt-0.5 text-xs text-[var(--text-secondary)]">{c.pickerDesc}</p>
        <SampleButtons samples={samples} viewed={viewed} onOpen={onOpen} />
      </section>
      {viewed.size > 0 && <TurnCta freeLeft={freeLeft} onAnalyze={onAnalyze} />}
    </div>
  );
};

/** A analise de exemplo aberta, no mesmo AnalysisResult das analises reais. */
export const SampleAnalysisView = ({
  sample,
  samples,
  viewed,
  freeLeft,
  onOpen,
  onBack,
  onAnalyze,
}: {
  sample: SampleAnalysis;
  samples: SampleAnalysis[];
  viewed: ReadonlySet<SampleKind>;
  freeLeft: number;
  onOpen: (kind: SampleKind) => void;
  onBack: () => void;
  onAnalyze: () => void;
}) => {
  const { t, language } = useLanguage();
  const c = t.samples;
  const after = c.after[sample.kind];
  const date = new Date(sample.analysis.createdAt).toLocaleDateString(language === 'pt' ? 'pt-BR' : language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="flex w-fit items-center gap-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {c.back}
        </button>
        <div className="tk-eyebrow mt-3 flex items-center gap-2 text-[11px]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" />
          {c.eyebrow}
        </div>
        <h1 className="tk-display mt-2 text-3xl md:text-4xl">{c.title[sample.kind]}</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{c.banner.replace('{date}', date)}</p>
      </div>

      <SampleButtons samples={samples} viewed={viewed} current={sample.kind} onOpen={onOpen} />

      <AnalysisResult analysisData={sample.analysis} uploadedImage={null} sample />

      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <h2 className="tk-display text-lg text-[var(--text-primary)]">{c.afterTitle}</h2>
        <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{after.headline}</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{after.detail}</p>
        <p className="mt-3 text-xs text-[var(--text-muted)]">{c.afterFine}</p>
      </section>

      <TurnCta freeLeft={freeLeft} onAnalyze={onAnalyze} />
    </div>
  );
};
