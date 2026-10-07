import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Analysis, AnalysisLevels, Usage } from '@/lib/api';
import { PLANS_URL, SIGN_IN_URL, analysisUrl } from '@/lib/config';
import type { Rect } from '@/lib/crop';
import { fractionsFromAxis, type LevelFractions } from '@/lib/levels';
import { t } from '@/lib/texts';
import type { PanelView } from '@/lib/messages';
import type { PageMeta, Platform } from '@/lib/platform';
import type { LevelPrices } from './LevelsOverlay';

export type UiView = PanelView | { kind: 'confirm'; rect: Rect; meta: PageMeta };
export type Pos = { x: number; y: number };

export type ReadResult = {
  rec: 'BUY' | 'SELL' | 'WAIT';
  symbol: string;
  timeframe: string;
  /** Lado da entrada e tipo cru do motor (limit/market); o rotulo sai do texts.ts. */
  side: 'BUY' | 'SELL';
  entryType: string | null;
  prices: LevelPrices;
  /** null = sem escala confiavel: so os precos no painel, nenhuma linha. */
  fractions: LevelFractions | null;
  rr1: string | null;
  rr2: string | null;
  summary: string;
  risks: string[];
  invalidation: string | null;
  waitFor: string | null;
};

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const rr = (v: unknown): string | null => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : null);

/** 179.5 ao lado de 179.25 parece outro preco: todos com as mesmas casas decimais. */
function samePrecision(raw: Record<keyof LevelPrices, unknown>): LevelPrices {
  const nums = Object.values(raw).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const decimals = Math.max(0, ...nums.map((n) => (String(n).split('.')[1] ?? '').length));
  const fmt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(decimals) : str(v));
  return { entry: fmt(raw.entry), stop: fmt(raw.stop), tp1: fmt(raw.tp1), tp2: fmt(raw.tp2) };
}

/** Le o resultado da API no formato que o painel usa (mesmos campos do site). */
export function readResult(analysis: Analysis, meta: PageMeta): ReadResult {
  const a: AnalysisLevels = analysis.fullResponse?.analysis ?? {};
  const raw = String(analysis.recommendation ?? analysis.fullResponse?.recommendation ?? '').toUpperCase();
  const rec = raw === 'BUY' || raw === 'SELL' ? raw : 'WAIT';
  return {
    rec,
    symbol: str(a.symbol) ?? meta.symbol ?? '',
    timeframe: str(a.timeframe) ?? meta.timeframe ?? '',
    side: rec === 'SELL' ? 'SELL' : 'BUY',
    entryType: str(a.entryType),
    prices: samePrecision({ entry: a.entry, stop: a.stopLoss, tp1: a.takeProfit1, tp2: a.takeProfit2 }),
    fractions: fractionsFromAxis(
      { entry: num(a.entry), stop: num(a.stopLoss), tp1: num(a.takeProfit1), tp2: num(a.takeProfit2) },
      a.priceAxis,
    ),
    rr1: rr(a.riskRewardTp1),
    rr2: rr(a.riskRewardTp2),
    summary: str(a.executiveSummary) ?? '',
    risks: Array.isArray(a.riskFactorsList) ? a.riskFactorsList.filter(Boolean) : [],
    invalidation: str(a.invalidationNote),
    waitFor: str(a.entryCondition) ?? str(a.alternativeScenario),
  };
}


function usageLine(usage: Usage | null): string {
  if (!usage) return '';
  if (usage.plan === 'free') {
    return typeof usage.remaining === 'number' && typeof usage.total === 'number'
      ? t.freeLeft(usage.remaining, usage.total)
      : t.freePlan;
  }
  return typeof usage.tickBalance === 'number' ? t.analysesLeft(usage.tickBalance) : '';
}

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W'];

export type PanelProps = {
  view: UiView;
  usage: Usage | null;
  platform: Platform;
  logo: string;
  pos: Pos;
  reminderAt: string | null;
  onMove: (pos: Pos) => void;
  onMinimize: () => void;
  onConfirm: (meta: PageMeta) => void;
  onAgain: () => void;
  onAdjustArea: () => void;
  onRemind: (label: string) => void;
};

/** ↻ so onde analisar de novo faz sentido (sem permissao, so o icone resolve). */
function canRetry(view: UiView): boolean {
  if (view.kind === 'result' || view.kind === 'signin') return true;
  return view.kind === 'error' && view.reason !== 'permission';
}

/**
 * Painel enxuto (aprovado pelo dono em 06/10, demo-painel-enxuto.html): no
 * cabecalho so ↻ e minimizar (fechar fica na bolha); no resultado, veredito,
 * 4 precos, um "Details" e um botao: "Open in Tickrify".
 */
