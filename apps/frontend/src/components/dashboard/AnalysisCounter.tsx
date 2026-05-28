import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAnalysisLimit, type UserPlan } from "@/hooks/useAnalysisLimit";
import { useTicks } from "@/hooks/useTicks";
import { Zap, Crown, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

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

const AnalysisCounter = () => {
  const { isUnlimited, plan } = useAnalysisLimit();
  const { balance } = useTicks();

  // Usuário sem assinatura ativa: CTA para assinar
  if (!isUnlimited) {
    return (
      <Card className="surface-terminal-elevated border border-[var(--border-subtle)]">
        <CardContent className="p-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Crown className="h-4 w-4 text-[var(--accent-green)]" />
              <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                Plano necessário
              </span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              Assine um plano para analisar gráficos com IA institucional.
            </p>
            <Link to="/pricing">
              <Button size="sm" className="w-full">
                <Crown className="mr-2 h-4 w-4" />
                Ver planos
              </Button>
            </Link>
            <p className="text-xs text-[var(--text-muted)] text-center">
              3 dias grátis · Cancele quando quiser
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Assinante: mostrar saldo de ticks
  const planLabel = PLAN_LABELS[plan] ?? 'Pro';
  const planTicks = PLAN_TICKS[plan] ?? 0;
  const ticksPercent = planTicks > 0 ? Math.max(0, Math.min(100, (balance / planTicks) * 100)) : 0;
  const ticksLow = balance <= Math.ceil(planTicks * 0.1);

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
            <p className="text-xs text-amber-500 flex items-center gap-1.5">
              <TriangleAlert className="h-3.5 w-3.5" />
              Ticks esgotados. Renova automaticamente no próximo ciclo.
            </p>
          ) : ticksLow ? (
            <p className="text-xs text-amber-500 flex items-center gap-1.5">
              <TriangleAlert className="h-3.5 w-3.5" />
              Poucos ticks restantes. Renova no próximo ciclo.
            </p>
          ) : (
            <p className="text-xs text-[var(--text-secondary)]">
              Renova mensalmente · {Math.floor(balance)} ticks disponíveis
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default AnalysisCounter;
