import { useMemo, useState } from 'react';
import { Calculator, ChevronDown } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface PositionSizingCalculatorProps {
  entry: number | null;
  stopLoss: number | null;
}

/**
 * Calculadora de position sizing — cálculo 100% no cliente, sem IA.
 * A partir do tamanho da conta e do risco por trade (%), calcula o tamanho
 * da posição usando a distância até o stop (|entry - stopLoss|).
 */
export function PositionSizingCalculator({ entry, stopLoss }: PositionSizingCalculatorProps) {
  const { t } = useLanguage();
  const labels = t.analysis.positionSizing;

  const [open, setOpen] = useState<boolean>(false);
  const [accountSize, setAccountSize] = useState<string>('');
  const [riskPercent, setRiskPercent] = useState<string>('1');

  const hasLevels = entry !== null && stopLoss !== null && Math.abs(entry - stopLoss) > 0;

  const result = useMemo(() => {
    const account = Number(accountSize);
    const risk = Number(riskPercent);
    if (!hasLevels || !Number.isFinite(account) || account <= 0 || !Number.isFinite(risk) || risk <= 0) {
      return null;
    }
    const riskAmount = account * (risk / 100);
    const stopDistance = Math.abs((entry as number) - (stopLoss as number));
    const positionSize = riskAmount / stopDistance;
    if (!Number.isFinite(positionSize) || positionSize <= 0) {
      return null;
    }
    return { riskAmount, positionSize };
  }, [accountSize, riskPercent, hasLevels, entry, stopLoss]);

  const fmt = (n: number, max = 4) =>
    n.toLocaleString(undefined, { maximumFractionDigits: max });

  const inputClass =
    'w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 font-terminal text-sm text-[var(--text-primary)] outline-none focus:border-[var(--signal-buy)]';

  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2 py-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-1.5 font-semibold text-[var(--text-primary)]"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <Calculator className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
          {labels.title}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-[var(--text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {!open ? null : (
      <>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[var(--text-secondary)]">{labels.accountSize}</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={accountSize}
            onChange={(e) => setAccountSize(e.target.value)}
            placeholder="10000"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-[var(--text-secondary)]">{labels.riskPercent}</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.1}
            value={riskPercent}
            onChange={(e) => setRiskPercent(e.target.value)}
            placeholder="1"
            className={inputClass}
          />
        </label>
      </div>

      {!hasLevels ? (
        <p className="mt-2 text-[var(--text-secondary)]">{labels.noStop}</p>
      ) : result ? (
        <div className="mt-2 space-y-1 border-t border-[var(--border-subtle)] pt-2">
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-secondary)]">{labels.riskAmount}</span>
            <span className="font-terminal font-semibold text-[var(--signal-sell)]">
              ${fmt(result.riskAmount, 2)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-secondary)]">{labels.positionSize}</span>
            <span className="font-terminal font-semibold text-[var(--signal-buy)]">
              {fmt(result.positionSize)}
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[var(--text-secondary)]">{labels.hint}</p>
      )}
      </>
      )}
    </div>
  );
}

export default PositionSizingCalculator;