export function Panel(props: PanelProps) {
  const { view, pos } = props;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || !ref.current) return;
    const w = ref.current.offsetWidth;
    props.onMove({
      x: Math.max(0, Math.min(window.innerWidth - w, e.clientX - drag.current.dx)),
      y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - drag.current.dy)),
    });
  };
  const up = () => {
    drag.current = null;
  };

  const parsed = view.kind === 'result' ? readResult(view.analysis, view.meta) : null;
  const meta = 'meta' in view ? view.meta : null;
  const context = parsed
    ? [parsed.symbol, parsed.timeframe].filter(Boolean).join(' · ')
    : [meta?.symbol, meta?.timeframe].filter(Boolean).join(' · ');
  const usage = view.kind === 'result' || view.kind === 'paywall' ? view.usage ?? props.usage : props.usage;
  const showFoot = view.kind === 'result' || view.kind === 'confirm';

  return (
    <div className="tk-panel" ref={ref} style={{ left: pos.x, top: pos.y }} role="dialog" aria-label="Tickrify">
      <div className="tk-head" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <img className="tk-logo" src={props.logo} alt="Tickrify" />
        <span className="tk-name">Tickrify</span>
        <span className="tk-ctx">{context}</span>
        <span className="tk-sp" />
        {canRetry(view) && (
          <button type="button" className="tk-icon-btn" onClick={props.onAgain} aria-label={t.analyzeAgain} title={t.analyzeAgain}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
          </button>
        )}
        <button type="button" className="tk-icon-btn" onClick={props.onMinimize} aria-label={t.minimize} title={t.minimize}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14" /></svg>
        </button>
      </div>
      <div className="tk-body">
        <Body {...props} />
      </div>
      {showFoot && <div className="tk-foot">{[usageLine(usage), t.secondOpinion].filter(Boolean).join(' · ')}</div>}
    </div>
  );
}

function Body(props: PanelProps) {
  const { view } = props;
  switch (view.kind) {
    case 'signin':
      return (
        <>
          <p className="tk-h">{t.signInTitle}</p>
          <p className="tk-p">{t.signInBody}</p>
          <a className="tk-btn" href={SIGN_IN_URL} target="_blank" rel="noopener noreferrer">
            {t.signInButton}
          </a>
          <p className="tk-small">{t.signInAfter}</p>
        </>
      );
    case 'empty':
      return (
        <>
          <p className="tk-h">{t.emptyTitle}</p>
          <p className="tk-p">{t.emptyBody}</p>
        </>
      );
    case 'paywall':
      return <Paywall usage={view.usage ?? props.usage} />;
    case 'confirm':
      return <Confirm meta={view.meta} onConfirm={props.onConfirm} onAdjustArea={props.onAdjustArea} />;
    case 'starting':
      return (
        <div>
          <span className="tk-spin" />
          <b>{t.starting}</b>
        </div>
      );
    case 'analyzing':
      return <Analyzing />;
    case 'error':
      return (
        <>
          <p className="tk-h">{view.reason === 'permission' ? t.oneMoreClick : t.notCompleted}</p>
          <p className="tk-p">{t.errors[view.reason]}</p>
          {view.detail && <p className="tk-small tk-code">{t.technicalDetails(view.detail)}</p>}
          {view.reason === 'auth' && (
            <a className="tk-btn" href={SIGN_IN_URL} target="_blank" rel="noopener noreferrer">
              {t.signInButton}
            </a>
          )}
        </>
      );
    case 'result':
      return <Result {...props} view={view} />;
  }
}

function Paywall({ usage }: { usage: Usage | null }) {
  const free = !usage || usage.plan === 'free';
  return (
    <>
      <p className="tk-h">{free ? t.paywallFree : t.paywallPaid}</p>
      <div className="tk-price main">
        <b>$7.99</b> {t.perWeek}
        <small>{t.weekNote}</small>
      </div>
      <div className="tk-price">
        <b>$29</b> {t.perMonth}
        <small>{t.monthNote}</small>
      </div>
      <a className="tk-btn" href={PLANS_URL} target="_blank" rel="noopener noreferrer">
        {t.seePlans}
      </a>
    </>
  );
}

function Confirm({ meta, onConfirm, onAdjustArea }: { meta: PageMeta; onConfirm: (m: PageMeta) => void; onAdjustArea: () => void }) {
  const [symbol, setSymbol] = useState(meta.symbol ?? '');
  const [timeframe, setTimeframe] = useState(meta.timeframe ?? '');
  return (
    <>
      <div className="tk-field">
        <label>
          {t.symbol}
          <input value={symbol} maxLength={32} onChange={(e) => setSymbol(e.target.value.replace(/\s+/g, '').toUpperCase())} />
        </label>
        <label>
          {t.timeframe}
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
            <option value="">{t.notSure}</option>
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="button"
        className="tk-btn"
        onClick={() => onConfirm({ symbol: /^[A-Za-z0-9:._/!-]{2,32}$/.test(symbol) ? symbol : undefined, timeframe: timeframe || undefined })}
      >
        {t.analyzeThisChart}
      </button>
      <button type="button" className="tk-link" onClick={onAdjustArea}>
        {t.adjustArea}
      </button>
    </>
  );
}

