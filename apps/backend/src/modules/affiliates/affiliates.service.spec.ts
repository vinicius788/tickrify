import { BadRequestException, ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { AffiliatesService, addMonths, commissionFor } from './affiliates.service';
import { AffiliatesAdminController } from './affiliates-admin.controller';
import { AdminGuard } from '../auth/admin.guard';
import { AuthGuard } from '../auth/auth.guard';
import { AdminUpdateAffiliateDto, ClaimAffiliateDto, JoinAffiliateDto, RequestPayoutDto } from './dto/affiliates.dto';
import { CreateCheckoutSessionDto } from '../payments/dto/create-checkout-session.dto';
import { captureServer } from '../../common/analytics/posthog';

jest.mock('../../common/analytics/posthog', () => ({ captureServer: jest.fn() }));

// ── Prisma em memoria: so o que o servico usa, com chave unica de verdade ────

type Row = Record<string, any>;
const UNIQUE: Record<string, string[]> = {
  user: ['id'],
  subscription: ['id'],
  affiliate: ['id', 'userId', 'referralCode', 'couponCode', 'stripePromotionCodeId'],
  affiliateClick: ['id'],
  affiliateReferral: ['id', 'userId'],
  affiliateCommission: ['id', 'stripeInvoiceId'],
  affiliatePayout: ['id'],
  adminAudit: ['id'],
};

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(value);
      if ('not' in cond) return cond.not === null ? value != null : value !== cond.not;
      if ('lte' in cond) return value != null && value <= cond.lte;
      if ('startsWith' in cond) return typeof value === 'string' && value.startsWith(cond.startsWith);
    }
    return value === cond;
  });
}

