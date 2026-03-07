import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAnalysisLimit } from "@/hooks/useAnalysisLimit";
import { Zap, Crown, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AnalysisCounterProps {
  onUpgradeClick?: () => void;
}

const AnalysisCounter = ({ onUpgradeClick }: AnalysisCounterProps) => {
  const { total, used, remaining, isUnlimited, plan } = useAnalysisLimit();

  if (isUnlimited) {
    const isPaidPlan = plan === 'pro';
    return (
      <Card className="surface-terminal-elevated border border-[var(--border-subtle)]">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Crown className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-semibold tracking-wide text-[var(--text-primary)]">
                {isPaidPlan ? 'PLANO PRO' : 'ACESSO LIBERADO'}
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                {isPaidPlan ? 'Análises ilimitadas' : 'Análises ilimitadas temporariamente'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const usagePercent = (used / total) * 100;
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
              {remaining}/{total}
            </span>
          </div>

          <Progress value={usagePercent} className="h-2 bg-[var(--bg-overlay)]" />

          {isLimitReached ? (
            <div className="space-y-2">
              <p className="text-xs text-destructive">
                Você atingiu o limite de análises gratuitas deste mês.
              </p>
              {onUpgradeClick && (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={onUpgradeClick}
                >
                  <Crown className="mr-2 h-4 w-4" />
                  Fazer Upgrade para Pro
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
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={onUpgradeClick}
                >
                  <Crown className="mr-2 h-4 w-4" />
                  Assinar Pro
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Renova mensalmente • Upgrade para ilimitadas
              </p>
              {onUpgradeClick && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={onUpgradeClick}
                >
                  <Crown className="mr-2 h-4 w-4" />
                  Fazer Upgrade para Pro
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
