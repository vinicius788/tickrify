import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { buildApiUrl } from '@/lib/api';
import { formatNumber, formatUsd, LOCALES, type Language } from '@/lib/i18n';

/** Preco de tabela do mensal em USD. JSON-LD, meta e pre-render seguem com ele. */
export const MONTHLY_PRICE_USD = 29;

/**
 * Moedas em que o checkout cobra (13/11/2026). Cada uma e uma
 * `currency_option` do MESMO price USD na Stripe, no valor do dolar pelo
 * cambio, arredondado. A lista e os valores vem do servidor
 * (`/api/stripe/prices`); aqui so mora o USD, que todo price tem.
 */
export type ChargeCurrency = 'usd' | 'eur' | 'gbp' | 'jpy' | 'cad' | 'aud';
export type PricedCycle = 'weekly' | 'monthly' | 'yearly';

const USD_PRICES: Record<PricedCycle, number> = { weekly: 7.99, monthly: MONTHLY_PRICE_USD, yearly: 290 };
const CYCLES: PricedCycle[] = ['weekly', 'monthly', 'yearly'];

const EURO_TIME_ZONES = new Set([
  'Europe/Amsterdam', 'Europe/Andorra', 'Europe/Athens', 'Europe/Berlin', 'Europe/Bratislava', 'Europe/Brussels',
  'Europe/Busingen', 'Europe/Dublin', 'Europe/Helsinki', 'Europe/Lisbon', 'Europe/Ljubljana', 'Europe/Luxembourg',
  'Europe/Madrid', 'Europe/Malta', 'Europe/Monaco', 'Europe/Paris', 'Europe/Riga', 'Europe/Rome', 'Europe/San_Marino',
  'Europe/Tallinn', 'Europe/Vatican', 'Europe/Vienna', 'Europe/Vilnius', 'Europe/Zagreb', 'Europe/Nicosia',
  'Asia/Nicosia', 'Asia/Famagusta', 'Atlantic/Azores', 'Atlantic/Madeira', 'Atlantic/Canary', 'Africa/Ceuta',
]);
const POUND_TIME_ZONES = new Set(['Europe/London', 'Europe/Belfast', 'Europe/Guernsey', 'Europe/Isle_of_Man', 'Europe/Jersey']);
const CANADA_TIME_ZONES = new Set([
  'America/Toronto', 'America/Montreal', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Regina',
  'America/Halifax', 'America/St_Johns', 'America/Moncton', 'America/Glace_Bay', 'America/Goose_Bay', 'America/Whitehorse',
  'America/Yellowknife', 'America/Iqaluit', 'America/Dawson_Creek', 'America/Fort_Nelson', 'America/Creston',
  'America/Swift_Current', 'America/Inuvik', 'America/Cambridge_Bay', 'America/Rankin_Inlet', 'America/Resolute',
  'America/Atikokan', 'America/Blanc-Sablon', 'America/Dawson', 'America/Thunder_Bay', 'America/Nipigon',
  'America/Rainy_River', 'America/Pangnirtung',
]);

/**
 * Moeda da pessoa pelo fuso do navegador (o mesmo sinal que o trial usa).
 * Fuso fora das cinco regioes = USD. O checkout recebe EXATAMENTE a moeda
 * mostrada, entao tela e cobranca nunca divergem, mesmo se o palpite errar.
 */
export function detectChargeCurrency(timeZone?: string): ChargeCurrency {
  let zone = timeZone;
  if (!zone) {
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      zone = '';
    }
  }
  if (!zone) return 'usd';
  if (EURO_TIME_ZONES.has(zone)) return 'eur';
  if (POUND_TIME_ZONES.has(zone)) return 'gbp';
  if (zone === 'Asia/Tokyo') return 'jpy';
  if (CANADA_TIME_ZONES.has(zone)) return 'cad';
  if (zone.startsWith('Australia/') || zone === 'Antarctica/Macquarie') return 'aud';
  return 'usd';
}

