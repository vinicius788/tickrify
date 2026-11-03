import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { AIAdapter, AIAnalysisError, scrubPromptLeak } from '../ai/ai.adapter';
import { buildAnalysisPrompt } from '../prompt/prompt-builder.service';
import { UploadedFile } from '../../common/interfaces/multer';
import { prepareIncomingImage } from '../../common/utils/image-storage';
import {
  computeRiskReward,
  hasInvalidTradePlanLevels,
  formatRiskReward,
  normalizeBias,
  normalizeConfidence,
  normalizeRecommendation,
} from '../../common/utils/analysis-normalizer';
import { assertDemoOpen } from './demo-control';
import { storedSignalState, type PriceLocation, type WatchReach } from '../../common/utils/signal-decision';
import type { WatchPlan } from '../../common/utils/plan-engine';

type DemoUsage = { id: string; result: unknown; createdAt: Date; pending: boolean };

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
export class DemoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoService.name);
  private tableReady = false;
  private staleSweep?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private aiAdapter: AIAdapter,
  ) {}

  /** Concluidas em 24h + vagas reservadas; falhas liberadas nao gastam cota. */
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
      // Resultado da demo guardado (05/10/2026): ver `analyze`, passo 2.
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."DemoUsage" ADD COLUMN IF NOT EXISTS "result" JSONB',
      );
      this.tableReady = true;
      this.logger.log('[demo] Tabela de controle da demo pronta (RLS habilitado).');
      await this.releaseStale();
      this.staleSweep = setInterval(() => void this.releaseStale(), 10 * 60_000);
      this.staleSweep.unref();
    } catch (err) {
      this.tableReady = false;
      this.logger.warn(
        `[demo] Não foi possível preparar a tabela da demo (recurso ficará indisponível): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  onModuleDestroy(): void {
    if (this.staleSweep) clearInterval(this.staleSweep);
  }

  /** Vaga presa por processo morto (deploy no meio da IA) volta sozinha. A IA
   * tem timeout de ~2 min: 30 min e muito acima de qualquer requisicao viva, e
   * uma gravacao tardia so acha a linha se ela ainda estiver pendente. */
  private async releaseStale(): Promise<void> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        DELETE FROM "tickrify"."DemoUsage"
        WHERE "result" = 'null'::jsonb AND "createdAt" < NOW() - INTERVAL '30 minutes'
        RETURNING "id"
      `;
      if (rows.length) this.logger.warn(`[demo] ${rows.length} reserva(s) presa(s) liberada(s) automaticamente.`);
    } catch {
      // Proxima volta tenta de novo; nunca derruba o boot.
    }
  }

  /** Hash com salt secreto — nunca persistimos IP/fingerprint crus (GDPR). */
  private hashIdentifier(value: string): string {
    const salt =
      process.env.DEMO_HASH_SALT?.trim() ||
      process.env.CLERK_SECRET_KEY?.trim();
    if (!salt) {
      throw new ServiceUnavailableException({
        code: 'demo_unavailable',
        message: 'Free demo is temporarily unavailable. Please try again shortly.',
      });
    }
    return createHash('sha256').update(`${salt}|${value}`).digest('hex');
  }

  /**
   * Verifica o token do Cloudflare Turnstile no servidor.
   * Sem chave ou sem resposta confiável, a demo fica indisponível (503).
   * Token ausente ou rejeitado bloqueia a análise (403), antes de gerar custo.
   */
  private async verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
    if (!secret) {
      this.logger.warn('[demo] TURNSTILE_SECRET_KEY ausente — demo indisponível.');
      throw this.botCheckUnavailable();
    }
    if (!token || !token.trim()) {
      return false;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token, remoteip: ip }).toString(),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Turnstile returned a non-success HTTP status');
      const data = (await res.json()) as { success?: boolean };
      return data?.success === true;
    } catch {
      this.logger.warn('[demo] Verificação Turnstile indisponível — análise bloqueada.');
      throw this.botCheckUnavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  private botCheckUnavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'bot_check_unavailable',
      message: 'Verification is temporarily unavailable. Please try again shortly.',
    });
  }

  /**
   * Este device ja usou a demo? E, se usou nas ultimas 24h, o resultado que ele
   * recebeu. O resultado volta porque, no celular, a conexao de ~20 s cai quando
   * a pessoa troca de app: o servidor concluia, gastava a cota e ela via
   * "network error" e depois "you already used" sem nunca ver a analise
   * (05/10/2026: 16 network_error em 126 demos em 14 dias).
   */
  async getFingerprintStatus(fingerprint: string): Promise<{ used: boolean; result: Record<string, unknown> | null }> {
    if (!this.tableReady) return { used: false, result: null };
    const row = await this.findUsage(this.hashIdentifier(fingerprint));
    return { used: Boolean(row && !row.pending), result: this.recoverable(row) };
  }

  private async findUsage(fpHash: string, client: Pick<PrismaService, '$queryRaw'> = this.prisma) {
    const rows = await client.$queryRaw<DemoUsage[]>`
      SELECT "id", "result", "createdAt", COALESCE("result" = 'null'::jsonb, FALSE) AS "pending"
      FROM "tickrify"."DemoUsage" WHERE "fingerprintHash" = ${fpHash} LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /** O resultado guardado so volta por 24h. Nunca gera analise nova nem custo. */
  private recoverable(row: { result: unknown; createdAt: Date; pending?: boolean } | null): Record<string, unknown> | null {
    if (row?.pending) return null;
    if (!row || !row.result || typeof row.result !== 'object') return null;
    const age = Date.now() - new Date(row.createdAt).getTime();
    if (!(age >= 0 && age < 24 * 60 * 60 * 1000)) return null;
    return { ...(row.result as Record<string, unknown>), recovered: true };
  }

  /** Erro público padrão de limite — mensagem orientada à ação, sem detalhes internos. */
  private limitError(): ForbiddenException {
    return new ForbiddenException({
      code: 'demo_limit_reached',
      message: 'You already used your free analysis. Create a free account to keep analyzing.',
    });
  }

  private inProgressError(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'demo_in_progress',
      message: 'Your free analysis is still being processed. Please try again shortly.',
    });
  }

  private async releaseReservation(id: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM "tickrify"."DemoUsage" WHERE "id" = ${id} AND "result" = 'null'::jsonb
    `;
  }

  private async reserveUsage(fpHash: string, ipHash: string): Promise<{ id: string; existing?: DemoUsage }> {
    const id = randomUUID();
    try {
      return await this.prisma.$transaction(async tx => {
        await assertDemoOpen(tx);
        // Transaction-scoped, including with transaction pooling. Never held over AI.
        // ReadCommitted ensures the count sees the previous lock holder's commit.
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`tickrify-demo:${ipHash}`}, 0))`;
        const existing = await this.findUsage(fpHash, tx);
        if (existing) return { id: existing.id, existing };
        const rows = await tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count FROM "tickrify"."DemoUsage"
          WHERE "ipHash" = ${ipHash}
            AND ("result" = 'null'::jsonb OR "createdAt" > NOW() - INTERVAL '24 hours')
        `;
        if (Number(rows[0]?.count ?? 0) >= this.ipDailyCap) throw this.limitError();
        // JSON null is pending; legacy SQL NULL remains an already-used demo.
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO "tickrify"."DemoUsage" ("id", "fingerprintHash", "ipHash", "result")
          VALUES (${id}, ${fpHash}, ${ipHash}, 'null'::jsonb)
          ON CONFLICT ("fingerprintHash") DO NOTHING RETURNING "id"
        `;
        if (inserted.length) return { id };
        // The same fingerprint may compete from different IPs/locks.
        const winner = await this.findUsage(fpHash, tx);
        if (!winner) throw this.inProgressError();
        return { id: winner.id, existing: winner };
      }, { isolationLevel: 'ReadCommitted' });
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof ServiceUnavailableException) throw error;
      this.logger.warn(`[demo] Reserva ${id} nao confirmada; nenhuma IA iniciada.`);
      throw this.inProgressError();
    }
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

    // Recovery never requires another image. Admission repeats this read under
    // the IP lock, so this fast path is not the concurrency protection.
    const used = await this.findUsage(fpHash);
    if (used) {
      if (used.pending) throw this.inProgressError();
      const recovered = this.recoverable(used);
      if (recovered) return recovered;
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

    // 2/3) Reserva fingerprint e capacidade por IP ANTES de qualquer IA.
    const reservation = await this.reserveUsage(fpHash, ipHash);
    if (reservation.existing) {
      if (reservation.existing.pending) throw this.inProgressError();
      const recovered = this.recoverable(reservation.existing);
      if (recovered) return recovered;
      throw this.limitError();
    }
    this.logger.log(`[demo] Reserva ${reservation.id} admitida.`);

    // 5) Análise REAL — mesmo motor 'quick' da plataforma, prompt do código.
    //    Nada do prompt/modelo sai daqui.
    let safe: ReturnType<DemoService['serializeSafeResult']>;
    try {
      const prompt = buildAnalysisPrompt({ userLanguage: params.userLanguage, analysisType: 'quick' });

      const aiResponse = await this.aiAdapter.analyzeImage(dataUrl, prompt, 'quick');
      safe = this.serializeSafeResult(aiResponse);
    } catch (error) {
      try {
        // Only the owner can release its still-pending slot. Never delete a result.
        await this.releaseReservation(reservation.id);
      } catch {
        this.logger.warn(`[demo] Reserva ${reservation.id} pendente de reconciliacao.`);
        throw this.inProgressError();
      }
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

    try {
      const updated = await this.prisma.$executeRaw`
        UPDATE "tickrify"."DemoUsage" SET "result" = ${JSON.stringify(safe)}::jsonb, "createdAt" = NOW()
        WHERE "id" = ${reservation.id} AND "result" = 'null'::jsonb
      `;
      if (updated !== 1) throw new Error('Pending reservation was not finalized');
      return safe;
    } catch {
      // Unknown write outcome: keep the slot. A committed result is recoverable;
      // a pending one needs reconciliation after its execution is confirmed stopped.
      this.logger.warn(`[demo] Resultado da reserva ${reservation.id} nao confirmado; vaga preservada.`);
      throw this.inProgressError();
    }
  }

  /**
   * Serialização SEGURA: só os campos de valor pro visitante (tendência,
   * entrada, stop, alvos, R:R, confiança). Sem rawResponse, sem rawContent,
   * sem qualquer metadado do motor. Textos passam pelo scrub anti-vazamento.
   */
  private serializeSafeResult(aiResponse: {
    recommendation: unknown;
    signalState?: unknown;
    bias?: unknown;
    confidence?: unknown;
    reasoning?: unknown;
    analysis?: unknown;
    watchPlan?: WatchPlan | null;
    watchReach?: WatchReach | null;
    location?: PriceLocation | null;
    dataMode?: unknown;
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
    const rrTp1 = computeRiskReward(entry, stopLoss, takeProfit1, recommendation);
    const rrTp2 = computeRiskReward(entry, stopLoss, takeProfit2, recommendation);
    const invalidTradePlan = hasInvalidTradePlanLevels(recommendation, entry, stopLoss, takeProfit1, takeProfit2);

    const reasoning = scrubPromptLeak(
      str(aiResponse.reasoning) ?? str(analysis.reasoning) ?? '',
      'Analysis details unavailable.',
    );

    return {
      status: 'completed' as const,
      recommendation,
      signalState: storedSignalState({ signalState: aiResponse.signalState, analysis }, recommendation),
      bias,
      confidence,
      symbol: str(analysis.symbol) ?? 'N/A',
      timeframe: str(analysis.timeframe) ?? 'N/A',
      currentPrice: num(analysis.currentPrice),
      entry,
      stopLoss,
      takeProfit1,
      takeProfit2,
      // TP1 primeiro (30/09/2026): é o alvo que a /accuracy mede, e a tela do
      // /try rotula o número como "R:R to TP1".
      riskReward: invalidTradePlan || recommendation === 'WAIT' ? null : formatRiskReward(rrTp1 ?? rrTp2),
      // Modo leitura (02/11/2026): os mesmos tres blocos do painel. Textos do
      // modelo passam pelo scrub; numeros sao do codigo (REAL DATA).
      trendStrength: ['strong', 'moderate', 'weak'].includes(String(analysis.trendStrength)) ? String(analysis.trendStrength) : null,
      readLine: scrubPromptLeak((str(analysis.executiveSummary) ?? '').split(/(?<=[.!?])\s/)[0].slice(0, 220), ''),
      watchPlan: aiResponse.watchPlan
        ? { ...aiResponse.watchPlan, trigger: scrubPromptLeak(String(aiResponse.watchPlan.trigger ?? '').slice(0, 160), '') }
        : null,
      watchReach: aiResponse.watchReach ?? null,
      location: aiResponse.location ?? null,
      // Origem dos niveis, a mesma regra do painel: so 'print' mostra "estimated".
      dataMode: aiResponse.dataMode === 'real_data' || aiResponse.dataMode === 'print' ? aiResponse.dataMode : null,
      reasoning,
      // Aviso legal: a demo é pública — reforçar caráter educacional na própria resposta.
      disclaimer:
        'Educational analysis only, not financial advice. Trading involves risk; the decision is always yours.',
      demoRemaining: 0,
    };
  }
}
