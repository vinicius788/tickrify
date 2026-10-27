import { useQuery } from '@tanstack/react-query';
import { buildApiUrl } from '@/lib/api';

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
