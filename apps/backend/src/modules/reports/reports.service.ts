import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';

export type ReportStatus = 'aberto' | 'investigando' | 'resolvido' | 'descartado';

export const REPORT_STATUSES: readonly ReportStatus[] = [
  'aberto',
  'investigando',
  'resolvido',
  'descartado',
] as const;

export interface ProblemReportRow {
  id: string;
  userId: string | null;
  message: string;
  route: string | null;
  analysisId: string | null;
  context: unknown;
  status: string;
  resolvedAt: Date | null;
  createdAt: Date;
  userEmail?: string | null;
}

/**
 * Relatos de problema.
 *
 * O objetivo não é ter um formulário. É encurtar a distância entre "o usuário
 * viu algo errado" e "alguém consegue REPRODUZIR". Um relato sem contexto vira
 * "não consegui reproduzir" e morre — por isso o cliente manda rota, análise
 * envolvida, navegador e as últimas ações, e o servidor guarda tudo junto.
 *
 * SQL cru pelo mesmo motivo do FeatureFlagsService: o client do Prisma só pode
 * ser regenerado dentro do Render (binaries.prisma.sh é inalcançável de fora),
 * e um `tsc` local que mente é pior do que SQL explícito. Tudo parametrizado.
 */
@Injectable()
export class ReportsService implements OnModuleInit {
  private readonly logger = new Logger(ReportsService.name);

  /** Teto do contexto gravado. Blob gigante não ajuda a depurar e enche o banco. */
  private static readonly MAX_CONTEXT_BYTES = 8_000;
  private static readonly MAX_CONTEXT_KEYS = 40;

  /**
   * Teto GLOBAL de e-mails de relato por hora, somando todos os usuarios. O
   * limite por usuario (5/h) nao segura quem cria varias contas e troca de IP,
   * e cada relato vira um e-mail por destino. Sem este teto, uma rajada gasta a
   * cota diaria do Resend e derruba junto os e-mails de boas-vindas e de
   * recuperacao. Passando do teto o relato continua GRAVADO (aparece no /admin);
   * so o aviso por e-mail fica de fora ate a janela virar.
   */
  static readonly MAX_REPORT_EMAILS_PER_HOUR = 20;
  private emailWindowStart = 0;
  private emailsInWindow = 0;

  /** Reserva `n` envios na janela atual; false se passaria do teto. */
  private reservarEmails(n: number, agora = Date.now()): boolean {
    if (agora - this.emailWindowStart >= 3_600_000) {
      this.emailWindowStart = agora;
      this.emailsInWindow = 0;
    }
    if (this.emailsInWindow + n > ReportsService.MAX_REPORT_EMAILS_PER_HOUR) return false;
    this.emailsInWindow += n;
    return true;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Rede de segurança idempotente (RUN_MIGRATIONS_ON_START=false em produção).
    // Falhar aqui não pode derrubar o boot: sem a tabela, o botão devolve erro
    // e o resto do app segue normal.
    try {
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "tickrify"."ProblemReport" (
          "id"         TEXT PRIMARY KEY,
          "userId"     TEXT,
          "message"    TEXT NOT NULL,
          "route"      TEXT,
          "analysisId" TEXT,
          "context"    JSONB,
          "status"     TEXT NOT NULL DEFAULT 'aberto',
          "resolvedAt" TIMESTAMP(3),
          "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await this.prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS "ProblemReport_status_createdAt_idx" ON "tickrify"."ProblemReport"("status", "createdAt" DESC)',
      );
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."ProblemReport" ENABLE ROW LEVEL SECURITY',
      );
    } catch (error) {
      this.logger.warn(
        `[relatos] Não foi possível preparar a tabela: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  /**
   * Limita o que vem do cliente ANTES de gravar.
   *
   * O `ValidationPipe` global tem `forbidNonWhitelisted`, mas ele não alcança
   * dentro de um campo Json: `context` é objeto livre por design, então quem
   * impõe limite de tamanho, de profundidade e de quantidade de chaves é este
   * método. Sem ele, o botão vira um canal para gravar megabytes arbitrários
   * no banco a partir de qualquer conta.
   */
  private sanitizarContexto(context: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      return Prisma.DbNull;
    }

    const plano: Record<string, unknown> = {};
    let chaves = 0;

    for (const [chave, valor] of Object.entries(context as Record<string, unknown>)) {
      if (chaves >= ReportsService.MAX_CONTEXT_KEYS) break;
      if (typeof chave !== 'string' || chave.length > 60) continue;

      // Só primitivos e arrays rasos de string. Objeto aninhado profundo é o
      // que faz o JSON explodir de tamanho sem acrescentar informação útil.
      if (valor === null || ['string', 'number', 'boolean'].includes(typeof valor)) {
        plano[chave] = typeof valor === 'string' ? valor.slice(0, 500) : valor;
        chaves++;
      } else if (Array.isArray(valor)) {
        plano[chave] = valor.slice(0, 25).map((item) => String(item).slice(0, 300));
        chaves++;
      }
    }

    let serializado = JSON.stringify(plano);
    if (serializado.length > ReportsService.MAX_CONTEXT_BYTES) {
      // Trunca as migalhas primeiro: são a parte volumosa e a menos crítica.
      if (Array.isArray(plano.migalhas)) {
        plano.migalhas = (plano.migalhas as string[]).slice(-10);
        plano.migalhasTruncadas = true;
      }
      serializado = JSON.stringify(plano);
      if (serializado.length > ReportsService.MAX_CONTEXT_BYTES) {
        return { truncado: true, motivo: 'contexto acima do limite' } as Prisma.InputJsonValue;
      }
    }

    return plano as Prisma.InputJsonValue;
  }

  async criar(params: {
    userId: string;
    userEmail?: string | null;
    message: string;
    route?: string;
    analysisId?: string;
    context?: Record<string, unknown>;
  }): Promise<{ id: string; status: ReportStatus }> {
    const id = randomUUID();
    const contexto = this.sanitizarContexto(params.context);

    await this.prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "tickrify"."ProblemReport"
          ("id", "userId", "message", "route", "analysisId", "context", "status", "createdAt")
        VALUES (
          ${id},
          ${params.userId},
          ${params.message.trim()},
          ${params.route ?? null},
          ${params.analysisId ?? null},
          ${contexto === Prisma.DbNull ? null : JSON.stringify(contexto)}::jsonb,
          'aberto',
          NOW()
        )
      `,
    );

    this.logger.log(
      `[relatos] Novo relato ${id}${params.route ? ` em ${params.route}` : ''}${
        params.analysisId ? ` (análise ${params.analysisId})` : ''
      }`,
    );

    // Aviso ao admin: fire-and-forget. O relato JÁ está gravado — falha de
    // e-mail não pode fazer o usuário achar que o envio não funcionou.
    void this.avisarAdmin(id, params).catch(() => undefined);

    return { id, status: 'aberto' };
  }

