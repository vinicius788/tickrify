import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Analysis, AnalysisLevels, Usage } from '@/lib/api';
import { PLANS_URL, SIGN_IN_URL, analysisUrl } from '@/lib/config';
import type { Rect } from '@/lib/crop';
import { fractionsFromAxis, type LevelFractions } from '@/lib/levels';
import type { ErrorReason, PanelView } from '@/lib/messages';
import type { PageMeta, Platform } from '@/lib/platform';
import type { LevelPrices } from './LevelsOverlay';

export type UiView = PanelView | { kind: 'confirm'; rect: Rect; meta: PageMeta };
export type Pos = { x: number; y: number };

export type ReadResult = {
  rec: 'BUY' | 'SELL' | 'WAIT';
  symbol: string;
  timeframe: string;
  entryLabel: string;
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
  const side = rec === 'SELL' ? 'Sell' : 'Buy';
  return {
    rec,
    symbol: str(a.symbol) ?? meta.symbol ?? '',
    timeframe: str(a.timeframe) ?? meta.timeframe ?? '',
    entryLabel: a.entryType ? `${side} ${a.entryType}` : side,
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
      ? `${usage.remaining} of ${usage.total} free plans left`
      : 'Free plan';
  }
  return typeof usage.tickBalance === 'number' ? `${usage.tickBalance} analyses left` : '';
}

const ERROR_TEXT: Record<ErrorReason, string> = {
  permission: 'Click the Tickrify icon in your toolbar to analyze this chart again.',
  auth: 'Your session ended. Sign in to Tickrify and try again.',
  timeout: 'The analysis took too long. Press ↻ to try again.',
  network: 'Could not reach Tickrify. Check your connection and press ↻.',
  server: 'Something went wrong on our side. Press ↻ to try again.',
  failed: 'This analysis could not be completed. Press ↻ to try again.',
};

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
          <button type="button" className="tk-icon-btn" onClick={props.onAgain} aria-label="Analyze again" title="Analyze again">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
          </button>
        )}
        <button type="button" className="tk-icon-btn" onClick={props.onMinimize} aria-label="Minimize" title="Minimize">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14" /></svg>
        </button>
      </div>
      <div className="tk-body">
        <Body {...props} />
      </div>
      {showFoot && <div className="tk-foot">{[usageLine(usage), 'Second opinion, not a signal'].filter(Boolean).join(' · ')}</div>}
    </div>
  );
}

