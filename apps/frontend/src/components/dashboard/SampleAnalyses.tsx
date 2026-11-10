import { LOCALES } from '@/lib/i18n';
// Tres analises de exemplo antes das gratis: otimista, pessimista e neutra.
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
import type { SampleAnalysis, SampleKind } from '@/lib/sample-analyses';
import type { TrialUsage } from '@/lib/api';

const COPY = {
  en: {
    pickerDesc: 'Real reads from the Tickrify engine, saved with what the market did next. Open as many as you like: they do not use your free analyses.',
    banner: 'A real analysis from the Tickrify engine, saved on {date}. It is a fixed example: nothing is sent to the AI and it does not use your free analyses.',
    neutralTitle: 'No trade is also an answer',
    neutralDesc: 'Tickrify does not force a buy or a sell. When the chart has no clean setup, it tells you to stay out and shows what would have to change first. Every result depends on the real conditions of the chart.',
    afterTitle: 'What happened next',
    afterFine: 'One historical example, picked to show the format, not a typical result. Every market and moment is different. Never a promise of results.',
  },
  pt: {
    pickerDesc: 'Leituras reais do motor da Tickrify, guardadas com o que o mercado fez depois. Abra quantas quiser: elas não gastam suas análises grátis.',
    banner: 'Uma análise real do motor da Tickrify, feita em {date}. É um exemplo fixo: nada é enviado para a IA e não gasta suas análises grátis.',
    neutralTitle: 'Não entrar também é uma resposta',
    neutralDesc: 'A Tickrify não força compra nem venda. Quando o gráfico não tem um setup limpo, ela diz para ficar de fora e mostra o que precisaria mudar antes. Todo resultado depende das condições reais do gráfico.',
    afterTitle: 'O que aconteceu depois',
    afterFine: 'Um exemplo histórico, escolhido para mostrar o formato, não um resultado típico. Cada mercado e momento é diferente. Nunca uma promessa de resultado.',
  },
} as const;

function useSampleCopy() {
  const { language, t } = useLanguage();
  const content = language === 'pt' ? COPY.pt : COPY.en;
  return { ...content, ...t.sampleUi,
    kind: { bullish: t.sampleUi.bullish, bearish: t.sampleUi.bearish, neutral: t.sampleUi.neutral },
    title: { bullish: t.sampleUi.bullishTitle, bearish: t.sampleUi.bearishTitle, neutral: t.sampleUi.exampleNeutralTitle },
  };
}

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

function actionOf(sample: SampleAnalysis): string {
  const rec = String(sample.analysis.recommendation || '').toUpperCase();
  return rec === 'HOLD' ? 'WAIT' : rec;
}

/** Presentation only: the dashboard supplies the already-resolved access state. */
export type SampleAllowance =
  | { kind: 'demo' | 'paid' | 'loading' | 'unavailable' | 'former' }
  | { kind: 'trial'; trial: TrialUsage }
  | { kind: 'legacy'; remaining: number };

