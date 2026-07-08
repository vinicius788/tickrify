import { useEffect, useState } from 'react';
import { buildApiUrl } from '@/lib/api';

export interface EconomicEvent {
  title: string;
  country: string;
  date: string;
  time: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  forecast?: string;
  previous?: string;
  minutesUntil?: number;
}

interface CalendarResponse {
  symbol: string;
  events: EconomicEvent[];
}

interface State {
  events: EconomicEvent[];
  loading: boolean;
  error: boolean;
}

export function useEconomicCalendar(symbol: string | null | undefined): State {
  const [state, setState] = useState<State>({ events: [], loading: false, error: false });

  useEffect(() => {
    if (!symbol || symbol === 'UNKNOWN' || symbol === 'N/A') {
      setState({ events: [], loading: false, error: false });
      return;
    }

    const clean = symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    setState((s) => ({ ...s, loading: true, error: false }));

    const controller = new AbortController();
    fetch(buildApiUrl(`/api/calendar/events?symbol=${clean}&hours=24`), {
      signal: controller.signal,
    })
      .then((r) => r.ok ? r.json() as Promise<CalendarResponse> : Promise.reject())
      .then((data) => setState({ events: data.events ?? [], loading: false, error: false }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ events: [], loading: false, error: true });
        }
      });

    return () => controller.abort();
  }, [symbol]);

  return state;
}