function Analyzing() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <>
      <div>
        <span className="tk-spin" />
        <b>{t.analyzing}</b>
      </div>
      <div className="tk-bar">
        <i style={{ width: `${Math.min(95, (seconds / 20) * 100)}%` }} />
      </div>
      <div className="tk-small" style={{ display: 'flex', justifyContent: 'space-between', margin: 0 }}>
        <span>{t.analyzingNote}</span>
        <span>{`${seconds} s`}</span>
      </div>
    </>
  );
}

/**
 * Preco do plano. Um clique copia o numero (o trader cola no boleto da
 * corretora); as linhas no grafico somem quando ele mexe no grafico, o numero
 * copiado nao.
 */
function PriceCell({ label, value, tone }: { label: string; value: string | null; tone?: 'stop' | 'tp' }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const className = `tk-lv${tone ? ` ${tone}` : ''}`;
  if (!value) {
    return (
      <div className={className}>
        <small>{label}</small>
        <b>-</b>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`${className} tk-copy`}
      title={t.copyPrice}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    >
      <small>{copied ? <span key="copied">{t.copied}</span> : <span key="label">{label}</span>}</small>
      <b>{value}</b>
    </button>
  );
}

function Result(props: PanelProps & { view: Extract<UiView, { kind: 'result' }> }) {
  const { view } = props;
  const r = readResult(view.analysis, view.meta);
  const usage = view.usage ?? props.usage;
  const lastFree = usage?.plan === 'free' && usage.remaining === 0 && r.rec !== 'WAIT';
  const details = (
    <details className="tk-more">
      <summary>{t.details}</summary>
      <div className="tk-in">
        {r.summary && (
          <>
            <h5>{t.why}</h5>
            <p>{r.summary}</p>
          </>
        )}
        {r.risks.length > 0 && (
          <>
            <h5>{t.risks}</h5>
            <ul>
              {r.risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </>
        )}
        {r.invalidation && (
          <>
            <h5>{t.invalidation}</h5>
            <p>{r.invalidation}</p>
          </>
        )}
        {r.rr2 && <p className="tk-small">{t.rrTp2(r.rr2)}</p>}
      </div>
    </details>
  );
  return (
    <>
      {view.restored && <p className="tk-small" style={{ margin: '0 0 8px' }}>{t.lastOnTab}</p>}
      <div className="tk-top">
        <span className={`tk-verdict ${r.rec.toLowerCase()}`}>{r.rec}</span>
        {r.rec === 'WAIT' ? (
          <span className="tk-small" style={{ margin: 0 }}>{t.waitFree}</span>
        ) : (
          r.rr1 && (
            <span className="tk-rr">
              R/R <b>{r.rr1}</b> {t.rrTp1}
            </span>
          )
        )}
      </div>
      {r.rec === 'WAIT' ? (
        r.waitFor && (
          <div className="tk-waitfor">
            <small>{t.waitFor}</small>
            <p>{r.waitFor}</p>
            {props.reminderAt ? (
              <div className="tk-okline">{t.reminderSet(props.reminderAt)}</div>
            ) : (
              <button type="button" className="tk-link" onClick={() => props.onRemind(r.symbol || t.yourChart)}>
                {t.remindMe}
              </button>
            )}
          </div>
        )
      ) : (
        <div className="tk-levels">
          <PriceCell label={t.entry(r.entryType ? r.entryType : null)} value={r.prices.entry} />
          <PriceCell label={t.stop} value={r.prices.stop} tone="stop" />
          <PriceCell label={t.target1} value={r.prices.tp1} tone="tp" />
          <PriceCell label={t.target2} value={r.prices.tp2} tone="tp" />
        </div>
      )}
      {details}
      {lastFree && (
        <div className="tk-note">
          <b>{t.lastFreeBold}</b>
          {t.lastFreeRest}
        </div>
      )}
      <a className="tk-btn" href={analysisUrl(view.analysis.id)} target="_blank" rel="noopener noreferrer">
        {t.openInTickrify}
      </a>
      {props.platform === 'other' && !view.restored && (
        <button type="button" className="tk-link" onClick={props.onAdjustArea}>
          {t.adjustArea}
        </button>
      )}
    </>
  );
}
