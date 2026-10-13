import { Injectable, Logger } from '@nestjs/common';
import { flagBool } from '../../common/flags/feature-flags';
import { renderWelcomeEmail, renderWelcomeText, welcomeSubject } from './welcome-email';

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

  /**
   * `from` e `replyTo` sao opcionais: sem eles valem MAIL_FROM e MAIL_REPLY_TO.
   * `kind` so serve para o log: todo envio aceito pela Resend deixa
   * `[mail] Enviado kind=<tipo> id=<id da Resend>` no Render (sem o endereco).
   * Ate 29/09 so a falha deixava rastro e o boas-vindas era invisivel.
   * Devolve true quando a Resend aceitou.
   */
  private async send(
    to: string,
    subject: string,
    html: string,
    options: { kind: string; replyTo?: string; from?: string; headers?: Record<string, string>; text?: string },
  ): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.warn('RESEND_API_KEY ausente — pulando envio de e-mail.');
      return false;
    }
    if (!to) return false;

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: options.from || this.from,
          to,
          subject,
          html,
          ...(options.text ? { text: options.text } : {}),
          reply_to: options.replyTo || this.replyTo,
          ...(options.headers ? { headers: options.headers } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(`Resend falhou (${res.status}) kind=${options.kind}: ${body}`);
        return false;
      }
      const raw = await res.text().catch(() => '');
      let id = 'n/a';
      try {
        id = String((JSON.parse(raw) as { id?: string })?.id || 'n/a');
      } catch {
        /* corpo sem JSON: o envio foi aceito do mesmo jeito */
      }
      this.logger.log(`[mail] Enviado kind=${options.kind} id=${id}`);
      return true;
    } catch (err) {
      this.logger.error(`Erro ao enviar e-mail kind=${options.kind}: ${(err as Error)?.message ?? err}`);
      return false;
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
      { kind: 'problem_report', replyTo },
    );
  }

  /**
   * Chat do painel (12/10/2026): chegou mensagem de usuario. Operacional, igual
   * ao relato de problema: vai para o suporte com o texto (escapado, nunca HTML
   * do usuario) e o link para responder pelo /admin, aba Chat.
   */
  async sendChatFounderNotify(
    to: string,
    info: { userEmail: string | null; isSubscriber: boolean; freeLocked: boolean; body: string },
  ): Promise<boolean> {
    const escape = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const plano = info.isSubscriber ? 'assinante' : info.freeLocked ? 'gratis esgotado' : 'gratis';
    return this.send(
      to,
      '[Tickrify] Nova mensagem no chat',
      `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#16202a;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="font-size:13px;color:#5b6b7a;margin-bottom:8px;">Tickrify · chat do painel</div>
    <p style="margin:0 0 4px;"><b>${escape(info.userEmail || 'sem e-mail')}</b> (${plano})</p>
    <div style="white-space:pre-wrap;border-left:3px solid #d0d7de;padding-left:12px;margin:12px 0;">${escape(info.body)}</div>
    <p style="font-size:13px;color:#5b6b7a;">Responda pelo painel: o historico fica la e a pessoa le no Tickrify.</p>
    <a href="${this.appUrl}/admin?aba=chat" style="display:inline-block;margin-top:8px;font-size:14px;">Abrir o chat no /admin</a>
  </div>
</body></html>`,
      { kind: 'chat_founder_notify' },
    );
  }

  /**
   * Alerta operacional para o dono (ex.: teto de gasto do trial). Vai para o
   * suporte (FOUNDER_CHAT_NOTIFY_TO, padrao support@), nunca para usuario.
   */
  async sendOwnerAlert(subject: string, corpoHtml: string): Promise<boolean> {
    const to = process.env.FOUNDER_CHAT_NOTIFY_TO?.trim() || 'support@tickrify.com';
    return this.send(
      to,
      subject,
      `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#16202a;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="font-size:13px;color:#5b6b7a;margin-bottom:8px;">Tickrify · alerta operacional</div>
    ${corpoHtml}
    <a href="${this.appUrl}/admin" style="display:inline-block;margin-top:16px;font-size:14px;">Abrir o painel</a>
  </div>
</body></html>`,
      { kind: 'owner_alert' },
    );
  }

  /** Boas-vindas: disparado uma unica vez, quando a conta nova e criada. `firstName` e opcional. */
  async sendWelcome(to: string, firstName?: string | null): Promise<void> {
    // Conta nova com TRIAL_MODE ligado entra no trial de 3 dias: o texto acompanha.
    const trial = flagBool('TRIAL_MODE');
    await this.send(to, welcomeSubject(trial), renderWelcomeEmail({ appUrl: this.appUrl, firstName, trial }), {
      kind: 'welcome',
      text: renderWelcomeText({ appUrl: this.appUrl, firstName, trial }),
    });
  }

  /**
   * Recuperação: a cota grátis acabou e a pessoa não assinou.
   *
   * `offer`: o cupom so entra no texto se ainda estiver ativo na Stripe.
   * Prometer desconto esgotado e cobrar cheio e exatamente o que isto evita.
   *
   * Texto de 29/09 (aprovado pelo dono): o anterior presumia uso ("Looks like
   * the AI's been helping you confirm entries") e so oferecia o mensal. Agora
   * so afirma o que e verdade para todos e mostra o semanal primeiro, porque o
   * publico e quase todo de pais onde US$ 29 de uma vez nao fecha.
   */
  async sendRecovery(to: string, offer?: { code: string; percentOff: number | null } | null): Promise<boolean> {
    const oferta =
      offer && offer.percentOff
        ? `, or use code <b>${offer.code}</b> for ${offer.percentOff}% off the first month`
        : '';
    const subject = 'Your free Tickrify analyses are used up';
    const html = this.wrap(
      subject,
      `To keep getting entry, stop and targets on your charts, pick a plan:<br><br>` +
        `<b>One week:</b> $7.99 for 25 analyses.<br>` +
        `<b>Monthly:</b> $29 for 200 analyses${oferta}.<br><br>` +
        `Both renew automatically and you can cancel anytime.`,
      'See plans',
      `${this.appUrl}/pricing`,
    );
    return this.send(to, subject, html, { kind: 'recovery' });
  }

  /**
   * E-mails de ciclo de vida (ativacao e checkout abandonado). Saem em nome do
   * fundador (LIFECYCLE_MAIL_FROM; resposta cai na caixa dele) e levam o
   * cabecalho de descadastro de um clique que Gmail e Yahoo exigem.
   */
  async sendLifecycle(
    to: string,
    email: { kind: string; subject: string; html: string; unsubscribeUrl: string },
  ): Promise<boolean> {
    // Nome do dono: Vinicius, nunca "Vini" (Founder e CEO valem). Sem acento no
    // cabecalho From de proposito: nome com acento exige codificacao especial
    // e uma recusa aqui derrubaria todos os e-mails de ciclo de vida.
    const from = process.env.LIFECYCLE_MAIL_FROM || 'Vinicius from Tickrify <vinicius@tickrify.com>';
    const replyTo = process.env.LIFECYCLE_MAIL_REPLY_TO || 'vinicius@tickrify.com';
    return this.send(to, email.subject, email.html, {
      kind: email.kind,
      from,
      replyTo,
      headers: {
        'List-Unsubscribe': `<${email.unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  }
}
