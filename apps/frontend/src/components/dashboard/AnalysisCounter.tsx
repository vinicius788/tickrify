import { useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAnalysisLimit, type UserPlan } from "@/hooks/useAnalysisLimit";
import { useTicks } from "@/hooks/useTicks";
import { Zap, Crown, TriangleAlert, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { buildApiUrl } from "@/lib/api";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { track } from "@/lib/analytics";

const PLAN_LABELS: Record<UserPlan, string> = {
  free: 'Free',
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

const FREE_ANALYSES_TOTAL = 3;

const AnalysisCounter = () => {
  const { isUnlimited, plan, used, isLoading } = useAnalysisLimit();
  const { balance } = useTicks();
  const { t } = useLanguage();
  const { getToken } = useAuth();
  const c = t.counter;

  // Portal do cliente Stripe (gerenciar/cancelar assinatura) — endpoint já existia
  // no backend; este é o primeiro ponto da UI que o expõe.
  // IMPORTANTE: todos os hooks (incl. este useState) precisam ser chamados ANTES
  // de qualquer return condicional, senão React error #310 (hooks condicionais).
  const [portalLoading, setPortalLoading] = useState(false);

  // Enquanto o backend não confirmou o plano (conta paga demora no cold start),
  // mostrar um estado neutro de carregamento — NUNCA "0/3 grátis", que confundia
  // o assinante e o fazia achar que perdeu o plano.
  if (isLoading) {
    return (
      <Card className="surface-terminal-elevated border border-[var(--border-subtle)]">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-secondary)] border-t-transparent" />
            {c.loadingPlan ?? 'Loading your plan…'}
          </div>
        </CardContent>
      </Card>
    );
  }

  const openCustomerPortal = async () => {
    if (portalLoading) return;
    setPortalLoading(true);
    try {
      const token = await getToken({ skipCache: true });
      const res = await fetch(buildApiUrl('/api/stripe/create-customer-portal'), {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error('portal unavailable');
      const data = (await res.json()) as { url?: string };
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error('portal url missing');
    } catch {
      setPortalLoading(false);
    }
  };

  // Usuário sem assinatura: mostrar contador de análises grátis
  if (!isUnlimited) {
    const freeUsed = Math.min(used, FREE_ANALYSES_TOTAL);
    const freeRemaining = Math.max(0, FREE_ANALYSES_TOTAL - freeUsed);
    const freePercent = (freeUsed / FREE_ANALYSES_TOTAL) * 100;
    const exhausted = freeRemaining === 0;

    return (
      <Card className="surface-terminal-elevated border border-[var(--border-subtle)]">
        <CardContent className="p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-[var(--accent-green)]" />
                <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                  {c.freeTitle}
                </span>
              </div>
              <span className="font-terminal text-sm font-bold text-[var(--text-primary)]">
                {freeUsed}/{FREE_ANALYSES_TOTAL}
              </span>
            </div>

            <Progress value={freePercent} className="h-1.5 bg-[var(--bg-overlay)]" />

            {exhausted ? (
              <>
                <p className="text-xs text-amber-500 flex items-center gap-1.5">
                  <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0" />
                  {c.exhausted}
                </p>
                <Link
                  to="/pricing"
                  onClick={() => track('upgrade_cta_clicked', { source: 'counter_exhausted', destination: 'pricing' })}
                >
                  <Button size="sm" className="w-full">
                    <Crown className="mr-2 h-4 w-4" />
                    {c.subscribe}
                  </Button>
                </Link>
              </>
            ) : (
              <>
                <p className="text-xs text-[var(--text-secondary)]">
                  {freeRemaining} {c.remainingFree}
                </p>
                <Link
                  to="/pricing"
                  onClick={() =>
                    track('upgrade_cta_clicked', { source: 'counter_view_plans', destination: 'pricing', freeRemaining })
                  }
                >
                  <Button size="sm" variant="outline" className="w-full">
                    <Crown className="mr-2 h-4 w-4" />
                    {c.viewPlans}
                  </Button>
                </Link>
              </>
            )}
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
                {c.planPrefix} {planLabel}
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
              {c.ticksOut}
            </p>
          ) : ticksLow ? (
            <p className="text-xs text-amber-500 flex items-center gap-1.5">
              <TriangleAlert className="h-3.5 w-3.5" />
              {c.ticksLow}
            </p>
          ) : (
            <p className="text-xs text-[var(--text-secondary)]">
              {c.renewsPrefix} {Math.floor(balance)} {c.renewsSuffix}
            </p>
          )}

          <button
            type="button"
            onClick={() => void openCustomerPortal()}
            disabled={portalLoading}
            className="flex items-center gap-1 text-xs text-[var(--text-secondary)] underline-offset-2 transition-colors hover:text-[var(--text-primary)] hover:underline disabled:opacity-60"
          >
            <ExternalLink className="h-3 w-3" />
            {portalLoading ? '…' : c.manageSubscription}
          </button>
        </div>
      </CardContent>
    </Card>
  );
};

export default AnalysisCounter;
