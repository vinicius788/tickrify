import { Injectable, Logger } from '@nestjs/common';

/**
 * Serviço de e-mail isolado, usando a API HTTP do Resend (sem dependência nova).
 * Nunca lança erro pra cima — falha de e-mail jamais pode quebrar uma request.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey = process.env.RESEND_API_KEY || '';
  // Antes de verificar o domínio no Resend, use o remetente de teste padrão.
  // Depois de verificar tickrify.com, troque MAIL_FROM para algo como
  // "Tickrify <noreply@tickrify.com>".
  private readonly from = process.env.MAIL_FROM || 'Tickrify <onboarding@resend.dev>';
  private readonly appUrl = process.env.FRONTEND_URL || 'https://tickrify.com';
  // O remetente e noreply@; sem isto, quem responde ao e-mail fala com ninguem.
  private readonly replyTo = process.env.MAIL_REPLY_TO || 'support@tickrify.com';

  private async send(to: string, subject: string, html: string, replyTo?: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn('RESEND_API_KEY ausente — pulando envio de e-mail.');
      return;
    }
    if (!to) return;

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: this.from, to, subject, html, reply_to: replyTo || this.replyTo }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(`Resend falhou (${res.status}): ${body}`);
      }
    } catch (err) {
      this.logger.error(`Erro ao enviar e-mail: ${(err as Error)?.message ?? err}`);
    }
  }

  private wrap(title: string, bodyHtml: string, ctaLabel: string, ctaUrl: string): string {
    return `<!doctype html><html><body style="margin:0;background:#0b0f14;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#16202a;">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
    <div style="font-size:20px;font-weight:700;color:#ffffff;margin-bottom:24px;">Tickrify</div>
    <div style="background:#ffffff;border-radius:14px;padding:28px 26px;">
      <h1 style="font-size:20px;margin:0 0 12px;">${title}</h1>
      <div style="font-size:15px;line-height:1.6;color:#33424f;">${bodyHtml}</div>
      <a href="${ctaUrl}" style="display:inline-block;margin-top:22px;background:#2eb872;color:#04240f;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px;">${ctaLabel}</a>
    </div>
    <div style="font-size:11px;color:#5b6b7a;margin-top:18px;line-height:1.5;">
      Tickrify gives a second opinion, not financial advice. The decision is yours.
    </div>
  </div>
</body></html>`;
  }

  /**
   * Aviso de relato de problema para o admin.
   *
   * Não usa o wrap() das outras mensagens de propósito: aquele template tem
   * CTA verde e disclaimer de produto, desenhado para o CLIENTE. Aqui o
   * destinatário é operacional e o que importa é ler o relato rápido.
   */
  /** `replyTo`: e-mail de quem reportou, para o "responder" ir direto a ela. */
  async sendProblemReport(to: string, corpoHtml: string, replyTo?: string): Promise<void> {
    await this.send(
      to,
      '[Tickrify] Novo relato de problema',
      `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#16202a;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="font-size:13px;color:#5b6b7a;margin-bottom:8px;">Tickrify · relato de problema</div>
    ${corpoHtml}
    <a href="${this.appUrl}/admin" style="display:inline-block;margin-top:16px;font-size:14px;">Abrir o painel</a>
  </div>
</body></html>`,
      replyTo,
    );
  }

  /** Boas-vindas: disparado quando uma conta nova é criada. */
  async sendWelcome(to: string): Promise<void> {
    const html = this.wrap(
      'Your 3 free analyses are ready',
      `Welcome to Tickrify. You've got <b>3 free analyses</b>. Paste any chart and get the entry, stop, targets and risk before you decide.<br><br>Best way to start: run the next trade you're already unsure about.`,
      'Analyze a chart',
      `${this.appUrl}/dashboard`,
    );
    await this.send(to, 'Your 3 free analyses are ready', html);
  }

  /** Recuperação: créditos grátis acabaram e o usuário não assinou. */
  /**
   * `offer`: o cupom so entra no texto se ainda estiver ativo na Stripe.
   * Prometer desconto esgotado e cobrar cheio e exatamente o que isto evita.
   */
  async sendRecovery(to: string, offer?: { code: string; percentOff: number | null } | null): Promise<void> {
    const oferta =
      offer && offer.percentOff
        ? ` and keep this early-user code: <b>${offer.code}</b> (${offer.percentOff}% off your first month, then $29/month)`
        : '';
    const html = this.wrap(
      "Your analyses ran out, and your trades will not wait",
      `You used your free analyses. Looks like the AI's been helping you confirm entries, so it makes no sense to go back to trading blind.<br><br>Subscribe for 200 analyses a month${oferta}.`,
      'Subscribe',
      `${this.appUrl}/pricing`,
    );
    await this.send(to, "Your analyses ran out, and your trades will not wait", html);
  }
}
