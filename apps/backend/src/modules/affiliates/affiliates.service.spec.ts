import { BadRequestException, ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { AffiliatesService, OWNER_NOTIFY_PER_HOUR, addMonths, commissionFor } from './affiliates.service';
import { AffiliatesAdminController } from './affiliates-admin.controller';
import { AdminGuard } from '../auth/admin.guard';
import { AuthGuard } from '../auth/auth.guard';
import { AdminUpdateAffiliateDto, CheckAffiliateCodeDto, ClaimAffiliateDto, JoinAffiliateDto, RequestPayoutDto } from './dto/affiliates.dto';
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
      if ('gte' in cond) return value != null && value >= cond.gte;
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
    delete: async ({ where }: Row) => {
      const i = db[name].findIndex((r) => matches(r, where));
      if (i < 0) throw new Error(`${name} not found`);
      return db[name].splice(i, 1)[0];
    },
    deleteMany: async ({ where }: Row = {}) => {
      const before = db[name].length;
      db[name] = db[name].filter((r) => !matches(r, where));
      return { count: before - db[name].length };
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
  // Lingua do perfil: coluna so por SQL em producao; aqui, campo do usuario.
  prisma.$queryRawUnsafe = jest.fn(async (_sql: string, userId: string) => [
    { languagePreference: db.user.find((u) => u.id === userId)?.languagePreference ?? null },
  ]);
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
/** Pedido com o codigo que a pessoa escolheu (nome + 10, como o formulario sugere). */
const app = (userId: string, over: Row = {}) => ({ ...APP, couponCode: `${userId.toUpperCase().replace(/[^A-Z0-9]/g, '')}10`, ...over });

describe('AffiliatesService', () => {
  let service: AffiliatesService;
  let db: Record<string, Row[]>;
  let prisma: any;
  let stripe: any;
  let mail: { sendAffiliateApplicationNotify: jest.Mock; sendAffiliateWelcome: jest.Mock };

  const seedUser = (id: string, email: string | null = `${id}@mail.com`, extra: Row = {}) =>
    db.user.push({ id, email, clerkUserId: `clerk_${id}`, name: null, ...extra });

  /** Pede entrada e o admin aprova (novo afiliado nasce PENDING). */
  const joinApproved = async (userId: string) => {
    const affiliate = await service.join(userId, app(userId));
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
    // Cupom configurado e o normal: sem ele o admin nem aprova (testes que
    // precisam da falta apagam a variavel).
    process.env.STRIPE_AFFILIATE_COUPON_ID = 'AFF10';
    // Preco semanal: no modo de teste da Stripe vem desta variavel.
    process.env.STRIPE_TEST_PRICE_WEEKLY = 'price_week';
    process.env.FRONTEND_URL = 'https://tickrify.com';
    ({ prisma, db } = fakePrisma());
    const promos = new Map<string, Row>();
    mail = {
      sendAffiliateApplicationNotify: jest.fn().mockResolvedValue(true),
      sendAffiliateWelcome: jest.fn().mockResolvedValue(true),
    };
    service = new AffiliatesService(prisma, mail as any);
    stripe = {
      invoices: { retrieve: jest.fn() },
      charges: { retrieve: jest.fn() },
      coupons: { retrieve: jest.fn().mockResolvedValue({ id: 'AFF10', valid: true, duration: 'once', percent_off: 10 }) },
      prices: { retrieve: jest.fn().mockResolvedValue({ id: 'price_week', currency: 'usd', unit_amount: 799 }) },
      // Com estado, como a Stripe: o que foi criado pode ser lido e alterado.
      promotionCodes: {
        create: jest.fn(async (p: Row) => {
          const promo = { id: `promo_${p.code}`, code: p.code, active: p.active, coupon: { id: p.coupon } };
          promos.set(promo.id, promo);
          return { ...promo };
        }),
        retrieve: jest.fn(async (id: string) => ({ ...promos.get(id) })),
        update: jest.fn(async (id: string, data: Row) => Object.assign(promos.get(id) ?? {}, data)),
        list: jest.fn().mockResolvedValue({ data: [] }),
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
      await expect(service.checkoutDiscountFor('buyer')).resolves.toEqual({
        affiliateId: aff.id,
        discount: { promotion_code: 'promo_SAVE10' },
      });

      db.affiliate[0].stripePromotionCodeId = null;
      await expect(service.checkoutDiscountFor('buyer')).resolves.toEqual({ affiliateId: aff.id, discount: { coupon: 'AFF10' } });

      delete process.env.STRIPE_AFFILIATE_COUPON_ID;
      await expect(service.checkoutDiscountFor('buyer')).resolves.toBeNull();
      process.env.STRIPE_AFFILIATE_COUPON_ID = 'AFF10';
      db.affiliate[0].stripePromotionCodeId = 'promo_SAVE10';

      await pay();
      await expect(service.checkoutDiscountFor('buyer')).resolves.toBeNull();
    });

    it('afiliado aprovado ANTES do cupom existir ganha o codigo na Stripe no boot, uma vez so', async () => {
      seedUser('partner');
      delete process.env.STRIPE_AFFILIATE_COUPON_ID;
      const aff = await service.join('partner', app('partner'));
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

    it('pedido PENDING nao reserva nada na Stripe; o codigo nasce ativo na aprovacao', async () => {
      seedUser('partner');
      const aff = await service.join('partner', app('partner'));
      expect(stripe.promotionCodes.create).not.toHaveBeenCalled();
      await expect(service.syncMissingPromotionCodes()).resolves.toBe(0);

      await service.adminUpdate(aff.id, { status: 'ACTIVE' }, 'admin_1');
      expect(stripe.promotionCodes.create).toHaveBeenCalledWith(
        expect.objectContaining({
          coupon: 'AFF10',
          code: 'PARTNER10',
          active: true,
          metadata: { affiliateId: aff.id },
          restrictions: { first_time_transaction: true },
        }),
      );
      expect(db.affiliate[0]).toMatchObject({ status: 'ACTIVE', stripePromotionCodeId: 'promo_PARTNER10' });
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
      await service.join('partner', app('partner'));
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
      const a = await service.join('partner', app('partner'));
      const b = await service.join('partner', app('partner'));
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
      const aff = await service.join('partner', app('partner'));
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

    it('pedido antigo com promotion code inativo do mesmo codigo e cupom: aprovar so reativa', async () => {
      seedUser('partner');
      const aff = await service.join('partner', app('partner'));
      db.affiliate[0].stripePromotionCodeId = 'promo_old';
      stripe.promotionCodes.retrieve.mockResolvedValue({ id: 'promo_old', code: aff.couponCode, active: false, coupon: { id: 'AFF10' } });
      await service.adminUpdate(aff.id, { status: 'ACTIVE' }, 'admin_1');
      expect(stripe.promotionCodes.update).toHaveBeenCalledWith('promo_old', { active: true });
      expect(stripe.promotionCodes.create).not.toHaveBeenCalled();
      expect(db.affiliate[0]).toMatchObject({ status: 'ACTIVE', stripePromotionCodeId: 'promo_old' });
    });
  });

  describe('pedido com codigo escolhido (23/11/2026)', () => {
    it('codigo valido: gravado em maiusculas no cupom e no link, pedido PENDING', async () => {
      seedUser('eigla');
      await service.join('eigla', app('eigla', { couponCode: 'eigla10' }));
      expect(db.affiliate[0]).toMatchObject({ status: 'PENDING', couponCode: 'EIGLA10', referralCode: 'EIGLA10' });
    });

    it('codigo invalido e recusado', async () => {
      seedUser('eigla');
      await expect(service.join('eigla', app('eigla', { couponCode: 'EI' }))).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.checkCode('EIGLA-10')).resolves.toEqual({ available: false, reason: 'invalid' });
      expect(db.affiliate).toHaveLength(0);
    });

    it('codigo duplicado (outro afiliado ou promotion code ativo na Stripe) e recusado', async () => {
      seedUser('eigla');
      seedUser('rival');
      await service.join('eigla', app('eigla', { couponCode: 'EIGLA10' }));
      await expect(service.checkCode('eigla10')).resolves.toEqual({ available: false, reason: 'taken' });
      await expect(service.join('rival', app('rival', { couponCode: 'EIGLA10' }))).rejects.toBeInstanceOf(ConflictException);

      stripe.promotionCodes.list.mockResolvedValueOnce({ data: [{ id: 'promo_camp', code: 'EARLY50', active: true }] });
      await expect(service.checkCode('early50')).resolves.toEqual({ available: false, reason: 'taken' });
      await expect(service.checkCode('RIVAL10')).resolves.toEqual({ available: true });
    });

    it('Stripe fora do ar na checagem nao trava o formulario (a aprovacao confere de novo)', async () => {
      stripe.promotionCodes.list.mockRejectedValueOnce(new Error('down'));
      await expect(service.checkCode('EIGLA10')).resolves.toEqual({ available: true });
    });

    it('pedido novo gera aviso ao dono com nome, e-mail, codigo e o que a pessoa contou', async () => {
      seedUser('eigla', 'eigla@mail.cl', { name: 'Eigla Rojas' });
      await service.join('eigla', app('eigla', { couponCode: 'EIGLA10' }));
      expect(mail.sendAffiliateApplicationNotify).toHaveBeenCalledWith('support@tickrify.com', {
        name: 'Eigla Rojas',
        email: 'eigla@mail.cl',
        code: 'EIGLA10',
        platform: 'youtube',
        url: 'https://youtube.com/@tradercanal',
        audience: '10k_50k',
        note: APP.note,
      });
      expect(db.adminAudit.filter((a) => a.action === 'affiliate_application_notify')).toHaveLength(1);
    });

    it(`aviso tem teto de ${OWNER_NOTIFY_PER_HOUR} por hora, e envio recusado devolve a vaga`, async () => {
      for (let i = 0; i < OWNER_NOTIFY_PER_HOUR; i++) {
        db.adminAudit.push({ id: `n${i}`, action: 'affiliate_application_notify', createdAt: new Date() });
      }
      seedUser('eigla');
      await service.join('eigla', app('eigla'));
      expect(mail.sendAffiliateApplicationNotify).not.toHaveBeenCalled();
      expect(db.affiliate).toHaveLength(1);

      db.adminAudit = [];
      prisma.adminAudit = (fakePrisma().prisma as any).adminAudit;
      ({ prisma, db } = fakePrisma());
      service = new AffiliatesService(prisma, mail as any);
      (service as any).stripe = stripe;
      mail.sendAffiliateApplicationNotify.mockResolvedValueOnce(false);
      seedUser('maria');
      await service.join('maria', app('maria'));
      expect(mail.sendAffiliateApplicationNotify).toHaveBeenCalledTimes(1);
      expect(db.adminAudit.filter((a) => a.action === 'affiliate_application_notify')).toHaveLength(0);
    });
  });

  describe('aprovacao com a Stripe (23/11/2026)', () => {
    const pending = async (code = 'EIGLA10', extra: Row = {}) => {
      seedUser('eigla', 'eigla@mail.cl', { name: 'Eigla Rojas', ...extra });
      return service.join('eigla', app('eigla', { couponCode: code }));
    };

    it('aprovar cria o promotion code e libera o painel com codigo e link', async () => {
      const aff = await pending();
      await service.adminUpdate(aff.id, { status: 'ACTIVE' }, 'admin_1');
      expect(stripe.promotionCodes.create).toHaveBeenCalledWith(expect.objectContaining({ code: 'EIGLA10', coupon: 'AFF10', active: true }));
      const dash = await service.getDashboard('eigla', NOW);
      expect(dash.affiliate).toMatchObject({ status: 'ACTIVE', couponCode: 'EIGLA10', referralCode: 'EIGLA10' });
    });

    it('o dono edita o codigo antes de aprovar: vale o editado, no cupom e no link', async () => {
      const aff = await pending();
      await service.adminUpdate(aff.id, { status: 'ACTIVE', couponCode: 'eigla15', referralCode: 'eigla15' }, 'admin_1');
      expect(stripe.promotionCodes.create).toHaveBeenCalledWith(expect.objectContaining({ code: 'EIGLA15' }));
      expect(db.affiliate[0]).toMatchObject({ status: 'ACTIVE', couponCode: 'EIGLA15', referralCode: 'EIGLA15' });
    });

    it('Stripe recusando: o afiliado NAO vira ACTIVE, o erro traz o motivo e nada de boas-vindas', async () => {
      const aff = await pending();
      stripe.promotionCodes.create.mockRejectedValueOnce(new Error('Coupon AFF10 is expired'));
      await expect(service.adminUpdate(aff.id, { status: 'ACTIVE' }, 'admin_1')).rejects.toMatchObject({
        response: { code: 'affiliate_stripe_refused', message: expect.stringContaining('Coupon AFF10 is expired') },
      });
      expect(db.affiliate[0]).toMatchObject({ status: 'PENDING', stripePromotionCodeId: null });
      expect(mail.sendAffiliateWelcome).not.toHaveBeenCalled();
      expect(db.adminAudit.some((a) => a.action === 'affiliate_stripe_refused')).toBe(true);
    });

    it('codigo ja ativo na Stripe (ex.: cupom de campanha): recusa a aprovacao', async () => {
      const aff = await pending('EARLY50');
      stripe.promotionCodes.list.mockResolvedValueOnce({ data: [{ id: 'promo_camp', code: 'EARLY50', active: true }] });
      await expect(service.adminUpdate(aff.id, { status: 'ACTIVE' }, 'admin_1')).rejects.toBeInstanceOf(ConflictException);
      expect(db.affiliate[0].status).toBe('PENDING');
      expect(stripe.promotionCodes.create).not.toHaveBeenCalled();
    });

    it('sem STRIPE_AFFILIATE_COUPON_ID: aprovar explica que falta o cupom e nada muda', async () => {
      const aff = await pending();
      delete process.env.STRIPE_AFFILIATE_COUPON_ID;
      await expect(service.adminUpdate(aff.id, { status: 'ACTIVE' }, 'admin_1')).rejects.toMatchObject({
        response: { code: 'affiliate_coupon_missing', message: expect.stringContaining('STRIPE_AFFILIATE_COUPON_ID') },
      });
      expect(db.affiliate[0].status).toBe('PENDING');
    });

    it('recusar continua como antes (REJECTED) e nao manda boas-vindas', async () => {
      const aff = await pending();
      await service.adminUpdate(aff.id, { status: 'REJECTED' }, 'admin_1');
      expect(db.affiliate[0].status).toBe('REJECTED');
      expect(stripe.promotionCodes.create).not.toHaveBeenCalled();
      expect(mail.sendAffiliateWelcome).not.toHaveBeenCalled();
      await expect(service.sendWelcomeOnce(aff.id)).resolves.toBe(false);
    });

    it('trocar o codigo de um ACTIVE: cria o novo, desativa o antigo e as vendas antigas seguem dele', async () => {
      const aff = await pending();
      seedUser('buyer');
      await service.adminUpdate(aff.id, { status: 'ACTIVE' }, 'admin_1');
      await service.claim('buyer', { code: 'EIGLA10', kind: 'coupon' }, NOW);

      await service.adminUpdate(aff.id, { couponCode: 'ROJAS10' }, 'admin_1');
      expect(stripe.promotionCodes.create).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'ROJAS10', active: true }));
      expect(stripe.promotionCodes.update).toHaveBeenCalledWith('promo_EIGLA10', { active: false });
      expect(db.affiliate[0]).toMatchObject({ couponCode: 'ROJAS10', stripePromotionCodeId: 'promo_ROJAS10' });
      expect(db.affiliateReferral[0]).toMatchObject({ affiliateId: aff.id, userId: 'buyer' });
      await pay();
      expect(db.affiliateCommission[0]).toMatchObject({ affiliateId: aff.id });
    });

    it('troca de codigo que a Stripe recusa nao muda nada', async () => {
      const aff = await pending();
      await service.adminUpdate(aff.id, { status: 'ACTIVE' }, 'admin_1');
      stripe.promotionCodes.create.mockRejectedValueOnce(new Error('rate limited'));
      await expect(service.adminUpdate(aff.id, { couponCode: 'ROJAS10' }, 'admin_1')).rejects.toBeInstanceOf(BadRequestException);
      expect(db.affiliate[0]).toMatchObject({ couponCode: 'EIGLA10', stripePromotionCodeId: 'promo_EIGLA10' });
      expect(stripe.promotionCodes.update).not.toHaveBeenCalledWith('promo_EIGLA10', { active: false });
    });
  });

  describe('e-mail de boas-vindas (23/11/2026)', () => {
    const approve = async (extra: Row = {}) => {
      seedUser('eigla', 'eigla@mail.cl', { name: 'Eigla Rojas', ...extra });
      const aff = await service.join('eigla', app('eigla', { couponCode: 'EIGLA10' }));
      await service.adminUpdate(aff.id, { status: 'ACTIVE' }, 'admin_1');
      return aff;
    };
    const sentEmail = () => mail.sendAffiliateWelcome.mock.calls[0];

    it('sai uma vez so, para o e-mail da conta, com os valores da configuracao e do afiliado', async () => {
      const aff = await approve();
      expect(mail.sendAffiliateWelcome).toHaveBeenCalledTimes(1);
      const [to, email] = sentEmail();
      expect(to).toBe('eigla@mail.cl');
      expect(email.subject).toBe("You're now a Tickrify partner");
      for (const part of [
        'Hi Eigla,',
        'Your coupon code: EIGLA10',
        'Your link: https://tickrify.com/?ref=EIGLA10',
        '10% off their first payment',
        '20% of every payment from the people you bring, for 12 months',
        'confirmed 30 days after each payment and can be withdrawn from 50 USD',
        'partner dashboard: https://tickrify.com/affiliate',
        'Mention the weekly plan ($7.99)',
        'Vinícius\nFounder, Tickrify',
      ]) {
        expect(email.text).toContain(part);
      }
      expect(email.html).toContain('EIGLA10');
      expect(email.html).toContain('href="https://tickrify.com/?ref=EIGLA10"');
      expect(email.text + email.html + email.subject).not.toMatch(/\u2014/);

      await expect(service.sendWelcomeOnce(aff.id)).resolves.toBe(false);
      await service.getDashboard('eigla', NOW);
      expect(mail.sendAffiliateWelcome).toHaveBeenCalledTimes(1);
    });

    it('valores mudam com a configuracao: taxa especial e cupom de 15%', async () => {
      stripe.coupons.retrieve.mockResolvedValue({ id: 'AFF10', valid: true, duration: 'once', percent_off: 15 });
      seedUser('eigla', 'eigla@mail.cl');
      const aff = await service.join('eigla', app('eigla'));
      await service.adminUpdate(aff.id, { commissionRateBps: 3000 }, 'admin_1');
      await service.adminUpdate(aff.id, { status: 'ACTIVE' }, 'admin_1');
      const [, email] = sentEmail();
      expect(email.text).toContain('15% off their first payment');
      expect(email.text).toContain('What you get: 30% of every payment');
      expect(email.text).toContain('Hi,');
    });

    it('no idioma do perfil (espanhol para o Chile), com o preco no formato local', async () => {
      await approve({ languagePreference: 'es' });
      const [, email] = sentEmail();
      expect(email.subject).toBe('Ya eres partner de Tickrify');
      expect(email.text).toContain('Hola, Eigla:');
      expect(email.text).toContain('Tu código de cupón: EIGLA10');
      expect(email.text).toContain('10% de descuento en su primer pago');
      expect(email.text).toContain('20% de cada pago');
      expect(email.text).toContain('durante 12 meses');
      expect(email.text).toContain('30 días después');
      expect(email.text).toContain('a partir de 50 USD');
      expect(email.text).toMatch(/7,99/);
    });

    it('sem idioma ou com idioma fora dos 6 do site: ingles', async () => {
      await approve({ languagePreference: 'it' });
      expect(sentEmail()[1].subject).toBe("You're now a Tickrify partner");
    });

    it.each(['pt', 'fr', 'de', 'ja'])('%s tem traducao propria, sem travessao', async (lang) => {
      await approve({ languagePreference: lang });
      const [, email] = sentEmail();
      expect(email.subject).not.toBe("You're now a Tickrify partner");
      expect(email.text).toContain('EIGLA10');
      expect(email.text + email.subject).not.toMatch(/\u2014/);
    });

    it('Resend recusa: tira a marca e o painel do afiliado tenta de novo na visita', async () => {
      mail.sendAffiliateWelcome.mockResolvedValueOnce(false);
      await approve();
      expect(db.adminAudit.some((a) => a.action === 'affiliate_welcome_sent')).toBe(false);
      expect(db.adminAudit.some((a) => a.action === 'affiliate_welcome_retry')).toBe(true);

      await service.getDashboard('eigla', NOW);
      expect(mail.sendAffiliateWelcome).toHaveBeenCalledTimes(2);
      expect(db.adminAudit.filter((a) => a.action === 'affiliate_welcome_sent')).toHaveLength(1);
      expect(db.adminAudit.some((a) => a.action === 'affiliate_welcome_retry')).toBe(false);

      await service.getDashboard('eigla', NOW);
      expect(mail.sendAffiliateWelcome).toHaveBeenCalledTimes(2);
    });

    it('afiliado ativo antigo (sem marca de nova tentativa) nao recebe boas-vindas atrasadas', async () => {
      seedUser('old');
      db.affiliate.push({
        id: 'aff_old', userId: 'old', referralCode: 'X7K2M9QA', couponCode: 'X7K2M9QA', commissionRateBps: 2000,
        status: 'ACTIVE', stripePromotionCodeId: 'promo_old', createdAt: NOW, updatedAt: NOW,
      });
      await service.getDashboard('old', NOW);
      expect(mail.sendAffiliateWelcome).not.toHaveBeenCalled();
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

  it('pedido de entrada: so o codigo e obrigatorio; o que vier preenchido e validado', async () => {
    const ok = {
      couponCode: 'Eigla10',
      platform: 'instagram',
      url: 'https://instagram.com/trader',
      audience: '1k_10k',
      note: 'Posto analises diarias de cripto nos stories.',
    };
    await expect(run(JoinAffiliateDto, ok)).resolves.toBeDefined();
    await expect(run(JoinAffiliateDto, { couponCode: 'EIGLA10' })).resolves.toBeDefined();
    await expect(run(JoinAffiliateDto, { couponCode: 'EIGLA10', note: 'quero' })).resolves.toBeDefined();
    await expect(run(JoinAffiliateDto, {})).rejects.toBeDefined();
    await expect(run(JoinAffiliateDto, { couponCode: 'EIG' })).rejects.toBeDefined();
    await expect(run(JoinAffiliateDto, { couponCode: 'E'.repeat(21) })).rejects.toBeDefined();
    await expect(run(JoinAffiliateDto, { couponCode: 'EIGLA-10' })).rejects.toBeDefined();
    await expect(run(JoinAffiliateDto, { couponCode: 'ÉIGLA10' })).rejects.toBeDefined();
    await expect(run(CheckAffiliateCodeDto, { code: 'EIGLA10' })).resolves.toBeDefined();
    await expect(run(CheckAffiliateCodeDto, { code: 'EIGLA10', extra: 1 })).rejects.toBeDefined();
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
