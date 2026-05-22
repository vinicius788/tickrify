import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAnalysisLimit, type UserPlan } from "@/hooks/useAnalysisLimit";
import { useTicks } from "@/hooks/useTicks";
import { Zap, Crown, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AnalysisCounterProps {
  onUpgradeClick?: () => void;
  onBuyTicksClick?: () => void;
}

const PLAN_LABELS: Record<UserPlan, string> = {
  free: 'Gratuito',
  starter: 'Starter',
  pro: 'Pro',
  elite: 'Elite',
};

const PLAN_TICKS: Record<UserPlan, number> = {
  free: 0,
  starter: 45,
  pro: 150,
  elite: 400,
};

const AnalysisCounter = ({ onUpgradeClick, onBuyTicksClick }: AnalysisCounterProps) => {
  const { total, used, remaining, isUnlimited, plan } = useAnalysisLimit();
  const { balance } = useTicks();

  if (isUnlimited) {
    const planLabel = PLAN_LABELS[plan] ?? 'Pro';
    const planTicks = PLAN_TICKS[plan] ?? 0;
    const ticksPercent = planTicks > 0 ? Math.max(0, Math.min(100, (balance / planTicks) * 100)) : 0;
    const ticksLow = balance <= Math.ceil(planTicks * 0.1); // abaixo de 10%

    return (
      <Card className="surface-terminal-elevated border border-[var(--border-subtle)]">
        <CardContent className="p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                  Plano {planLabel}
                </span>
              </div>
              <div className="flex items-center gap-1 text-sm font-bold text-[var(--text-primary)]">
                <Zap className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                <span>{balance}</span>
                {planTicks > 0 && (
                  <span className="text-xs font-normal text-[var(--text-secondary)]">/{planTicks}</span>
                )}
              </div>
            </div>

            {planTicks > 0 && (
              <Progress value={ticksPercent} className="h-1.5 bg-[var(--bg-overlay)]" />
            )}

            {ticksLow && balance === 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-destructive flex items-center gap-1.5">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  Ticks esgotados. Compre mais ou aguarde renovação.
                </p>
                {onBuyTicksClick && (
                  <Button size="sm" className="w-full" onClick={onBuyTicksClick}>
                    <Zap className="mr-2 h-4 w-4" />
                    Comprar Ticks
                  </Button>
                )}
              </div>
            ) : ticksLow ? (
              <p className="text-xs text-amber-500 flex items-center gap-1.5">
                <TriangleAlert className="h-3.5 w-3.5" />
                Poucos ticks restantes. Renova no próximo ciclo.
              </p>
            ) : (
              <p className="text-xs text-[var(--text-secondary)]">
                Renova mensalmente · {Math.floor(balance)} análises rápidas ou {Math.floor(balance / 3)} deep
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const safeTotal = Number.isFinite(total) ? total : 0;
  const usagePercent = safeTotal > 0 ? (used / safeTotal) * 100 : 0;
  const isLimitReached = remaining === 0;

  return (
    <Card className={`surface-terminal-elevated border border-[var(--border-subtle)] ${isLimitReached ? "border-destructive/50" : ""}`}>
      <CardContent className="p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Análises gratuitas</span>
            </div>
            <span className="font-terminal text-sm font-bold text-[var(--text-primary)]">
              {remaining}/{safeTotal}
            </span>
          </div>

          <Progress value={usagePercent} className="h-2 bg-[var(--bg-overlay)]" />

          {isLimitReached ? (
            <div className="space-y-2">
              <p className="text-xs text-destructive">
                Você atingiu o limite de análises gratuitas deste mês.
              </p>
              {onUpgradeClick && (
                <Button size="sm" className="w-full" onClick={onUpgradeClick}>
                  <Crown className="mr-2 h-4 w-4" />
                  Fazer Upgrade
                </Button>
              )}
            </div>
          ) : remaining <= 1 ? (
            <div className="space-y-2">
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <TriangleAlert className="h-3.5 w-3.5" />
                <span>{remaining === 1 ? 'Última análise gratuita' : 'Poucas análises restantes'}</span>
              </p>
              {onUpgradeClick && (
                <Button size="sm" variant="outline" className="w-full" onClick={onUpgradeClick}>
                  <Crown className="mr-2 h-4 w-4" />
                  Assinar um plano
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Renova mensalmente · Upgrade para ilimitadas
              </p>
              {onUpgradeClick && (
                <Button size="sm" variant="outline" className="w-full" onClick={onUpgradeClick}>
                  <Crown className="mr-2 h-4 w-4" />
                  Fazer Upgrade
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default AnalysisCounter;
