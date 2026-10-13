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

const COPY = {
  en: {
    pickerTitle: 'See 3 real example analyses first',
    pickerDesc: 'Real reads from the Tickrify engine, saved with what the market did next. Open as many as you like: they do not use your free analyses.',
    kind: { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral' },
    viewed: 'Viewed',
    turnTitle: "Now it's your turn.",
    turnDesc: 'You have {left} free trade plans to test on your own charts. WAIT reads do not count.',
    turnDescTrial: 'Your 3-day free trial is ready: {left} analyses today on your own charts.',
    turnCta: 'Analyze my chart',
    eyebrow: 'Example analysis',
    title: { bullish: 'Bullish example', bearish: 'Bearish example', neutral: 'Neutral example' },
    banner: 'A real analysis from the Tickrify engine, saved on {date}. It is a fixed example: nothing is sent to the AI and it does not use your free analyses.',
    back: 'Back to examples',
    neutralTitle: 'No trade is also an answer',
    neutralDesc: 'Tickrify does not force a buy or a sell. When the chart has no clean setup, it tells you to stay out and shows what would have to change first. Every result depends on the real conditions of the chart.',
    afterTitle: 'What happened next',
    afterFine: 'One historical example, picked to show the format, not a typical result. Every market and moment is different. Never a promise of results.',
    otherExamples: 'Other examples',
  },
  pt: {
    pickerTitle: 'Veja antes 3 análises reais de exemplo',
    pickerDesc: 'Leituras reais do motor da Tickrify, guardadas com o que o mercado fez depois. Abra quantas quiser: elas não gastam suas análises grátis.',
    kind: { bullish: 'Otimista', bearish: 'Pessimista', neutral: 'Neutro' },
    viewed: 'Vista',
    turnTitle: 'Agora é sua vez.',
    turnDesc: 'Você tem {left} planos de trade grátis para testar com seus próprios gráficos. WAIT não conta.',
    turnDescTrial: 'Seu teste grátis de 3 dias está pronto: {left} análises hoje nos seus próprios gráficos.',
    turnCta: 'Analisar meu gráfico',
    eyebrow: 'Análise de exemplo',
    title: { bullish: 'Exemplo otimista', bearish: 'Exemplo pessimista', neutral: 'Exemplo neutro' },
    banner: 'Uma análise real do motor da Tickrify, feita em {date}. É um exemplo fixo: nada é enviado para a IA e não gasta suas análises grátis.',
    back: 'Voltar aos exemplos',
    neutralTitle: 'Não entrar também é uma resposta',
    neutralDesc: 'A Tickrify não força compra nem venda. Quando o gráfico não tem um setup limpo, ela diz para ficar de fora e mostra o que precisaria mudar antes. Todo resultado depende das condições reais do gráfico.',
    afterTitle: 'O que aconteceu depois',
    afterFine: 'Um exemplo histórico, escolhido para mostrar o formato, não um resultado típico. Cada mercado e momento é diferente. Nunca uma promessa de resultado.',
    otherExamples: 'Outros exemplos',
  },
} as const;

type Copy = (typeof COPY)[keyof typeof COPY];

function useSampleCopy(): Copy {
  const { language } = useLanguage();
  return language === 'pt' ? COPY.pt : COPY.en;
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

/** `trial`: conta no trial de 3 dias (a cota e por dia e o WAIT conta). */
const TurnCta = ({ freeLeft, trial, onAnalyze }: { freeLeft: number; trial?: boolean; onAnalyze: () => void }) => {
  const c = useSampleCopy();
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-accent)] bg-[var(--bg-card)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-base font-semibold text-[var(--text-primary)]">{c.turnTitle}</p>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{(trial ? c.turnDescTrial : c.turnDesc).replace('{left}', String(freeLeft))}</p>
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
                ? 'border-[var(--border-accent)] bg-white/[0.06]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-overlay)] hover:bg-white/[0.04]'
            }`}
          >
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold tracking-wider ${KIND_TONE[sample.kind]}`}>
              <Icon className="h-3 w-3" strokeWidth={2.5} />
              {actionOf(sample)}
            </span>
            <span className="w-full truncate text-sm font-semibold text-[var(--text-primary)]">{c.kind[sample.kind]}</span>
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
  trial,
  onOpen,
  onAnalyze,
}: {
  samples: SampleAnalysis[];
  viewed: ReadonlySet<SampleKind>;
  freeLeft: number;
  trial?: boolean;
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
      {viewed.size > 0 && <TurnCta freeLeft={freeLeft} trial={trial} onAnalyze={onAnalyze} />}
    </div>
  );
};

/** A analise de exemplo aberta, no mesmo AnalysisResult das analises reais. */
export const SampleAnalysisView = ({
  sample,
  samples,
  viewed,
  freeLeft,
  trial,
  onOpen,
  onBack,
  onAnalyze,
}: {
  sample: SampleAnalysis;
  samples: SampleAnalysis[];
  viewed: ReadonlySet<SampleKind>;
  freeLeft: number;
  trial?: boolean;
  onOpen: (kind: SampleKind) => void;
  onBack: () => void;
  onAnalyze: () => void;
}) => {
  const c = useSampleCopy();
  const { language } = useLanguage();
  const date = new Date(sample.analysis.createdAt).toLocaleDateString(language === 'pt' ? 'pt-BR' : 'en-US', {
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
        <p className="mt-3 text-xs text-[var(--text-muted)]">{c.afterFine}</p>
      </section>

      <TurnCta freeLeft={freeLeft} trial={trial} onAnalyze={onAnalyze} />
    </div>
  );
};