function Body(props: PanelProps) {
  const { view } = props;
  switch (view.kind) {
    case 'signin':
      return (
        <>
          <p className="tk-h">Sign in to analyze this chart</p>
          <p className="tk-p">Use your Tickrify account. Your analyses and free trade plans are the same as on tickrify.com.</p>
          <a className="tk-btn" href={SIGN_IN_URL} target="_blank" rel="noopener noreferrer">
            Sign in to Tickrify
          </a>
          <p className="tk-small">After signing in, come back and press ↻.</p>
        </>
      );
    case 'empty':
      return (
        <>
          <p className="tk-h">No analysis on this tab yet</p>
          <p className="tk-p">Click the Tickrify icon in your toolbar to analyze the chart you have open.</p>
        </>
      );
    case 'paywall':
      return <Paywall usage={view.usage ?? props.usage} />;
    case 'confirm':
      return <Confirm meta={view.meta} onConfirm={props.onConfirm} onAdjustArea={props.onAdjustArea} />;
    case 'analyzing':
      return <Analyzing />;
    case 'error':
      return (
        <>
          <p className="tk-h">{view.reason === 'permission' ? 'One more click' : 'Analysis not completed'}</p>
          <p className="tk-p">{ERROR_TEXT[view.reason]}</p>
          {view.reason === 'auth' && (
            <a className="tk-btn" href={SIGN_IN_URL} target="_blank" rel="noopener noreferrer">
              Sign in to Tickrify
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
      <p className="tk-h">{free ? 'Your free trade plans are used up' : 'You are out of analyses for now'}</p>
      <div className="tk-price main">
        <b>$7.99</b> / week<small>25 analyses every 7 days. Cancel anytime.</small>
      </div>
      <div className="tk-price">
        <b>$29</b> / month<small>200 analyses every month.</small>
      </div>
      <a className="tk-btn" href={PLANS_URL} target="_blank" rel="noopener noreferrer">
        See plans on tickrify.com
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
          Symbol
          <input value={symbol} maxLength={32} onChange={(e) => setSymbol(e.target.value.replace(/\s+/g, '').toUpperCase())} />
        </label>
        <label>
          Timeframe
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
            <option value="">Not sure</option>
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
        Analyze this chart
      </button>
      <button type="button" className="tk-link" onClick={onAdjustArea}>
        Adjust area
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
        <b>Analyzing your chart</b>
      </div>
      <div className="tk-bar">
        <i style={{ width: `${Math.min(95, (seconds / 20) * 100)}%` }} />
      </div>
      <div className="tk-small" style={{ display: 'flex', justifyContent: 'space-between', margin: 0 }}>
        <span>About 20 seconds. You can keep trading.</span>
        <span>{`${seconds} s`}</span>
      </div>
    </>
  );
}

function Result(props: PanelProps & { view: Extract<UiView, { kind: 'result' }> }) {
  const { view } = props;
  const r = readResult(view.analysis, view.meta);
  const usage = view.usage ?? props.usage;
  const lastFree = usage?.plan === 'free' && usage.remaining === 0 && r.rec !== 'WAIT';
  const details = (
    <details className="tk-more">
      <summary>Details</summary>
      <div className="tk-in">
        {r.summary && (
          <>
            <h5>Why</h5>
            <p>{r.summary}</p>
          </>
        )}
        {r.risks.length > 0 && (
          <>
            <h5>Risks</h5>
            <ul>
              {r.risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </>
        )}
        {r.invalidation && (
          <>
            <h5>Invalidation</h5>
            <p>{r.invalidation}</p>
          </>
        )}
        {r.rr2 && <p className="tk-small">{`Risk/reward to TP2: ${r.rr2}`}</p>}
      </div>
    </details>
  );
  return (
    <>
      {view.restored && <p className="tk-small" style={{ margin: '0 0 8px' }}>Your last analysis on this tab.</p>}
      <div className="tk-top">
        <span className={`tk-verdict ${r.rec.toLowerCase()}`}>{r.rec}</span>
        {r.rec === 'WAIT' ? (
          <span className="tk-small" style={{ margin: 0 }}>{"Didn't use a free plan"}</span>
        ) : (
          r.rr1 && (
            <span className="tk-rr">
              R/R <b>{r.rr1}</b> to TP1
            </span>
          )
        )}
      </div>
      {r.rec === 'WAIT' ? (
        r.waitFor && (
          <div className="tk-waitfor">
            <small>Wait for</small>
            <p>{r.waitFor}</p>
            {props.reminderAt ? (
              <div className="tk-okline">{`Reminder set for ${props.reminderAt}. Tickrify will not analyze by itself.`}</div>
            ) : (
              <button type="button" className="tk-link" onClick={() => props.onRemind(r.symbol || 'your chart')}>
                Remind me in 15 min
              </button>
            )}
          </div>
        )
      ) : (
        <div className="tk-levels">
          <div className="tk-lv">
            <small>{r.entryLabel.replace(/^(Buy|Sell)\s?/, 'Entry ')}</small>
            <b>{r.prices.entry ?? '-'}</b>
          </div>
          <div className="tk-lv stop">
            <small>Stop</small>
            <b>{r.prices.stop ?? '-'}</b>
          </div>
          <div className="tk-lv tp">
            <small>Target 1</small>
            <b>{r.prices.tp1 ?? '-'}</b>
          </div>
          <div className="tk-lv tp">
            <small>Target 2</small>
            <b>{r.prices.tp2 ?? '-'}</b>
          </div>
        </div>
      )}
      {details}
      {lastFree && (
        <div className="tk-note">
          <b>That was your last free trade plan.</b> Your next analysis needs a subscription.
        </div>
      )}
      <a className="tk-btn" href={analysisUrl(view.analysis.id)} target="_blank" rel="noopener noreferrer">
        Open in Tickrify
      </a>
      {props.platform === 'other' && !view.restored && (
        <button type="button" className="tk-link" onClick={props.onAdjustArea}>
          Adjust area
        </button>
      )}
    </>
  );
}