/**
 * "$29", "$7.99", "€27", "£6.49", "¥4,500", "CA$39". O USD segue o formato de
 * sempre da tela de planos (sem "US$"); iene nunca tem centavos.
 */
export function formatPrice(value: number, currency: ChargeCurrency, language: Language, maxDigits = 2): string {
  if (currency === 'usd' && maxDigits === 2) return formatUsd(value, language);
  const zero = currency === 'jpy' && maxDigits === 2;
  try {
    return new Intl.NumberFormat(LOCALES[language], {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: zero || Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: zero ? 0 : maxDigits,
    }).format(value);
  } catch {
    return `${formatNumber(value, language)} ${currency.toUpperCase()}`;
  }
}

export interface PublicPrices {
  currencies: ChargeCurrency[];
  plans: Record<PricedCycle, Partial<Record<ChargeCurrency, number>>>;
}

export interface LocalPrices {
  /** Moeda mostrada e mandada ao checkout. */
  currency: ChargeCurrency;
  amounts: Record<PricedCycle, number>;
  /** Preco do ciclo ja formatado. */
  price: (cycle: PricedCycle) => string;
  /** Valores para os textos com {weekly}, {monthly}, {yearly} e {perAnalysis}. */
  params: { weekly: string; monthly: string; yearly: string; perAnalysis: string };
}

/**
 * Precos do plano na moeda da pessoa. Enquanto carrega, ou se a API falhar,
 * ou se a moeda dela nao estiver cadastrada nos tres ciclos, fica em USD.
 */
export function useLocalPrices(language: Language): LocalPrices {
  const { data } = useQuery<PublicPrices | null>({
    queryKey: ['stripe-prices'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/stripe/prices'));
      if (!res.ok) return null;
      return (await res.json()) as PublicPrices;
    },
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return useMemo(() => localPricesFrom(data ?? null, language), [data, language]);
}

export interface FounderOffer {
  active: boolean;
  priceUsd: number;
  seatsLeft: number | null;
  /** Segundos desde 1970 (formato da Stripe). */
  expiresAt: number | null;
}

/**
 * Oferta Founding Member de UM link pessoal (`?offer=FND-XXXXXXXX`).
 *
 * Sem codigo, ou com codigo invalido, usado ou vencido, devolve null e a pagina
 * fica exatamente como era: a oferta nao aparece em lugar nenhum publico. O
 * checkout confere o codigo de novo no servidor, entao uma tela velha nunca
 * cobra diferente do que a Stripe aplica.
 */
export function useFounderOffer(code: string | null): FounderOffer | null {
  const { data } = useQuery<FounderOffer | null>({
    queryKey: ['founder-offer', code],
    enabled: Boolean(code),
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/stripe/founder-offer?code=${encodeURIComponent(code ?? '')}`));
      if (!res.ok) return null;
      return (await res.json()) as FounderOffer;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return data?.active ? data : null;
}

/** Precos a mostrar: a moeda do fuso se a Stripe tiver o valor nela, senao USD. */
export function localPricesFrom(data: PublicPrices | null, language: Language, timeZone?: string): LocalPrices {
  const wanted = detectChargeCurrency(timeZone);
  const local = data && wanted !== 'usd' && data.currencies?.includes(wanted)
    ? CYCLES.map((cycle) => data.plans?.[cycle]?.[wanted])
    : null;
  const usable = local?.every((value) => typeof value === 'number' && value > 0) ? local as number[] : null;
  const currency: ChargeCurrency = usable ? wanted : 'usd';
  const amounts: Record<PricedCycle, number> = usable
    ? { weekly: usable[0], monthly: usable[1], yearly: usable[2] }
    : USD_PRICES;
  const price = (cycle: PricedCycle) => formatPrice(amounts[cycle], currency, language);
  return {
    currency,
    amounts,
    price,
    params: {
      weekly: price('weekly'),
      monthly: price('monthly'),
      yearly: price('yearly'),
      perAnalysis: formatPrice(amounts.monthly / 200, currency, language, currency === 'jpy' ? 1 : 3),
    },
  };
}
