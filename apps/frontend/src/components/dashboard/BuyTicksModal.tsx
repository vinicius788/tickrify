import { useMemo, useState } from 'react';
import { TrendingUp, X, Zap } from 'lucide-react';
import { useTicks } from '@/hooks/useTicks';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const FALLBACK_BASE = [
  { id: 'ticks_starter', name: 'Starter', ticks: 20, price: 'R$19,90' },
  { id: 'ticks_trader', name: 'Trader', ticks: 50, price: 'R$49,90', highlight: true },
  { id: 'ticks_pro', name: 'Pro', ticks: 150, price: 'R$129,90', badge: '-13%' },
] as const;

function formatCurrency(valueInCents: number): string {
  return (valueInCents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

export function BuyTicksModal({
  open,
  onClose,
  reason,
  isSubscriber = false,
}: {
  open: boolean;
  onClose: () => void;
  reason?: 'insufficient' | 'topup';
  isSubscriber?: boolean;
}) {
  const { buyTicks, balance, packages } = useTicks();
  const { t } = useLanguage();
  const m = t.ticksModal;
  const [loading, setLoading] = useState<string | null>(null);

  const COSTS = [
    { label: m.costQuick, cost: m.quickTick },
    { label: m.costDeep, cost: m.deepTicks },
    { label: m.costPdf, cost: m.pdfTicks },
  ];

  const usageText = (ticks: number) =>
    `${ticks} ${m.rapidAnalyses} ${m.or} ${Math.max(1, Math.floor(ticks / 3))} deep`;

  const mappedPackages = useMemo(() => {
    if (!packages.length) {
      return FALLBACK_BASE.map((p) => ({
        id: p.id,
        name: p.name,
        ticks: p.ticks,
        price: p.price,
        usage: usageText(p.ticks),
        highlight: 'highlight' in p ? p.highlight : undefined,
        badge: 'badge' in p ? p.badge : undefined,
      }));
    }

    return packages.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      ticks: pkg.ticks,
      price: formatCurrency(pkg.priceInCents),
      usage: usageText(pkg.ticks),
      highlight: pkg.highlight,
      badge: pkg.discountLabel,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packages, m]);

  if (!open) return null;

  const handleBuy = async (packageId: string) => {
    try {
      setLoading(packageId);
      await buyTicks(packageId);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-5">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 fill-yellow-400 text-yellow-400" />
              <h2 className="text-lg font-medium text-[var(--text-primary)]">{m.title}</h2>
            </div>
            {reason === 'insufficient' ? (
              isSubscriber ? (
                <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
                  {m.insuffSub}
                </p>
              ) : (
                <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
                  {m.insuffPrefix} <strong>{balance}</strong> {m.insuffSuffix}
                </p>
              )
            ) : (
              <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
                {m.topup}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            aria-label={m.close}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 pb-2 pt-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-[var(--text-secondary)]">
            {m.costsTitle}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {COSTS.map((cost) => (
              <div key={cost.label} className="rounded-lg bg-[var(--bg-overlay)] p-2.5 text-center">
                <p className="text-xs text-[var(--text-secondary)]">{cost.label}</p>
                <p className="mt-0.5 text-sm font-medium text-[var(--text-primary)]">{cost.cost}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 p-5">
          {mappedPackages.map((pkg) => (
            <button
              type="button"
              key={pkg.id}
              onClick={() => void handleBuy(pkg.id)}
              disabled={Boolean(loading)}
              className={`w-full rounded-xl border p-4 text-left transition-all ${
                pkg.highlight
                  ? 'border-2 border-blue-500 bg-blue-500/5 hover:bg-blue-500/10'
                  : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-overlay)]'
              } ${loading && loading !== pkg.id ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--text-primary)]">{pkg.name}</span>
                      {pkg.highlight && (
                        <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-500">
                          {m.popular}
                        </span>
                      )}
                      {pkg.badge && (
                        <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-600">
                          {pkg.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[var(--text-secondary)]">{pkg.usage}</p>
                  </div>
                </div>
                <div className="ml-4 shrink-0 text-right">
                  <p className="text-lg font-medium text-[var(--text-primary)]">{pkg.price}</p>
                  {loading === pkg.id && (
                    <p className="mt-0.5 text-xs text-blue-500">{m.redirecting}</p>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>

        <p className="flex items-center justify-center gap-1 pb-4 text-center text-xs text-[var(--text-secondary)]">
          <TrendingUp className="h-3.5 w-3.5" />
          {m.secure}
        </p>
      </div>
    </div>
  );
}