const TurnCta = ({ allowance, onAnalyze }: { allowance: SampleAllowance; onAnalyze: () => void }) => {
  const c = useSampleCopy();
  const { t } = useLanguage();
  const description = (() => {
    switch (allowance.kind) {
      case 'demo': return t.commercial.exampleDemo;
      case 'paid': return `${t.commercial.examplePaid} ${t.commercial.tickCosts}`;
      case 'trial':
        return allowance.trial.status === 'ended'
          ? t.counter.trialEnded
          : `${t.counter.trialLeftToday
              .replace('{left}', String(allowance.trial.remainingToday))
              .replace('{limit}', String(allowance.trial.limitToday))} ${t.commercial.trialRules}`;
      case 'legacy':
        return Number.isFinite(allowance.remaining) && allowance.remaining >= 0
          ? t.commercial.exampleLegacy.replace('{left}', String(Math.floor(allowance.remaining)))
          : t.counter.planUnavailable;
      case 'loading': return t.counter.loadingPlan;
      case 'former': return t.counter.subscriptionEnded;
      case 'unavailable': return t.counter.planUnavailable;
    }
  })();
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-accent)] bg-[var(--bg-card)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-base font-semibold text-[var(--text-primary)]">{c.turnTitle}</p>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{description}</p>
      </div>
      <button
        type="button"
        onClick={onAnalyze}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--inverse-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90"
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
  const c = useSampleCopy();
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
                ? 'border-[var(--border-accent)] bg-[var(--fill-3)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-overlay)] hover:bg-[var(--fill-2)]'
            }`}
          >
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${KIND_TONE[sample.kind]}`}>
              <Icon className="h-3 w-3" strokeWidth={2.5} />
              {actionOf(sample)}
            </span>
            <span className="w-full truncate text-sm font-semibold text-[var(--text-primary)]">{c.kind[sample.kind]}</span>
            <span className="w-full break-words tabular-nums text-[11px] leading-tight text-[var(--text-secondary)]">{sampleLabel(sample)}</span>
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
  allowance,
  onOpen,
  onAnalyze,
}: {
  samples: SampleAnalysis[];
  viewed: ReadonlySet<SampleKind>;
  allowance: SampleAllowance;
  onOpen: (kind: SampleKind) => void;
  onAnalyze: () => void;
}) => {
  const c = useSampleCopy();
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
        <p className="text-sm font-semibold text-[var(--text-primary)]">{c.pickerTitle}</p>
        <p className="mb-3 mt-0.5 text-xs text-[var(--text-secondary)]">{c.pickerDesc}</p>
        <SampleButtons samples={samples} viewed={viewed} onOpen={onOpen} />
      </section>
      {viewed.size > 0 && <TurnCta allowance={allowance} onAnalyze={onAnalyze} />}
    </div>
  );
};

/** A analise de exemplo aberta, no mesmo AnalysisResult das analises reais. */
export const SampleAnalysisView = ({
  sample,
  samples,
  viewed,
  allowance,
  onOpen,
  onBack,
  onAnalyze,
}: {
  sample: SampleAnalysis;
  samples: SampleAnalysis[];
  viewed: ReadonlySet<SampleKind>;
  allowance: SampleAllowance;
  onOpen: (kind: SampleKind) => void;
  onBack: () => void;
  onAnalyze: () => void;
}) => {
  const c = useSampleCopy();
  const { language } = useLanguage();
  const date = new Date(sample.analysis.createdAt).toLocaleDateString(LOCALES[language], {
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
        <div className="tk-eyebrow mt-3">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" />
          {c.eyebrow}
        </div>
        <h1 className="tk-display mt-2 text-2xl md:text-3xl">{c.title[sample.kind]}</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{c.banner.replace('{date}', date)}</p>
      </div>

      <SampleButtons samples={samples} viewed={viewed} current={sample.kind} onOpen={onOpen} />

      {sample.kind === 'neutral' && (
        <div className="rounded-xl border border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)] px-4 py-3">
          <p className="text-sm font-semibold text-[var(--signal-hold)]">{c.neutralTitle}</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-primary)]">{c.neutralDesc}</p>
        </div>
      )}

      <AnalysisResult analysisData={sample.analysis} uploadedImage={null} sample />

      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <h2 className="tk-display text-lg text-[var(--text-primary)]">{c.afterTitle}</h2>
        <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{sample.after.headline}</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{sample.after.detail}</p>
        {sample.after.chart && (
          <img
            src={sample.after.chart}
            alt={sample.after.chartAlt ?? ''}
            loading="lazy"
            decoding="async"
            className="mt-3 block h-auto w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] object-contain"
          />
        )}
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">{c.afterFine}</p>
      </section>

      <TurnCta allowance={allowance} onAnalyze={onAnalyze} />
    </div>
  );
};
