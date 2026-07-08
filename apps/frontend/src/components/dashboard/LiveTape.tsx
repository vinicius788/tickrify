import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * Fita de cotações ao vivo. Usa a API pública da Binance (sem chave, com CORS).
 * Nunca mostra número falso: se a busca falhar, o ponto fica apagado e os valores ficam "—".
 */

type Ticker = { symbol: string; label: string; price: string; changePct: number };

const SYMBOLS: Array<{ symbol: string; label: string }> = [
  { symbol: 'BTCUSDT', label: 'BTCUSD' },
  { symbol: 'ETHUSDT', label: 'ETHUSD' },
  { symbol: 'SOLUSDT', label: 'SOLUSD' },
  { symbol: 'BNBUSDT', label: 'BNBUSD' },
  { symbol: 'XRPUSDT', label: 'XRPUSD' },
];

function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function LiveTape() {
  const { language } = useLanguage();
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let active = true;
    const symbolsParam = encodeURIComponent(JSON.stringify(SYMBOLS.map((s) => s.symbol)));
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`;

    const load = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('bad response');
        const data = (await res.json()) as Array<{ symbol: string; lastPrice: string; priceChangePercent: string }>;
        if (!active) return;
        const map = new Map(data.map((d) => [d.symbol, d]));
        const next: Ticker[] = SYMBOLS.map(({ symbol, label }) => {
          const d = map.get(symbol);
          const price = d ? Number(d.lastPrice) : NaN;
          const changePct = d ? Number(d.priceChangePercent) : NaN;
          return { symbol, label, price: fmtPrice(price), changePct };
        });
        setTickers(next);
        setLive(true);
      } catch {
        if (active) setLive(false);
      }
    };

    load();
    const id = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (tickers.length === 0) return null;

  return (
    <div className="flex items-center gap-5 overflow-x-auto whitespace-nowrap border-b border-[var(--border-subtle)] px-4 py-2 md:px-6">
      <span className="flex shrink-0 items-center gap-1.5 font-terminal text-[10px] uppercase tracking-wide text-[var(--accent-green)]">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${live ? 'bg-[var(--accent-green)]' : 'bg-[var(--text-secondary)]'}`} />
        {language === 'pt' ? 'Ao vivo' : 'Live'}
      </span>
      {tickers.map((tk) => {
        const up = Number.isFinite(tk.changePct) && tk.changePct >= 0;
        return (
          <span key={tk.symbol} className="font-terminal text-[11px] text-[var(--text-secondary)]">
            {tk.label} <b className="text-[var(--text-primary)]">{tk.price}</b>{' '}
            <b className={up ? 'text-[var(--accent-green)]' : 'text-[var(--signal-sell)]'}>
              {Number.isFinite(tk.changePct) ? `${up ? '+' : ''}${tk.changePct.toFixed(1)}%` : ''}
            </b>
          </span>
        );
      })}
    </div>
  );
}

export default LiveTape;
