import { formatNumber } from '@/lib/i18n';
// O que o mercado fez com o plano, 48h depois (12/10/2026, ideia A da retencao).
//
// O trader recebia o plano e nunca sabia o desfecho. O sweeper ja media tudo
// (WIN, LOSS, NO_FILL, TIMEOUT); isto so mostra. Acerto e erro aparecem do
// mesmo jeito: e o que faz o numero valer alguma coisa.
//
// - MarketResultCard: dentro da analise aberta. Antes das 48h, diz quando o
//   resultado sai (motivo para voltar).
// - TrackRecordCard: inicio do painel, os ultimos 30 dias do proprio usuario.
//   Busca o proprio dado como o ActivityHeatmap; falha some calada.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { CheckCircle2, CircleDashed, Clock, MinusCircle, XCircle } from 'lucide-react';
import { buildApiUrl } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { Language } from '@/lib/i18n';

const LOCALE: Record<Language, string> = {
  en: 'en-US', pt: 'pt-BR', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

// O sweeper roda de hora em hora: 48h + 1h de folga.
const RESULT_DELAY_MS = 49 * 60 * 60 * 1000;
// Sem resultado depois disso, o quadro some em vez de prometer uma data velha.
const PENDING_MAX_MS = 72 * 60 * 60 * 1000;

type Measured = 'WIN' | 'LOSS' | 'NO_FILL' | 'TIMEOUT' | 'UNTRACKED';

function measured(outcome: string | null | undefined): Measured | null {
  const o = String(outcome || '').toUpperCase();
  if (o === 'WIN' || o === 'LOSS' || o === 'NO_FILL' || o === 'TIMEOUT') return o;
  if (o === 'UNTRACKABLE' || o === 'INCOMPLETE') return 'UNTRACKED';
  return null;
}

const TONE: Record<Measured, { box: string; text: string; Icon: typeof CheckCircle2 }> = {
  WIN: { box: 'border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)]', text: 'text-[var(--signal-buy)]', Icon: CheckCircle2 },
  LOSS: { box: 'border-[var(--signal-sell-border)] bg-[var(--signal-sell-bg)]', text: 'text-[var(--signal-sell)]', Icon: XCircle },
  NO_FILL: { box: 'border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)]', text: 'text-[var(--signal-hold)]', Icon: MinusCircle },
  TIMEOUT: { box: 'border-[var(--border-subtle)] bg-[var(--bg-card)]', text: 'text-[var(--text-primary)]', Icon: CircleDashed },
  UNTRACKED: { box: 'border-[var(--border-subtle)] bg-[var(--bg-card)]', text: 'text-[var(--text-secondary)]', Icon: CircleDashed },
};

export function MarketResultCard(props: {
  analysisId: string;
  createdAt: string;
  marketOutcome?: string | null;
  marketTp1R?: number | null;
  marketTp2Hit?: boolean;
  now?: number;
}) {
  const { t, language } = useLanguage();
  const m = t.marketResult;
  const result = measured(props.marketOutcome);
  const tracked = useRef<string | null>(null);

  useEffect(() => {
    if (!result || tracked.current === props.analysisId) return;
    tracked.current = props.analysisId;
    track('market_result_viewed', { outcome: result });
  }, [result, props.analysisId]);

  const created = Date.parse(props.createdAt);
  const now = props.now ?? Date.now();

  if (!result) {
    if (!Number.isFinite(created) || now - created > PENDING_MAX_MS) return null;
    const date = new Date(created + RESULT_DELAY_MS).toLocaleString(LOCALE[language], {
      weekday: 'short', hour: '2-digit', minute: '2-digit',
    });
    return (
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5" data-testid="market-result">
        <p className="tk-stat-label">{m.title}</p>
        <div className="mt-2 flex items-start gap-3">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-[var(--text-secondary)]" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">{m.pendingTitle}</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{m.pending.replace('{date}', date)}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">{m.fine}</p>
      </section>
    );
  }

  const tone = TONE[result];
  const head = {
    WIN: props.marketTp1R != null ? `${m.win}, +${formatNumber(props.marketTp1R, language, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })}R` : m.win,
    LOSS: `${m.loss}, -1R`,
    NO_FILL: m.noFill,
    TIMEOUT: m.timeout,
    UNTRACKED: m.untracked,
  }[result];
  const desc = {
    WIN: props.marketTp2Hit ? `${m.winDesc} ${m.tp2}` : m.winDesc,
    LOSS: m.lossDesc,
    NO_FILL: m.noFillDesc,
    TIMEOUT: m.timeoutDesc,
    UNTRACKED: m.untrackedDesc,
  }[result];

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5" data-testid="market-result">
      <p className="tk-stat-label">{m.title}</p>
      <div className={`mt-2 flex items-start gap-3 rounded-lg border px-4 py-3 ${tone.box}`}>
        <tone.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tone.text}`} aria-hidden />
        <div>
          <p className={`text-sm font-semibold ${tone.text}`}>{head}</p>
          <p className="mt-1 text-sm text-[var(--text-primary)]">{desc}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-[var(--text-tertiary)]">{m.fine}</p>
    </section>
  );
}

interface TrackRecord {
  days: number;
  plans: number;
  win: number;
  loss: number;
  noFill: number;
  timeout: number;
  pending: number;
}

export function TrackRecordCard() {
  const { getToken, isSignedIn } = useAuth();
  const { t } = useLanguage();
  const r = t.trackRecord;
  const [data, setData] = useState<TrackRecord | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(buildApiUrl('/api/ai/track-record'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const body = (await res.json()) as TrackRecord;
        if (!cancelled && typeof body?.plans === 'number') setData(body);
      } catch {
        // silencioso: o card simplesmente nao aparece
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, isSignedIn]);

  const plans = data?.plans ?? 0;
  useEffect(() => {
    if (plans > 0) track('track_record_viewed', { plans });
  }, [plans]);

  if (!data || data.plans === 0) return null;

  const rows: Array<[string, number, string]> = [
    [r.target, data.win, 'text-[var(--signal-buy)]'],
    [r.stop, data.loss, 'text-[var(--signal-sell)]'],
    [r.noFill, data.noFill, 'text-[var(--text-primary)]'],
    [r.timeout, data.timeout, 'text-[var(--text-primary)]'],
    [r.pending, data.pending, 'text-[var(--text-secondary)]'],
  ];

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4" data-testid="track-record">
      <div className="flex items-baseline justify-between gap-3">
        <p className="tk-stat-label">{r.title}</p>
        <p className="tabular-nums text-[12px] text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--text-primary)]">{data.plans}</span> <span>{r.plans}</span>
        </p>
      </div>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">{r.sub}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {rows.map(([label, value, color]) => (
          <div key={label} className="rounded-lg bg-[var(--bg-base)] px-3 py-2">
            <p className={`tabular-nums text-lg font-semibold ${color}`}>{value}</p>
            <p className="text-xs text-[var(--text-secondary)]">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
