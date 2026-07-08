import { useEffect, useState } from 'react';
import { buildApiUrl } from '@/lib/api';

export interface MarketContextData {
  symbol: string;
  isCrypto: boolean;
  binanceSymbol: string | null;
  fundingRatePercent: number | null;
  nextFundingTime: number | null;
  openInterest: number | null;
  longShortRatio: number | null;
  longAccountPercent: number | null;
  shortAccountPercent: number | null;
  fearGreedValue: number | null;
  fearGreedClassification: string | null;
  fetchedAt: number;
}

interface State {
  data: MarketContextData | null;
  loading: boolean;
  error: boolean;
}

export function useMarketContext(symbol: string | null | undefined): State {
  const [state, setState] = useState<State>({ data: null, loading: false, error: false });

  useEffect(() => {
    if (!symbol || symbol === 'UNKNOWN' || symbol === 'N/A') {
      setState({ data: null, loading: false, error: false });
      return;
    }

    const clean = symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    setState((s) => ({ ...s, loading: true, error: false }));

    const controller = new AbortController();
    fetch(buildApiUrl(`/api/market/context?symbol=${clean}`), {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<MarketContextData>) : Promise.reject()))
      .then((data) => setState({ data, loading: false, error: false }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ data: null, loading: false, error: true });
        }
      });

    return () => controller.abort();
  }, [symbol]);

  return state;
}
