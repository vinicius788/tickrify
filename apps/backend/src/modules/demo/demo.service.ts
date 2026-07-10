import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { AIAdapter, AIAnalysisError, scrubPromptLeak } from '../ai/ai.adapter';
import { PromptBuilderService } from '../prompt/prompt-builder.service';
import { UploadedFile } from '../../common/interfaces/multer';
import { prepareIncomingImage } from '../../common/utils/image-storage';
import {
  computeRiskReward,
  formatRiskReward,
  normalizeBias,
  normalizeConfidence,
  normalizeRecommendation,
} from '../../common/utils/analysis-normalizer';

/**
 * Demo anônima (sem cadastro) — o "aha moment" antes do sign-up.
 *
 * Regras de negócio (não-negociáveis):
 * - 1 análise REAL grátis por device (fingerprint), decidida SEMPRE no servidor.
 * - A cota só é gasta quando a análise COMPLETA. Falha do provedor de IA não
 *   consome a grátis do visitante.
 * - IP e fingerprint são persistidos APENAS como hash com salt secreto
 *   (LGPD/GDPR). A tabela tem RLS habilitado sem policies — só o backend
 *   (conexão direta Prisma) lê/escreve; PostgREST/cliente não acessam.
 * - Teto persistente por IP em 24h (multi-device atrás do mesmo IP) limita o
 *   custo máximo de API mesmo com rotação de fingerprint.
 * - Nenhuma resposta ou erro público revela modelo, prompt ou detalhes internos.
 */
@Injectable()
export class DemoService implements OnModuleInit {
  private readonly logger = new Logger(DemoService.name);
  private tableReady = false;

  constructor(
    private prisma: PrismaService,
    private aiAdapter: AIAdapter,
    private promptBuilder: PromptBuilderService,
  ) {}

  /** Teto de análises demo CONCLUÍDAS por IP em 24h (custo máximo por IP). */
  private get ipDailyCap(): number {
    const raw = Number(process.env.DEMO_IP_DAILY_CAP || 3);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
  }

  /**
   * Cria a tabela de controle de forma idempotente no boot (mesmo padrão
   * aditivo do AiService.onModuleInit — nunca derruba o boot; se falhar, a
   * demo fica indisponível e o resto do app segue normal).
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "tickrify"."DemoUsage" (
          "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "fingerprintHash" TEXT NOT NULL,
          "ipHash" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await this.prisma.$executeRawUnsafe(
        'CREATE UNIQUE INDEX IF NOT EXISTS "DemoUsage_fingerprintHash_key" ON "tickrify"."DemoUsage"("fingerprintHash")',
      );
      await this.prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS "DemoUsage_ipHash_createdAt_idx" ON "tickrify"."DemoUsage"("ipHash", "createdAt")',
      );
      // RLS sem policies: bloqueia qualquer acesso via PostgREST (anon/authenticated).
      // A conexão do Prisma (owner da tabela) não é afetada.
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."DemoUsage" ENABLE ROW LEVEL SECURITY',
      );
      this.tableReady = true;
      this.logger.log('[demo] Tabela de controle da demo pronta (RLS habilitado).');
    } catch (err) {
      this.tableReady = false;
      this.logger.warn(
        `[demo] Não foi possível preparar a tabela da demo (recurso ficará indisponível): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /** Hash com salt secreto — nunca persistimos IP/fingerprint crus (GDPR). */
  private hashIdentifier(value: string): string {
    const salt =
      process.env.DEMO_HASH_SALT?.trim() ||
      process.env.CLERK_SECRET_KEY?.trim() ||
      'tickrify-demo-dev-salt';
    return createHash('sha256').update(`${salt}|${value}`).digest('hex');
  }

