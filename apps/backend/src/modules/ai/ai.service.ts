import { flagNumber } from '../../common/flags/feature-flags';
import {
  sanitizeStrategyProfile,
  strategyFitFields,
  strategyProfileHash,
  type StrategyProfile,
} from '../../common/strategy/strategy-profile';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PrismaService } from '../database/prisma.service';
import { getAiQueue, getAiQueueReadiness } from './ai.queue';
import { isWeeklyPriceId, resolvePlanForPriceId } from '../../config/stripe.config';
import { AIAdapter, AIAnalysisError } from './ai.adapter';
import { resolveModel } from './openai-params';
import { TRADING_SYSTEM_PROMPT_V9 } from '../../common/prompts/trading-system-prompt-v9';
import { UploadedFile } from '../../common/interfaces/multer';
import { PromptBuilderService } from '../prompt/prompt-builder.service';
import {
  buildPersistedAnalysisPayload,
  normalizeStoredAnalysis,
  NormalizedPersistedAnalysis,
} from '../../common/utils/analysis-payload';
import {
  normalizeBias,
  normalizeConfidence,
  normalizeRecommendation,
  normalizeSymbol,
  computeRiskReward,
  hasInvalidTradePlanLevels,
  formatRiskReward,
} from '../../common/utils/analysis-normalizer';
import {
  ImageStorageClient,
  prepareIncomingImage,
} from '../../common/utils/image-storage';
import { isProductionRuntime } from '../../common/utils/runtime-env';
import { getFreeQuota } from '../../common/free-quota';
import { TICK_COSTS, AnalysisType } from '../ticks/tick-packages';
import { TicksService } from '../ticks/ticks.service';
import { MailService } from '../mail/mail.service';
import {
  notifyIfFreeQuotaExhausted as notifyFreeQuotaExhausted,
  sendRecoveryEmailOnce,
  type RecoveryEmailDeps,
} from '../mail/recovery-email';
import { StripeService } from '../payments/stripe.service';
import { trackFreeAnalysisCompleted, trackFreeAnalysisStarted } from '../../common/analytics/free-funnel';
import { analysisFailureCodeForResponse, safeAnalysisFailureCode, trackAnalysisExecutionFailed } from '../../common/analytics/analysis-failure';
import {
  AnalysisContext,
  validateImageHook,
  logMetricsHook,
  runPreHooks,
  runPostHooks,
} from './analysis-pipeline';

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'];

type ApiAnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';


/**
 * A/B DE PROMPT EM PRODUÇÃO — a medição que não custa API.
 *
 * Por que existe: o backtest usa gráficos renderizados (matplotlib, sem
 * indicador, sem desenho, resolução uniforme). O usuário manda print do
 * TradingView. A limitação nº 1 do próprio relatório de backtest é justamente
 * essa: "gráfico renderizado ≠ print real de usuário". Já existe em produção o
 * sweeper que 48h depois mede TP1-antes-do-SL nos candles reais — então basta
 * marcar QUAL prompt gerou cada análise para a produção medir o A/B sozinha,
 * com print de verdade e sem gastar um centavo em teste.
 *
 * Como ligar: AB_PROMPT_V9_PERCENT=20 no env → ~20% dos usuários recebem o v9.
 * Default 0 (desligado). Qualquer valor fora de 0-100 é tratado como 0.
 *
 * Determinístico POR USUÁRIO, não por análise: o mesmo usuário fica sempre no
 * mesmo lado. Se sorteássemos por análise, o mesmo print poderia dar leituras
 * diferentes em dois cliques — e nos modelos GPT-5 não existe mais controle de
 * temperatura para atenuar isso (temperature é forçada em 1).
 *
 * promptVer = -9 marca a perna B. Negativo de propósito: nunca colide com uma
 * versão real de PromptConfig, e o /accuracy corta por esse valor.
 */
export const AB_V9_PROMPT_VER = -9;

