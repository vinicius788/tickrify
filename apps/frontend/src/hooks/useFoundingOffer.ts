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
