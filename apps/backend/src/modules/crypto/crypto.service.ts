import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { captureServer } from '../../common/analytics/posthog';
import { funnelLog } from '../../common/observability/funnel-log';
import { publicUrl } from '../mail/lifecycle-email';
import {
  activateCryptoPass,
  CRYPTO_PASSES,
  CRYPTO_PASS_PREFIX,
  CryptoPassKind,
  isCryptoPassKind,
  refreshCryptoPasses,
} from './crypto-pass';
import {
  createInvoice,
  getPayment,
  isNowPaymentsConfigured,
  nowPaymentsConfig,
  NowPayment,
  verifyIpnSignature,
} from './nowpayments';

/** Assinatura de cartao (ou acesso manual) viva: nao vende passe por cima. */
const CARD_BLOCKING_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'];

const BOOT_SQL = [
  `CREATE TABLE IF NOT EXISTS "tickrify"."CryptoPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pass" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "providerInvoiceId" TEXT,
    "providerPaymentId" TEXT,
    "payCurrency" TEXT,
    "actuallyPaid" TEXT,
    "subscriptionId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CryptoPayment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CryptoPayment_pass_check" CHECK ("pass" IN ('week', 'month')),
    CONSTRAINT "CryptoPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tickrify"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CryptoPayment_providerInvoiceId_key" ON "tickrify"."CryptoPayment"("providerInvoiceId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CryptoPayment_providerPaymentId_key" ON "tickrify"."CryptoPayment"("providerPaymentId")`,
  `CREATE INDEX IF NOT EXISTS "CryptoPayment_userId_createdAt_idx" ON "tickrify"."CryptoPayment"("userId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "CryptoPayment_status_idx" ON "tickrify"."CryptoPayment"("status")`,
];

const PASS_LABEL: Record<CryptoPassKind, string> = {
  week: 'Tickrify 7-day pass (25 analyses)',
  month: 'Tickrify 30-day pass (200 analyses)',
};

