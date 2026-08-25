import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  FLAG_REGISTRY,
  applyFlagOverrideLocally,
  getFlagDefinition,
  getFlagCacheStatus,
  loadFlagsFromDb,
  resolveAllFlags,
  startFlagRefresh,
  type ResolvedFlag,
} from '../../common/flags/feature-flags';

/**
 * O lado servidor da loja de apps interna.
 *
 * ACESSO À TABELA POR SQL CRU, E NÃO POR `prisma.featureFlag`
 * Não é preguiça: o client do Prisma só consegue ser regenerado dentro do
 * Render, porque `binaries.prisma.sh` é inalcançável tanto da máquina de
 * desenvolvimento quanto do sandbox. Usar o modelo gerado deixaria o
 * `tsc` local quebrado até o próximo deploy, e "o typecheck local mente" é
 * exatamente o tipo de coisa que faz alguém parar de rodar o typecheck.
 * A tabela DemoUsage já é gerenciada assim desde a Fase 0 — este é o padrão
 * da casa, não uma exceção.
 *
 * Todas as consultas são parametrizadas com Prisma.sql. Nenhuma interpolação
 * de string entra em SQL aqui, mesmo a chave vindo de um registro fechado.
 */
@Injectable()
export class FeatureFlagsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private stopRefresh: (() => void) | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Rede de segurança idempotente, mesmo padrão do AiService: em produção
    // RUN_MIGRATIONS_ON_START=false, então a migração pode não ter rodado.
    // Se isto falhar, o app segue normal e as flags resolvem por env.
    try {
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "tickrify"."FeatureFlag" (
          "key"         TEXT PRIMARY KEY,
          "value"       TEXT NOT NULL,
          "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedById" TEXT
        )
      `);
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."FeatureFlag" ENABLE ROW LEVEL SECURITY',
      );
    } catch (error) {
      this.logger.warn(
        `[flags] Não foi possível preparar a tabela (as flags seguem resolvendo por env): ${
          error instanceof Error ? error.message : error
        }`,
      );
    }

    this.stopRefresh = startFlagRefresh(() => this.readOverrides());

    const ligadas = resolveAllFlags().filter((f) => f.value === 'true' || Number(f.value) > 0);
    this.logger.log(
      `[flags] Loja de apps pronta — ${FLAG_REGISTRY.length} funções registradas, ${ligadas.length} ativas.`,
    );
  }

  onModuleDestroy(): void {
    this.stopRefresh?.();
  }

  /** Leitura crua dos overrides. É o `FlagLoader` que alimenta o cache. */
  private async readOverrides(): Promise<Array<{ key: string; value: string }>> {
    return this.prisma.$queryRaw<Array<{ key: string; value: string }>>(
      Prisma.sql`SELECT "key", "value" FROM "tickrify"."FeatureFlag"`,
    );
  }

  /** Estado completo para o painel: valor, origem e metadados de cada função. */
  listar(): { flags: ResolvedFlag[]; cache: ReturnType<typeof getFlagCacheStatus> } {
    return { flags: resolveAllFlags(), cache: getFlagCacheStatus() };
  }

  /**
   * Grava um override e registra QUEM mexeu.
   *
   * A auditoria não é enfeite: sem ela, "desde quando o grounding está
   * desligado?" não tem resposta — que é exatamente a pergunta que apareceu
   * quando a vitrine passou a vender uma feature que a produção não entregava.
   */
  async definir(
    key: string,
    value: string,
    ator: { id: string; clerkUserId: string },
  ): Promise<ResolvedFlag> {
    const definition = getFlagDefinition(key);
    if (!definition) {
      // Registro fechado: impede que um typo crie uma flag fantasma que parece
      // ligada no painel e não controla nada no código.
      throw new BadRequestException(`Função desconhecida: ${key}`);
    }

    const normalized = this.validar(definition.type, value, key);
    const antes = resolveAllFlags().find((f) => f.key === key);

    await this.prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "tickrify"."FeatureFlag" ("key", "value", "updatedAt", "updatedById")
        VALUES (${key}, ${normalized}, NOW(), ${ator.id})
        ON CONFLICT ("key") DO UPDATE
          SET "value" = ${normalized}, "updatedAt" = NOW(), "updatedById" = ${ator.id}
      `,
    );

    // Aplica no cache deste processo na hora, para o painel não mostrar o valor
    // velho por até um minuto logo depois de o usuário clicar.
    // ⚠️ O WORKER é outro processo e só vê a mudança no próximo refresh.
    applyFlagOverrideLocally(key, normalized);

    await this.auditar(ator, 'feature_flag_definida', {
      key,
      de: antes ? { valor: antes.value, origem: antes.source } : null,
      para: { valor: normalized, origem: 'banco' },
      risco: definition.risk,
      vendidoNaVitrine: Boolean(definition.soldOnSite),
    });

    return resolveAllFlags().find((f) => f.key === key) as ResolvedFlag;
  }

  /** Remove o override: a função volta a obedecer a variável de ambiente. */
  async limpar(key: string, ator: { id: string; clerkUserId: string }): Promise<ResolvedFlag> {
    const definition = getFlagDefinition(key);
    if (!definition) {
      throw new BadRequestException(`Função desconhecida: ${key}`);
    }

    const antes = resolveAllFlags().find((f) => f.key === key);

    await this.prisma.$executeRaw(
      Prisma.sql`DELETE FROM "tickrify"."FeatureFlag" WHERE "key" = ${key}`,
    );
    applyFlagOverrideLocally(key, null);

    const depois = resolveAllFlags().find((f) => f.key === key) as ResolvedFlag;

    await this.auditar(ator, 'feature_flag_limpa', {
      key,
      de: antes ? { valor: antes.value, origem: antes.source } : null,
      para: { valor: depois.value, origem: depois.source },
    });

    return depois;
  }

  /** Recarrega do banco sob demanda (botão de sincronizar no painel). */
  async recarregar(): Promise<boolean> {
    return loadFlagsFromDb(() => this.readOverrides());
  }

  private validar(type: 'boolean' | 'number' | 'string', value: string, key: string): string {
    const raw = String(value ?? '').trim();

    if (type === 'boolean') {
      const lower = raw.toLowerCase();
      if (lower !== 'true' && lower !== 'false') {
        throw new BadRequestException(`${key} aceita apenas "true" ou "false" (recebido: "${raw}")`);
      }
      return lower;
    }

    if (type === 'number') {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        throw new BadRequestException(`${key} aceita apenas número (recebido: "${raw}")`);
      }
      // AB_PROMPT_V9_PERCENT é porcentagem. Aceitar 150 aqui significaria
      // "150% dos usuários", que o hash nunca satisfaz — silenciosamente errado.
      if (key.endsWith('_PERCENT') && (parsed < 0 || parsed > 100)) {
        throw new BadRequestException(`${key} precisa estar entre 0 e 100 (recebido: ${parsed})`);
      }
      return String(parsed);
    }

    if (!raw) {
      throw new BadRequestException(`${key} não aceita valor vazio`);
    }
    return raw;
  }

  private async auditar(
    ator: { id: string; clerkUserId: string },
    acao: string,
    detalhes: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.adminAudit.create({
        data: {
          actorUserId: ator.id,
          targetUserId: null,
          action: acao,
          details: { ...detalhes, clerkUserId: ator.clerkUserId } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      // Best-effort: falha de auditoria não pode impedir o botão de emergência
      // de funcionar. Mas precisa GRITAR no log, porque mudança sem rastro é
      // exatamente o que este recurso veio consertar.
      this.logger.error(
        `[flags] MUDANÇA SEM AUDITORIA (${acao}): ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }
}