function fakePrisma() {
  const db: Record<string, Row[]> = Object.fromEntries(Object.keys(UNIQUE).map((k) => [k, []]));
  let seq = 0;
  const id = () => `c${String(++seq).padStart(24, '0')}`;

  const withInclude = (model: string, row: Row | undefined, include?: Row) => {
    if (!row) return null;
    const out: Row = { ...row };
    if (include?.user) out.user = db.user.find((u) => u.id === row.userId) ?? null;
    if (include?.affiliate) out.affiliate = db.affiliate.find((a) => a.id === row.affiliateId) ?? null;
    if (include?._count) {
      const related: Record<string, string> = { clicks: 'affiliateClick', referrals: 'affiliateReferral' };
      out._count = Object.fromEntries(
        Object.keys(include._count.select).map((k) => [k, db[related[k]].filter((r) => r.affiliateId === row.id).length]),
      );
    }
    return out;
  };

  const model = (name: string) => ({
    findUnique: async ({ where, include }: Row) => withInclude(name, db[name].find((r) => matches(r, where)), include),
    findFirst: async ({ where, include }: Row = {}) => withInclude(name, db[name].find((r) => matches(r, where)), include),
    findMany: async ({ where, select, include }: Row = {}) =>
      db[name]
        .filter((r) => matches(r, where))
        .map((r) =>
          select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : include ? withInclude(name, r, include) : { ...r },
        ),
    count: async ({ where }: Row = {}) => db[name].filter((r) => matches(r, where)).length,
    create: async ({ data }: Row) => {
      const row: Row = { id: id(), createdAt: new Date(), updatedAt: new Date(), ...data };
      if (name === 'affiliate') { row.stripePromotionCodeId ??= null; row.status ??= 'PENDING'; }
      if (name === 'affiliateCommission') row.payoutId ??= null;
      if (name === 'affiliatePayout') row.status ??= 'REQUESTED';
      if (name === 'affiliateReferral') { row.firstPaidAt ??= null; row.commissionEndsAt ??= null; }
      for (const field of UNIQUE[name]) {
        if (row[field] != null && db[name].some((r) => r[field] === row[field])) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        }
      }
      db[name].push(row);
      return { ...row };
    },
    update: async ({ where, data }: Row) => {
      const row = db[name].find((r) => matches(r, where));
      if (!row) throw new Error(`${name} not found`);
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
    updateMany: async ({ where, data }: Row) => {
      const rows = db[name].filter((r) => matches(r, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    aggregate: async ({ where, _sum }: Row) => {
      const rows = db[name].filter((r) => matches(r, where));
      return { _sum: Object.fromEntries(Object.keys(_sum).map((f) => [f, rows.length ? rows.reduce((a, r) => a + r[f], 0) : null])) };
    },
    groupBy: async ({ by, where, _sum }: Row) => {
      const groups = new Map<string, Row[]>();
      for (const r of db[name].filter((x) => matches(x, where))) {
        const key = JSON.stringify(by.map((b: string) => r[b]));
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      return [...groups.values()].map((rows) => ({
        ...Object.fromEntries(by.map((b: string) => [b, rows[0][b]])),
        _sum: Object.fromEntries(Object.keys(_sum).map((f) => [f, rows.reduce((a, r) => a + r[f], 0)])),
      }));
    },
  });

  const prisma: any = Object.fromEntries(Object.keys(UNIQUE).map((k) => [k, model(k)]));
  prisma.$executeRawUnsafe = jest.fn();
  prisma.$transaction = async (fn: (tx: any) => Promise<unknown>) => fn(prisma);
  return { prisma, db };
}

// ── Cenario ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-09-26T12:00:00Z');
/** Pedido de entrada valido (o que o formulario manda). */
const APP = {
  platform: 'youtube',
  url: 'https://youtube.com/@tradercanal',
  audience: '10k_50k',
  note: 'Canal de price action, 2 lives por semana analisando ouro.',
};
const DAY = 24 * 60 * 60 * 1000;

describe('AffiliatesService', () => {
  let service: AffiliatesService;
  let db: Record<string, Row[]>;
  let prisma: any;
  let stripe: any;

  const seedUser = (id: string, email: string | null = `${id}@mail.com`) =>
    db.user.push({ id, email, clerkUserId: `clerk_${id}` });

  /** Pede entrada e o admin aprova (novo afiliado nasce PENDING). */
  const joinApproved = async (userId: string) => {
    const affiliate = await service.join(userId, APP);
    await service.adminUpdate(affiliate.id, { status: 'ACTIVE' }, 'admin_1');
    return db.affiliate.find((a) => a.id === affiliate.id)!;
  };

  /** Afiliado aprovado `partner` (codigo PARTNER1, cupom SAVE10) e o cliente `buyer`. */
  const setup = async () => {
    seedUser('partner');
    seedUser('buyer');
    const affiliate = await joinApproved('partner');
    await service.adminUpdate(affiliate.id, { referralCode: 'PARTNER1', couponCode: 'SAVE10' }, 'admin_1');
    return db.affiliate[0];
  };

  const clickAt = (affiliateId: string, date: Date) => {
    const row = { id: `click${db.affiliateClick.length}xxxxxxxxxxxxxxx`, affiliateId, landingPath: '/', createdAt: date };
    db.affiliateClick.push(row);
    return row.id;
  };

  /** Fatura como a Stripe devolve no SDK (2023-10-16). */
  const stripeInvoice = (over: Row = {}) => ({
    id: 'in_1',
    status: 'paid',
    currency: 'usd',
    amount_paid: 2610,
    tax: null,
    created: Math.floor(NOW.getTime() / 1000),
    status_transitions: { paid_at: Math.floor(NOW.getTime() / 1000) },
    charge: 'ch_1',
    payment_intent: 'pi_1',
    discounts: [],
    billing_reason: 'subscription_create',
    ...over,
  });

  const pay = async (over: Row = {}) => {
    const inv = stripeInvoice(over);
    stripe.invoices.retrieve.mockResolvedValueOnce(inv);
    await service.recordInvoiceCommission(inv as any, 'buyer');
    return inv;
  };

  beforeEach(() => {
    delete process.env.STRIPE_AFFILIATE_COUPON_ID;
    ({ prisma, db } = fakePrisma());
    service = new AffiliatesService(prisma);
    stripe = {
      invoices: { retrieve: jest.fn() },
      charges: { retrieve: jest.fn() },
      coupons: { retrieve: jest.fn() },
      promotionCodes: {
        create: jest.fn(async (p: Row) => ({ id: `promo_${p.code}`, code: p.code, active: p.active })),
        retrieve: jest.fn(),
        update: jest.fn(),
      },
    };
    (service as any).stripe = stripe;
  });

  describe('dinheiro', () => {
    it('exemplo do programa: US$ 26,10 pagos a 20% = US$ 5,22, em centavos inteiros', () => {
      expect(commissionFor(2610, 2000)).toBe(522);
      expect(commissionFor(2900, 2000)).toBe(580);
      // Arredonda para BAIXO: nunca paga centavo que nao existe.
      expect(commissionFor(1885, 2000)).toBe(377);
      expect(commissionFor(0, 2000)).toBe(0);
      expect(commissionFor(26.1 as number, 2000)).toBe(0);
    });
  });

  describe('referral (link)', () => {
    it('clique valido grava e devolve o id; codigo desconhecido nao grava nada', async () => {
      const aff = await setup();
      await expect(service.recordClick('partner1', '/pricing')).resolves.toEqual({ valid: true, clickId: expect.any(String) });
      await expect(service.recordClick('NOPE99')).resolves.toEqual({ valid: false });
      expect(db.affiliateClick.filter((c) => c.affiliateId === aff.id)).toHaveLength(1);
    });

    it('mesmo aparelho no mesmo dia conta UM clique; outro dia ou outro aparelho conta outro', async () => {
      (captureServer as jest.Mock).mockClear();
      const aff = await setup();
      const phone = { ip: '200.1.2.3', userAgent: 'Mobile Safari' };
      const first = await service.recordClick('PARTNER1', '/', phone, NOW);
      const again = await service.recordClick('PARTNER1', '/pricing', phone, new Date(NOW.getTime() + 60_000));
      expect(again.clickId).toBe(first.clickId);
      await service.recordClick('PARTNER1', '/', { ip: '200.1.2.4', userAgent: 'Mobile Safari' }, NOW);
      await service.recordClick('PARTNER1', '/', phone, new Date(NOW.getTime() + DAY));
      expect(db.affiliateClick.filter((c) => c.affiliateId === aff.id)).toHaveLength(3);
      // O id de clique continua passando no DTO do claim.
      const dto = await new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }).transform(
        { code: 'PARTNER1', kind: 'link', clickId: first.clickId },
        { type: 'body', metatype: ClaimAffiliateDto },
      );
      expect(dto.clickId).toBe(first.clickId);
      // Repeticao nao vira outro affiliate_link_visited.
      const visits = (captureServer as jest.Mock).mock.calls.filter((c) => c[1] === 'affiliate_link_visited');
      expect(visits).toHaveLength(3);
      expect(visits[0][2]).toMatchObject({ code: 'PARTNER1', $process_person_profile: false });
    });

    it('link dentro de 30 dias vincula o usuario', async () => {
      const aff = await setup();
      const clickId = clickAt(aff.id, new Date(NOW.getTime() - 29 * DAY));
      await expect(service.claim('buyer', { code: 'PARTNER1', kind: 'link', clickId }, NOW)).resolves.toEqual({ attributed: true });
      expect(db.affiliateReferral[0]).toMatchObject({ affiliateId: aff.id, userId: 'buyer', source: 'link' });
    });

    it('clique com mais de 30 dias nao vincula (janela no servidor)', async () => {
      const aff = await setup();
      const clickId = clickAt(aff.id, new Date(NOW.getTime() - 31 * DAY));
      await expect(service.claim('buyer', { code: 'PARTNER1', kind: 'link', clickId }, NOW)).resolves.toEqual({
        attributed: false,
        reason: 'expired',
      });
      expect(db.affiliateReferral).toHaveLength(0);
    });

    it('clique de outro afiliado nao serve para este codigo', async () => {
      await setup();
      seedUser('other');
      const other = await joinApproved('other');
      const clickId = clickAt(other.id, NOW);
      await expect(service.claim('buyer', { code: 'PARTNER1', kind: 'link', clickId }, NOW)).resolves.toMatchObject({ attributed: false });
    });

    it('ultimo link valido vence enquanto nao houve pagamento', async () => {
      const first = await setup();
      seedUser('other');
      const second = await joinApproved('other');
      await service.claim('buyer', { code: 'PARTNER1', kind: 'link', clickId: clickAt(first.id, NOW) }, NOW);
      await service.claim('buyer', { code: second.referralCode, kind: 'link', clickId: clickAt(second.id, NOW) }, NOW);
      expect(db.affiliateReferral).toHaveLength(1);
      expect(db.affiliateReferral[0].affiliateId).toBe(second.id);
    });

    it('afiliado suspenso nao vincula', async () => {
      const aff = await setup();
      await service.adminUpdate(aff.id, { status: 'SUSPENDED' }, 'admin_1');
      await expect(service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW)).resolves.toEqual({
        attributed: false,
        reason: 'invalid_code',
      });
    });

    it('quem ja era cliente pagante antes da indicacao nao e atribuido', async () => {
      await setup();
      db.subscription.push({ id: 's1', userId: 'buyer', stripeId: 'sub_old' });
      await expect(service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW)).resolves.toEqual({
        attributed: false,
        reason: 'existing_customer',
      });
    });
  });

  describe('cupom', () => {
    it('cupom tem prioridade: substitui o link e um link novo nao desfaz o cupom', async () => {
      const first = await setup();
      seedUser('other');
      const second = await joinApproved('other');

      await service.claim('buyer', { code: 'PARTNER1', kind: 'link', clickId: clickAt(first.id, NOW) }, NOW);
      await service.claim('buyer', { code: second.couponCode, kind: 'coupon' }, NOW);
      expect(db.affiliateReferral[0]).toMatchObject({ affiliateId: second.id, source: 'coupon' });

      const res = await service.claim('buyer', { code: 'PARTNER1', kind: 'link', clickId: clickAt(first.id, NOW) }, NOW);
      expect(res).toEqual({ attributed: false, reason: 'coupon_priority' });
      expect(db.affiliateReferral[0].affiliateId).toBe(second.id);
    });

    it('promotion code do afiliado na fatura da Stripe atribui mesmo sem vinculo previo', async () => {
      const aff = await setup();
      db.affiliate[0].stripePromotionCodeId = 'promo_SAVE10';
      await pay({ discounts: [{ id: 'di_1', promotion_code: 'promo_SAVE10' }] });
      expect(db.affiliateReferral[0]).toMatchObject({ affiliateId: aff.id, source: 'coupon' });
      expect(db.affiliateCommission).toHaveLength(1);
    });

    it('checkout: desconto so para indicado que ainda nao pagou, e so com cupom configurado', async () => {
      const aff = await setup();
      await service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW);
      await expect(service.checkoutDiscountFor('buyer')).resolves.toBeNull();

      process.env.STRIPE_AFFILIATE_COUPON_ID = 'AFF10';
      await expect(service.checkoutDiscountFor('buyer')).resolves.toEqual({ affiliateId: aff.id, discount: { coupon: 'AFF10' } });

      db.affiliate[0].stripePromotionCodeId = 'promo_SAVE10';
      await expect(service.checkoutDiscountFor('buyer')).resolves.toEqual({
        affiliateId: aff.id,
        discount: { promotion_code: 'promo_SAVE10' },
      });

      await pay();
      await expect(service.checkoutDiscountFor('buyer')).resolves.toBeNull();
    });

    it('afiliado aprovado ANTES do cupom existir ganha o codigo na Stripe no boot, uma vez so', async () => {
      seedUser('partner');
      const aff = await service.join('partner', APP);
      db.affiliate[0].status = 'ACTIVE';
      // Sem cupom configurado: nada acontece.
      await expect(service.syncMissingPromotionCodes()).resolves.toBe(0);
      expect(stripe.promotionCodes.create).not.toHaveBeenCalled();

      process.env.STRIPE_AFFILIATE_COUPON_ID = 'AFF10';
      await expect(service.syncMissingPromotionCodes()).resolves.toBe(1);
      expect(stripe.promotionCodes.create).toHaveBeenCalledWith(
        expect.objectContaining({ coupon: 'AFF10', code: aff.couponCode, active: true }),
      );
      expect(db.affiliate[0].stripePromotionCodeId).toBe(`promo_${aff.couponCode}`);

      // Segunda vez: ja tem codigo, nao cria de novo.
      await expect(service.syncMissingPromotionCodes()).resolves.toBe(0);
      expect(stripe.promotionCodes.create).toHaveBeenCalledTimes(1);
    });

    it('com cupom configurado, entrar no programa cria o promotion code (1o pagamento, metadata do afiliado)', async () => {
      process.env.STRIPE_AFFILIATE_COUPON_ID = 'AFF10';
      seedUser('partner');
      const aff = await service.join('partner', APP);
      expect(stripe.promotionCodes.create).toHaveBeenCalledWith(
        expect.objectContaining({
          coupon: 'AFF10',
          code: aff.couponCode,
          metadata: { affiliateId: aff.id },
          restrictions: { first_time_transaction: true },
          // Nasce PENDING: o codigo so vale depois da aprovacao.
          active: false,
        }),
      );
      expect(db.affiliate[0].stripePromotionCodeId).toBe(`promo_${aff.couponCode}`);
    });
  });

  describe('self-referral', () => {
    it('o proprio afiliado nao se indica (link, cupom e na fatura)', async () => {
      const aff = await setup();
      await expect(service.claim('partner', { code: 'SAVE10', kind: 'coupon' }, NOW)).resolves.toEqual({
        attributed: false,
        reason: 'self_referral',
      });
      await expect(
        service.claim('partner', { code: 'PARTNER1', kind: 'link', clickId: clickAt(aff.id, NOW) }, NOW),
      ).resolves.toMatchObject({ reason: 'self_referral' });

      db.affiliate[0].stripePromotionCodeId = 'promo_SAVE10';
      const inv = stripeInvoice({ discounts: [{ id: 'di', promotion_code: 'promo_SAVE10' }] });
      stripe.invoices.retrieve.mockResolvedValueOnce(inv);
      await service.recordInvoiceCommission(inv as any, 'partner');
      expect(db.affiliateCommission).toHaveLength(0);
    });

    it('segunda conta com o MESMO e-mail do afiliado tambem e self-referral', async () => {
      await setup();
      seedUser('alt', 'PARTNER@mail.com');
      await expect(service.claim('alt', { code: 'SAVE10', kind: 'coupon' }, NOW)).resolves.toMatchObject({
        reason: 'self_referral',
      });
    });
  });

  describe('comissao', () => {
    beforeEach(async () => {
      await setup();
      await service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW);
    });

    it('cancelou e assinou de novo: a assinatura nova nao gera comissao', async () => {
      db.subscription.push({ id: 's_old', userId: 'buyer', stripeId: 'sub_old', status: 'canceled' });
      await pay({ id: 'in_new', subscription: 'sub_new' });
      expect(db.affiliateCommission).toHaveLength(0);
    });

    it('renovacao da MESMA assinatura segue gerando comissao', async () => {
      db.subscription.push({ id: 's_1', userId: 'buyer', stripeId: 'sub_1', status: 'active' });
      await pay({ id: 'in_1', subscription: 'sub_1' });
      expect(db.affiliateCommission).toHaveLength(1);
    });

    it('fatura paga cria comissao PENDING pelo valor REALMENTE pago, relido na Stripe', async () => {
      // O payload do webhook mente 9999: vale o que a API da Stripe devolve.
      stripe.invoices.retrieve.mockResolvedValueOnce(stripeInvoice());
      await service.recordInvoiceCommission({ id: 'in_1', billing_reason: 'subscription_create', amount_paid: 9999 } as any, 'buyer');

      expect(db.affiliateCommission[0]).toMatchObject({
        amountPaidCents: 2610,
        commissionCents: 522,
        rateBps: 2000,
        status: 'PENDING',
        stripeChargeId: 'ch_1',
        stripePaymentIntentId: 'pi_1',
        availableAt: new Date(NOW.getTime() + 30 * DAY),
      });
      expect(db.affiliateReferral[0]).toMatchObject({ firstPaidAt: NOW, commissionEndsAt: addMonths(NOW, 12) });
    });

    it('imposto nao entra na base da comissao', async () => {
      await pay({ amount_paid: 3190, tax: 580 });
      expect(db.affiliateCommission[0]).toMatchObject({ amountPaidCents: 2610, commissionCents: 522 });
    });

    it('taxa individual do parceiro vale para as proximas faturas', async () => {
      await service.adminUpdate(db.affiliate[0].id, { commissionRateBps: 3000 }, 'admin_1');
      await pay({ amount_paid: 2900 });
      expect(db.affiliateCommission[0]).toMatchObject({ commissionCents: 870, rateBps: 3000 });
    });

    it('fatura em outra moeda usa o valor liquidado em USD pela Stripe', async () => {
      stripe.charges.retrieve.mockResolvedValue({ balance_transaction: { currency: 'usd', amount: 2610 } });
      await pay({ currency: 'brl', amount_paid: 14000 });
      expect(db.affiliateCommission[0]).toMatchObject({ amountPaidCents: 2610, commissionCents: 522 });
    });

    it('sem como converter para USD: nada de comissao chutada, vai para revisao', async () => {
      stripe.charges.retrieve.mockResolvedValue({ balance_transaction: { currency: 'brl', amount: 14000 } });
      await pay({ currency: 'brl', amount_paid: 14000 });
      expect(db.affiliateCommission).toHaveLength(0);
      expect(db.adminAudit.some((a) => a.action === 'affiliate_commission_review')).toBe(true);
    });

    it('troca de plano, fatura zerada e fatura nao paga nao geram comissao', async () => {
      await service.recordInvoiceCommission({ id: 'in_u', billing_reason: 'subscription_update', amount_paid: 500 } as any, 'buyer');
      await service.recordInvoiceCommission({ id: 'in_z', billing_reason: 'subscription_cycle', amount_paid: 0 } as any, 'buyer');
      await pay({ id: 'in_open', status: 'open' });
      expect(db.affiliateCommission).toHaveLength(0);
    });

    it('afiliado suspenso nao recebe comissao nova', async () => {
      await service.adminUpdate(db.affiliate[0].id, { status: 'SUSPENDED' }, 'admin_1');
      await pay();
      expect(db.affiliateCommission).toHaveLength(0);
    });

    it('usuario sem indicacao nao gera nada', async () => {
      seedUser('organic');
      const inv = stripeInvoice({ id: 'in_org' });
      stripe.invoices.retrieve.mockResolvedValueOnce(inv);
      await service.recordInvoiceCommission(inv as any, 'organic');
      expect(db.affiliateCommission).toHaveLength(0);
    });
  });

  describe('renovacao', () => {
    beforeEach(async () => {
      await setup();
      await service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW);
      await pay(); // 1o pagamento, com desconto
    });

    const at = (date: Date) => Math.floor(date.getTime() / 1000);

    it('renovacoes dentro de 12 meses geram comissao recorrente sobre o valor cheio', async () => {
      await pay({ id: 'in_2', billing_reason: 'subscription_cycle', amount_paid: 2900, status_transitions: { paid_at: at(addMonths(NOW, 1)) } });
      await pay({ id: 'in_12', billing_reason: 'subscription_cycle', amount_paid: 2900, status_transitions: { paid_at: at(addMonths(NOW, 11)) } });
      expect(db.affiliateCommission.map((c) => c.commissionCents)).toEqual([522, 580, 580]);
    });

    it('depois de 12 meses do 1o pagamento, acabou', async () => {
      await pay({ id: 'in_13', billing_reason: 'subscription_cycle', amount_paid: 2900, status_transitions: { paid_at: at(addMonths(NOW, 12)) } });
      expect(db.affiliateCommission).toHaveLength(1);
    });

    it('vinculo trava no pagamento: outro cupom depois nao rouba o cliente', async () => {
      seedUser('other');
      const other = await joinApproved('other');
      await expect(service.claim('buyer', { code: other.couponCode, kind: 'coupon' }, NOW)).resolves.toEqual({
        attributed: false,
        reason: 'already_converted',
      });
    });
  });

  describe('duplicidade', () => {
    it('mesma fatura duas vezes (reenvio do webhook) cria UMA comissao', async () => {
      await setup();
      await service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW);
      await pay();
      await pay();
      expect(db.affiliateCommission).toHaveLength(1);
      // A 2a entrega nem relê a Stripe.
      expect(stripe.invoices.retrieve).toHaveBeenCalledTimes(1);
    });

    it('corrida que escapa da leitura bate na chave unica e nao falha', async () => {
      await setup();
      await service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW);
      const inv = stripeInvoice();
      stripe.invoices.retrieve.mockResolvedValue(inv);
      await Promise.all([
        service.recordInvoiceCommission(inv as any, 'buyer'),
        service.recordInvoiceCommission(inv as any, 'buyer'),
      ]);
      expect(db.affiliateCommission).toHaveLength(1);
    });
  });

  describe('refund e disputa', () => {
    beforeEach(async () => {
      await setup();
      await service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW);
      await pay();
    });

    it('refund cancela comissao PENDING', async () => {
      await expect(service.cancelForCharge({ chargeId: 'ch_1' }, 'refund')).resolves.toBe(1);
      expect(db.affiliateCommission[0]).toMatchObject({ status: 'CANCELLED', cancelledReason: 'refund' });
    });

    it('disputa acha a comissao pelo payment intent e cancela mesmo AVAILABLE', async () => {
      await service.releaseMatured(new Date(NOW.getTime() + 31 * DAY));
      expect(db.affiliateCommission[0].status).toBe('AVAILABLE');
      await service.cancelForCharge({ paymentIntentId: 'pi_1' }, 'dispute');
      expect(db.affiliateCommission[0]).toMatchObject({ status: 'CANCELLED', cancelledReason: 'dispute' });
    });

    it('comissao ja PAGA nao muda: fica registro para estorno manual', async () => {
      db.affiliateCommission[0].status = 'PAID';
      await expect(service.cancelForCharge({ chargeId: 'ch_1' }, 'refund')).resolves.toBe(0);
      expect(db.affiliateCommission[0].status).toBe('PAID');
      expect(db.adminAudit.some((a) => a.action === 'affiliate_commission_clawback')).toBe(true);
    });

    it('refund de charge desconhecida nao mexe em nada', async () => {
      await expect(service.cancelForCharge({ chargeId: 'ch_other' }, 'refund')).resolves.toBe(0);
      expect(db.affiliateCommission[0].status).toBe('PENDING');
    });
  });

  describe('payout', () => {
    const LATER = new Date(NOW.getTime() + 31 * DAY);
    const at = (date: Date) => Math.floor(date.getTime() / 1000);

    /** N faturas de US$ 29 (580c de comissao cada), todas pagas em NOW. */
    const earn = async (n: number) => {
      await setup();
      await service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW);
      for (let i = 0; i < n; i++) {
        await pay({ id: `in_${i}`, amount_paid: 2900, billing_reason: i ? 'subscription_cycle' : 'subscription_create', status_transitions: { paid_at: at(NOW) } });
      }
    };

    it('venda paga emite affiliate_sale_paid com o codigo e a comissao pela taxa do afiliado', async () => {
      (captureServer as jest.Mock).mockClear();
      await earn(1);
      const sale = (captureServer as jest.Mock).mock.calls.find((c) => c[1] === 'affiliate_sale_paid');
      expect(sale?.[0]).toBe('clerk_buyer');
      expect(sale?.[2]).toMatchObject({ code: 'PARTNER1', amount_usd: 29, commission_usd: 5.8, rate_percent: 20 });
      const signup = (captureServer as jest.Mock).mock.calls.find((c) => c[1] === 'affiliate_signup');
      expect(signup?.[2]).toMatchObject({ code: 'PARTNER1', source: 'coupon' });
    });

    it('marcar como pago no admin fecha so o disponivel, sem minimo e sem pedido do afiliado', async () => {
      await earn(2); // 2 x 5,80, abaixo do minimo de saque
      await expect(service.adminSettle(db.affiliate[0].id, 'admin_1', 'pix', NOW)).rejects.toBeInstanceOf(BadRequestException);
      const payout = await service.adminSettle(db.affiliate[0].id, 'admin_1', 'pix e2e', LATER);
      expect(payout).toMatchObject({ amountCents: 1160, status: 'PAID', method: 'manual (pix)' });
      expect(db.affiliateCommission.every((c) => c.status === 'PAID' && c.payoutId === payout.id)).toBe(true);
      await expect(service.adminSettle(db.affiliate[0].id, 'admin_1', undefined, LATER)).rejects.toBeInstanceOf(BadRequestException);
      const list = await service.adminList(LATER);
      expect(list[0]).toMatchObject({ paidSales: 2, paidCustomers: 1, paidCents: 1160, availableCents: 0 });
    });

    it('PENDING vira AVAILABLE so depois de 30 dias', async () => {
      await earn(1);
      await service.releaseMatured(new Date(NOW.getTime() + 29 * DAY));
      expect(db.affiliateCommission[0].status).toBe('PENDING');
      await service.releaseMatured(LATER);
      expect(db.affiliateCommission[0].status).toBe('AVAILABLE');
    });

    it('abaixo de US$ 50 disponiveis o saque e recusado', async () => {
      await earn(8); // 8 x 5,80 = 46,40
      await expect(service.requestPayout('partner', 'PayPal: p@mail.com', LATER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('saldo pendente nao conta para o minimo', async () => {
      await earn(9);
      await expect(service.requestPayout('partner', 'PayPal: p@mail.com', NOW)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('fluxo completo: pedido -> aprovado -> pago, com valor calculado no servidor', async () => {
      await earn(9); // 52,20
      const payout = await service.requestPayout('partner', 'PayPal: p@mail.com', LATER);
      expect(payout.amountCents).toBe(5220);
      expect(db.affiliateCommission.every((c) => c.payoutId === payout.id)).toBe(true);

      // Um pedido aberto por vez.
      await expect(service.requestPayout('partner', 'PayPal: p@mail.com', LATER)).rejects.toBeInstanceOf(ConflictException);
      // Pagar sem aprovar nao pode.
      await expect(service.adminDecidePayout(payout.id, 'mark_paid', 'admin_1')).rejects.toBeInstanceOf(ConflictException);

      await service.adminDecidePayout(payout.id, 'approve', 'admin_1');
      const paid = await service.adminDecidePayout(payout.id, 'mark_paid', 'admin_1', 'PayPal tx 123');
      expect(paid).toMatchObject({ status: 'PAID', amountCents: 5220, adminNote: 'PayPal tx 123' });
      expect(db.affiliateCommission.every((c) => c.status === 'PAID')).toBe(true);

      // Clique duplo no "pago" nao paga de novo.
      await expect(service.adminDecidePayout(payout.id, 'mark_paid', 'admin_1')).rejects.toBeInstanceOf(ConflictException);

      const dash = await service.getDashboard('partner', LATER);
      expect(dash.balances).toMatchObject({ paidCents: 5220, availableCents: 0, pendingCents: 0, totalEarnedCents: 5220 });
      expect(db.adminAudit.filter((a) => a.action.startsWith('affiliate_payout_'))).toHaveLength(2);
    });

    it('rejeitar devolve as comissoes ao saldo disponivel', async () => {
      await earn(9);
      const payout = await service.requestPayout('partner', 'PayPal: p@mail.com', LATER);
      await service.adminDecidePayout(payout.id, 'reject', 'admin_1', 'dados incompletos');
      expect(db.affiliateCommission.every((c) => c.status === 'AVAILABLE' && c.payoutId === null)).toBe(true);
      const dash = await service.getDashboard('partner', LATER);
      expect(dash.balances!.availableCents).toBe(5220);
      expect(dash.canRequestPayout).toBe(true);
    });

    it('refund no meio do pedido: o pagamento sai sem a comissao cancelada', async () => {
      await earn(10);
      const payout = await service.requestPayout('partner', 'PayPal: p@mail.com', LATER);
      db.affiliateCommission[0].stripeChargeId = 'ch_refunded';
      await service.cancelForCharge({ chargeId: 'ch_refunded' }, 'refund');
      await service.adminDecidePayout(payout.id, 'approve', 'admin_1');
      const paid = await service.adminDecidePayout(payout.id, 'mark_paid', 'admin_1');
      expect(paid!.amountCents).toBe(5220);
    });

    it('afiliado suspenso nao pede saque', async () => {
      await earn(9);
      await service.adminUpdate(db.affiliate[0].id, { status: 'SUSPENDED' }, 'admin_1');
      await expect(service.requestPayout('partner', 'PayPal: p@mail.com', LATER)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('painel', () => {
    it('mostra numeros do afiliado sem expor e-mail do cliente indicado', async () => {
      const aff = await setup();
      clickAt(aff.id, NOW);
      await service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW);
      await pay();
      const dash = await service.getDashboard('partner', NOW);
      expect(dash.affiliate).toMatchObject({ referralCode: 'PARTNER1', couponCode: 'SAVE10', commissionPercent: 20 });
      // So a propria taxa: nada de taxa de outro parceiro no painel.
      expect(JSON.stringify(dash)).not.toMatch(/commissionRateBps|4000|"rateBps"/);
      expect(dash.stats).toEqual({ clicks: 1, signups: 1, paidCustomers: 1, revenueCents: 2610 });
      expect(dash.balances).toMatchObject({ pendingCents: 522, availableCents: 0, totalEarnedCents: 522 });
      expect(JSON.stringify(dash.commissions)).not.toContain('buyer@mail.com');
    });

    it('pagina publica nao expoe nenhuma taxa de comissao (nem a padrao, nem a especial)', async () => {
      const aff = await setup();
      await service.adminUpdate(aff.id, { commissionRateBps: 4000 }, 'admin_1');
      const program = await service.getProgram();
      expect(Object.keys(program)).not.toEqual(expect.arrayContaining(['commissionPercent']));
      expect(JSON.stringify(program)).not.toMatch(/commission(Percent|Rate)|2000|4000|"20"|"40"/);
    });

    it('cada afiliado ve so a propria taxa', async () => {
      const aff = await setup();
      seedUser('other');
      const other = await joinApproved('other');
      await service.adminUpdate(other.id, { commissionRateBps: 3000 }, 'admin_1');
      await service.adminUpdate(aff.id, { commissionRateBps: 2500 }, 'admin_1');
      expect((await service.getDashboard('partner', NOW)).affiliate).toMatchObject({ commissionPercent: 25 });
      expect((await service.getDashboard('other', NOW)).affiliate).toMatchObject({ commissionPercent: 30 });
    });

    it('o pedido guarda canal, link, audiencia e plano, e o admin ve tudo', async () => {
      seedUser('partner');
      await service.join('partner', APP);
      expect(db.affiliate[0]).toMatchObject({
        status: 'PENDING',
        applicationPlatform: 'youtube',
        applicationUrl: 'https://youtube.com/@tradercanal',
        applicationAudience: '10k_50k',
        applicationNote: APP.note,
      });
      db.affiliate[0].user = undefined;
      prisma.affiliate.findMany = async () =>
        db.affiliate.map((a) => ({ ...a, user: { email: 'partner@mail.com' }, _count: { clicks: 0, referrals: 0 } }));
      prisma.affiliateCommission.groupBy = async () => [];
      const [row] = await service.adminList(NOW);
      expect(row.application).toEqual({
        platform: 'youtube',
        url: 'https://youtube.com/@tradercanal',
        audience: '10k_50k',
        note: APP.note,
      });
    });

    it('entrar duas vezes devolve o mesmo perfil', async () => {
      seedUser('partner');
      const a = await service.join('partner', APP);
      const b = await service.join('partner', APP);
      expect(a.id).toBe(b.id);
      expect(db.affiliate).toHaveLength(1);
    });
  });

  describe('aprovacao manual', () => {
    const tryPay = async () => {
      await service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW);
      await pay();
    };
    /** Afiliado com codigos conhecidos, NAO aprovado. */
    const pendingPartner = async () => {
      seedUser('partner');
      seedUser('buyer');
      const aff = await service.join('partner', APP);
      db.affiliate[0].referralCode = 'PARTNER1';
      db.affiliate[0].couponCode = 'SAVE10';
      return aff;
    };

    it('novo afiliado entra como PENDING e o painel so diz que esta em analise', async () => {
      await pendingPartner();
      expect(db.affiliate[0].status).toBe('PENDING');
      const dash = await service.getDashboard('partner', NOW);
      expect(dash.affiliate).toEqual({ status: 'PENDING', joinedAt: expect.any(Date) });
      expect(JSON.stringify(dash)).not.toMatch(/SAVE10|PARTNER1|commissionPercent/);
    });

    it('PENDING nao registra clique, nao atribui e nao gera comissao', async () => {
      await pendingPartner();
      await expect(service.recordClick('PARTNER1')).resolves.toEqual({ valid: false });
      await expect(service.isCouponValid('SAVE10')).resolves.toBe(false);
      await tryPay();
      expect(db.affiliateReferral).toHaveLength(0);
      expect(db.affiliateCommission).toHaveLength(0);
    });

    it('admin aprova PENDING -> ACTIVE e ai a comissao sai normalmente', async () => {
      const aff = await pendingPartner();
      await service.adminUpdate(aff.id, { status: 'ACTIVE' }, 'admin_1');
      expect(db.affiliate[0].status).toBe('ACTIVE');
      await tryPay();
      expect(db.affiliateCommission[0]).toMatchObject({ commissionCents: 522, status: 'PENDING' });
    });

    it('REJECTED nao gera comissao nem pede saque', async () => {
      const aff = await pendingPartner();
      await service.adminUpdate(aff.id, { status: 'REJECTED' }, 'admin_1');
      await tryPay();
      expect(db.affiliateCommission).toHaveLength(0);
      await expect(service.requestPayout('partner', 'PayPal: p@mail.com', NOW)).rejects.toBeInstanceOf(ForbiddenException);
      expect((await service.getDashboard('partner', NOW)).affiliate).toEqual({ status: 'REJECTED', joinedAt: expect.any(Date) });
    });

    it('PENDING nao pede saque', async () => {
      await pendingPartner();
      await expect(service.requestPayout('partner', 'PayPal: p@mail.com', NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('SUSPENDED para as comissoes NOVAS, mantem as ja ganhas, e reativar volta', async () => {
      const aff = await setup();
      await service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW);
      await pay();
      await service.adminUpdate(aff.id, { status: 'SUSPENDED' }, 'admin_1');
      await pay({ id: 'in_2', billing_reason: 'subscription_cycle', amount_paid: 2900 });
      expect(db.affiliateCommission).toHaveLength(1);
      expect(db.affiliateCommission[0].status).toBe('PENDING');
      await expect(service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW)).resolves.toMatchObject({ attributed: false });

      await service.adminUpdate(aff.id, { status: 'ACTIVE' }, 'admin_1');
      await pay({ id: 'in_3', billing_reason: 'subscription_cycle', amount_paid: 2900 });
      expect(db.affiliateCommission).toHaveLength(2);
    });

    it('transicoes invalidas sao recusadas (ex.: suspender quem nem foi aprovado)', async () => {
      const aff = await pendingPartner();
      await expect(service.adminUpdate(aff.id, { status: 'SUSPENDED' }, 'admin_1')).rejects.toBeInstanceOf(ConflictException);
      await service.adminUpdate(aff.id, { status: 'ACTIVE' }, 'admin_1');
      await expect(service.adminUpdate(aff.id, { status: 'REJECTED' }, 'admin_1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('aprovar ativa o promotion code na Stripe (nasce inativo)', async () => {
      process.env.STRIPE_AFFILIATE_COUPON_ID = 'AFF10';
      seedUser('partner');
      const aff = await service.join('partner', APP);
      stripe.promotionCodes.retrieve.mockResolvedValue({ id: db.affiliate[0].stripePromotionCodeId, code: aff.couponCode, active: false });
      await service.adminUpdate(aff.id, { status: 'ACTIVE' }, 'admin_1');
      expect(stripe.promotionCodes.update).toHaveBeenCalledWith(db.affiliate[0].stripePromotionCodeId, { active: true });
    });
  });

  describe('EARLY35', () => {
    it('cliente indicado que pagou com EARLY35: continua atribuido e a comissao sai sobre o valor pago', async () => {
      await setup();
      await service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW);
      // Fatura com o cupom EARLY35 (sem promotion code de afiliado): US$ 29 x 0,65.
      await pay({ amount_paid: 1885, discounts: [{ id: 'di_early', coupon: { id: 'EARLY35' }, promotion_code: null }] });
      expect(db.affiliateReferral[0]).toMatchObject({ source: 'coupon', firstPaidAt: NOW });
      expect(db.affiliateCommission[0]).toMatchObject({ amountPaidCents: 1885, commissionCents: 377 });
    });

    it('depois do EARLY35 ainda ha desconto de afiliado para o indicado que nao pagou', async () => {
      process.env.STRIPE_AFFILIATE_COUPON_ID = 'AFF10';
      const aff = await setup();
      await service.claim('buyer', { code: 'SAVE10', kind: 'coupon' }, NOW);
      await expect(service.checkoutDiscountFor('buyer')).resolves.toMatchObject({ affiliateId: aff.id });
    });
  });

  describe('admin', () => {
    it('codigo em uso por outro afiliado e recusado; toda mudanca fica auditada', async () => {
      const aff = await setup();
      seedUser('other');
      const other = await joinApproved('other');
      await expect(service.adminUpdate(other.id, { couponCode: 'partner1' }, 'admin_1')).rejects.toBeInstanceOf(ConflictException);
      const audits = db.adminAudit.filter((a) => a.action === 'affiliate_update' && a.details.affiliateId === aff.id);
      expect(audits[0]).toMatchObject({ actorUserId: 'admin_1', targetUserId: 'partner' });
    });

    it('rotas do admin exigem AuthGuard E AdminGuard na classe', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, AffiliatesAdminController);
      expect(guards).toEqual([AuthGuard, AdminGuard]);
    });

    it('AdminGuard recusa quem nao e admin', () => {
      const ctx = (role?: string) =>
        ({ switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }) }) as any;
      const guard = new AdminGuard();
      expect(() => guard.canActivate(ctx('user'))).toThrow(ForbiddenException);
      expect(() => guard.canActivate(ctx())).toThrow(ForbiddenException);
      expect(guard.canActivate(ctx('admin'))).toBe(true);
    });
  });
});

describe('DTOs de afiliado contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const run = (metatype: any, body: unknown) => pipe.transform(body, { type: 'body', metatype });

  it('claim aceita link e cupom; recusa codigo com simbolo', async () => {
    await expect(run(ClaimAffiliateDto, { code: 'SAVE10', kind: 'coupon' })).resolves.toBeDefined();
    await expect(run(ClaimAffiliateDto, { code: 'PARTNER1', kind: 'link', clickId: 'ckabcdefghijklmnopqrst' })).resolves.toBeDefined();
    await expect(run(ClaimAffiliateDto, { code: 'a b;', kind: 'link' })).rejects.toBeDefined();
  });

  it('pedido de entrada: nada obrigatorio, mas o que vier preenchido e validado', async () => {
    const ok = {
      platform: 'instagram',
      url: 'https://instagram.com/trader',
      audience: '1k_10k',
      note: 'Posto analises diarias de cripto nos stories.',
    };
    await expect(run(JoinAffiliateDto, ok)).resolves.toBeDefined();
    await expect(run(JoinAffiliateDto, {})).resolves.toBeDefined();
    await expect(run(JoinAffiliateDto, { note: 'quero' })).resolves.toBeDefined();
    await expect(run(JoinAffiliateDto, { ...ok, url: 'http://instagram.com/trader' })).rejects.toBeDefined();
    await expect(run(JoinAffiliateDto, { ...ok, url: 'javascript:alert(1)' })).rejects.toBeDefined();
    await expect(run(JoinAffiliateDto, { ...ok, note: 'x'.repeat(501) })).rejects.toBeDefined();
    await expect(run(JoinAffiliateDto, { ...ok, platform: 'myspace' })).rejects.toBeDefined();
    await expect(run(JoinAffiliateDto, { ...ok, audience: '1000000' })).rejects.toBeDefined();
  });

  it('o navegador nao consegue mandar valor de saque nem de comissao', async () => {
    await expect(run(RequestPayoutDto, { method: 'PayPal: p@mail.com', amountCents: 999999 })).rejects.toBeDefined();
    await expect(run(AdminUpdateAffiliateDto, { commissionRateBps: 0.2 })).rejects.toBeDefined();
    await expect(run(AdminUpdateAffiliateDto, { commissionRateBps: 9000 })).rejects.toBeDefined();
    await expect(run(AdminUpdateAffiliateDto, { commissionRateBps: 3000, status: 'SUSPENDED' })).resolves.toBeDefined();
  });

  it('checkout aceita o afiliado do navegador (so identificacao)', async () => {
    await expect(
      run(CreateCheckoutSessionDto, { planType: 'starter', affiliateCode: 'SAVE10', affiliateKind: 'coupon' }),
    ).resolves.toBeDefined();
    await expect(run(CreateCheckoutSessionDto, { affiliateCode: 'SAVE10', affiliateDiscount: 50 })).rejects.toBeDefined();
  });
});
