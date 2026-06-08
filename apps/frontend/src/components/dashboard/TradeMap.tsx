interface TradeMapProps {
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const dec = abs >= 1000 ? 2 : abs >= 1 ? 2 : 5;
  return n.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/**
 * Mapa da operação: régua de preços proporcional com zona de risco (vermelha),
 * zona de ganho (verde) e os níveis (entrada/stop/TP1/TP2). 100% preciso —
 * gerado a partir dos números, não desenhado sobre o print.
 */
export function TradeMap({ entry, stopLoss, takeProfit1, takeProfit2 }: TradeMapProps) {
  const levels = [entry, stopLoss, takeProfit1, takeProfit2].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  if (entry === null || stopLoss === null || levels.length < 2) {
    return null;
  }

  const max = Math.max(...levels);
  const min = Math.min(...levels);
  const range = max - min || 1;
  const PAD = 12; // % de respiro topo/base
  const yPct = (price: number) => PAD + ((max - price) / range) * (100 - 2 * PAD);

  const entryY = yPct(entry);
  const stopY = yPct(stopLoss);
  const rewardPrice = takeProfit2 ?? takeProfit1;
  const rewardY = rewardPrice !== null ? yPct(rewardPrice) : entryY;

  const riskTop = Math.min(entryY, stopY);
  const riskH = Math.abs(entryY - stopY);
  const rewTop = Math.min(entryY, rewardY);
  const rewH = Math.abs(entryY - rewardY);

  const rows: Array<{ price: number; label: string; color: string }> = [
    { price: entry, label: 'Entrada', color: 'var(--text-primary)' },
    { price: stopLoss, label: 'Stop', color: 'var(--signal-sell)' },
  ];
  if (takeProfit1 !== null) rows.push({ price: takeProfit1, label: 'TP1', color: 'var(--signal-buy)' });
  if (takeProfit2 !== null) rows.push({ price: takeProfit2, label: 'TP2', color: 'var(--signal-buy)' });

  return (
    <div className="relative h-48 w-full overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)]">
      {/* zona de ganho */}
      <div
        className="absolute left-0 right-0 bg-[var(--signal-buy)]/10"
        style={{ top: `${rewTop}%`, height: `${rewH}%` }}
      />
      {/* zona de risco */}
      <div
        className="absolute left-0 right-0 bg-[var(--signal-sell)]/10"
        style={{ top: `${riskTop}%`, height: `${riskH}%` }}
      />
      {/* linhas + rótulos dos níveis */}
      {rows.map((r) => (
        <div
          key={r.label}
          className="absolute left-0 right-0 flex items-center gap-2 px-3"
          style={{ top: `${yPct(r.price)}%`, transform: 'translateY(-50%)' }}
        >
          <span className="w-14 flex-shrink-0 font-terminal text-[10px]" style={{ color: r.color }}>
            {r.label}
          </span>
          <div className="h-px flex-1" style={{ backgroundColor: r.color, opacity: 0.6 }} />
          <span className="font-terminal text-[11px] font-semibold" style={{ color: r.color }}>
            {fmt(r.price)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default TradeMap;
