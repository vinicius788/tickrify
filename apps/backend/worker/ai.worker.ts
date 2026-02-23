import { Job, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { TRADING_SYSTEM_PROMPT } from '../src/common/prompts/trading-system-prompt';
import {
  buildPersistedAnalysisPayload,
  NormalizedPersistedAnalysis,
} from '../src/common/utils/analysis-payload';
import {
  Recommendation,
  recommendationToBias,
} from '../src/common/utils/analysis-normalizer';
import { buildDemoDrawingPlan } from '../src/common/utils/drawing-plan';
import { AIAdapter } from '../src/modules/ai/ai.adapter';
import { ImageStorageClient } from '../src/common/utils/image-storage';

const prisma = new PrismaClient();
const aiAdapter = new AIAdapter();
const storage = new ImageStorageClient();

interface JobData {
  analysisId: string;
  imageUrl: string;
  promptOverride?: string;
  promptVersion?: number;
  userId?: string;
}

function getRedisConnection() {
  if (process.env.REDIS_URL) {
    try {
      const redisUrl = new URL(process.env.REDIS_URL);
      return {
        host: redisUrl.hostname,
        port: parseInt(redisUrl.port || '6379', 10),
        password: redisUrl.password || undefined,
        tls: redisUrl.protocol === 'rediss:' ? {} : undefined,
      };
    } catch {
      // fall through to host/port fallback
    }
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  };
}

function hasValidOpenAiKey(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY &&
      process.env.OPENAI_API_KEY !== 'sk-xxxxx' &&
      process.env.OPENAI_API_KEY.startsWith('sk-'),
  );
}

function isProductionEnvironment(): boolean {
  const env = String(process.env.APP_ENV || process.env.NODE_ENV || 'development')
    .trim()
    .toLowerCase();
  return env === 'production';
}

function canUseDemoFallback(): boolean {
  if (isProductionEnvironment()) {
    return false;
  }

  const appEnv = String(process.env.APP_ENV || '').trim().toLowerCase();
  return appEnv === 'dev' || process.env.DEMO_MODE === 'true';
}

function randomRecommendation(): Recommendation {
  const options: Recommendation[] = ['BUY', 'SELL', 'WAIT'];
  return options[Math.floor(Math.random() * options.length)];
}

function generateDemoAnalysis() {
  const recommendation = randomRecommendation();
  const bias = recommendationToBias(recommendation);
  const confidence = Math.floor(Math.random() * 20) + 75;
  const drawingPlan = buildDemoDrawingPlan(recommendation, bias);

  const reasoning = `Analise demo ${recommendation}/${bias} com referencias visuais: ${drawingPlan.elements[0].id} e ${drawingPlan.elements[1].id}.`;

  return {
    recommendation,
    bias,
    confidence,
    reasoning,
    analysis: {
      symbol: 'DEMO/USDT',
      timeframe: '1H',
      confluenceScore: confidence,
      marketStructure: {
        bias,
      },
      technicalAnalysis:
        'Modo demonstracao ativo. Configure OPENAI_API_KEY valida para analise real.',
      executiveSummary:
        'Resposta gerada em modo demo para manter o fluxo end-to-end funcional.',
    },
    drawing_plan: drawingPlan,
  };
}

async function getPrompt(promptOverride?: string, promptVersion?: number): Promise<string> {
  if (promptOverride) {
    return promptOverride;
  }

  if (promptVersion) {
    const promptConfig = await prisma.promptConfig.findUnique({
      where: { version: promptVersion },
    });
    if (promptConfig?.prompt) {
      return promptConfig.prompt;
    }
  }

  const activePrompt = await prisma.promptConfig.findFirst({
    where: { isActive: true },
    orderBy: { version: 'desc' },
  });

  return activePrompt?.prompt || TRADING_SYSTEM_PROMPT;
}

async function persistAnnotatedImage(
  payload: NormalizedPersistedAnalysis,
  userId?: string,
): Promise<NormalizedPersistedAnalysis> {
  if (!payload.annotatedImageUrl || !payload.annotatedImageUrl.startsWith('data:')) {
    return payload;
  }

  if (!storage.isConfigured()) {
    if (storage.requiresRemoteStorage()) {
      payload.annotatedImageUrl = null;
      payload.drawingFailed = true;
      payload.fullResponse.annotated_image_url = null;
      payload.fullResponse.drawing_failed = true;
    }
    return payload;
  }

  const owner = userId || 'unknown-user';
  const uploadedUrl = await storage.uploadDataUrl(
    payload.annotatedImageUrl,
    `analyses/${owner}/annotated`,
  );

  payload.annotatedImageUrl = uploadedUrl;
  payload.fullResponse.annotated_image_url = uploadedUrl;
  payload.fullResponse.drawing_failed = Boolean(payload.drawingFailed);
  return payload;
}

async function resolveAiSource(imageUrl: string, prompt: string) {
  if (hasValidOpenAiKey()) {
    return aiAdapter.analyzeImage(imageUrl, prompt);
  }

  if (canUseDemoFallback()) {
    return generateDemoAnalysis();
  }

  throw new Error('OpenAI key is missing or invalid in production mode.');
}

function safeWorkerErrorMessage(error: unknown): string {
  if (!isProductionEnvironment() && error instanceof Error) {
    return error.message;
  }

  return 'Analysis processing failed. Please try again later.';
}

async function processAnalysis(job: Job<JobData>) {
  const { analysisId, imageUrl, promptOverride, promptVersion, userId } = job.data;

  console.log(`[Worker] Processing analysis ${analysisId}`);

  try {
    await prisma.analysis.update({
      where: { id: analysisId },
      data: { status: 'processing' },
    });

    const prompt = await getPrompt(promptOverride, promptVersion);
    const aiSource: any = await resolveAiSource(imageUrl, prompt);

    let normalized = buildPersistedAnalysisPayload({
      source: (aiSource.rawResponse as Record<string, any>) || aiSource,
      recommendation: aiSource.recommendation,
      bias: aiSource.bias,
      confidence: aiSource.confidence,
      reasoning: aiSource.reasoning,
      analysis: aiSource.analysis,
      drawingPlan: aiSource.drawingPlan || aiSource.drawing_plan,
      originalImageUrl: imageUrl,
      forceDrawingPlanForDemo: !hasValidOpenAiKey() && canUseDemoFallback(),
    });

    normalized = await persistAnnotatedImage(normalized, userId);

    await prisma.analysis.update({
      where: { id: analysisId },
      data: {
        status: 'completed',
        recommendation: normalized.recommendation,
        confidence: normalized.confidence,
        reasoning: normalized.reasoning,
        imageUrl: normalized.originalImageUrl,
        fullResponse: normalized.fullResponse as any,
      },
    });

    console.log(`[Worker] Analysis ${analysisId} completed`);
  } catch (error) {
    console.error(`[Worker] Error processing analysis ${analysisId}:`, error);

    await prisma.analysis.update({
      where: { id: analysisId },
      data: {
        status: 'failed',
        reasoning: safeWorkerErrorMessage(error),
      },
    });

    throw error;
  }
}

const worker = new Worker<JobData>('ai-analysis', processAnalysis, {
  connection: getRedisConnection() as any,
  concurrency: 3,
});

worker.on('completed', (job) => {
  console.log(`✅ [Worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ [Worker] Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('❌ [Worker] Error:', err);
});

console.log('🚀 AI Worker started and listening for jobs...');

async function shutdown() {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
