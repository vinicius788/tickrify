import { useQuery } from '@tanstack/react-query';
import { buildApiUrl } from '@/lib/api';
import { formatNumber, type Language } from '@/lib/i18n';

export interface FoundingOffer {
  active: boolean;
  code: string;
  percentOff: number | null;
}

/**
 * Oferta Founding Trader (EARLY35) como a Stripe a ve agora.
 *
 * A faixa da home, a /pricing e o paywall so mostram o desconto quando isto
 * devolve `active`. Enquanto carrega ou se a API falhar, a oferta NAO aparece:
 * esconder um desconto que existe custa pouco; prometer um esgotado e cobrar o
 * preco cheio e o erro que isto evita. O checkout decide no servidor, entao
 * mesmo uma tela velha nunca cobra diferente do que a Stripe aplica.
 */
export function useFoundingOffer(): FoundingOffer | null {
  const { data } = useQuery<FoundingOffer | null>({
    queryKey: ['founding-offer'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/stripe/offer'));
      if (!res.ok) return null;
      return (await res.json()) as FoundingOffer;
    },
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return data?.active ? data : null;
}

/** Preco de tabela do mensal. JSON-LD, meta e pre-render seguem com ele. */
export const MONTHLY_PRICE_USD = 29;

/**
 * Preco do 1o mes do mensal com o EARLY35 ativo, ja formatado ("$18.85"), ou
 * null sem oferta. Conta em centavos a partir do `percentOff` da Stripe, nunca
 * fixo: a Stripe arredonda o desconto no centavo.
 */
export function firstMonthPrice(offer: FoundingOffer | null, language: Language): string | null {
  if (!offer?.percentOff) return null;
  const cents = Math.round((MONTHLY_PRICE_USD * 100 * (100 - offer.percentOff)) / 100);
  return `$${formatNumber(cents / 100, language, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })}`;
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
