import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import Stripe from 'stripe';
import { PrismaService } from '../database/prisma.service';
import { getStripeConfig } from '../../config/stripe.config';

/**
 * Programa de afiliados.
 *
 * Regras (decididas pelo dono em 26/09/2026):
 * - 20% recorrente por 12 meses a partir do 1o pagamento do cliente indicado.
 * - Cliente indicado ganha desconto so no 1o pagamento (cupom da Stripe em
 *   STRIPE_AFFILIATE_COUPON_ID, `duration: once`).
 * - Janela de atribuicao do link: 30 dias, contados da data do CLIQUE gravada
 *   aqui (o navegador so guarda o id do clique).
 * - Cupom do afiliado tem prioridade sobre o link; sem cupom vale o ultimo
 *   link valido. Depois do 1o pagamento o vinculo trava.
 * - Comissao fica PENDING 30 dias, depois AVAILABLE. Saque manual a partir de
 *   US$ 50. Refund ou disputa -> CANCELLED.
 *
 * Fonte da verdade do dinheiro e a Stripe: o valor vem da fatura RELIDA na
 * API, nunca do payload do webhook nem do navegador. Dinheiro em centavos de
 * USD (Int) e taxa em pontos-base: nada de ponto flutuante.
 */
export const AFFILIATE_RULES = {
  defaultRateBps: 2000,
  commissionMonths: 12,
  attributionDays: 30,
  holdDays: 30,
  minPayoutCents: 5000,
} as const;

export type CommissionStatus = 'PENDING' | 'AVAILABLE' | 'PAID' | 'CANCELLED';
export type PayoutStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PAID';
/**
 * PENDING (pediu para entrar) -> ACTIVE (aprovado pelo admin) | REJECTED.
 * ACTIVE <-> SUSPENDED. So ACTIVE gera clique, atribuicao, desconto, comissao
 * e saque; comissao ja ganha antes de uma suspensao continua onde estava.
 */
export type AffiliateStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

/** Transicoes que o admin pode fazer (approve, reject, suspend, reactivate). */
const STATUS_TRANSITIONS: Record<AffiliateStatus, AffiliateStatus[]> = {
  PENDING: ['ACTIVE', 'REJECTED'],
  REJECTED: ['ACTIVE'],
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE'],
};
export type ReferralKind = 'link' | 'coupon';
export type PayoutAction = 'approve' | 'reject' | 'mark_paid';

const DAY_MS = 24 * 60 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const AFFILIATE_CODE_RE = /^[A-Z0-9]{4,20}$/;

/** Faturas que geram comissao: criacao e renovacao (troca de plano nao). */
const COMMISSIONABLE_REASONS = ['subscription_create', 'subscription_cycle'];

/** Comissao inteira, arredondada para baixo: nunca paga centavo que nao existe. */
export function commissionFor(amountPaidCents: number, rateBps: number): number {
  if (!Number.isInteger(amountPaidCents) || !Number.isInteger(rateBps) || amountPaidCents <= 0 || rateBps <= 0) {
    return 0;
  }
  return Math.floor((amountPaidCents * rateBps) / 10_000);
}

