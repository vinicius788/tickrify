import { Controller, Get, Header, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../database/prisma.service';
import { UNSUBSCRIBE_AUDIT_ACTION, verifyUnsubscribeToken } from './lifecycle-email';
import { UnsubscribeQueryDto } from './dto/unsubscribe.dto';

const PAGE = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title}</title></head>
<body style="margin:0;background:#050508;color:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:64px 20px;line-height:1.6;">
<h1 style="font-size:22px;margin:0 0 12px;">${title}</h1><p style="color:#9aa3ae;margin:0 0 20px;">${body}</p>
<a href="https://tickrify.com" style="color:#5eea8a;">Back to Tickrify</a></div></body></html>`;

/**
 * Descadastro dos e-mails de ciclo de vida (lifecycle-email.ts). Controller
 * proprio porque o MailModule nao tinha rota e nenhum outro controller e dono
 * deste assunto. GET = link no rodape; POST = descadastro de um clique do
 * Gmail/Yahoo (cabecalho List-Unsubscribe-Post). Recibos da Stripe e e-mails
 * da conta continuam saindo: so os de ciclo de vida respeitam isto.
 */
@Public()
@Controller('email')
export class MailController {
  constructor(private readonly prisma: PrismaService) {}

  private async unsubscribe(query: UnsubscribeQueryDto): Promise<boolean> {
    if (!verifyUnsubscribeToken(query.u, query.t)) return false;
    const already = await this.prisma.adminAudit.findFirst({
      where: { action: UNSUBSCRIBE_AUDIT_ACTION, targetUserId: query.u },
      select: { id: true },
    });
    if (!already) {
      // Conta apagada depois do envio: a FK recusa, e nao ha mais a quem escrever.
      await this.prisma.adminAudit
        .create({ data: { action: UNSUBSCRIBE_AUDIT_ACTION, targetUserId: query.u, details: { scope: 'lifecycle' } } })
        .catch(() => undefined);
    }
    return true;
  }

  @Get('unsubscribe')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Content-Type', 'text/html; charset=utf-8')
  async unsubscribePage(@Query() query: UnsubscribeQueryDto): Promise<string> {
    const ok = await this.unsubscribe(query);
    return ok
      ? PAGE('You are unsubscribed', 'You will not get tips or reminders from Tickrify anymore. Receipts and account emails still arrive.')
      : PAGE('This link is not valid', 'Reply to any Tickrify email and we will remove you by hand.');
  }

  @Post('unsubscribe')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async unsubscribeOneClick(@Query() query: UnsubscribeQueryDto): Promise<{ ok: boolean }> {
    return { ok: await this.unsubscribe(query) };
  }
}