export function resolveAbPromptVariant(userId: string): 'A' | 'B' {
  const pct = flagNumber('AB_PROMPT_V9_PERCENT');
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return 'A';
  // Hash estável (FNV-1a): mesmo userId → sempre o mesmo bucket, sem estado.
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 100) < pct ? 'B' : 'A';
}

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  /** true quando as colunas de resultado existem no banco (verificado no boot). */
  private outcomeColumnsReady = false;

  constructor(
    private prisma: PrismaService,
    private aiAdapter: AIAdapter,
    private ticksService: TicksService,
    private promptBuilder: PromptBuilderService,
    private stripeService: StripeService,
    private mailService: MailService,
  ) {}

  /**
   * Garante (de forma idempotente e isolada) que as colunas de resultado existam.
   * Não depende do pipeline de migração e NUNCA derruba o boot: se falhar, o recurso
   * de resultado fica indisponível, mas o resto da aplicação segue normal.
   */
  async onModuleInit(): Promise<void> {
    try {
      // Produção usa RUN_MIGRATIONS_ON_START=false. Criar a coluna opcional
      // antes de qualquer leitura Prisma de Analysis evita indisponibilidade
      // durante o primeiro boot desta versão; a migração formal cobre bancos novos.
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "errorCode" TEXT',
      );
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "outcome" TEXT',
      );
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "pnlPercent" DOUBLE PRECISION',
      );
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "pnlAmount" DOUBLE PRECISION',
      );
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3)',
      );
      // Favoritos: estrela por análise (mesmo padrão aditivo e idempotente).
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "isFavorite" BOOLEAN NOT NULL DEFAULT false',
      );
      // Veredicto manual do trader, separado do outcome automático do sweeper.
      // Existe também como migração Prisma; isto aqui é a rede de segurança
      // (mesmo padrão das colunas acima) para o caso de a migração não rodar.
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "userVerdict" TEXT',
      );
      // Modelo da OpenAI que gerou a análise. Sem esta coluna é impossível
      // comparar calibração antes/depois de uma troca de modelo — e a migração
      // gpt-4o-mini → gpt-5.6 é obrigatória (gpt-4o desliga em 23/10/2026).
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "model" TEXT',
      );
      // ⚠️ isDemo — DESCOBERTO EM 12/08/2026, e é o mais grave desta lista.
      // Esta coluna é o portão da cota grátis inteira (enforceAccessAndCreate
      // conta `isDemo: true`) e o filtro que impede análise de demo de vazar
      // para a vitrine em /ai/public-analyses. Ela está no schema.prisma e é
      // usada em 36 lugares do código — mas NÃO ERA CRIADA POR NENHUMA MIGRAÇÃO
      // NEM POR ESTE HOOK. Só existia em produção porque foi adicionada à mão
      // pelo SQL Editor em algum momento.
      //
      // Consequência: um banco criado do zero com `prisma migrate deploy`
      // (staging, disaster recovery, ambiente novo) subia SEM a coluna, e a
      // PRIMEIRA análise de qualquer usuário estourava. Descoberto ao executar
      // as migrações do repo num Postgres limpo — não aparece de outro jeito,
      // porque produção já tem a coluna e nunca reclama.
      //
      // Existe agora também como migração Prisma (20260812120000). Isto aqui é
      // a rede de segurança, porque RUN_MIGRATIONS_ON_START=false em produção.
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false',
      );
      // Perfil de estrategia (recurso pago). Mesmo padrao aditivo das colunas
      // acima, pelo mesmo motivo: RUN_MIGRATIONS_ON_START=false em producao,
      // entao a migracao Prisma sozinha nao chega la.
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "strategyProfile" JSONB',
      );
      // NULL = analise sem estrategia. E o filtro que mantem preferencia de
      // usuario fora da amostra publica da /accuracy e da esteira da landing.
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "strategyHash" TEXT',
      );
      // Índice para cortar a acurácia por versão de prompt sem varrer a tabela
      // (o A/B de prompt em produção consulta exatamente por isto).
      await this.prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS "Analysis_promptVer_outcome_idx" ON "tickrify"."Analysis"("promptVer", "outcome")',
      );
      // Backfill idempotente: move para a coluna certa os veredictos manuais
      // que ficaram presos em "outcome" antes da separação (27/07/2026).
      // Só toca em valores MINÚSCULOS — os do sweeper são MAIÚSCULOS. Depois da
      // primeira execução não há mais linhas elegíveis e isto vira no-op.
      // Efeito desejado: essas análises voltam a ter outcome NULL e o sweeper
      // as reavalia, recuperando pontos perdidos da amostra da /accuracy.
      const moved = await this.prisma.$executeRawUnsafe(
        `UPDATE "tickrify"."Analysis"
         SET "userVerdict" = "outcome", "outcome" = NULL
         WHERE "outcome" IN ('tp1', 'tp2', 'stop', 'breakeven', 'open')`,
      );
      if (Number(moved) > 0) {
        this.logger.log(`[outcome] Backfill: ${moved} veredicto(s) manual(is) movido(s) para userVerdict.`);
      }
      this.outcomeColumnsReady = true;
      this.logger.log('[outcome] Colunas de resultado prontas.');
    } catch (err) {
      this.outcomeColumnsReady = false;
      this.logger.warn(
        `[outcome] Não foi possível garantir colunas de resultado (recurso ficará indisponível): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /** Mapa id -> resultado, lido por SQL isolado. Nunca lança (retorna mapa vazio em falha). */
  private async getOutcomesMap(
    userId: string,
    /** Se vier, le so estas analises (a pagina da lista). Sem ele, todas. */
    ids?: string[],
  ): Promise<Map<string, { outcome: string | null; pnlPercent: number | null; pnlAmount: number | null; isFavorite: boolean }>> {
    const map = new Map<string, { outcome: string | null; pnlPercent: number | null; pnlAmount: number | null; isFavorite: boolean }>();
    if (!this.outcomeColumnsReady) {
      return map;
    }
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string; outcome: string | null; pnlPercent: number | null; pnlAmount: number | null; isFavorite: boolean | null }>
      >(ids
        ? ids.length === 0
          ? Prisma.sql`SELECT NULL::text AS "id" WHERE false`
          : Prisma.sql`SELECT "id", "userVerdict" AS "outcome", "pnlPercent", "pnlAmount", "isFavorite" FROM "tickrify"."Analysis" WHERE "userId" = ${userId} AND "id" IN (${Prisma.join(ids)})`
        : Prisma.sql`SELECT "id", "userVerdict" AS "outcome", "pnlPercent", "pnlAmount", "isFavorite" FROM "tickrify"."Analysis" WHERE "userId" = ${userId}`);
      // O campo `outcome` da API é, e sempre foi, o veredicto do TRADER — agora
      // lido da coluna certa. O outcome automático do sweeper não é exposto aqui
      // (ele aparece agregado e anonimizado em GET /api/ai/accuracy).
      for (const r of rows) {
        map.set(r.id, {
          outcome: r.outcome ?? null,
          pnlPercent: r.pnlPercent ?? null,
          pnlAmount: r.pnlAmount ?? null,
          isFavorite: r.isFavorite === true,
        });
      }
    } catch (err) {
      this.logger.warn(`[outcome] Falha ao ler resultados: ${err instanceof Error ? err.message : err}`);
    }
    return map;
  }

  /** Resultado de uma única análise por id. Nunca lança (retorna null em falha). */
  private async getOutcomeById(
    id: string,
  ): Promise<{ outcome: string | null; pnlPercent: number | null; pnlAmount: number | null } | null> {
    if (!this.outcomeColumnsReady) {
      return null;
    }
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ outcome: string | null; pnlPercent: number | null; pnlAmount: number | null }>
      >`SELECT "userVerdict" AS "outcome", "pnlPercent", "pnlAmount" FROM "tickrify"."Analysis" WHERE "id" = ${id} LIMIT 1`;
      const r = rows[0];
      return r
        ? { outcome: r.outcome ?? null, pnlPercent: r.pnlPercent ?? null, pnlAmount: r.pnlAmount ?? null }
        : null;
    } catch {
      return null;
    }
  }

  async createAnalysis(
    userId: string,
    imageFile?: UploadedFile,
    base64Image?: string,
    promptOverride?: string,
    analysisType: AnalysisType = 'quick',
    userLanguage?: string,
    htfBase64Images?: string[],
  ) {
    const preparedImage = this.prepareImagePayload(imageFile, base64Image);
    // useCache: decidir fila-vs-sincrono aceita um readiness de ate 15s. Sao
    // tres round-trips no Redis por analise que deixam de existir. O health
    // check continua perguntando ao vivo.
    const queueReadiness = await getAiQueueReadiness({ useCache: true });

    // `hasPaidAccess` e caro: alem do findFirst em subscription, um usuario SEM
    // assinatura ativa mas COM stripeCustomerId (todo ex-assinante e todo lead
    // que abriu checkout) cai em `syncActiveSubscriptionFromStripe`, que faz uma
    // chamada de REDE a API da Stripe. Isto era chamado TRES vezes por analise:
    // aqui para o tipo, aqui para o perfil, e de novo dentro do
    // `enforceAccessAndCreate`. Uma vez so, e o valor desce por parametro.
    const paidAccess = await this.hasPaidAccess(userId);

    // Deep é recurso de assinante (gpt-4o, ~15x mais caro). Conta grátis/demo
    // roda como 'quick' — mesma regra do multi-timeframe. Degradação graciosa:
    // a análise segue normal, só sem o enriquecimento deep.
    const normalizedAnalysisType: AnalysisType =
      analysisType === 'deep' && paidAccess ? 'deep' : 'quick';

    // Perfil so vale para quem paga. A checagem se repete aqui, e nao so na
    // rota de escrita, para que cancelar a assinatura pare de injetar o bloco
    // mesmo com a linha ainda no banco.
    const strategyProfile = paidAccess ? await this.getStrategy(userId) : null;
    const strategyHash = strategyProfile ? strategyProfileHash(strategyProfile) : null;

    const storage = new ImageStorageClient();

    if (storage.requiresRemoteStorage() && !storage.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'storage_not_configured',
        message: 'Image storage is required in production.',
      });
    }

    // A/B de prompt em produção: fração determinística dos usuários recebe o v9.
    // Desligado por default (AB_PROMPT_V9_PERCENT ausente ou 0).
    const abVariant = promptOverride ? 'A' : resolveAbPromptVariant(userId);
    const effectivePromptOverride =
      promptOverride ?? (abVariant === 'B' ? TRADING_SYSTEM_PROMPT_V9 : undefined);

    // Paraleliza: upload da imagem + busca da versão do prompt ao mesmo tempo
    const [imageUrl, promptVersion] = await Promise.all([
      (async (): Promise<string> => {
        if (!storage.isConfigured()) {
          return preparedImage.dataUrl;
        }
        try {
          return await storage.uploadBuffer({
            buffer: preparedImage.buffer,
            mimeType: preparedImage.mimeType,
            extension: preparedImage.extension,
            pathPrefix: `analyses/${userId}/original`,
          });
        } catch (error) {
          if (isProductionRuntime()) throw error;
          this.logger.warn(
            `Storage upload failed in non-production, falling back to inline image payload: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
          return preparedImage.dataUrl;
        }
      })(),
      (async (): Promise<number | undefined> => {
        if (promptOverride) return undefined;
        // Perna B marcada com o sentinela negativo — é assim que o /accuracy
        // separa v9 de v7.3 sem precisar de tabela nova.
        if (abVariant === 'B') return AB_V9_PROMPT_VER;
        const latestPrompt = await this.prisma.promptConfig.findFirst({
          where: { isActive: true },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        return latestPrompt?.version;
      })(),
    ]);

    // Upload das imagens de timeframe maior (top-down), se houver. Máx 2; falhas ignoradas.
    // EM PARALELO: eram dois uploads em serie dentro de um `for`, somando o tempo
    // de rede de ambos no caminho critico de toda analise top-down.
    // `Promise.all` sobre um map que ja trata o proprio erro nunca rejeita, entao
    // uma imagem que falha continua sendo ignorada sem derrubar a outra.
    const htfImageUrls = (
      await Promise.all(
        (Array.isArray(htfBase64Images) ? htfBase64Images.slice(0, 2) : []).map(
          async (b64): Promise<string | null> => {
            try {
              const prepared = this.prepareImagePayload(undefined, b64);
              if (!storage.isConfigured()) {
                return prepared.dataUrl;
              }
              return await storage.uploadBuffer({
                buffer: prepared.buffer,
                mimeType: prepared.mimeType,
                extension: prepared.extension,
                pathPrefix: `analyses/${userId}/htf`,
              });
            } catch (err) {
              this.logger.warn(
                `[htf] Falha ao preparar imagem extra (ignorada): ${err instanceof Error ? err.message : err}`,
              );
              return null;
            }
          },
        ),
      )
    ).filter((url): url is string => typeof url === 'string' && url.length > 0);

    // Only consume free quota / ticks after infrastructure/storage prerequisites are validated.
    // enforceAccessAndCreate conta a cota grátis e cria a análise na MESMA transação,
    // evitando que requisições simultâneas ultrapassem o limite gratuito.
    const { isDemo, analysis } = await this.enforceAccessAndCreate(
      userId,
      normalizedAnalysisType,
      {
        imageUrl,
        promptVer: promptVersion,
        model: resolveModel(normalizedAnalysisType),
        status: 'pending',
        strategyHash,
      },
      paidAccess,
    );

    // Funil gratis (fonte: banco). Fire-and-forget: nunca segura a analise.
    if (isDemo) {
      void trackFreeAnalysisStarted(this.prisma, {
        userId,
        analysisId: analysis.id,
        createdAt: analysis.createdAt,
      });
    }

    const queue = queueReadiness.connected ? getAiQueue() : null;

    // Use queue when workers are available — async, fastest path.
    if (queue && queueReadiness.hasWorkers) {
      await queue.add('process-analysis', {
        analysisId: analysis.id,
        imageUrl,
        htfImageUrls,
        promptOverride: effectivePromptOverride,
        promptVersion,
        userId,
        analysisType: normalizedAnalysisType,
        isDemo,
        userLanguage,
        strategyProfile,
      }, { jobId: analysis.id });

      return {
        id: analysis.id,
        status: 'pending',
        createdAt: analysis.createdAt,
        updatedAt: analysis.updatedAt,
      };
    }

    // No workers available (or no queue) — process synchronously.
    // Keeps the app functional on Render Free where a separate worker service may be absent.
    this.logger.warn(
      `[AiService] No queue workers available — processing analysis ${analysis.id} synchronously.`,
    );

    return this.processSynchronously({
      analysisId: analysis.id,
      imageUrl,
      htfImageUrls,
      promptOverride: effectivePromptOverride,
      promptVersion,
      userId,
      analysisType: normalizedAnalysisType,
      userLanguage,
      isDemo,
      strategyProfile,
    });
  }

  /**
   * Streaming analysis via Server-Sent Events.
   * Emits: progress (phase/pct), chunk (text delta), result (full response), error.
   * Does not use the queue — runs synchronously for immediate feedback.
   */
  async getAnalysis(id: string, userId: string) {
    const analysis = await this.prisma.analysis.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!analysis) {
      throw new BadRequestException('Analysis not found');
    }

    // CAMINHO RAPIDO DO POLLING.
    //
    // Este endpoint e chamado a cada 0,8-3s enquanto a analise roda: sao 10 a 14
    // chamadas por analise. Rodar a serializacao completa nelas era desperdicio
    // caro, porque enquanto o status e pending/processing NAO EXISTE nada para
    // serializar — nao ha recomendacao, nem imagem anotada, nem outcome. O
    // frontend (`waitForAnalysisCompletion`) so le `status` nessa fase.
    //
    // O que a serializacao completa cobrava por poll, sem entregar nada:
    //   - 1 `createSignedUrl` no Supabase (round-trip de REDE) pela imagem
    //     original, que ja existe desde a criacao;
    //   - 1 query crua do outcome, que so pode existir depois de completed.
    //
    // Pior: o worker roda no MESMO processo Node (RUN_EMBEDDED_WORKER=true), num
    // container de 0.1 CPU. O polling competia por CPU com a analise que ele
    // estava esperando terminar. Quanto mais o usuario esperava, mais poll, e
    // mais lento o worker ficava.
    //
    // O `getCalibration` ja tinha short-circuit por acidente
    // (`normalizeRecommendation(null)` devolve 'WAIT'), entao ele nunca foi o
    // problema. As duas chamadas acima eram.
    const apiStatus = this.toApiStatus(analysis.status);
    if (apiStatus === 'pending' || apiStatus === 'processing') {
      return this.serializePendingAnalysis(analysis.id, apiStatus, analysis);
    }

    const serialized = await this.serializeAnalysis(analysis);
    const calibration = await this.getCalibration(
      userId,
      serialized.recommendation,
      serialized.confidence,
    );
    return { ...serialized, calibration };
  }

  /**
   * Historico do usuario, paginado por cursor.
   *
   * Antes de 03/09/2026 nao havia paginacao nenhuma: o frontend pedia 40, o
   * backend limitava a 100, e o resto do historico era INALCANCAVEL por
   * qualquer tela. Uma conta com 403 analises so conseguia abrir 40.
   *
   * `orderBy` leva `id` como desempate porque duas analises podem compartilhar
   * o mesmo `createdAt`; sem isso a ordem nao e total e o cursor pode pular ou
   * repetir uma linha na fronteira da pagina.
   */
  async listAnalyses(userId: string, limit = 20, cursor?: string | null) {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
    const safeCursor = typeof cursor === 'string' && cursor.trim() ? cursor.trim() : null;

    // O cursor vem do CLIENTE, entao precisa ser validado antes de virar ancora
    // de query. Duas coisas quebram sem isto:
    //   1. o Prisma localiza a linha do cursor pelo id, ANTES de aplicar o
    //      `where`. Um id de analise de outro usuario nao vaza conteudo (o
    //      `where: { userId }` continua valendo), mas responde diferente de um
    //      id inexistente, e isso e um oraculo de existencia entre contas.
    //   2. id inexistente faz o Prisma lancar, e viraria 500 cru numa rota que
    //      deveria simplesmente dizer "acabou o historico".
    // Cursor que nao e do usuario encerra a paginacao devolvendo lista vazia.
    // Devolver a primeira pagina seria pior: a tela concatena, e o usuario veria
    // as mesmas analises duplicadas.
    if (safeCursor) {
      const owned = await this.prisma.analysis.findFirst({
        where: { id: safeCursor, userId },
        select: { id: true },
      });
      if (!owned) return [];
    }

    const analyses = await this.prisma.analysis.findMany({
      where: { userId },
      // So as colunas que o mapeamento abaixo le. Sem isto vinha a linha
      // inteira, incluindo `fullResponse` (texto bruto da IA, varios kB por
      // analise, x40), que neste caminho nunca e usado: getStoredAnalysisPayload
      // so aproveita `fullResponse` se for objeto, e a coluna e texto.
      select: {
        id: true,
        imageUrl: true,
        status: true,
        recommendation: true,
        confidence: true,
        reasoning: true,
        result: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: safeLimit,
      // `skip: 1` pula a propria linha do cursor, que o cliente ja tem.
      ...(safeCursor ? { cursor: { id: safeCursor }, skip: 1 } : {}),
    });

    return this.mapAnalysisRows(userId, analyses);
  }

  /**
   * Busca do Diario (calendario do mes): analises CONCLUIDAS criadas em
   * [from, to). O dia de cada uma e decidido no navegador, no fuso do trader;
   * por isso o cliente manda o intervalo ja no fuso dele, e aqui so se filtra.
   *
   * Teto de 45 dias por chamada (um mes cheio + folga de fuso) e de 500 linhas.
   * `truncated` avisa a tela quando o teto corta o mes, para ela dizer que o
   * total esta incompleto em vez de exibir uma soma menor como se fosse a real.
   */
  async listAnalysesInRange(userId: string, from: Date, to: Date) {
    const MAX_SPAN_MS = 45 * 24 * 60 * 60 * 1000;
    const MAX_ROWS = 500;
    if (!(from instanceof Date) || !(to instanceof Date) || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date range');
    }
    if (to.getTime() <= from.getTime() || to.getTime() - from.getTime() > MAX_SPAN_MS) {
      throw new BadRequestException('Date range must be positive and at most 45 days');
    }

    const analyses = await this.prisma.analysis.findMany({
      where: { userId, status: 'completed', createdAt: { gte: from, lt: to } },
      select: {
        id: true,
        imageUrl: true,
        status: true,
        recommendation: true,
        confidence: true,
        reasoning: true,
        result: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS + 1,
    });

    const truncated = analyses.length > MAX_ROWS;
    const items = await this.mapAnalysisRows(userId, truncated ? analyses.slice(0, MAX_ROWS) : analyses);
    return { items, truncated };
  }

  /**
   * Linha do banco -> item da API. Fonte UNICA do formato devolvido pela lista
   * paginada e pelo Diario: se cada rota tivesse o seu mapeamento, um campo
   * novo apareceria numa tela e sumiria na outra.
   */
  private async mapAnalysisRows(
    userId: string,
    analyses: Array<{
      id: string;
      imageUrl: string | null;
      status: string;
      recommendation: string | null;
      confidence: number | null;
      reasoning: string | null;
      result: Prisma.JsonValue;
      createdAt: Date;
    }>,
  ) {
    // Veredito so das analises desta pagina (antes: TODAS as do usuario) e as
    // imagens assinadas em UMA chamada ao Supabase (antes: uma por analise).
    const [outcomesMap, signedUrls] = await Promise.all([
      this.getOutcomesMap(userId, analyses.map((a) => a.id)),
      this.signImagesBatch(
        analyses.map((analysis) => {
          const payload = this.getStoredAnalysisPayload(analysis);
          return (
            String(
              analysis.imageUrl ||
                (payload?.original_image_url as string) ||
                (payload?.originalImageUrl as string) ||
                '',
            ).trim() || null
          );
        }),
      ),
    ]);

    return Promise.all(
      analyses.map(async (analysis, index) => {
        const fullResponse = this.getStoredAnalysisPayload(analysis);
        const operationFields = this.extractOperationFields(fullResponse, analysis.reasoning ?? null);
        const analysisMeta = operationFields.analysisMeta;
        const outcomeData = outcomesMap.get(analysis.id) ?? null;

        const symbolFromAnalysis =
          analysisMeta && typeof analysisMeta.symbol === 'string'
            ? (analysisMeta.symbol as string)
            : null;
        const timeframeFromAnalysis =
          analysisMeta && typeof analysisMeta.timeframe === 'string'
            ? (analysisMeta.timeframe as string)
            : null;

        const recommendation = normalizeRecommendation(
          analysis.recommendation ?? (fullResponse?.recommendation as string),
        );
        const bias = normalizeBias(
          (fullResponse?.bias as string) ?? operationFields.marketStructure?.bias,
          recommendation,
        );
        const confidence = normalizeConfidence(
          analysis.confidence ?? (fullResponse?.confidence as number),
          50,
        );

        const symbol = normalizeSymbol(
          symbolFromAnalysis ||
            (fullResponse?.symbol as string) ||
            (fullResponse?.ticker as string) ||
            (fullResponse?.asset as string) ||
            '',
        );

        const timeframe =
          String(
            timeframeFromAnalysis ||
              (analysisMeta && typeof analysisMeta.period === 'string' ? analysisMeta.period : '') ||
              (fullResponse?.timeframe as string) ||
              (fullResponse?.period as string) ||
              '',
          ).trim() || 'N/A';

        const signedImageUrl = signedUrls[index] ?? null;

        return {
          id: analysis.id,
          imageUrl: signedImageUrl,
          status: this.toApiStatus(analysis.status),
          recommendation,
          bias,
          confidence,
          symbol,
          timeframe,
          createdAt: analysis.createdAt,
          entry: operationFields.entry,
          stopLoss: operationFields.stopLoss,
          stopLossPercent: operationFields.stopLossPercent,
          takeProfit1: operationFields.takeProfit1,
          takeProfit1Percent: operationFields.takeProfit1Percent,
          takeProfit2: operationFields.takeProfit2,
          takeProfit2Percent: operationFields.takeProfit2Percent,
          reasoning: operationFields.reasoning,
          riskReward: operationFields.riskReward,
          riskRewardRatio: operationFields.riskReward,
          riskRewardTp1: operationFields.riskRewardTp1,
          riskRewardTp2: operationFields.riskRewardTp2,
          outcome: outcomeData?.outcome ?? null,
          pnlPercent: outcomeData?.pnlPercent ?? null,
          pnlAmount: outcomeData?.pnlAmount ?? null,
          isFavorite: outcomeData?.isFavorite ?? false,
        };
      }),
    );
  }

  /**
   * Marca/desmarca uma análise como favorita (filtro Favoritas do My Trades). Owner-checked.
   * Mesmo padrão tolerante do setOutcome: SQL isolado, nunca derruba nada.
   */
  async setFavorite(userId: string, id: string, isFavorite: boolean) {
    const analysis = await this.prisma.analysis.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!analysis) {
      throw new BadRequestException('Analysis not found');
    }

    if (!this.outcomeColumnsReady) {
      throw new ServiceUnavailableException(
        'Favoritos temporariamente indisponíveis. Tente novamente em instantes.',
      );
    }

    const value = isFavorite === true;
    await this.prisma.$executeRaw`
      UPDATE "tickrify"."Analysis"
      SET "isFavorite" = ${value}
      WHERE "id" = ${id} AND "userId" = ${userId}
    `;

    return { id, isFavorite: value };
  }

  /**
   * Registra o resultado de uma análise (TP1/TP2/Stop/BE/aberto + P&L manual).
   * Owner-checked. Usa SQL isolado e tolera a ausência das colunas (sem derrubar nada).
   */
  async setOutcome(
    userId: string,
    id: string,
    input: { outcome: string | null; pnlPercent?: number | null; pnlAmount?: number | null },
  ) {
    // Ownership check usando o modelo Prisma padrão (colunas garantidas).
    const analysis = await this.prisma.analysis.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!analysis) {
      throw new BadRequestException('Analysis not found');
    }

    if (!this.outcomeColumnsReady) {
      throw new ServiceUnavailableException(
        'Registro de resultado temporariamente indisponível. Tente novamente em instantes.',
      );
    }

    const VALID = ['tp1', 'tp2', 'stop', 'breakeven', 'open', 'no_fill'];
    const outcome = input.outcome && VALID.includes(input.outcome) ? input.outcome : null;
    // `Number(null)` e 0, entao "sem valor" virava 0 gravado (um trade sem valor
    // aparecia como +0.00 e entrava na soma do Diario). Vazio fica vazio.
    const toAmount = (v: unknown): number | null =>
      v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
    const pnlPercent = toAmount(input.pnlPercent);
    const pnlAmount = toAmount(input.pnlAmount);
    const closedAt = outcome ? new Date() : null;

    await this.prisma.$executeRaw`
      UPDATE "tickrify"."Analysis"
      SET "userVerdict" = ${outcome}, "pnlPercent" = ${pnlPercent}, "pnlAmount" = ${pnlAmount}, "closedAt" = ${closedAt}
      WHERE "id" = ${id} AND "userId" = ${userId}
    `;

    return { id, outcome, pnlPercent, pnlAmount };
  }

  /**
   * Perfil de estrategia do usuario, ou null.
   *
   * Passa pelo sanitize na LEITURA tambem, e nao so na escrita. Motivo: o
   * conteudo da coluna pode ter sido gravado por uma versao anterior do
   * formato, ou editado a mao no banco. Sanitizar na leitura garante que o
   * que chega ao prompt sempre veio da whitelist vigente.
   */
  async getStrategy(userId: string): Promise<StrategyProfile | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { strategyProfile: true },
    });
    return sanitizeStrategyProfile(row?.strategyProfile ?? null);
  }

  /** Grava o perfil ja sanitizado. Perfil sem criterio nenhum vira NULL. */
  async setStrategy(userId: string, input: unknown): Promise<{ profile: StrategyProfile | null }> {
    const profile = sanitizeStrategyProfile(input);
    await this.prisma.user.update({
      where: { id: userId },
      // Conversao explicita: StrategyProfile e uma interface sem index signature, e o Prisma exige
      // InputJsonValue. E segura porque `profile` acabou de sair do sanitizeStrategyProfile acima,
      // entao so contem valores da whitelist.
      data: { strategyProfile: (profile as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull },
    });
    return { profile };
  }

  /** Estatísticas de performance do usuário (win rate, R:R médio, contagens). */
  /**
   * #2 — Calibração: taxa de acerto histórica de setups SEMELHANTES (mesma direção +
   * faixa de confiança parecida), a partir dos resultados registrados pelo usuário.
   * Transforma a confiança da IA em prova com dados. Nunca lança.
   */
  async getCalibration(
    userId: string,
    recommendation: string | null | undefined,
    confidence: number | null | undefined,
  ): Promise<{ sampleSize: number; winRate: number | null }> {
    const rec = normalizeRecommendation(recommendation);
    if (rec === 'WAIT') {
      return { sampleSize: 0, winRate: null };
    }

    const outcomesMap = await this.getOutcomesMap(userId);
    if (outcomesMap.size === 0) {
      return { sampleSize: 0, winRate: null };
    }

    const analyses = await this.prisma.analysis.findMany({
      where: { userId, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: { id: true, confidence: true, recommendation: true },
    });

    let wins = 0;
    let losses = 0;
    for (const a of analyses) {
      if (normalizeRecommendation(a.recommendation) !== rec) continue;
      const outcome = outcomesMap.get(a.id)?.outcome;
      if (outcome !== 'tp1' && outcome !== 'tp2' && outcome !== 'stop') continue;
      // Faixa de confiança parecida (±12 pontos), quando ambos disponíveis.
      if (
        confidence != null &&
        a.confidence != null &&
        Math.abs(a.confidence - confidence) > 12
      ) {
        continue;
      }
      if (outcome === 'stop') losses += 1;
      else wins += 1;
    }

    const decided = wins + losses;
    return {
      sampleSize: decided,
      winRate: decided > 0 ? Math.round((wins / decided) * 100) : null,
    };
  }

  async getUsage(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new UnauthorizedException('Authenticated user not found');
    }

    const periodStart = this.getCurrentUsagePeriodStart();
    const paidAccess = await this.hasPaidAccess(userId);

    const usageRow = await this.prisma.analysisUsage.findUnique({
      where: {
        userId_periodType_periodStart: {
          userId,
          periodType: 'MONTH',
          periodStart,
        },
      },
      select: { count: true },
    });

    const used = usageRow?.count ?? 0;
    // Contagem REAL de analises concluidas, de todos os tempos.
    //
    // Existe porque o KPI do painel contava a LISTA CARREGADA (useAnalyses(40))
    // e rotulava o numero como "all time": uma conta com 403 analises exibia 38
    // para sempre, porque analise nova entrava no topo da lista e uma antiga
    // saia embaixo. Era claim falso dentro do produto.
    //
    // `count()` nao carrega linha nenhuma, entao nao tem teto (ao contrario do
    // getPerformance, que faz findMany take:1000 so para contar) e o custo e
    // irrelevante. Vai junto no /usage porque o painel JA chama esse endpoint:
    // zero requisicao a mais.
    const analysesAllTime = await this.prisma.analysis.count({
      where: { userId, status: 'completed' },
    });
    const tickBalance = await this.ticksService.getBalance(userId);
    const canAnalyzeWithTicks = paidAccess && tickBalance >= TICK_COSTS.ANALYSIS_QUICK;

    // Usuário grátis: o contador exibido precisa refletir EXATAMENTE o que o paywall
    // conta, senão fica eternamente em 0/3. A tabela analysisUsage só é usada por
    // assinantes; para o grátis a fonte de verdade é `getFreeQuota`, a mesma regra
    // do `enforceAccessAndCreate`. `total`/`used`/`remaining` seguem falando de
    // SINAIS (BUY/SELL), para o front antigo continuar coerente.
    if (!paidAccess) {
      const quota = await getFreeQuota(this.prisma, userId);
      return {
        plan: 'free',
        period: 'monthly',
        periodStart,
        total: quota.signalsLimit,
        used: quota.signalsUsed,
        remaining: quota.remaining,
        isUnlimited: false,
        tickBalance,
        canAnalyze: !quota.exhausted,
        analysesAllTime,
        signalsUsed: quota.signalsUsed,
        signalsLimit: quota.signalsLimit,
        totalUsed: quota.totalUsed,
        totalLimit: quota.totalLimit,
      };
    }

    // Resolve nome real do plano (starter/pro/elite) a partir da subscription ativa
    let planName: string = 'free';
    const activeSub = await this.prisma.subscription.findFirst({
      where: { userId, status: { in: ACTIVE_SUBSCRIPTION_STATUSES } },
      select: { priceId: true },
      orderBy: { updatedAt: 'desc' },
    });
    const resolved = activeSub?.priceId ? resolvePlanForPriceId(activeSub.priceId) : null;
    // O semanal e o starter cobrado por semana: o painel precisa saber para
    // mostrar o teto de 25 e "por semana" em vez de 200 por mes.
    const weekly = isWeeklyPriceId(activeSub?.priceId);
    planName = weekly ? 'weekly' : resolved ?? 'pro';

    return {
      plan: planName,
      period: weekly ? 'weekly' : 'monthly',
      periodStart,
      total: null,
      used,
      remaining: null,
      isUnlimited: true,
      tickBalance,
      canAnalyze: canAnalyzeWithTicks,
      analysesAllTime,
    };
  }

  private async processSynchronously(params: {
    analysisId: string;
    imageUrl: string;
    htfImageUrls?: string[];
    promptOverride?: string;
    promptVersion?: number;
    userId: string;
    analysisType: AnalysisType;
    userLanguage?: string;
    isDemo?: boolean;
    strategyProfile?: StrategyProfile | null;
  }) {
    const {
      analysisId,
      imageUrl,
      htfImageUrls,
      promptOverride,
      promptVersion,
      userId,
      analysisType,
      userLanguage,
      isDemo,
      strategyProfile,
    } = params;
    const startedAt = Date.now();

    try {
      await this.prisma.analysis.update({
        where: { id: analysisId },
        data: { status: 'processing' },
      });

      const tickBalance = await this.ticksService.getBalance(userId);
      const pipelineCtx: AnalysisContext = { userId, imageUrl, analysisType, tickBalance };

      // The analysis row and paid debit already exist. Pre-hook failures must
      // enter the same failure/refund path as model failures.
      await runPreHooks(pipelineCtx, [validateImageHook()]);

      const prompt = await this.promptBuilder.buildPromptByVersion(
        analysisType,
        promptVersion,
        promptOverride,
        userLanguage,
      );
      const aiResponse = await this.aiAdapter.analyzeImage(
        imageUrl,
        prompt,
        analysisType,
        htfImageUrls ?? [],
        strategyProfile,
      );

      let normalizedPayload = buildPersistedAnalysisPayload({
        source: {
          ...((aiResponse.rawResponse as Record<string, any>) || {}),
          ...(aiResponse.evidence ? { evidence: aiResponse.evidence } : {}),
          // Selo de estrategia: o VALIDADO pelo adapter, por cima do cru do modelo.
          ...strategyFitFields(aiResponse),
        },
        recommendation: aiResponse.recommendation,
        bias: aiResponse.bias,
        confidence: aiResponse.confidence,
        reasoning: aiResponse.reasoning,
        analysis: aiResponse.analysis,
        drawingPlan: aiResponse.drawingPlan,
        originalImageUrl: imageUrl,
      });

      normalizedPayload = await this.persistAnnotatedImage(normalizedPayload, userId);
      const rawContent =
        typeof aiResponse.rawContent === 'string' && aiResponse.rawContent.trim().length > 0
          ? aiResponse.rawContent
          : JSON.stringify(aiResponse.rawResponse || {});

      const updated = await this.prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'completed',
          recommendation: normalizedPayload.recommendation as any,
          confidence: normalizedPayload.confidence,
          reasoning: normalizedPayload.reasoning,
          imageUrl: normalizedPayload.originalImageUrl,
          result: normalizedPayload.fullResponse as any,
          fullResponse: rawContent,
          errorMessage: null,
          errorCode: null,
        },
      });

      // Última análise grátis concluída → e-mail de recuperação (ver o método).
      void this.notifyIfFreeQuotaExhausted(userId, updated.isDemo, updated.id);

      const model = resolveModel(analysisType);
      await runPostHooks(pipelineCtx, aiResponse, [
        logMetricsHook(this.logger, startedAt, model),
      ], this.logger);

      return this.serializeAnalysis(updated);
    } catch (error) {
      const safeMessage = this.safeErrorMessage(error);
      const failedAnalysis = await this.prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'failed',
          reasoning: safeMessage,
          errorMessage: safeMessage,
          errorCode: safeAnalysisFailureCode(error instanceof AIAnalysisError ? error.code : null),
          result: Prisma.DbNull,
        },
      });

      // Paid analysis failed → give the tick(s) back. Idempotent per analysisId.
      if (!isDemo) {
        const tickCost =
          analysisType === 'deep' ? TICK_COSTS.ANALYSIS_DEEP : TICK_COSTS.ANALYSIS_QUICK;
        try {
          await this.ticksService.refundTicks(
            userId,
            tickCost,
            'Refund: analysis failed',
            analysisId,
          );
        } catch (refundError) {
          this.logger.error(
            `[AiService] Failed to refund ticks for analysis ${analysisId}: ${
              refundError instanceof Error ? refundError.message : refundError
            }`,
          );
        }
      }

      await trackAnalysisExecutionFailed(this.prisma, {
        userId,
        analysisId,
        analysisType,
        code: error instanceof AIAnalysisError ? error.code : 'processing_unclassified',
        createdAt: failedAnalysis.createdAt,
      });

      // Convert non_chart_image to a 400 HTTP exception so the frontend receives
      // a proper error code + user-friendly message instead of a generic 500.
      if (error instanceof AIAnalysisError && error.code === 'non_chart_image') {
        throw new BadRequestException({ code: 'non_chart_image', message: error.message });
      }
      throw error;
    }
  }

  private prepareImagePayload(imageFile?: UploadedFile, base64Image?: string) {
    try {
      return prepareIncomingImage(imageFile, base64Image);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid image payload');
    }
  }

  private async persistAnnotatedImage(
    payload: NormalizedPersistedAnalysis,
    userId: string,
  ): Promise<NormalizedPersistedAnalysis> {
    const annotatedImageUrl = payload.annotatedImageUrl;
    if (!annotatedImageUrl || !annotatedImageUrl.startsWith('data:')) {
      return payload;
    }

    const storage = new ImageStorageClient();

    if (!storage.isConfigured()) {
      if (storage.requiresRemoteStorage()) {
        payload.annotatedImageUrl = null;
        payload.drawingFailed = true;
        payload.fullResponse.annotated_image_url = null;
        payload.fullResponse.drawing_failed = true;
      }
      return payload;
    }

    try {
      const uploadedUrl = await storage.uploadDataUrl(
        annotatedImageUrl,
        `analyses/${userId}/annotated`,
      );

      payload.annotatedImageUrl = uploadedUrl;
      payload.fullResponse.annotated_image_url = uploadedUrl;
      payload.fullResponse.drawing_failed = Boolean(payload.drawingFailed);
    } catch (error) {
      this.logger.warn(
        `Failed to persist annotated image for user ${userId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      payload.annotatedImageUrl = null;
      payload.drawingFailed = true;
      payload.fullResponse.annotated_image_url = null;
      payload.fullResponse.drawing_failed = true;
    }

    return payload;
  }

  /**
   * Heatmap de consistência: contagem de análises por dia (UTC) dos últimos
   * ~119 dias (17 semanas, grade estilo GitHub). O dado já existe — só agrega.
   */
  async getActivityHeatmap(userId: string): Promise<{ days: Array<{ day: string; count: number }> }> {
    const rows = await this.prisma.$queryRaw<Array<{ day: string; count: number }>>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS count
      FROM "tickrify"."Analysis"
      WHERE "userId" = ${userId}
        AND "createdAt" > NOW() - INTERVAL '119 days'
        AND status != 'failed'
      GROUP BY 1
      ORDER BY 1
    `;
    return { days: rows.map((r) => ({ day: r.day, count: Number(r.count) })) };
  }

  private readonly DEMO_LIMIT_ERROR = {
    code: 'DEMO_LIMIT_REACHED',
    message: 'You have used your free analyses. Subscribe to a plan to continue.',
  };

  /**
   * E-mail de recuperação: disparado quando o usuário grátis bate o limite.
   * Dedup permanente via AdminAudit (action 'recovery_email_sent') — zero migração.
   * Best-effort absoluto: fire-and-forget, nunca propaga erro nem atrasa a resposta.
   */
  private triggerRecoveryEmail(userId: string): Promise<void> {
    return sendRecoveryEmailOnce(this.recoveryDeps(), userId);
  }

  private recoveryDeps(): RecoveryEmailDeps {
    return {
      prisma: this.prisma,
      mail: this.mailService,
      hasPaidAccess: (id) => this.hasPaidAccess(id),
      foundingOffer: () => this.stripeService.getFoundingOffer(),
      log: (level, message) => (level === 'warn' ? this.logger.warn(message) : this.logger.log(message)),
    };
  }


  /**
   * Cota grátis esgotada: dispara o e-mail de recuperação quando o usuário
   * TERMINA a última análise grátis, não só quando ele tenta a quarta.
   *
   * POR QUE ISTO EXISTE. O único gatilho até 15/09/2026 era o
   * `ForbiddenException` do `enforceAccessAndCreate`, ou seja, o e-mail só
   * saía se a pessoa voltasse e TENTASSE analisar de novo depois de esgotar.
   * Quem usa as 3 análises e fecha a aba nunca tenta uma quarta, e portanto
   * nunca recebia nada. Isso bate com o painel do Resend: nenhum e-mail de
   * recuperação enviado, enquanto os de boas-vindas saíam normalmente.
   *
   * É chamado depois da análise ficar `completed`, e não na criação da linha,
   * de propósito: a contagem ignora `failed`, então uma análise que falha
   * devolve a vaga. Disparar na criação mandaria "suas análises acabaram"
   * para alguém que ainda tem uma.
   *
   * Best-effort absoluto, igual ao `triggerRecoveryEmail`: nunca propaga erro,
   * nunca atrasa a resposta, e a dedup permanente por AdminAudit garante que
   * este caminho e o da quarta tentativa não mandem dois e-mails.
   */
  private async notifyIfFreeQuotaExhausted(userId: string, isDemo: boolean, analysisId?: string): Promise<void> {
    if (!isDemo) return;
    if (analysisId) {
      void trackFreeAnalysisCompleted(this.prisma, { userId, analysisId, completedAt: new Date() });
    }
    await notifyFreeQuotaExhausted(this.recoveryDeps(), userId);
  }


  /**
   * Enforces plan/quota access AND creates the Analysis row atomically.
   *
   * Paid users: debits ticks (already race-safe) and creates the row.
   * Free users: reads the free quota (`getFreeQuota`: 3 BUY/SELL or 10 in total,
   * in-flight rows counted) and creates the row inside a Serializable
   * transaction, so two concurrent requests cannot both slip past the limit.
   * Failed analyses don't count, and a completed WAIT doesn't use a signal.
   */
  private async enforceAccessAndCreate(
    userId: string,
    analysisType: AnalysisType,
    rowData: {
      imageUrl: string;
      promptVer?: number;
      model?: string;
      status: ApiAnalysisStatus;
      strategyHash?: string | null;
    },
    /**
     * Resultado de `hasPaidAccess` ja calculado pelo chamador nesta mesma
     * requisicao. Opcional: quem nao passar mantem o comportamento antigo de
     * consultar aqui (o `streamAnalysis` ainda faz isso). Passar evita uma
     * chamada de rede a Stripe repetida no caminho critico.
     */
    knownPaidAccess?: boolean,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new UnauthorizedException('Authenticated user not found');
    }

    const tickCost =
      analysisType === 'deep' ? TICK_COSTS.ANALYSIS_DEEP : TICK_COSTS.ANALYSIS_QUICK;

    const paidAccess =
      typeof knownPaidAccess === 'boolean' ? knownPaidAccess : await this.hasPaidAccess(userId);

    if (paidAccess) {
      // Debit and create must commit together. A separate successful debit
      // followed by a failed Analysis insert would charge the user for no job.
      const analysis = await this.prisma.$transaction(async (tx) => {
        await this.ticksService.debitTicks(
          userId,
          tickCost,
          `Análise ${analysisType === 'deep' ? 'deep' : 'rápida'} de gráfico`,
          { analysisType },
          tx,
        );
        return tx.analysis.create({
          data: {
            userId,
            imageUrl: rowData.imageUrl,
            status: rowData.status,
            promptVer: rowData.promptVer,
            model: rowData.model,
            isDemo: false,
            strategyHash: rowData.strategyHash ?? null,
          },
        });
      });

      return { isDemo: false, analysis };
    }

    // Sem assinatura: reserva atômica de UMA das análises grátis.
    // Contagem + criação na mesma transação serializável garantem que requisições
    // simultâneas não consigam ultrapassar o limite gratuito.
    try {
      const analysis = await this.prisma.$transaction(
        async (tx) => {
          const quota = await getFreeQuota(tx, userId);

          if (quota.exhausted) {
            throw new ForbiddenException(this.DEMO_LIMIT_ERROR);
          }

          return tx.analysis.create({
            data: {
              userId,
              imageUrl: rowData.imageUrl,
              status: rowData.status,
              promptVer: rowData.promptVer,
              model: rowData.model,
              isDemo: true,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return { isDemo: true, analysis };
    } catch (error) {
      if (error instanceof ForbiddenException) {
        // Limite grátis atingido → e-mail de recuperação (1x por usuário, fire-and-forget).
        void this.triggerRecoveryEmail(userId);
        throw error;
      }

      // Conflito de serialização (P2034): uma requisição concorrente ficou com a
      // última vaga grátis — tratamos como limite atingido.
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code || '')
          : '';
      if (code === 'P2034') {
        void this.triggerRecoveryEmail(userId);
        throw new ForbiddenException(this.DEMO_LIMIT_ERROR);
      }

      throw error;
    }
  }

  // Publico: a rota de estrategia (ai.controller) consome para checar acesso pago.
  async hasPaidAccess(userId: string): Promise<boolean> {
    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: {
          in: ACTIVE_SUBSCRIPTION_STATUSES,
        },
      },
      select: { id: true, priceId: true, stripeId: true, currentPeriodStart: true, currentPeriodEnd: true },
    });

    if (activeSubscription) {
      // Janela mensal de ticks (saldo = pacote do plano no inicio de cada mes).
      await this.stripeService.ensureTicksForActiveSubscriber(userId, activeSubscription);
      return true;
    }

    // Fallback: webhook may have been missed — check Stripe API directly
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });

    if (!user?.stripeCustomerId) return false;

    return this.stripeService.syncActiveSubscriptionFromStripe(userId, user.stripeCustomerId);
  }

  private getCurrentUsagePeriodStart(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  }

  /**
   * Payload da analise em andamento: MESMA FORMA do `serializeAnalysis`, com os
   * campos derivados em null e zero I/O externo.
   *
   * A forma tem de bater chave por chave: o frontend tipa a resposta do poll com
   * o mesmo `AIAnalysisResponse` da resposta final, entao devolver um objeto
   * menor quebraria a tipagem no cliente. Se um campo novo entrar no
   * `serializeAnalysis`, ele entra aqui tambem.
   */
  private serializePendingAnalysis(
    id: string,
    status: ApiAnalysisStatus,
    analysis: { errorMessage?: string | null; createdAt: Date; updatedAt: Date },
  ) {
    return {
      id,
      imageUrl: null,
      status,
      recommendation: null,
      bias: null,
      confidence: null,
      reasoning: analysis.errorMessage || null,
      drawing_plan: null,
      original_image_url: null,
      annotated_image_url: null,
      drawing_failed: false,
      fullResponse: null,
      entry: null,
      stopLoss: null,
      stopLossPercent: null,
      takeProfit1: null,
      takeProfit1Percent: null,
      takeProfit2: null,
      takeProfit2Percent: null,
      riskReward: null,
      riskRewardRatio: null,
      riskRewardTp1: null,
      riskRewardTp2: null,
      outcome: null,
      pnlPercent: null,
      pnlAmount: null,
      errorMessage: analysis.errorMessage || null,
      errorCode: null,
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
      calibration: { sampleSize: 0, winRate: null as number | null },
    };
  }

  private async serializeAnalysis(analysis: {
    id: string;
    imageUrl?: string | null;
    status: string;
    recommendation?: string | null;
    confidence?: number | null;
    reasoning?: string | null;
    result?: unknown;
    fullResponse?: unknown;
    errorMessage?: string | null;
    errorCode?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const normalized = normalizeStoredAnalysis(analysis);
    const signedOriginalImageUrl = await this.getSignedImageUrl(normalized.originalImageUrl);
    const signedAnnotatedImageUrl = await this.getSignedImageUrl(normalized.annotatedImageUrl);
    const storedPayload = this.getStoredAnalysisPayload(analysis);
    const operationFields = this.extractOperationFields(
      storedPayload ?? normalized.fullResponse,
      analysis.errorMessage || normalized.reasoning,
    );
    const outcomeData = await this.getOutcomeById(analysis.id);

    return {
      id: analysis.id,
      imageUrl: signedOriginalImageUrl,
      status: this.toApiStatus(analysis.status),
      recommendation: normalized.recommendation,
      bias: normalized.bias,
      confidence: normalized.confidence,
      reasoning: analysis.errorMessage || normalized.reasoning,
      drawing_plan: normalized.drawingPlan,
      original_image_url: signedOriginalImageUrl,
      annotated_image_url: signedAnnotatedImageUrl,
      drawing_failed: normalized.drawingFailed,
      fullResponse: normalized.fullResponse,
      entry: operationFields.entry,
      stopLoss: operationFields.stopLoss,
      stopLossPercent: operationFields.stopLossPercent,
      takeProfit1: operationFields.takeProfit1,
      takeProfit1Percent: operationFields.takeProfit1Percent,
      takeProfit2: operationFields.takeProfit2,
      takeProfit2Percent: operationFields.takeProfit2Percent,
      riskReward: operationFields.riskReward,
      riskRewardRatio: operationFields.riskReward,
      riskRewardTp1: operationFields.riskRewardTp1,
      riskRewardTp2: operationFields.riskRewardTp2,
      outcome: outcomeData?.outcome ?? null,
      pnlPercent: outcomeData?.pnlPercent ?? null,
      pnlAmount: outcomeData?.pnlAmount ?? null,
      errorMessage: analysis.errorMessage || null,
      errorCode: analysisFailureCodeForResponse(analysis.status, analysis.errorCode),
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
    };
  }

  /**
   * Cliente de storage reaproveitado.
   *
   * Antes, o `createClient` era chamado DENTRO do getSignedImageUrl — ou seja,
   * uma vez por imagem. No `listAnalyses` com limit=40 isso construia 40
   * clientes Supabase inteiros (cada um monta auth + realtime + postgrest) numa
   * unica requisicao. Medido em producao em 11/08: GET /api/ai/analyses levou
   * 3883ms, contra 60-100ms de todo o resto da API.
   *
   * A chave inclui url+key para que uma troca de credencial em runtime nao
   * continue usando o cliente antigo.
   */
  private storageClientCache: { key: string; client: SupabaseClient } | null = null;

  private getStorageClient(supabaseUrl: string, supabaseServiceKey: string): SupabaseClient {
    const key = `${supabaseUrl}::${supabaseServiceKey}`;
    if (this.storageClientCache && this.storageClientCache.key === key) {
      return this.storageClientCache.client;
    }
    const client = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.storageClientCache = { key, client };
    return client;
  }

  /**
   * URLs assinadas ja geradas, por caminho no bucket. A URL vale 60 min
   * (createSignedUrl 3600); guardamos 50 para nunca entregar uma que expira em
   * seguida. Antes cada abertura da lista pedia 40 assinaturas ao Supabase,
   * uma por imagem, mesmo que tivessem sido geradas um minuto antes.
   */
  private readonly signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
  private static readonly SIGNED_URL_TTL_MS = 50 * 60 * 1000;
  private static readonly SIGNED_URL_CACHE_MAX = 5000;

  private cacheSignedUrl(path: string, url: string): void {
    if (this.signedUrlCache.size >= AiService.SIGNED_URL_CACHE_MAX) {
      const oldest = this.signedUrlCache.keys().next().value;
      if (oldest !== undefined) this.signedUrlCache.delete(oldest);
    }
    this.signedUrlCache.set(path, { url, expiresAt: Date.now() + AiService.SIGNED_URL_TTL_MS });
  }

  private cachedSignedUrl(path: string): string | null {
    const hit = this.signedUrlCache.get(path);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.signedUrlCache.delete(path);
      return null;
    }
    return hit.url;
  }

  /** Caminho no bucket, ou URL a devolver como esta, ou nada. */
  private resolveImageRef(rawUrl: string | null): { path: string } | { passthrough: string } | null {
    if (!rawUrl) return null;
    if (rawUrl.startsWith('data:')) return { passthrough: rawUrl };
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('http')) {
      const match = trimmed.match(/analysis-images\/(.+?)(\?|$)/);
      return match?.[1] ? { path: decodeURIComponent(match[1]) } : { passthrough: trimmed };
    }
    return { path: trimmed };
  }

  /**
   * Assina varias imagens de uma vez: o que ja esta no cache sai dele, o resto
   * vai numa unica chamada `createSignedUrls`. Se o lote falhar, cai no
   * caminho de uma por uma (o mesmo de antes), entao nada fica pior.
   */
  private async signImagesBatch(rawUrls: Array<string | null>): Promise<Array<string | null>> {
    const refs = rawUrls.map((raw) => this.resolveImageRef(raw));
    const missing = [
      ...new Set(
        refs
          .filter((ref): ref is { path: string } => Boolean(ref && 'path' in ref))
          .map((ref) => ref.path)
          .filter((path) => !this.cachedSignedUrl(path)),
      ),
    ];

    if (missing.length > 0) {
      const supabaseUrl = process.env.SUPABASE_URL?.trim() || '';
      const supabaseServiceKey =
        process.env.SUPABASE_SERVICE_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
      if (supabaseUrl && supabaseServiceKey) {
        try {
          const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'analysis-images';
          const { data, error } = await this.getStorageClient(supabaseUrl, supabaseServiceKey)
            .storage.from(bucket)
            .createSignedUrls(missing, 3600);
          if (!error && Array.isArray(data)) {
            for (const item of data) {
              if (item?.path && item.signedUrl && !item.error) this.cacheSignedUrl(item.path, item.signedUrl);
            }
          }
        } catch (error) {
          this.logger.warn(
            `[AiService] Lote de URLs assinadas falhou: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
          );
        }
      }
    }

    return Promise.all(
      refs.map(async (ref, index) => {
        if (!ref) return null;
        if ('passthrough' in ref) return ref.passthrough;
        return this.cachedSignedUrl(ref.path) ?? this.getSignedImageUrl(rawUrls[index]);
      }),
    );
  }

  private async getSignedImageUrl(rawUrl: string | null): Promise<string | null> {
    if (!rawUrl) {
      return null;
    }

    if (rawUrl.startsWith('data:')) {
      return rawUrl;
    }

    let storagePath = rawUrl.trim();
    if (!storagePath) {
      return null;
    }

    if (storagePath.startsWith('http')) {
      const match = storagePath.match(/analysis-images\/(.+?)(\?|$)/);
      if (match?.[1]) {
        storagePath = decodeURIComponent(match[1]);
      } else {
        return storagePath;
      }
    }

    const cached = this.cachedSignedUrl(storagePath);
    if (cached) return cached;

    const supabaseUrl = process.env.SUPABASE_URL?.trim() || '';
    const supabaseServiceKey =
      process.env.SUPABASE_SERVICE_KEY?.trim() ||
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      '';

    if (!supabaseUrl || !supabaseServiceKey) {
      this.logger.warn('[AiService] Missing Supabase configuration while signing image URL.');
      return null;
    }

    try {
      const supabase = this.getStorageClient(supabaseUrl, supabaseServiceKey);

      const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'analysis-images';
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 3600);

      if (error || !data?.signedUrl) {
        this.logger.warn(
          `[AiService] Failed to generate signed URL for ${storagePath}: ${
            error?.message || 'signed URL unavailable'
          }`,
        );
        return null;
      }

      this.cacheSignedUrl(storagePath, data.signedUrl);
      return data.signedUrl;
    } catch (error) {
      this.logger.warn(
        `[AiService] getSignedImageUrl error: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  private getStoredAnalysisPayload(analysis: {
    result?: unknown;
    fullResponse?: unknown;
  }): Record<string, unknown> | null {
    if (analysis.result && typeof analysis.result === 'object' && !Array.isArray(analysis.result)) {
      return analysis.result as Record<string, unknown>;
    }

    if (
      analysis.fullResponse &&
      typeof analysis.fullResponse === 'object' &&
      !Array.isArray(analysis.fullResponse)
    ) {
      return analysis.fullResponse as Record<string, unknown>;
    }

    if (typeof analysis.fullResponse === 'string') {
      try {
        const parsed = JSON.parse(analysis.fullResponse);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private toNullableNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private toNullableString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized ? normalized : null;
  }

  private extractOperationFields(
    fullResponse: Record<string, unknown> | null,
    fallbackReasoning?: string | null,
  ): {
    analysisMeta: Record<string, unknown> | null;
    marketStructure: Record<string, unknown> | null;
    entry: number | null;
    stopLoss: number | null;
    stopLossPercent: number | null;
    takeProfit1: number | null;
    takeProfit1Percent: number | null;
    takeProfit2: number | null;
    takeProfit2Percent: number | null;
    reasoning: string | null;
    riskReward: string | null;
    riskRewardTp1: number | null;
    riskRewardTp2: number | null;
  } {
    const analysisMeta = this.asRecord(fullResponse?.analysis);
    const marketStructure = this.asRecord(analysisMeta?.marketStructure);

    const entry = this.toNullableNumber(
      analysisMeta?.entry ??
        analysisMeta?.entryPrice ??
        analysisMeta?.entry_price ??
        fullResponse?.entry ??
        fullResponse?.entryPrice ??
        fullResponse?.entry_price,
    );
    const stopLoss = this.toNullableNumber(
      analysisMeta?.stopLoss ??
        analysisMeta?.stop_loss ??
        fullResponse?.stopLoss ??
        fullResponse?.stop_loss,
    );
    const stopLossPercent = this.toNullableNumber(
      analysisMeta?.stopLossPercent ?? analysisMeta?.stop_loss_percent ?? fullResponse?.stopLossPercent,
    );
    const takeProfit1 = this.toNullableNumber(
      analysisMeta?.takeProfit1 ??
        analysisMeta?.take_profit_1 ??
        fullResponse?.takeProfit1 ??
        fullResponse?.take_profit_1,
    );
    const takeProfit1Percent = this.toNullableNumber(
      analysisMeta?.takeProfit1Percent ??
        analysisMeta?.take_profit_1_percent ??
        fullResponse?.takeProfit1Percent,
    );
    const takeProfit2 = this.toNullableNumber(
      analysisMeta?.takeProfit2 ??
        analysisMeta?.take_profit_2 ??
        fullResponse?.takeProfit2 ??
        fullResponse?.take_profit_2,
    );
    const takeProfit2Percent = this.toNullableNumber(
      analysisMeta?.takeProfit2Percent ??
        analysisMeta?.take_profit_2_percent ??
        fullResponse?.takeProfit2Percent,
    );
    const reasoning =
      this.toNullableString(fallbackReasoning) ??
      this.toNullableString(analysisMeta?.reasoning) ??
      this.toNullableString(fullResponse?.reasoning);
    // R/R recalculado a partir dos níveis (determinístico). Também corrige análises
    // antigas retroativamente, pois recalcula a partir dos números já armazenados.
    const side = normalizeRecommendation(fullResponse?.recommendation);
    const riskRewardTp1 = computeRiskReward(entry, stopLoss, takeProfit1, side);
    const riskRewardTp2 = computeRiskReward(entry, stopLoss, takeProfit2, side);
    const invalidTradePlan = hasInvalidTradePlanLevels(side, entry, stopLoss, takeProfit1, takeProfit2);

    const riskReward = invalidTradePlan || side === 'WAIT'
      ? null : formatRiskReward(riskRewardTp2 ?? riskRewardTp1);

    return {
      analysisMeta,
      marketStructure,
      entry,
      stopLoss,
      stopLossPercent,
      takeProfit1,
      takeProfit1Percent,
      takeProfit2,
      takeProfit2Percent,
      reasoning,
      riskReward,
      riskRewardTp1: invalidTradePlan || side === 'WAIT' ? null : riskRewardTp1,
      riskRewardTp2: invalidTradePlan || side === 'WAIT' ? null : riskRewardTp2,
    };
  }

  private toApiStatus(status: string): ApiAnalysisStatus {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'done' || normalized === 'completed') {
      return 'completed';
    }
    if (normalized === 'failed') {
      return 'failed';
    }
    if (normalized === 'processing') {
      return 'processing';
    }
    return 'pending';
  }

  private safeErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse() as { message?: string | string[] } | string;
      if (typeof response === 'string') {
        return response;
      }
      if (Array.isArray(response?.message)) {
        return response.message.join(', ');
      }
      if (typeof response?.message === 'string') {
        return response.message;
      }
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Failed to process analysis';
  }
}