export function addMonths(date: Date, months: number): Date {
  const out = new Date(date.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

export function normalizeCode(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function generateCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

function stripeId(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id ?? null;
}

/** SQL do boot. Mesmo conteudo de prisma/migrations/20260926120000_affiliates. */
const BOOT_SQL = [
  `CREATE TABLE IF NOT EXISTS "tickrify"."Affiliate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "couponCode" TEXT NOT NULL,
    "commissionRateBps" INTEGER NOT NULL DEFAULT 2000,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "stripePromotionCodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Affiliate_status_check" CHECK ("status" IN ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED')),
    CONSTRAINT "Affiliate_rate_check" CHECK ("commissionRateBps" >= 0 AND "commissionRateBps" <= 10000),
    CONSTRAINT "Affiliate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "tickrify"."AffiliateClick" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "landingPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AffiliateClick_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "tickrify"."Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "tickrify"."AffiliateReferral" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "clickId" TEXT,
    "firstPaidAt" TIMESTAMP(3),
    "commissionEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AffiliateReferral_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AffiliateReferral_source_check" CHECK ("source" IN ('link', 'coupon')),
    CONSTRAINT "AffiliateReferral_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "tickrify"."Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AffiliateReferral_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "tickrify"."AffiliatePayout" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "method" TEXT NOT NULL,
    "adminNote" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "decidedById" TEXT,
    CONSTRAINT "AffiliatePayout_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AffiliatePayout_status_check" CHECK ("status" IN ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID')),
    CONSTRAINT "AffiliatePayout_amount_check" CHECK ("amountCents" >= 0),
    CONSTRAINT "AffiliatePayout_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "tickrify"."Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "tickrify"."AffiliateCommission" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "referralId" TEXT,
    "referredUserId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "stripeChargeId" TEXT,
    "stripePaymentIntentId" TEXT,
    "amountPaidCents" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL,
    "payoutId" TEXT,
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AffiliateCommission_status_check" CHECK ("status" IN ('PENDING', 'AVAILABLE', 'PAID', 'CANCELLED')),
    CONSTRAINT "AffiliateCommission_amount_check" CHECK ("amountPaidCents" >= 0 AND "commissionCents" >= 0),
    CONSTRAINT "AffiliateCommission_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "tickrify"."Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AffiliateCommission_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "tickrify"."AffiliateReferral"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AffiliateCommission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "tickrify"."AffiliatePayout"("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  // Tabela criada na 1a versao (ACTIVE | SUSPENDED, padrao ACTIVE): amplia o
  // CHECK e muda so o PADRAO. Linhas existentes ficam com o status que tem.
  'ALTER TABLE "tickrify"."Affiliate" ALTER COLUMN "status" SET DEFAULT \'PENDING\'',
  'ALTER TABLE "tickrify"."Affiliate" DROP CONSTRAINT IF EXISTS "Affiliate_status_check"',
  'ALTER TABLE "tickrify"."Affiliate" ADD CONSTRAINT "Affiliate_status_check" CHECK ("status" IN (\'PENDING\', \'ACTIVE\', \'REJECTED\', \'SUSPENDED\'))',
  // Pedido de entrada (28/09): canal, link, tamanho da audiencia e plano.
  'ALTER TABLE "tickrify"."Affiliate" ADD COLUMN IF NOT EXISTS "applicationPlatform" TEXT',
  'ALTER TABLE "tickrify"."Affiliate" ADD COLUMN IF NOT EXISTS "applicationUrl" TEXT',
  'ALTER TABLE "tickrify"."Affiliate" ADD COLUMN IF NOT EXISTS "applicationAudience" TEXT',
  'ALTER TABLE "tickrify"."Affiliate" ADD COLUMN IF NOT EXISTS "applicationNote" TEXT',
  'CREATE UNIQUE INDEX IF NOT EXISTS "Affiliate_userId_key" ON "tickrify"."Affiliate"("userId")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "Affiliate_referralCode_key" ON "tickrify"."Affiliate"("referralCode")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "Affiliate_couponCode_key" ON "tickrify"."Affiliate"("couponCode")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "Affiliate_stripePromotionCodeId_key" ON "tickrify"."Affiliate"("stripePromotionCodeId")',
  'CREATE INDEX IF NOT EXISTS "AffiliateClick_affiliateId_createdAt_idx" ON "tickrify"."AffiliateClick"("affiliateId", "createdAt")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateReferral_userId_key" ON "tickrify"."AffiliateReferral"("userId")',
  'CREATE INDEX IF NOT EXISTS "AffiliateReferral_affiliateId_createdAt_idx" ON "tickrify"."AffiliateReferral"("affiliateId", "createdAt")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "AffiliateCommission_stripeInvoiceId_key" ON "tickrify"."AffiliateCommission"("stripeInvoiceId")',
  'CREATE INDEX IF NOT EXISTS "AffiliateCommission_affiliateId_status_idx" ON "tickrify"."AffiliateCommission"("affiliateId", "status")',
  'CREATE INDEX IF NOT EXISTS "AffiliateCommission_status_availableAt_idx" ON "tickrify"."AffiliateCommission"("status", "availableAt")',
  'CREATE INDEX IF NOT EXISTS "AffiliateCommission_stripeChargeId_idx" ON "tickrify"."AffiliateCommission"("stripeChargeId")',
  'CREATE INDEX IF NOT EXISTS "AffiliateCommission_stripePaymentIntentId_idx" ON "tickrify"."AffiliateCommission"("stripePaymentIntentId")',
  'CREATE INDEX IF NOT EXISTS "AffiliatePayout_affiliateId_status_idx" ON "tickrify"."AffiliatePayout"("affiliateId", "status")',
  'CREATE INDEX IF NOT EXISTS "AffiliatePayout_status_requestedAt_idx" ON "tickrify"."AffiliatePayout"("status", "requestedAt")',
];

type ClaimResult = { attributed: boolean; reason?: string };

/** O que a pessoa conta ao pedir para entrar (validado no DTO). Tudo opcional. */
export type AffiliateApplication = {
  platform?: string;
  url?: string;
  audience?: string;
  note?: string;
};

export type CheckoutDiscount = {
  affiliateId: string;
  discount: { promotion_code: string } | { coupon: string };
};

type AffiliateRow = {
  id: string;
  userId: string;
  referralCode: string;
  couponCode: string;
  commissionRateBps: number;
  status: string;
  stripePromotionCodeId: string | null;
};

@Injectable()
export class AffiliatesService implements OnModuleInit {
  private readonly logger = new Logger(AffiliatesService.name);
  private stripe: Stripe | null;
  private discountCache: { value: number | null; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {
    const { secretKey } = getStripeConfig();
    this.stripe = secretKey ? new Stripe(secretKey, { apiVersion: '2023-10-16' }) : null;
  }

  async onModuleInit(): Promise<void> {
    try {
      for (const sql of BOOT_SQL) await this.prisma.$executeRawUnsafe(sql);
      this.logger.log(
        `[affiliate] Tabelas prontas. Cupom da Stripe: ${this.affiliateCouponId() ? 'configurado' : 'AUSENTE (sem desconto para indicados)'}.`,
      );
      void this.syncMissingPromotionCodes();
    } catch (error) {
      this.logger.error('[affiliate] Nao consegui garantir as tabelas de afiliados.', error);
    }
  }

  /**
   * Afiliado que entrou ou foi aprovado ANTES de existir STRIPE_AFFILIATE_COUPON_ID
   * ficava sem codigo na Stripe (o cupom dele nao funcionava) e o /admin so
   * sincroniza quando algo muda. No boot, cria o que falta. Idempotente: quem
   * ja tem codigo nao e tocado; com 2 instancias, a Stripe recusa o codigo
   * repetido na segunda e so fica um log.
   */
  async syncMissingPromotionCodes(): Promise<number> {
    if (!this.affiliateCouponId() || !this.stripe) return 0;
    try {
      const missing = await this.prisma.affiliate.findMany({
        where: { stripePromotionCodeId: null, status: { in: ['ACTIVE', 'PENDING'] } },
      });
      let created = 0;
      for (const affiliate of missing) {
        if ((await this.syncPromotionCode(affiliate)) === 'ok') created++;
      }
      if (missing.length > 0) {
        this.logger.log(`[affiliate] Codigos na Stripe criados no boot: ${created} de ${missing.length}.`);
      }
      return created;
    } catch (error) {
      this.logger.error(`[affiliate] Sincronizacao de codigos no boot falhou: ${error instanceof Error ? error.message : error}`);
      return 0;
    }
  }

  private affiliateCouponId(): string | null {
    return process.env.STRIPE_AFFILIATE_COUPON_ID?.trim() || null;
  }

  // ── Pagina publica ────────────────────────────────────────────────────────

  /**
   * Numeros PUBLICOS do programa. SEM taxa de comissao (decisao do dono,
   * 28/09): a porcentagem so aparece no painel do proprio afiliado e no admin.
   * O desconto do cliente vem do cupom da Stripe (a afirmacao publica segue o
   * que de fato sera aplicado); sem cupom, null.
   */
  async getProgram() {
    return {
      commissionMonths: AFFILIATE_RULES.commissionMonths,
      attributionDays: AFFILIATE_RULES.attributionDays,
      holdDays: AFFILIATE_RULES.holdDays,
      minPayoutUsd: AFFILIATE_RULES.minPayoutCents / 100,
      customerDiscountPercent: await this.customerDiscountPercent(),
    };
  }

  private async customerDiscountPercent(): Promise<number | null> {
    const couponId = this.affiliateCouponId();
    if (!couponId || !this.stripe) return null;
    if (this.discountCache && Date.now() - this.discountCache.at < 10 * 60 * 1000) return this.discountCache.value;
    try {
      const coupon = await this.stripe.coupons.retrieve(couponId);
      const value = coupon.valid && coupon.duration === 'once' ? coupon.percent_off ?? null : null;
      this.discountCache = { value, at: Date.now() };
      return value;
    } catch {
      return this.discountCache?.value ?? null;
    }
  }

  /** Clique num link ?ref=. Afiliado inexistente ou suspenso nao grava nada. */
  async recordClick(code: string, landingPath?: string): Promise<{ valid: boolean; clickId?: string }> {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { referralCode: normalizeCode(code) },
      select: { id: true, status: true },
    });
    if (!affiliate || affiliate.status !== 'ACTIVE') return { valid: false };
    const click = await this.prisma.affiliateClick.create({
      data: { affiliateId: affiliate.id, landingPath: landingPath?.slice(0, 240) || null },
      select: { id: true },
    });
    return { valid: true, clickId: click.id };
  }

  /** Cupom digitado no site antes do login: so diz se existe e esta ativo. */
  async isCouponValid(code: string): Promise<boolean> {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { couponCode: normalizeCode(code) },
      select: { status: true },
    });
    return affiliate?.status === 'ACTIVE';
  }

  // ── Atribuicao ────────────────────────────────────────────────────────────

  /**
   * Vincula o usuario ao afiliado. Chamado depois do login (cadastro novo ou
   * visita com ?ref=) e de novo no checkout, entao e idempotente.
   *
   * Recusas: codigo invalido/suspenso, self-referral (mesmo usuario ou mesmo
   * e-mail), clique vencido (30 dias) ou de outro afiliado, cliente que ja
   * pagou antes de ser indicado, e vinculo ja travado por pagamento.
   */
  async claim(
    userId: string,
    input: { code: string; kind: ReferralKind; clickId?: string | null },
    now = new Date(),
  ): Promise<ClaimResult> {
    const code = normalizeCode(input.code);
    if (!AFFILIATE_CODE_RE.test(code)) return { attributed: false, reason: 'invalid_code' };

    const affiliate = await this.prisma.affiliate.findUnique({
      where: input.kind === 'coupon' ? { couponCode: code } : { referralCode: code },
      include: { user: { select: { email: true } } },
    });
    if (!affiliate || affiliate.status !== 'ACTIVE') return { attributed: false, reason: 'invalid_code' };

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) return { attributed: false, reason: 'unknown_user' };
    if (this.isSelfReferral(affiliate, user)) return { attributed: false, reason: 'self_referral' };

    let clickId: string | null = null;
    if (input.kind === 'link') {
      const click = input.clickId
        ? await this.prisma.affiliateClick.findUnique({ where: { id: input.clickId } })
        : null;
      const windowStart = now.getTime() - AFFILIATE_RULES.attributionDays * DAY_MS;
      if (!click || click.affiliateId !== affiliate.id || click.createdAt.getTime() < windowStart) {
        return { attributed: false, reason: 'expired' };
      }
      clickId = click.id;
    }

    const existing = await this.prisma.affiliateReferral.findUnique({ where: { userId } });
    if (existing?.firstPaidAt) {
      return existing.affiliateId === affiliate.id
        ? { attributed: true }
        : { attributed: false, reason: 'already_converted' };
    }
    if (!existing && (await this.hasPaidBefore(userId))) {
      return { attributed: false, reason: 'existing_customer' };
    }
    if (existing) {
      // Cupom vence link: um link novo nao desfaz o cupom que a pessoa digitou.
      if (input.kind === 'link' && existing.source === 'coupon') {
        return existing.affiliateId === affiliate.id
          ? { attributed: true }
          : { attributed: false, reason: 'coupon_priority' };
      }
      await this.prisma.affiliateReferral.update({
        where: { id: existing.id },
        data: { affiliateId: affiliate.id, source: input.kind, clickId },
      });
      return { attributed: true };
    }

    try {
      await this.prisma.affiliateReferral.create({
        data: { affiliateId: affiliate.id, userId, source: input.kind, clickId },
      });
    } catch (error) {
      // Corrida entre a chamada do login e a do checkout: a outra ja gravou.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.claim(userId, input, now);
      }
      throw error;
    }
    this.logger.log(`[affiliate] Usuario ${userId} indicado por ${affiliate.id} (${input.kind}).`);
    return { attributed: true };
  }

  private isSelfReferral(
    affiliate: { userId: string; user?: { email: string | null } | null },
    user: { id: string; email: string | null },
  ): boolean {
    if (affiliate.userId === user.id) return true;
    const a = affiliate.user?.email?.trim().toLowerCase();
    const b = user.email?.trim().toLowerCase();
    return Boolean(a && b && a === b);
  }

  /** Ja teve assinatura da Stripe (o acesso manual `manual_*` nao conta). */
  private async hasPaidBefore(userId: string): Promise<boolean> {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId, stripeId: { startsWith: 'sub_' } },
      select: { id: true },
    });
    return Boolean(sub);
  }

  /**
   * Desconto de afiliado para o checkout, ou null. So antes do 1o pagamento
   * (o cupom e `once` e o vinculo trava no pagamento). Prefere o promotion
   * code do afiliado (a fatura da Stripe fica carimbada com ele); sem ele,
   * o cupom direto.
   */
  async checkoutDiscountFor(userId: string): Promise<CheckoutDiscount | null> {
    const couponId = this.affiliateCouponId();
    if (!couponId) return null;
    const referral = await this.prisma.affiliateReferral.findUnique({
      where: { userId },
      include: { affiliate: true },
    });
    if (!referral || referral.firstPaidAt || referral.affiliate.status !== 'ACTIVE') return null;
    if (referral.affiliate.userId === userId) return null;
    return {
      affiliateId: referral.affiliateId,
      discount: referral.affiliate.stripePromotionCodeId
        ? { promotion_code: referral.affiliate.stripePromotionCodeId }
        : { coupon: couponId },
    };
  }

  // ── Comissao (webhook da Stripe) ─────────────────────────────────────────

  /**
   * Fatura paga -> comissao PENDING, UMA por fatura (chave unica no banco).
   * `userId` e o dono da assinatura, ja resolvido pelo StripeService.
   *
   * A fatura e RELIDA na Stripe (versao do SDK, com charge e payment_intent
   * no topo): o valor pago, o imposto e o promotion code vem de la.
   */
  async recordInvoiceCommission(invoice: Pick<Stripe.Invoice, 'id' | 'billing_reason' | 'amount_paid'>, userId: string): Promise<void> {
    if (!COMMISSIONABLE_REASONS.includes(invoice.billing_reason ?? '')) return;
    if (!(invoice.amount_paid > 0)) return;
    if (!this.stripe) return;

    const already = await this.prisma.affiliateCommission.findUnique({
      where: { stripeInvoiceId: invoice.id },
      select: { id: true },
    });
    if (already) return;

    const full = await this.stripe.invoices.retrieve(invoice.id, { expand: ['discounts'] });
    if (full.status !== 'paid' || !(full.amount_paid > 0)) return;

    await this.applyCouponFromInvoice(full, userId);

    const referral = await this.prisma.affiliateReferral.findUnique({
      where: { userId },
      include: { affiliate: true },
    });
    if (!referral) return;

    const affiliate = referral.affiliate;
    if (affiliate.userId === userId) {
      this.logger.warn(`[affiliate] Self-referral na fatura ${full.id}; sem comissao.`);
      return;
    }
    if (affiliate.status !== 'ACTIVE') {
      this.logger.warn(`[affiliate] Afiliado ${affiliate.id} suspenso; fatura ${full.id} sem comissao.`);
      return;
    }

    const paidAt = new Date((full.status_transitions?.paid_at ?? full.created) * 1000);
    if (referral.commissionEndsAt && paidAt.getTime() >= referral.commissionEndsAt.getTime()) {
      this.logger.log(`[affiliate] Fatura ${full.id} fora dos 12 meses de ${referral.id}; sem comissao.`);
      return;
    }

    const amountPaidCents = await this.usdAmountPaid(full);
    if (amountPaidCents === null) {
      this.logger.warn(`[affiliate] Fatura ${full.id} em ${full.currency} sem conversao para USD; comissao para revisao manual.`);
      await this.prisma.adminAudit.create({
        data: {
          action: 'affiliate_commission_review',
          targetUserId: affiliate.userId,
          details: { invoiceId: full.id, currency: full.currency, amountPaid: full.amount_paid, referredUserId: userId },
        },
      });
      return;
    }

    const commissionCents = commissionFor(amountPaidCents, affiliate.commissionRateBps);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.affiliateCommission.create({
          data: {
            affiliateId: affiliate.id,
            referralId: referral.id,
            referredUserId: userId,
            stripeInvoiceId: full.id,
            stripeChargeId: stripeId(full.charge),
            stripePaymentIntentId: stripeId(full.payment_intent),
            amountPaidCents,
            commissionCents,
            rateBps: affiliate.commissionRateBps,
            status: 'PENDING',
            availableAt: new Date(paidAt.getTime() + AFFILIATE_RULES.holdDays * DAY_MS),
          },
        });
        if (!referral.firstPaidAt) {
          await tx.affiliateReferral.update({
            where: { id: referral.id },
            data: { firstPaidAt: paidAt, commissionEndsAt: addMonths(paidAt, AFFILIATE_RULES.commissionMonths) },
          });
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.log(`[affiliate] Comissao da fatura ${full.id} ja existe; ignorado.`);
        return;
      }
      throw error;
    }
    this.logger.log(
      `[affiliate] Comissao PENDING ${commissionCents}c (${affiliate.commissionRateBps}bps de ${amountPaidCents}c) ` +
        `para ${affiliate.id}, fatura ${full.id}.`,
    );
  }

  /**
   * Promotion code de afiliado na fatura (digitado no checkout da Stripe ou
   * pre-aplicado por nos) = cupom com prioridade sobre o link, enquanto o
   * vinculo nao travou.
   */
  private async applyCouponFromInvoice(invoice: Stripe.Invoice, userId: string): Promise<void> {
    const promoIds = (invoice.discounts ?? [])
      .map((d) => (typeof d === 'string' || ('deleted' in d && d.deleted) ? null : stripeId((d as Stripe.Discount).promotion_code)))
      .filter((id): id is string => Boolean(id));
    if (promoIds.length === 0) return;

    const affiliate = await this.prisma.affiliate.findFirst({
      where: { stripePromotionCodeId: { in: promoIds } },
      include: { user: { select: { email: true } } },
    });
    if (!affiliate || affiliate.status !== 'ACTIVE') return;

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user || this.isSelfReferral(affiliate, user)) return;

    const existing = await this.prisma.affiliateReferral.findUnique({ where: { userId } });
    if (existing?.firstPaidAt) return;
    if (existing) {
      if (existing.affiliateId !== affiliate.id || existing.source !== 'coupon') {
        await this.prisma.affiliateReferral.update({
          where: { id: existing.id },
          data: { affiliateId: affiliate.id, source: 'coupon', clickId: null },
        });
      }
      return;
    }
    await this.prisma.affiliateReferral.create({
      data: { affiliateId: affiliate.id, userId, source: 'coupon' },
    });
  }

  /**
   * Valor realmente pago, sem imposto, em centavos de USD. Fatura em outra
   * moeda (Adaptive Pricing) usa o valor que a Stripe liquidou em USD na
   * transacao de saldo; se nao der para saber, null (revisao manual).
   */
  private async usdAmountPaid(invoice: Stripe.Invoice): Promise<number | null> {
    const net = invoice.amount_paid - (invoice.tax ?? 0);
    if (invoice.currency === 'usd') return Math.max(0, net);

    const chargeId = stripeId(invoice.charge);
    if (!chargeId || !this.stripe) return null;
    try {
      const charge = await this.stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] });
      const bt = charge.balance_transaction;
      if (!bt || typeof bt === 'string' || bt.currency !== 'usd' || !invoice.amount_paid) return null;
      // Proporcao inteira: tira o imposto na mesma razao em que foi cobrado.
      return Math.max(0, Math.floor((bt.amount * net) / invoice.amount_paid));
    } catch {
      return null;
    }
  }

  /** Refund ou disputa: cancela o que ainda nao foi pago ao afiliado. */
  async cancelForCharge(ref: { chargeId?: string | null; paymentIntentId?: string | null }, reason: 'refund' | 'dispute'): Promise<number> {
    const or: Prisma.AffiliateCommissionWhereInput[] = [];
    if (ref.chargeId) or.push({ stripeChargeId: ref.chargeId });
    if (ref.paymentIntentId) or.push({ stripePaymentIntentId: ref.paymentIntentId });
    if (or.length === 0) return 0;

    const commissions = await this.prisma.affiliateCommission.findMany({ where: { OR: or } });
    let cancelled = 0;
    for (const commission of commissions) {
      if (commission.status === 'PAID') {
        // Dinheiro ja saiu: nao da para desfazer aqui. Fica registrado para o dono.
        this.logger.warn(`[affiliate] ${reason} numa comissao ja PAGA (${commission.id}); estorno manual.`);
        await this.prisma.adminAudit.create({
          data: {
            action: 'affiliate_commission_clawback',
            details: { commissionId: commission.id, affiliateId: commission.affiliateId, reason, ...ref },
          },
        });
        continue;
      }
      if (commission.status === 'CANCELLED') continue;
      const res = await this.prisma.affiliateCommission.updateMany({
        where: { id: commission.id, status: { in: ['PENDING', 'AVAILABLE'] } },
        data: { status: 'CANCELLED', cancelledReason: reason, payoutId: null },
      });
      if (res.count > 0) {
        cancelled += 1;
        if (commission.payoutId) await this.refreshPayoutAmount(commission.payoutId);
      }
    }
    if (cancelled > 0) this.logger.log(`[affiliate] ${cancelled} comissao(oes) cancelada(s) por ${reason}.`);
    return cancelled;
  }

  /** PENDING com 30 dias vencidos vira AVAILABLE. Chamado antes de toda leitura de saldo. */
  async releaseMatured(now = new Date(), affiliateId?: string): Promise<number> {
    const res = await this.prisma.affiliateCommission.updateMany({
      where: { status: 'PENDING', availableAt: { lte: now }, ...(affiliateId ? { affiliateId } : {}) },
      data: { status: 'AVAILABLE' },
    });
    return res.count;
  }

  // ── Painel do afiliado ────────────────────────────────────────────────────

  /**
   * Pede entrada no programa, com o que o admin precisa para decidir (canal,
   * link, audiencia, plano). Idempotente: quem ja pediu recebe o mesmo perfil.
   */
  async join(userId: string, application: AffiliateApplication) {
    const existing = await this.prisma.affiliate.findUnique({ where: { userId } });
    if (existing) return existing;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      const clash = await this.prisma.affiliate.findFirst({
        where: { OR: [{ referralCode: code }, { couponCode: code }] },
        select: { id: true },
      });
      if (clash) continue;
      try {
        // Entra PENDING: so vira ACTIVE quando o admin aprova.
        const created = await this.prisma.affiliate.create({
          data: {
            userId,
            referralCode: code,
            couponCode: code,
            commissionRateBps: AFFILIATE_RULES.defaultRateBps,
            status: 'PENDING',
            applicationPlatform: application.platform || null,
            applicationUrl: application.url?.trim().slice(0, 300) || null,
            applicationAudience: application.audience || null,
            applicationNote: application.note?.trim().slice(0, 500) || null,
          },
        });
        await this.syncPromotionCode(created);
        this.logger.log(`[affiliate] Novo afiliado ${created.id} (usuario ${userId}).`);
        return (await this.prisma.affiliate.findUnique({ where: { id: created.id } })) ?? created;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const mine = await this.prisma.affiliate.findUnique({ where: { userId } });
          if (mine) return mine;
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not generate an affiliate code. Please try again.');
  }

  async getDashboard(userId: string, now = new Date()) {
    const affiliate = await this.prisma.affiliate.findUnique({ where: { userId } });
    if (!affiliate) return { affiliate: null, program: await this.getProgram() };
    // Pedido em analise ou recusado: so o status. Nada de link, cupom ou taxa.
    if (affiliate.status === 'PENDING' || affiliate.status === 'REJECTED') {
      return { affiliate: { status: affiliate.status, joinedAt: affiliate.createdAt }, program: await this.getProgram() };
    }

    await this.releaseMatured(now, affiliate.id);
    const [clicks, signups, paidCustomers, sums, openSums, commissions, payouts] = await Promise.all([
      this.prisma.affiliateClick.count({ where: { affiliateId: affiliate.id } }),
      this.prisma.affiliateReferral.count({ where: { affiliateId: affiliate.id } }),
      this.prisma.affiliateReferral.count({ where: { affiliateId: affiliate.id, firstPaidAt: { not: null } } }),
      this.prisma.affiliateCommission.groupBy({
        by: ['status'],
        where: { affiliateId: affiliate.id },
        _sum: { commissionCents: true, amountPaidCents: true },
      }),
      this.prisma.affiliateCommission.aggregate({
        where: { affiliateId: affiliate.id, status: 'AVAILABLE', payoutId: { not: null } },
        _sum: { commissionCents: true },
      }),
      this.prisma.affiliateCommission.findMany({
        where: { affiliateId: affiliate.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          id: true,
          referralId: true,
          amountPaidCents: true,
          commissionCents: true,
          status: true,
          availableAt: true,
          createdAt: true,
        },
      }),
      this.prisma.affiliatePayout.findMany({
        where: { affiliateId: affiliate.id },
        orderBy: { requestedAt: 'desc' },
        take: 20,
        select: { id: true, amountCents: true, status: true, requestedAt: true, paidAt: true },
      }),
    ]);

    const byStatus = (status: CommissionStatus, field: 'commissionCents' | 'amountPaidCents' = 'commissionCents') =>
      sums.find((s) => s.status === status)?._sum[field] ?? 0;
    const inPayoutCents = openSums._sum.commissionCents ?? 0;
    const availableCents = byStatus('AVAILABLE') - inPayoutCents;
    const hasOpenPayout = payouts.some((p) => p.status === 'REQUESTED' || p.status === 'APPROVED');

    return {
      affiliate: {
        referralCode: affiliate.referralCode,
        couponCode: affiliate.couponCode,
        commissionPercent: affiliate.commissionRateBps / 100,
        status: affiliate.status,
        joinedAt: affiliate.createdAt,
      },
      program: await this.getProgram(),
      stats: {
        clicks,
        signups,
        paidCustomers,
        revenueCents: (['PENDING', 'AVAILABLE', 'PAID'] as const).reduce((acc, s) => acc + byStatus(s, 'amountPaidCents'), 0),
      },
      balances: {
        pendingCents: byStatus('PENDING'),
        availableCents,
        inPayoutCents,
        paidCents: byStatus('PAID'),
        totalEarnedCents: byStatus('PENDING') + byStatus('AVAILABLE') + byStatus('PAID'),
      },
      canRequestPayout:
        affiliate.status === 'ACTIVE' && !hasOpenPayout && availableCents >= AFFILIATE_RULES.minPayoutCents,
      // Cliente indicado sem e-mail nem nome: so um rotulo estavel por indicacao.
      commissions: commissions.map(({ referralId, ...c }) => ({
        ...c,
        customer: referralId ? `#${referralId.slice(-6).toUpperCase()}` : '#------',
      })),
      payouts,
    };
  }

  /** Pede saque de TODO o saldo disponivel. Um pedido aberto por vez. */
  async requestPayout(userId: string, method: string, now = new Date()) {
    const affiliate = await this.prisma.affiliate.findUnique({ where: { userId } });
    if (!affiliate) throw new NotFoundException('You are not in the affiliate program.');
    if (affiliate.status !== 'ACTIVE') throw new ForbiddenException('Your affiliate account is not active.');

    await this.releaseMatured(now, affiliate.id);

    return this.prisma.$transaction(async (tx) => {
      const open = await tx.affiliatePayout.findFirst({
        where: { affiliateId: affiliate.id, status: { in: ['REQUESTED', 'APPROVED'] } },
        select: { id: true },
      });
      if (open) throw new ConflictException('You already have a payout in progress.');

      const available = await tx.affiliateCommission.findMany({
        where: { affiliateId: affiliate.id, status: 'AVAILABLE', payoutId: null },
        select: { id: true, commissionCents: true },
      });
      const amountCents = available.reduce((acc, c) => acc + c.commissionCents, 0);
      if (amountCents < AFFILIATE_RULES.minPayoutCents) {
        throw new BadRequestException(`The minimum payout is $${AFFILIATE_RULES.minPayoutCents / 100}.`);
      }

      const payout = await tx.affiliatePayout.create({
        data: { affiliateId: affiliate.id, amountCents, method: method.trim().slice(0, 200) },
      });
      const linked = await tx.affiliateCommission.updateMany({
        where: { id: { in: available.map((c) => c.id) }, status: 'AVAILABLE', payoutId: null },
        data: { payoutId: payout.id },
      });
      // Um refund no meio do caminho mudou o saldo: desfaz tudo e a pessoa tenta de novo.
      if (linked.count !== available.length) throw new ConflictException('Your balance changed. Please try again.');
      this.logger.log(`[affiliate] Saque ${payout.id} pedido: ${amountCents}c por ${affiliate.id}.`);
      return payout;
    });
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  async adminList(now = new Date()) {
    await this.releaseMatured(now);
    const affiliates = await this.prisma.affiliate.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { email: true } },
        _count: { select: { clicks: true, referrals: true } },
      },
    });
    const sums = await this.prisma.affiliateCommission.groupBy({
      by: ['affiliateId', 'status'],
      _sum: { commissionCents: true, amountPaidCents: true },
    });
    const sumFor = (id: string, status: CommissionStatus, field: 'commissionCents' | 'amountPaidCents' = 'commissionCents') =>
      sums.find((s) => s.affiliateId === id && s.status === status)?._sum[field] ?? 0;

    return affiliates.map((a) => ({
      id: a.id,
      email: a.user.email,
      referralCode: a.referralCode,
      couponCode: a.couponCode,
      commissionRateBps: a.commissionRateBps,
      status: a.status,
      stripePromotionCodeId: a.stripePromotionCodeId,
      application: a.applicationPlatform || a.applicationUrl || a.applicationAudience || a.applicationNote
        ? {
            platform: a.applicationPlatform,
            url: a.applicationUrl,
            audience: a.applicationAudience,
            note: a.applicationNote,
          }
        : null,
      createdAt: a.createdAt,
      clicks: a._count.clicks,
      signups: a._count.referrals,
      pendingCents: sumFor(a.id, 'PENDING'),
      availableCents: sumFor(a.id, 'AVAILABLE'),
      paidCents: sumFor(a.id, 'PAID'),
      revenueCents: (['PENDING', 'AVAILABLE', 'PAID'] as const).reduce((acc, s) => acc + sumFor(a.id, s, 'amountPaidCents'), 0),
    }));
  }

  async adminDetail(id: string) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id },
      include: { user: { select: { email: true } } },
    });
    if (!affiliate) throw new NotFoundException('Affiliate not found');
    const [referrals, commissions, payouts] = await Promise.all([
      this.prisma.affiliateReferral.findMany({
        where: { affiliateId: id },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { user: { select: { email: true } } },
      }),
      this.prisma.affiliateCommission.findMany({
        where: { affiliateId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
      this.prisma.affiliatePayout.findMany({ where: { affiliateId: id }, orderBy: { requestedAt: 'desc' }, take: 50 }),
    ]);
    const { user, ...profile } = affiliate;
    return {
      affiliate: { ...profile, email: user.email },
      referrals: referrals.map((r) => ({
        id: r.id,
        email: r.user.email,
        source: r.source,
        createdAt: r.createdAt,
        firstPaidAt: r.firstPaidAt,
        commissionEndsAt: r.commissionEndsAt,
      })),
      commissions,
      payouts,
    };
  }

  /** Aprovar/recusar/suspender/reativar, taxa individual e codigos. Tudo auditado. */
  async adminUpdate(
    id: string,
    patch: { status?: AffiliateStatus; commissionRateBps?: number; referralCode?: string; couponCode?: string },
    actorUserId: string,
  ) {
    const current = await this.prisma.affiliate.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Affiliate not found');

    const data: Prisma.AffiliateUpdateInput = {};
    if (patch.status && patch.status !== current.status) {
      const from = current.status as AffiliateStatus;
      if (!STATUS_TRANSITIONS[from]?.includes(patch.status)) {
        throw new ConflictException(`Cannot change affiliate from ${from} to ${patch.status}.`);
      }
      data.status = patch.status;
    }
    if (patch.commissionRateBps !== undefined) data.commissionRateBps = patch.commissionRateBps;
    for (const field of ['referralCode', 'couponCode'] as const) {
      const value = patch[field] !== undefined ? normalizeCode(patch[field]) : undefined;
      if (value === undefined || value === current[field]) continue;
      if (!AFFILIATE_CODE_RE.test(value)) throw new BadRequestException(`${field} must be 4-20 letters or digits.`);
      const clash = await this.prisma.affiliate.findFirst({
        where: { id: { not: id }, OR: [{ referralCode: value }, { couponCode: value }] },
        select: { id: true },
      });
      if (clash) throw new ConflictException(`${value} is already used by another affiliate.`);
      data[field] = value;
    }

    const updated = await this.prisma.affiliate.update({ where: { id }, data });
    const stripeSync = await this.syncPromotionCode(updated);
    await this.prisma.adminAudit.create({
      data: {
        action: 'affiliate_update',
        actorUserId,
        targetUserId: current.userId,
        details: {
          affiliateId: id,
          before: {
            status: current.status,
            commissionRateBps: current.commissionRateBps,
            referralCode: current.referralCode,
            couponCode: current.couponCode,
          },
          after: patch,
          stripeSync,
        },
      },
    });
    return { affiliate: updated, stripeSync };
  }

  /** Todos os saques (os 200 mais recentes); a tela separa pendentes de historico. */
  async adminListPayouts() {
    return this.prisma.affiliatePayout.findMany({
      orderBy: { requestedAt: 'desc' },
      take: 200,
      include: { affiliate: { select: { id: true, referralCode: true, user: { select: { email: true } } } } },
    });
  }

  /**
   * REQUESTED -> APPROVED -> PAID, ou -> REJECTED. Transicao condicional no
   * banco (updateMany com o status esperado): dois cliques nao pagam duas vezes.
   */
  async adminDecidePayout(id: string, action: PayoutAction, actorUserId: string, note?: string) {
    const from: Record<PayoutAction, PayoutStatus[]> = {
      approve: ['REQUESTED'],
      reject: ['REQUESTED', 'APPROVED'],
      mark_paid: ['APPROVED'],
    };
    const to: Record<PayoutAction, PayoutStatus> = { approve: 'APPROVED', reject: 'REJECTED', mark_paid: 'PAID' };
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const payout = await tx.affiliatePayout.findUnique({ where: { id } });
      if (!payout) throw new NotFoundException('Payout not found');

      const moved = await tx.affiliatePayout.updateMany({
        where: { id, status: { in: from[action] } },
        data: {
          status: to[action],
          decidedById: actorUserId,
          ...(note !== undefined ? { adminNote: note.slice(0, 500) } : {}),
          ...(action === 'mark_paid' ? { paidAt: now } : { decidedAt: now }),
        },
      });
      if (moved.count === 0) {
        throw new ConflictException(`Payout is ${payout.status}; cannot ${action.replace('_', ' ')}.`);
      }

      if (action === 'reject') {
        await tx.affiliateCommission.updateMany({ where: { payoutId: id }, data: { payoutId: null } });
      }
      if (action === 'mark_paid') {
        // Paga o que continua valido no pedido (um refund pode ter tirado algo).
        const linked = await tx.affiliateCommission.findMany({
          where: { payoutId: id, status: 'AVAILABLE' },
          select: { commissionCents: true },
        });
        await tx.affiliateCommission.updateMany({
          where: { payoutId: id, status: 'AVAILABLE' },
          data: { status: 'PAID' },
        });
        await tx.affiliatePayout.update({
          where: { id },
          data: { amountCents: linked.reduce((acc, c) => acc + c.commissionCents, 0) },
        });
      }
      return tx.affiliatePayout.findUnique({ where: { id }, include: { affiliate: { select: { userId: true } } } });
    });

    await this.prisma.adminAudit.create({
      data: {
        action: `affiliate_payout_${action}`,
        actorUserId,
        targetUserId: result?.affiliate.userId ?? null,
        details: { payoutId: id, amountCents: result?.amountCents ?? null, note: note ?? null },
      },
    });
    return result;
  }

  private async refreshPayoutAmount(payoutId: string): Promise<void> {
    const agg = await this.prisma.affiliateCommission.aggregate({
      where: { payoutId, status: 'AVAILABLE' },
      _sum: { commissionCents: true },
    });
    await this.prisma.affiliatePayout.updateMany({
      where: { id: payoutId, status: { in: ['REQUESTED', 'APPROVED'] } },
      data: { amountCents: agg._sum.commissionCents ?? 0 },
    });
  }

  // ── Stripe: promotion code do afiliado ───────────────────────────────────

  /**
   * Mantem o promotion code da Stripe igual ao `couponCode` e ao status:
   * codigo novo cria outro e desativa o antigo; suspenso fica inativo.
   * Falha na Stripe nao bloqueia nada: o checkout cai no cupom direto.
   */
  private async syncPromotionCode(affiliate: AffiliateRow): Promise<'ok' | 'skipped' | 'failed'> {
    const couponId = this.affiliateCouponId();
    if (!couponId || !this.stripe) return 'skipped';
    const active = affiliate.status === 'ACTIVE';
    try {
      if (affiliate.stripePromotionCodeId) {
        const promo = await this.stripe.promotionCodes.retrieve(affiliate.stripePromotionCodeId);
        if (promo.code.toUpperCase() === affiliate.couponCode) {
          if (promo.active !== active) await this.stripe.promotionCodes.update(promo.id, { active });
          return 'ok';
        }
        if (promo.active) await this.stripe.promotionCodes.update(promo.id, { active: false });
      }
      const created = await this.stripe.promotionCodes.create({
        coupon: couponId,
        code: affiliate.couponCode,
        active,
        metadata: { affiliateId: affiliate.id },
        restrictions: { first_time_transaction: true },
      });
      await this.prisma.affiliate.update({ where: { id: affiliate.id }, data: { stripePromotionCodeId: created.id } });
      return 'ok';
    } catch (error) {
      this.logger.error(
        `[affiliate] Promotion code de ${affiliate.id} nao sincronizou: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'failed';
    }
  }
}
