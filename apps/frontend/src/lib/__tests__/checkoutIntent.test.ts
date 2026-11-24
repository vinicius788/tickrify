import { afterEach, describe, expect, it } from 'vitest';
import {
  CHECKOUT_INTENT_TTL_MS,
  affiliateTargetFromAuthSearch,
  authUrlForCheckout,
  checkoutReturnPath,
  checkoutTargetFromAuthSearch,
  clearCheckoutIntent,
  loadCheckoutIntent,
  parseCheckoutIntent,
  saveCheckoutIntent,
} from '@/lib/checkoutIntent';

const ORIGIN = 'https://tickrify.com';

describe('checkoutIntent', () => {
  afterEach(() => clearCheckoutIntent());

  it('preserva plano, ciclo e origem ida e volta pela URL de login', () => {
    const intent = { plan: 'starter', cycle: 'yearly', source: 'locked_value' } as const;
    const authUrl = authUrlForCheckout(intent);

    expect(authUrl).toBe('/sign-in?redirect_url=%2Fdashboard%2Fplans%3Fcheckout%3Dstarter%26cycle%3Dyearly%26source%3Dlocked_value');
    const redirect = new URLSearchParams(authUrl.split('?')[1]).get('redirect_url')!;
    expect(parseCheckoutIntent(new URL(redirect, ORIGIN).search)).toEqual(intent);
  });

  it('funciona tambem para a URL de cadastro', () => {
    expect(authUrlForCheckout({ plan: 'starter', cycle: 'monthly', source: 'pricing' }, 'sign-up')).toMatch(/^\/sign-up\?redirect_url=/);
  });

  it('recusa plano legado ou inventado (so vende o da vitrine)', () => {
    expect(parseCheckoutIntent('?checkout=pro')).toBeNull();
    expect(parseCheckoutIntent('?checkout=elite')).toBeNull();
    expect(parseCheckoutIntent('?checkout=<script>')).toBeNull();
  });

  it('ciclo ou origem invalidos caem no padrao em vez de vazar', () => {
    expect(parseCheckoutIntent('?checkout=starter&cycle=daily&source=evil')).toEqual({
      plan: 'starter',
      cycle: 'monthly',
      source: 'pricing',
    });
  });

  it('o semanal sobrevive ao login', () => {
    expect(parseCheckoutIntent('?checkout=starter&cycle=weekly&source=pricing')).toEqual({
      plan: 'starter',
      cycle: 'weekly',
      source: 'pricing',
    });
  });

  it('nao vira open redirect: so aceita os Planos (ou a /pricing antiga) deste mesmo site', () => {
    const q = (target: string) => `?redirect_url=${encodeURIComponent(target)}`;

    expect(checkoutTargetFromAuthSearch(q('/dashboard/plans?checkout=starter&cycle=yearly'), ORIGIN)).toBe(
      '/dashboard/plans?checkout=starter&cycle=yearly&source=pricing',
    );
    // Link de login aberto antes da troca: volta para o painel mesmo assim.
    expect(checkoutTargetFromAuthSearch(q('/pricing?checkout=starter&cycle=yearly'), ORIGIN)).toBe(
      '/dashboard/plans?checkout=starter&cycle=yearly&source=pricing',
    );
    expect(checkoutTargetFromAuthSearch(q('https://evil.com/pricing?checkout=starter'), ORIGIN)).toBeNull();
    expect(checkoutTargetFromAuthSearch(q('//evil.com/pricing?checkout=starter'), ORIGIN)).toBeNull();
    expect(checkoutTargetFromAuthSearch(q('/dashboard'), ORIGIN)).toBeNull();
    expect(checkoutTargetFromAuthSearch(q('javascript:alert(1)'), ORIGIN)).toBeNull();
    expect(checkoutTargetFromAuthSearch('', ORIGIN)).toBeNull();
  });

  it('painel do afiliado: o login volta para /affiliate, e so deste site', () => {
    const q = (target: string) => `?redirect_url=${encodeURIComponent(target)}`;
    expect(affiliateTargetFromAuthSearch(q('/affiliate'), ORIGIN)).toBe('/affiliate');
    expect(affiliateTargetFromAuthSearch('', ORIGIN, '#/?redirect_url=https%3A%2F%2Ftickrify.com%2Faffiliate')).toBe('/affiliate');
    expect(affiliateTargetFromAuthSearch(q('https://evil.com/affiliate'), ORIGIN)).toBeNull();
    expect(affiliateTargetFromAuthSearch(q('/affiliates'), ORIGIN)).toBeNull();
  });

  it('le o redirect_url do hash, formato que o Clerk usa ao ir para o cadastro', () => {
    // Link real de producao: "Sign up" na tela de login aberta pelo Upgrade.
    const hash = '#/?redirect_url=https%3A%2F%2Ftickrify.com%2Fpricing%3Fcheckout%3Dstarter%26cycle%3Dyearly%26source%3Dpricing';

    expect(checkoutTargetFromAuthSearch('', ORIGIN, hash)).toBe('/dashboard/plans?checkout=starter&cycle=yearly&source=pricing');
    expect(checkoutTargetFromAuthSearch('', ORIGIN, '#/?redirect_url=https%3A%2F%2Fevil.com%2Fpricing%3Fcheckout%3Dstarter')).toBeNull();
  });

  it('o storage guarda a intencao por 30 min e depois esquece', () => {
    const intent = { plan: 'starter', cycle: 'yearly', source: 'pricing' } as const;
    saveCheckoutIntent(intent, 1_000);

    expect(loadCheckoutIntent(1_000 + CHECKOUT_INTENT_TTL_MS - 1)).toEqual(intent);
    expect(loadCheckoutIntent(1_000 + CHECKOUT_INTENT_TTL_MS + 1)).toBeNull();
    expect(loadCheckoutIntent(1_000)).toBeNull(); // expirada ja foi apagada
  });

  it('o destino montado e sempre o mesmo caminho interno', () => {
    expect(checkoutReturnPath({ plan: 'starter', cycle: 'monthly', source: 'pricing' })).toBe(
      '/dashboard/plans?checkout=starter&cycle=monthly&source=pricing',
    );
  });
  describe('oferta Founding Member', () => {
    const CODE = 'FND-ABCD2345';

    it('o codigo viaja na URL de volta do login e na intencao guardada, sempre no mensal', () => {
      expect(parseCheckoutIntent(`?checkout=starter&cycle=yearly&source=pricing&offer=${CODE}`)).toEqual({
        plan: 'starter', cycle: 'monthly', source: 'pricing', offer: CODE,
      });
      const intent = { plan: 'starter', cycle: 'monthly', source: 'pricing', offer: CODE } as const;
      expect(checkoutReturnPath(intent)).toBe(`/dashboard/plans?checkout=starter&cycle=monthly&source=pricing&offer=${CODE}`);
      saveCheckoutIntent(intent, 1_000);
      expect(loadCheckoutIntent(1_001)).toEqual(intent);
    });

    it('codigo fora do formato some, e o resto da intencao continua igual', () => {
      for (const bad of ['EARLY35', 'fnd-abcd2345', 'FND-ABCD234', 'FND-ABCD23456', 'FND-ABCD234!', '']) {
        expect(parseCheckoutIntent(`?checkout=starter&cycle=yearly&source=pricing&offer=${bad}`)).toEqual({
          plan: 'starter', cycle: 'yearly', source: 'pricing',
        });
      }
    });

    it('o redirect do login preserva o codigo e continua recusando destino de fora', () => {
      const target = `/dashboard/plans?checkout=starter&cycle=monthly&source=pricing&offer=${CODE}`;
      expect(checkoutTargetFromAuthSearch(`?redirect_url=${encodeURIComponent(target)}`, ORIGIN)).toBe(target);
      expect(checkoutTargetFromAuthSearch(`?redirect_url=${encodeURIComponent(`https://evil.com${target}`)}`, ORIGIN)).toBeNull();
    });
  });
});
