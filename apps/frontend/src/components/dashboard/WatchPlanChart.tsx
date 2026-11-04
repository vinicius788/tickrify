import { Eye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatNumber } from '@/lib/i18n';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { WatchLevels, WatchPlan } from '@/lib/api';

// Plano do WATCH desenhado numa escala de preco: a area de interesse,
// a linha de invalidacao e os alvos, com a reacao esperada. Nunca usa as cores
// de compra/venda nem linhas cheias: nao e um sinal ativo.

interface WatchPlanChartProps {
  plan: WatchPlan;
  currentPrice: number | null;
  formatPrice: (value: number | null) => string;
  /** Niveis lidos do print, sem velas reais (dataMode print). */
  estimated?: boolean;
  /**
   * Niveis do motor ao destravar no nivel: os alvos vem daqui (TP1 com teto).
   * null = o motor rejeitou a geometria no nivel (sem alvos nem R);
   * ausente = analise antiga ou sem velas reais (alvos do modelo, como antes).
   */
  levels?: WatchLevels | null;
}

const WIDTH = 320;
const HEIGHT = 168;
const PAD = 14;
const LABEL_X = 196;
/** Distancia minima entre rotulos (fonte de 11 px). */
const LABEL_GAP = 13;

export function isWatchPlan(value: unknown): value is WatchPlan {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  return (p.direction === 'long' || p.direction === 'short') &&
    (p.triggerType === 'zone_reaction' || p.triggerType === 'sweep_reclaim' || p.triggerType === 'breakout_close') &&
    n(p.zoneLow) && n(p.zoneHigh) && n(p.invalidation) && n(p.target1) &&
    (p.target2 === null || n(p.target2)) && typeof p.validForCandles === 'number';
}

export function isWatchLevels(value: unknown): value is WatchLevels {
  if (!value || typeof value !== 'object') return false;
  const l = value as Record<string, unknown>;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  return n(l.entry) && n(l.stopLoss) && n(l.takeProfit1) && (l.takeProfit2 === null || n(l.takeProfit2)) && n(l.tp1R) && n(l.riskAtr);
}

/**
 * Afasta rotulos de niveis proximos sem mexer nas linhas: na ordem vertical,
 * cada rotulo fica a pelo menos LABEL_GAP do anterior, dentro do desenho.
 */
export function spreadLabels(ys: readonly number[], min = PAD, max = HEIGHT - 2): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = new Array<number>(ys.length);
  let last = -Infinity;
  for (const { y, i } of order) {
    out[i] = Math.max(y, last + LABEL_GAP, min);
    last = out[i];
  }
  // Passou do fundo: empurra de baixo para cima.
  let next = Infinity;
  for (const { i } of [...order].reverse()) {
    out[i] = Math.min(out[i], next - LABEL_GAP, max);
    next = out[i];
  }
  return out;
}

export function WatchPlanChart({ plan, currentPrice, formatPrice, estimated = false, levels }: WatchPlanChartProps) {
  const { t, language } = useLanguage();
  const w = t.analysis.result.watch;
  const rejected = levels === null;
  const target1 = rejected ? null : levels ? levels.takeProfit1 : plan.target1;
  const target2 = rejected ? null : levels ? levels.takeProfit2 : plan.target2;
  const prices = [plan.zoneLow, plan.zoneHigh, plan.invalidation, target1, target2, currentPrice]
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  const top = Math.max(...prices);
  const bottom = Math.min(...prices);
  const span = top - bottom || top * 0.001;
  const y = (price: number) => PAD + ((top - price) / span) * (HEIGHT - 2 * PAD);

  const lines = [
    { key: 'inv', price: plan.invalidation, label: w.invalidation, color: 'var(--tone-warn-2)' },
    ...(target1 !== null ? [{ key: 't1', price: target1, label: levels ? `${w.target1} (${formatNumber(levels.tp1R, language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}R)` : w.target1, color: 'var(--text-secondary)' }] : []),
    ...(target2 !== null ? [{ key: 't2', price: target2, label: w.target2, color: 'var(--text-muted)' }] : []),
  ];
  const zoneTop = y(plan.zoneHigh);
  const zoneHeight = Math.max(2, y(plan.zoneLow) - zoneTop);
  // Rotulo da area no meio dela; os dos niveis na linha. So os rotulos se afastam.
  const [zoneLabelY, ...lineLabelY] = spreadLabels([zoneTop + zoneHeight / 2 + 4, ...lines.map((l) => y(l.price) + 4)]);

  return (
    <Card className="surface-terminal rounded-xl fade-in-stagger" data-testid="watch-plan" style={{ animationDelay: '50ms' }}>
      <CardContent className="p-5 md:p-6">
        <p className="tk-display mb-1 flex items-center gap-2 text-[15px]">
          <Eye className="h-4 w-4 text-[var(--signal-hold)]" />
          <span>{w.title}</span>
        </p>
        <p className="mb-3 text-xs text-[var(--text-secondary)]">{w.notSignal}</p>
        {rejected && (
          <p data-testid="targets-rejected" className="-mt-2 mb-3 text-xs text-[var(--text-secondary)]">
            {w.targetsRejected}
          </p>
        )}
        {estimated && (
          <p data-testid="levels-estimated" className="-mt-2 mb-3 text-xs text-[var(--text-secondary)]">
            {t.analysis.result.levelsEstimated}
          </p>
        )}
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full max-w-[420px]"
          role="img"
          aria-label={`${w.zone} ${formatPrice(plan.zoneLow)} - ${formatPrice(plan.zoneHigh)}`}
        >
          <rect
            x={PAD}
            y={zoneTop}
            width={LABEL_X - PAD - 8}
            height={zoneHeight}
            fill="var(--signal-hold-bg)"
            stroke="var(--signal-hold-border)"
            strokeDasharray="4 3"
          />
          <text x={LABEL_X} y={zoneLabelY} fontSize="11" fill="var(--signal-hold)">
            {`${w.zone} ${formatPrice(plan.zoneLow)} - ${formatPrice(plan.zoneHigh)}`}
          </text>
          {lines.map((line, i) => (
            <g key={line.key}>
              <line x1={PAD} x2={LABEL_X - 8} y1={y(line.price)} y2={y(line.price)} stroke={line.color} strokeDasharray="5 4" strokeWidth="1" />
              <text x={LABEL_X} y={lineLabelY[i]} fontSize="11" fill={line.color}>
                {`${line.label} ${formatPrice(line.price)}`}
              </text>
            </g>
          ))}
          {currentPrice !== null && currentPrice > 0 && (
            <g>
              <circle cx={PAD + 4} cy={y(currentPrice)} r="3" fill="var(--text-primary)" />
              <text x={PAD + 12} y={y(currentPrice) - 5} fontSize="10" fill="var(--text-primary)">
                {`${w.price} ${formatPrice(currentPrice)}`}
              </text>
            </g>
          )}
        </svg>
        <div className="mt-3 space-y-1 text-sm">
          <p className="font-terminal text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
            <span>{`${w.trigger}: ${w.types[plan.triggerType]}`}</span>
          </p>
          {plan.trigger && <p className="leading-relaxed text-[var(--text-primary)]/85">{plan.trigger}</p>}
          <p className="text-xs text-[var(--text-secondary)]">{w.valid.replace('{n}', String(plan.validForCandles))}</p>
        </div>
      </CardContent>
    </Card>
  );
}