  /**
   * Verifica o token do Cloudflare Turnstile no servidor.
   * - Sem TURNSTILE_SECRET_KEY configurada: passa (permite deploy antes das
   *   chaves existirem), com aviso no log.
   * - Com chave: token ausente/inválido bloqueia. Indisponibilidade de rede da
   *   Cloudflare NÃO bloqueia (fail-open só em outage, nunca em token inválido).
   */
  private async verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
    if (!secret) {
      this.logger.warn('[demo] TURNSTILE_SECRET_KEY ausente — desafio anti-bot desativado.');
      return true;
    }
    if (!token || !token.trim()) {
      return false;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token, remoteip: ip }).toString(),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = (await res.json()) as { success?: boolean };
      return data?.success === true;
    } catch (err) {
      // Outage da Cloudflare: não derruba a conversão inteira por causa disso.
      this.logger.warn(
        `[demo] Verificação Turnstile indisponível (fail-open): ${
          err instanceof Error ? err.message : err
        }`,
      );
      return true;
    }
  }

  /** true se este fingerprint JÁ consumiu a análise grátis. */
  async isFingerprintUsed(fingerprint: string): Promise<boolean> {
    if (!this.tableReady) return false;
    const fpHash = this.hashIdentifier(fingerprint);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "tickrify"."DemoUsage" WHERE "fingerprintHash" = ${fpHash} LIMIT 1
    `;
    return rows.length > 0;
  }

  /** Erro público padrão de limite — mensagem orientada à ação, sem detalhes internos. */
  private limitError(): ForbiddenException {
    return new ForbiddenException({
      code: 'demo_limit_reached',
      message: 'You already used your free analysis. Create a free account to keep analyzing.',
    });
  }

  async analyze(params: {
    file?: UploadedFile;
    base64Image?: string;
    fingerprint: string;
    turnstileToken?: string;
    ip: string;
    userLanguage?: string;
  }) {
    if (!this.tableReady) {
      throw new ServiceUnavailableException({
        code: 'demo_unavailable',
        message: 'Free demo is temporarily unavailable. Please try again shortly.',
      });
    }

    // 1) Anti-bot ANTES de qualquer custo.
    const human = await this.verifyTurnstile(params.turnstileToken, params.ip);
    if (!human) {
      throw new ForbiddenException({
        code: 'bot_check_failed',
        message: 'Verification failed. Please refresh the page and try again.',
      });
    }

    const fpHash = this.hashIdentifier(params.fingerprint);
    const ipHash = this.hashIdentifier(params.ip);

    // 2) Cota por device: 1 análise concluída por fingerprint (persistente, server-side).
    const usedRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "tickrify"."DemoUsage" WHERE "fingerprintHash" = ${fpHash} LIMIT 1
    `;
    if (usedRows.length > 0) {
      throw this.limitError();
    }

    // 3) Teto persistente por IP/24h: limita o custo máximo mesmo com rotação
    //    de fingerprint (sobrevive a restart/hibernação do Render).
    const ipRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "tickrify"."DemoUsage"
      WHERE "ipHash" = ${ipHash} AND "createdAt" > NOW() - INTERVAL '24 hours'
    `;
    const ipCount = Number(ipRows[0]?.count ?? 0);
    if (ipCount >= this.ipDailyCap) {
      throw this.limitError();
    }

    // 4) Imagem: validação local (sem storage — a demo não persiste a imagem).
    let dataUrl: string;
    try {
      dataUrl = prepareIncomingImage(params.file, params.base64Image).dataUrl;
    } catch (error) {
      throw new BadRequestException({
        code: 'invalid_image',
        message: error instanceof Error ? error.message : 'Invalid image payload.',
      });
    }

    // 5) Análise REAL — mesmo motor 'quick' da plataforma, prompt resolvido
    //    server-side (banco → arquivo). Nada do prompt/modelo sai daqui.
    try {
      const latestPrompt = await this.prisma.promptConfig.findFirst({
        where: { isActive: true },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const prompt = await this.promptBuilder.buildPromptByVersion(
        'quick',
        latestPrompt?.version,
        undefined,
        params.userLanguage,
      );

      const aiResponse = await this.aiAdapter.analyzeImage(dataUrl, prompt, 'quick');

      // 6) Sucesso → AGORA a cota é gasta (contabilização justa). ON CONFLICT
      //    cobre corrida entre requisições simultâneas do mesmo device.
      await this.prisma.$executeRaw`
        INSERT INTO "tickrify"."DemoUsage" ("fingerprintHash", "ipHash")
        VALUES (${fpHash}, ${ipHash})
        ON CONFLICT ("fingerprintHash") DO NOTHING
      `;

      return this.serializeSafeResult(aiResponse);
    } catch (error) {
      // Imagem que não é gráfico: erro claro pro usuário, cota intacta.
      if (error instanceof AIAnalysisError && error.code === 'non_chart_image') {
        throw new BadRequestException({
          code: 'non_chart_image',
          message: 'This image does not look like a trading chart. Upload a chart screenshot and try again.',
        });
      }

      // Qualquer outra falha: log interno com detalhe, resposta pública GENÉRICA
      // (nunca ecoar mensagem do provedor — pode conter nome de modelo).
      this.logger.warn(
        `[demo] Análise demo falhou (cota NÃO consumida): ${
          error instanceof Error ? error.message : error
        }`,
      );
      throw new ServiceUnavailableException({
        code: 'analysis_failed',
        message: 'Analysis failed. Your free analysis was not used — please try again.',
      });
    }
  }

  /**
   * Serialização SEGURA: só os campos de valor pro visitante (tendência,
   * entrada, stop, alvos, R:R, confiança). Sem rawResponse, sem rawContent,
   * sem qualquer metadado do motor. Textos passam pelo scrub anti-vazamento.
   */
  private serializeSafeResult(aiResponse: {
    recommendation: unknown;
    bias?: unknown;
    confidence?: unknown;
    reasoning?: unknown;
    analysis?: unknown;
  }) {
    const analysis =
      aiResponse.analysis && typeof aiResponse.analysis === 'object'
        ? (aiResponse.analysis as Record<string, unknown>)
        : {};

    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    const str = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() ? v.trim() : null;

    const recommendation = normalizeRecommendation(aiResponse.recommendation);
    const marketStructure =
      analysis.marketStructure && typeof analysis.marketStructure === 'object'
        ? (analysis.marketStructure as Record<string, unknown>)
        : null;
    const bias = normalizeBias(aiResponse.bias ?? marketStructure?.bias, recommendation);
    const confidence = normalizeConfidence(aiResponse.confidence, 50);

    const entry = num(analysis.entry);
    const stopLoss = num(analysis.stopLoss);
    const takeProfit1 = num(analysis.takeProfit1);
    const takeProfit2 = num(analysis.takeProfit2);
    const rrTp1 = computeRiskReward(entry, stopLoss, takeProfit1);
    const rrTp2 = computeRiskReward(entry, stopLoss, takeProfit2);

    const reasoning = scrubPromptLeak(
      str(aiResponse.reasoning) ?? str(analysis.reasoning) ?? '',
      'Analysis details unavailable.',
    );

    return {
      status: 'completed' as const,
      recommendation,
      bias,
      confidence,
      symbol: str(analysis.symbol) ?? 'N/A',
      timeframe: str(analysis.timeframe) ?? 'N/A',
      currentPrice: num(analysis.currentPrice),
      entry,
      stopLoss,
      takeProfit1,
      takeProfit2,
      riskReward: formatRiskReward(rrTp2 ?? rrTp1),
      reasoning,
      // Aviso legal: a demo é pública — reforçar caráter educacional na própria resposta.
      disclaimer:
        'Educational analysis only — not financial advice. Trading involves risk; the decision is always yours.',
      demoRemaining: 0,
    };
  }
}