  private async avisarAdmin(
    id: string,
    params: { userEmail?: string | null; message: string; route?: string; analysisId?: string },
  ): Promise<void> {
    // Vai para a caixa do suporte e para os admins (a mesma allowlist que
    // define quem e admin), sem repetir endereco.
    const suporte = String(process.env.SUPPORT_EMAIL || 'support@tickrify.com').trim();
    const destinos = [
      ...new Set(
        [suporte, ...String(process.env.BOOTSTRAP_ADMIN_EMAILS || '').split(',')]
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    // "Responder" vai direto para quem reportou, quando o e-mail e conhecido.
    const replyTo = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(params.userEmail || '')
      ? String(params.userEmail)
      : undefined;

    if (!this.reservarEmails(destinos.length)) {
      this.logger.warn(
        `[relatos] Teto de ${ReportsService.MAX_REPORT_EMAILS_PER_HOUR} e-mails/hora atingido; relato ${id} gravado sem aviso por e-mail.`,
      );
      return;
    }

    const escapar = (texto: string) =>
      texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const corpo = `
      <p><strong>${escapar(params.message.slice(0, 500))}</strong></p>
      <p style="font-size:13px;color:#5b6b7a;">
        Rota: ${escapar(params.route || '—')}<br/>
        Análise: ${escapar(params.analysisId || '—')}<br/>
        Usuário: ${escapar(params.userEmail || '—')}<br/>
        Relato: ${escapar(id)}
      </p>`;

    for (const destino of destinos) {
      await this.mail.sendProblemReport(destino, corpo, replyTo);
    }
  }

  async listar(status?: ReportStatus, limite = 50): Promise<ProblemReportRow[]> {
    const take = Math.min(Math.max(limite, 1), 200);

    const linhas = status
      ? await this.prisma.$queryRaw<ProblemReportRow[]>(Prisma.sql`
          SELECT r.*, u."email" AS "userEmail"
          FROM "tickrify"."ProblemReport" r
          LEFT JOIN "tickrify"."User" u ON u."id" = r."userId"
          WHERE r."status" = ${status}
          ORDER BY r."createdAt" DESC
          LIMIT ${take}
        `)
      : await this.prisma.$queryRaw<ProblemReportRow[]>(Prisma.sql`
          SELECT r.*, u."email" AS "userEmail"
          FROM "tickrify"."ProblemReport" r
          LEFT JOIN "tickrify"."User" u ON u."id" = r."userId"
          ORDER BY r."createdAt" DESC
          LIMIT ${take}
        `);

    return linhas;
  }

  async contarPorStatus(): Promise<Record<string, number>> {
    const linhas = await this.prisma.$queryRaw<Array<{ status: string; total: bigint }>>(
      Prisma.sql`SELECT "status", COUNT(*)::bigint AS total FROM "tickrify"."ProblemReport" GROUP BY "status"`,
    );
    const saida: Record<string, number> = {};
    for (const linha of linhas) saida[linha.status] = Number(linha.total);
    return saida;
  }

  async definirStatus(id: string, status: ReportStatus): Promise<void> {
    await this.prisma.$executeRaw(
      Prisma.sql`
        UPDATE "tickrify"."ProblemReport"
        SET "status" = ${status},
            "resolvedAt" = ${status === 'resolvido' || status === 'descartado' ? new Date() : null}
        WHERE "id" = ${id}
      `,
    );
  }
}
