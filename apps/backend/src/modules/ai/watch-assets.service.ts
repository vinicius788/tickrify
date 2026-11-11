import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { captureServer } from '../../common/analytics/posthog';
import { recentCandles } from '../market/candle-store';
import { WATCH_ASSET_RULES, canonicalWatchSymbol, dayLevels, type DayLevels } from './watch-assets';
import { SetupAlertsService, type AssetAlertView } from './setup-alerts.service';

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
  /** Alertas do ativo: valendo, e disparados que a pessoa ainda nao viu. */
  alerts: AssetAlertView[];
};

export type WatchAssetsView = {
  assets: WatchAssetView[];
  timeframe: string;
  maxAssets: number;
  suggested: readonly string[];
  timeframes: readonly string[];
  /** false = o botao de alerta nao aparece. */
  alertsAvailable: boolean;
};

/** Lista de ativos da pessoa e os niveis do dia (watch-assets.ts). Uma lista por conta. */
@Injectable()
export class WatchAssetsService implements OnModuleInit {
  private readonly logger = new Logger(WatchAssetsService.name);
  private ready = false;
  /** Trocado no teste. */
  candles: typeof recentCandles = recentCandles;

  constructor(private readonly prisma: PrismaService, private readonly alerts: SetupAlertsService) {}

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

  private async levelsOf(row: { symbol: string; timeframe: string }, nowMs: number): Promise<{ levels: DayLevels | null; stale: boolean }> {
    // Reserva do monitor no Twelve Data: a lista nunca gasta a cota da analise.
    const got = await this.candles(row.symbol, row.timeframe, 'monitor', nowMs, { maxAgeMs: WATCH_ASSET_RULES.maxAgeMs })
      .catch(() => ({ candles: null, stale: false }));
    return { levels: got.candles ? dayLevels(got.candles, row.timeframe, nowMs) : null, stale: got.stale === true };
  }

  /**
   * Liga ou desliga o alerta de um ativo da lista. Ligar vigia o nivel acima e
   * o abaixo de AGORA (recalculados aqui), por um dia. Sem analise e sem cota.
   */
  async setAlert(user: { id: string; clerkUserId: string }, rawSymbol: string, on: boolean, isSubscriber: boolean): Promise<WatchAssetsView> {
    this.assertReady();
    const maxAssets = isSubscriber ? WATCH_ASSET_RULES.maxAssets.subscriber : WATCH_ASSET_RULES.maxAssets.free;
    const symbol = canonicalWatchSymbol(rawSymbol);
    const row = (await this.rows(user.id)).slice(0, maxAssets).find((r) => r.symbol === symbol);
    if (!row) throw new NotFoundException({ code: 'asset_not_in_list', message: 'Add this asset to your list first.' });
    if (!on) {
      await this.alerts.cancelAssetAlerts(user.id, { symbol: row.symbol });
      return this.view(user.id, isSubscriber);
    }
    const { levels } = await this.levelsOf(row, Date.now());
    const wanted = [levels?.above?.price, levels?.below?.price].filter((p): p is number => typeof p === 'number');
    if (!levels || wanted.length === 0) {
      throw new UnprocessableEntityException({ code: 'asset_levels_unavailable', message: 'No level to watch on this asset right now.' });
    }
    await this.alerts.setAssetAlerts(user, { symbol: row.symbol, referencePrice: levels.price, levels: wanted }, { isSubscriber });
    return this.view(user.id, isSubscriber);
  }

  /** A lista com os niveis do dia de cada ativo. */
  async view(userId: string, isSubscriber: boolean, nowMs: number = Date.now()): Promise<WatchAssetsView> {
    this.assertReady();
    const maxAssets = isSubscriber ? WATCH_ASSET_RULES.maxAssets.subscriber : WATCH_ASSET_RULES.maxAssets.free;
    // Quem deixou de assinar segue vendo so os primeiros do teto atual.
    const rows = (await this.rows(userId)).slice(0, maxAssets);
    const alerts = await this.alerts.assetAlerts(userId, new Date(nowMs)).catch(() => [] as AssetAlertView[]);
    const assets = await Promise.all(rows.map(async (row): Promise<WatchAssetView> => {
      const { levels, stale } = await this.levelsOf(row, nowMs);
      return {
        symbol: row.symbol, timeframe: row.timeframe, levels, status: !levels ? 'unavailable' : stale ? 'stale' : 'ok',
        alerts: alerts.filter((alert) => alert.symbol === row.symbol),
      };
    }));
    return {
      alertsAvailable: this.alerts.assetAlertsAvailable,
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
    const before = await this.rows(user.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM "tickrify"."UserWatchAsset" WHERE "userId" = ${user.id}`;
      for (const [position, symbol] of symbols.entries()) {
        await tx.$executeRaw`
          INSERT INTO "tickrify"."UserWatchAsset" ("userId", "symbol", "timeframe", "position")
          VALUES (${user.id}, ${symbol}, ${input.timeframe}, ${position})
        `;
      }
    });
    // Ativo que saiu ou mudou de tempo grafico: os niveis vigiados nao valem mais.
    const keep = before.filter((row) => symbols.includes(row.symbol) && row.timeframe === input.timeframe).map((row) => row.symbol);
    await this.alerts.cancelAssetAlerts(user.id, { keep });
    captureServer(user.clerkUserId, 'watch_assets_saved', { count: symbols.length, timeframe: input.timeframe, is_subscriber: isSubscriber });
    return this.view(user.id, isSubscriber);
  }
}
