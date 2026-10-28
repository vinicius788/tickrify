import { Eye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { WatchPlan } from '@/lib/api';

// Plano do WATCH (v10.3) desenhado numa escala de preco: a area de interesse,
// a linha de invalidacao e os alvos, com a reacao esperada. Nunca usa as cores
// de compra/venda nem linhas cheias: nao e um sinal ativo.

interface WatchPlanChartProps {
  plan: WatchPlan;
  currentPrice: number | null;
  formatPrice: (value: number | null) => string;
  /** Niveis lidos do print, sem velas reais (dataMode print). */
  estimated?: boolean;
}

const WIDTH = 320;
const HEIGHT = 168;
const PAD = 14;
const LABEL_X = 196;

export function isWatchPlan(value: unknown): value is WatchPlan {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  return (p.direction === 'long' || p.direction === 'short') &&
    (p.triggerType === 'zone_reaction' || p.triggerType === 'sweep_reclaim' || p.triggerType === 'breakout_close') &&
    n(p.zoneLow) && n(p.zoneHigh) && n(p.invalidation) && n(p.target1) &&
    (p.target2 === null || n(p.target2)) && typeof p.validForCandles === 'number';
}

export function WatchPlanChart({ plan, currentPrice, formatPrice, estimated = false }: WatchPlanChartProps) {
  const { t } = useLanguage();
  const w = t.analysis.result.watch;
  const levels = [plan.zoneLow, plan.zoneHigh, plan.invalidation, plan.target1, plan.target2, currentPrice]
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  const top = Math.max(...levels);
  const bottom = Math.min(...levels);
  const span = top - bottom || top * 0.001;
  const y = (price: number) => PAD + ((top - price) / span) * (HEIGHT - 2 * PAD);

  const lines = [
    { key: 'inv', price: plan.invalidation, label: w.invalidation, color: 'var(--tone-warn-2)' },
    { key: 't1', price: plan.target1, label: w.target1, color: 'var(--text-secondary)' },
    ...(plan.target2 !== null ? [{ key: 't2', price: plan.target2, label: w.target2, color: 'var(--text-muted)' }] : []),
  ];
  const zoneTop = y(plan.zoneHigh);
  const zoneHeight = Math.max(2, y(plan.zoneLow) - zoneTop);

  return (
    <Card className="surface-terminal rounded-xl fade-in-stagger" data-testid="watch-plan" style={{ animationDelay: '50ms' }}>
      <CardContent className="p-5 md:p-6">
        <p className="tk-display mb-1 flex items-center gap-2 text-[15px]">
          <Eye className="h-4 w-4 text-[var(--signal-hold)]" />
          <span>{w.title}</span>
        </p>
        <p className="mb-3 text-xs text-[var(--text-secondary)]">{w.notSignal}</p>
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
          <text x={LABEL_X} y={zoneTop + zoneHeight / 2 + 4} fontSize="11" fill="var(--signal-hold)">
            {`${w.zone} ${formatPrice(plan.zoneLow)} - ${formatPrice(plan.zoneHigh)}`}
          </text>
          {lines.map((line) => (
            <g key={line.key}>
              <line x1={PAD} x2={LABEL_X - 8} y1={y(line.price)} y2={y(line.price)} stroke={line.color} strokeDasharray="5 4" strokeWidth="1" />
              <text x={LABEL_X} y={y(line.price) + 4} fontSize="11" fill={line.color}>
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
