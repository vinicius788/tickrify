import { BadRequestException, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { captureServer } from '../../common/analytics/posthog';
import { recentCandles } from '../market/candle-store';
import { WATCH_ASSET_RULES, canonicalWatchSymbol, dayLevels, type DayLevels } from './watch-assets';

const BOOT_SQL = [
  `CREATE TABLE IF NOT EXISTS "tickrify"."UserWatchAsset" (
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "UserWatchAsset_pkey" PRIMARY KEY ("userId", "symbol")
  )`,
];

export type WatchAssetView = {
  symbol: string;
  timeframe: string;
  levels: DayLevels | null;
  /** ok = velas frescas; stale = fonte recusou, niveis das ultimas velas guardadas; unavailable = sem velas. */
  status: 'ok' | 'stale' | 'unavailable';
};

export type WatchAssetsView = {
  assets: WatchAssetView[];
  timeframe: string;
  maxAssets: number;
  suggested: readonly string[];
  timeframes: readonly string[];
};

/** Lista de ativos da pessoa e os niveis do dia (watch-assets.ts). Uma lista por conta. */
@Injectable()
export class WatchAssetsService implements OnModuleInit {
  private readonly logger = new Logger(WatchAssetsService.name);
  private ready = false;
  /** Trocado no teste. */
  candles: typeof recentCandles = recentCandles;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      for (const sql of BOOT_SQL) await this.prisma.$executeRawUnsafe(sql);
      this.ready = true;
      this.logger.log('[watch-assets] Tabela pronta.');
    } catch (error) {
      this.logger.warn(`[watch-assets] Indisponivel: ${error instanceof Error ? error.message : error}`);
    }
  }

  private assertReady() {
    if (!this.ready) throw new ServiceUnavailableException({ code: 'watch_assets_unavailable', message: 'Your asset list is temporarily unavailable.' });
  }

  private async rows(userId: string): Promise<Array<{ symbol: string; timeframe: string }>> {
    return this.prisma.$queryRaw<Array<{ symbol: string; timeframe: string }>>`
      SELECT "symbol", "timeframe" FROM "tickrify"."UserWatchAsset" WHERE "userId" = ${userId} ORDER BY "position" ASC, "symbol" ASC
    `;
  }

  /** A lista com os niveis do dia de cada ativo. */
  async view(userId: string, isSubscriber: boolean, nowMs: number = Date.now()): Promise<WatchAssetsView> {
    this.assertReady();
    const maxAssets = isSubscriber ? WATCH_ASSET_RULES.maxAssets.subscriber : WATCH_ASSET_RULES.maxAssets.free;
    // Quem deixou de assinar segue vendo so os primeiros do teto atual.
    const rows = (await this.rows(userId)).slice(0, maxAssets);
    const assets = await Promise.all(rows.map(async (row): Promise<WatchAssetView> => {
      // Reserva do monitor no Twelve Data: a lista nunca gasta a cota da analise.
      const got = await this.candles(row.symbol, row.timeframe, 'monitor', nowMs, { maxAgeMs: WATCH_ASSET_RULES.maxAgeMs })
        .catch(() => ({ candles: null, stale: false }));
      const levels = got.candles ? dayLevels(got.candles, row.timeframe, nowMs) : null;
      return { symbol: row.symbol, timeframe: row.timeframe, levels, status: !levels ? 'unavailable' : got.stale ? 'stale' : 'ok' };
    }));
    return {
      assets,
      timeframe: rows[0]?.timeframe ?? WATCH_ASSET_RULES.defaultTimeframe,
      maxAssets,
      suggested: WATCH_ASSET_RULES.suggested,
      timeframes: WATCH_ASSET_RULES.timeframes,
    };
  }

  /** Troca a lista inteira. Ativo sem fonte de preco ou acima do teto: recusa tudo, nada e gravado. */
  async save(user: { id: string; clerkUserId: string }, input: { symbols: string[]; timeframe: string }, isSubscriber: boolean): Promise<WatchAssetsView> {
    this.assertReady();
    const maxAssets = isSubscriber ? WATCH_ASSET_RULES.maxAssets.subscriber : WATCH_ASSET_RULES.maxAssets.free;
    const symbols: string[] = [];
    for (const raw of input.symbols) {
      const symbol = canonicalWatchSymbol(raw);
      if (!symbol) throw new BadRequestException({ code: 'asset_not_supported', message: `Price data isn't available for ${raw} yet.`, symbol: raw });
      if (!symbols.includes(symbol)) symbols.push(symbol);
    }
    if (symbols.length > maxAssets) {
      throw new BadRequestException({ code: 'asset_limit', message: `You can follow up to ${maxAssets} assets on your plan.`, maxAssets });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM "tickrify"."UserWatchAsset" WHERE "userId" = ${user.id}`;
      for (const [position, symbol] of symbols.entries()) {
        await tx.$executeRaw`
          INSERT INTO "tickrify"."UserWatchAsset" ("userId", "symbol", "timeframe", "position")
          VALUES (${user.id}, ${symbol}, ${input.timeframe}, ${position})
        `;
      }
    });
    captureServer(user.clerkUserId, 'watch_assets_saved', { count: symbols.length, timeframe: input.timeframe, is_subscriber: isSubscriber });
    return this.view(user.id, isSubscriber);
  }
}