function cents(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Origem do site para a volta do pagamento. Mesma lista do checkout da Stripe. */
function appBaseUrl(): string {
  for (const candidate of [process.env.APP_URL, process.env.FRONTEND_URL]) {
    try {
      const parsed = new URL(String(candidate || ''));
      if (parsed.protocol === 'https:' || parsed.hostname === 'localhost') return parsed.origin;
    } catch {
      continue;
    }
  }
  throw new ServiceUnavailableException({ code: 'crypto_unavailable', message: 'Crypto payments are not available right now.' });
}

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private tableReady = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      for (const sql of BOOT_SQL) await this.prisma.$executeRawUnsafe(sql);
      this.tableReady = true;
      this.logger.log(`[crypto] Tabela pronta. NOWPayments: ${isNowPaymentsConfigured() ? 'configurado' : 'DESLIGADO (sem NOWPAYMENTS_API_KEY/NOWPAYMENTS_IPN_SECRET)'}.`);
    } catch (error) {
      this.logger.error('[crypto] Nao consegui garantir a tabela CryptoPayment; pagamento em cripto desligado.', error);
    }
  }

  /** O painel so mostra "Pay with crypto" quando isto e verdade. */
  isEnabled(): boolean {
    return this.tableReady && isNowPaymentsConfigured();
  }

  private unavailable() {
    return new ServiceUnavailableException({ code: 'crypto_unavailable', message: 'Crypto payments are not available right now.' });
  }

  async createCheckout(userId: string, pass: CryptoPassKind): Promise<{ url: string; paymentId: string }> {
    if (!this.isEnabled()) throw this.unavailable();
    if (!isCryptoPassKind(pass)) throw new HttpException({ code: 'invalid_pass' }, HttpStatus.BAD_REQUEST);

    await refreshCryptoPasses(this.prisma, userId);
    const card = await this.prisma.subscription.findFirst({
      where: { userId, status: { in: CARD_BLOCKING_STATUSES }, NOT: { stripeId: { startsWith: CRYPTO_PASS_PREFIX } } },
      select: { status: true },
    });
    if (card) {
      funnelLog('crypto_checkout_failed', { user: userId, pass, code: 'already_subscribed', status: card.status }, { level: 'warn' });
      throw new ConflictException({ code: 'already_subscribed', message: 'You already have an active subscription.' });
    }

    const plan = CRYPTO_PASSES[pass];
    const payment = await this.prisma.cryptoPayment.create({
      data: { userId, pass, priceCents: plan.priceCents },
      select: { id: true },
    });

    const app = appBaseUrl();
    const api = publicUrl(process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL, 'https://tickrify.onrender.com');
    try {
      const invoice = await createInvoice({
        priceUsd: plan.priceCents / 100,
        orderId: payment.id,
        description: PASS_LABEL[pass],
        ipnCallbackUrl: `${api}/api/crypto/webhook`,
        successUrl: `${app}/dashboard?crypto=success&order=${payment.id}`,
        cancelUrl: `${app}/dashboard/plans?crypto=canceled`,
        partiallyPaidUrl: `${app}/dashboard/plans?crypto=partial`,
      });
      await this.prisma.cryptoPayment.update({ where: { id: payment.id }, data: { providerInvoiceId: invoice.id } });
      funnelLog('crypto_checkout_created', { user: userId, pass, payment: payment.id, amount: plan.priceCents / 100, currency: 'usd' }, { persist: this.prisma });
      return { url: invoice.invoice_url, paymentId: payment.id };
    } catch (error) {
      await this.prisma.cryptoPayment.update({ where: { id: payment.id }, data: { status: 'invoice_failed' } }).catch(() => undefined);
      funnelLog('crypto_checkout_failed', { user: userId, pass, payment: payment.id, message: (error as Error)?.message }, { level: 'error', persist: this.prisma });
      throw this.unavailable();
    }
  }

  /**
   * Status de UM pagamento da propria conta, para a tela de volta saber quando o
   * passe ligou (inclusive quem estende um passe que ja estava ativo).
   */
  async getPaymentStatus(userId: string, paymentId: string): Promise<{ status: string; active: boolean }> {
    const payment = await this.prisma.cryptoPayment.findFirst({
      where: { id: paymentId, userId },
      select: { status: true, subscriptionId: true },
    });
    if (!payment) throw new NotFoundException({ code: 'not_found' });
    return { status: payment.status, active: Boolean(payment.subscriptionId) };
  }

  /**
   * Aviso do NOWPayments. A assinatura prova que veio deles; mesmo assim a
   * decisao sai da RELEITURA do pagamento na API (o corpo do aviso nunca e a
   * fonte da verdade, como na Stripe). Libera o passe uma vez so.
   */
  async handleIpn(body: unknown, signature: string | undefined): Promise<{ received: true }> {
    if (!this.isEnabled()) throw this.unavailable();
    if (!verifyIpnSignature(body, signature, nowPaymentsConfig().ipnSecret)) {
      funnelLog('crypto_ipn_rejected', { reason: signature ? 'bad_signature' : 'missing_signature' }, { level: 'warn' });
      throw new UnauthorizedException({ code: 'invalid_signature' });
    }

    const notice = body as Record<string, unknown>;
    const orderId = typeof notice.order_id === 'string' ? notice.order_id : '';
    const paymentId = String(notice.payment_id ?? '');
    const record = orderId
      ? await this.prisma.cryptoPayment.findUnique({ where: { id: orderId } })
      : null;
    if (!record) {
      // 2xx: nao e nosso (ou foi apagado). Repetir o aviso nao muda nada.
      funnelLog('crypto_ipn_rejected', { reason: 'unknown_order', payment: paymentId }, { level: 'warn' });
      return { received: true };
    }

    const live = await getPayment(paymentId);
    const pass = isCryptoPassKind(record.pass) ? record.pass : null;
    const problem = this.mismatch(record, live, pass);
    if (problem) {
      funnelLog('crypto_payment_mismatch', { user: record.userId, payment: record.id, reason: problem, status: live.payment_status }, { level: 'error', persist: this.prisma });
      return { received: true };
    }

    const status = String(live.payment_status);
    await this.prisma.cryptoPayment.update({
      where: { id: record.id },
      data: {
        status,
        providerPaymentId: String(live.payment_id),
        payCurrency: live.pay_currency ? String(live.pay_currency).slice(0, 30) : null,
        actuallyPaid: live.actually_paid != null ? String(live.actually_paid).slice(0, 40) : null,
      },
    });

    if (status === 'partially_paid') {
      funnelLog('crypto_payment_partial', { user: record.userId, payment: record.id, pass }, { level: 'warn', persist: this.prisma });
      return { received: true };
    }
    if (status !== 'finished' || !pass) {
      funnelLog('crypto_payment_updated', { user: record.userId, payment: record.id, status });
      return { received: true };
    }

    const activated = await activateCryptoPass(this.prisma, { userId: record.userId, paymentId: record.id, kind: pass });
    if (activated.created) {
      await this.prisma.cryptoPayment.update({
        where: { id: record.id },
        data: { subscriptionId: activated.stripeId, paidAt: new Date() },
      });
      funnelLog(
        'crypto_payment_succeeded',
        { user: record.userId, payment: record.id, pass, amount: record.priceCents / 100, currency: 'usd', status: activated.status },
        { persist: this.prisma },
      );
      await this.track(record.userId, record.id, pass, record.priceCents, activated.end);
    }
    return { received: true };
  }

  /** Motivo para NAO confiar no pagamento, ou null. */
  private mismatch(
    record: { id: string; priceCents: number; providerInvoiceId: string | null },
    live: NowPayment,
    pass: CryptoPassKind | null,
  ): string | null {
    if (!pass) return 'unknown_pass';
    if (String(live.order_id ?? '') !== record.id) return 'order_id';
    if (String(live.price_currency || '').toLowerCase() !== 'usd') return 'currency';
    if (cents(live.price_amount) !== record.priceCents) return 'amount';
    if (live.parent_payment_id) return 'repeated_deposit';
    if (record.providerInvoiceId && live.invoice_id != null && String(live.invoice_id) !== record.providerInvoiceId) return 'invoice_id';
    return null;
  }

  private async track(userId: string, paymentId: string, pass: CryptoPassKind, priceCents: number, endsAt: Date) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { clerkUserId: true } });
    if (!user?.clerkUserId) return;
    captureServer(
      user.clerkUserId,
      'crypto_payment_succeeded',
      { pass, amount: priceCents / 100, currency: 'usd', passEndsAt: endsAt.toISOString(), $set: { is_subscriber: true, payment_method: 'crypto' } },
      { dedupeKey: `crypto_payment_succeeded:${paymentId}` },
    );
  }
}
