import type { SignalStateCanonical } from '@/lib/trading-ui';

/**
 * Renderer unico dos cards de compartilhar: a leitura da analise e o resultado
 * do trade (My Trades). Preview, PNG, area de transferencia e video saem do
 * MESMO `renderShareFrame`. Mora fora do componente porque e puro (dados +
 * Canvas 2D) e e usado pelos dois botoes.
 *
 * Regras que nao se desfazem sem pensar:
 * 1. Card de leitura NUNCA mostra entrada, stop ou alvo: frase com preco ou
 *    nivel sai antes de desenhar (`hasPriceLevel`). Post com nivel le como sinal.
 * 2. Todo texto do card e em ingles, sem travessao e sem emoji (`cardText`).
 * 3. Card de trade so mostra o que o trader registrou. Nada estimado.
 * 4. Sem `ctx.filter` (o Safari nao tem). O brilho e `shadowBlur`, que NAO
 *    segue a transformacao do contexto: por isso sempre multiplicado pela escala.
 * 5. A arte de fundo (`public/share/`) ja vem no tamanho de exportacao. Nunca
 *    passar por otimizador de imagem nem desenhar menor e ampliar depois.
 */

export type ShareFormat = 'post' | 'feed' | 'story';
export type ShareTheme = 'watch' | 'bull' | 'bear';

/** Tamanho logico; a exportacao e 2x (2400x1350, 2160x2700, 2160x3840). */
export const SHARE_FORMATS: Record<ShareFormat, { w: number; h: number }> = {
  post: { w: 1200, h: 675 },
  feed: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 },
};
export const SHARE_FORMAT_ORDER: readonly ShareFormat[] = ['post', 'feed', 'story'];
export const EXPORT_SCALE = 2;
/** Video: Post 1920x1080, Feed 1080x1350, Story 1080x1920. */
export const VIDEO_SCALE: Record<ShareFormat, number> = { post: 1.6, feed: 1, story: 1 };
export const ANIMATION_MS = 1800;
export const VIDEO_MS = 4000;
const VIDEO_FPS = 30;
const VIDEO_BITS = 12_000_000;

const BASE = '#050706';
const THEMES: Record<ShareTheme, { color: string; rgb: string }> = {
  watch: { color: '#F2B63C', rgb: '242, 182, 60' },
  bull: { color: '#46D97F', rgb: '70, 217, 127' },
  bear: { color: '#F4566A', rgb: '244, 86, 106' },
};
const HEAVY = "Inter, 'Geist', system-ui, sans-serif";
const MONO = "'JetBrains Mono', 'Geist Mono', ui-monospace, monospace";

export const LOGO_SRC = '/share/tickrify_logo_3d_icone_transparente.png';
const LOGO_RATIO = 1932 / 2314;

export function backgroundSrc(theme: ShareTheme, format: ShareFormat): string {
  return `/share/${theme}_${format}.webp`;
}

export interface ShareCardModel {
  theme: ShareTheme;
  /** Data e hora em UTC, ja formatada; null omite a linha. */
  date: string | null;
  symbol: string;
  /** Ao lado do ativo: timeframe (leitura) ou LONG/SHORT (trade). */
  tag: string | null;
  hero: string;
  status: string | null;
  secondary: string | null;
  /** Leituras candidatas em ordem; desenha a primeira que cabe inteira em 2 linhas. */
  read: string[];
  stats: Array<{ label: string; value: string }>;
  footerUrl: string;
  footerLines: string[];
}

// ── Texto ───────────────────────────────────────────────────────────────────

/** Texto pronto para o card: sem travessao, sem emoji, espacos normais. */
export function cardText(value: unknown): string {
  return String(value ?? '')
    .replace(/[—–]/g, ', ')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

const PRICE_LIKE = /[$€£¥]|\d[\d,]*\.\d|\d{3,}/;
const LEVEL_WORDS = /\b(entry|entries|stop|stops|sl|tp\d?|target|targets|take[-\s]?profit)\b/i;

/** Frase com preco ou nivel de entrada/stop/alvo: nunca vai para o card de leitura. */
export function hasPriceLevel(sentence: string): boolean {
  return PRICE_LIKE.test(sentence) || (LEVEL_WORDS.test(sentence) && /\d/.test(sentence));
}

/** Frases inteiras do texto, sem as que citam preco ou nivel. Nunca corta frase. */
export function readSentences(text: string): string[] {
  const clean = cardText(text);
  const sentences = clean.match(/.+?[.!?](?=\s|$)/gs) ?? [];
  return sentences
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && !hasPriceLevel(s));
}

/**
 * Quebra em linhas de ate `maxWidth`. Nao trunca: se nao couber em `maxLines`
 * (ou uma palavra sozinha passar da linha), devolve null e quem chama tenta a
 * proxima frase. Frase cortada no meio e pior do que frase nenhuma.
 */
export function wrapExact(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (measure(word) > maxWidth) return null;
    const next = current ? `${current} ${word}` : word;
    if (measure(next) <= maxWidth) {
      current = next;
      continue;
    }
    lines.push(current);
    if (lines.length >= maxLines) return null;
    current = word;
  }
  if (current) lines.push(current);
  return lines.length <= maxLines ? lines : null;
}

export interface PickedRead {
  lines: string[];
  size: number;
}

/** Primeira frase que cabe inteira em `maxLines`, no tamanho cheio ou um pouco menor. */
export function pickRead(
  measureAt: (size: number) => (text: string) => number,
  candidates: string[],
  size: number,
  maxWidth: number,
  maxLines: number,
): PickedRead | null {
  const sizes = [size, Math.round(size * 0.9), Math.round(size * 0.82)];
  for (const candidate of candidates) {
    for (const s of sizes) {
      const lines = wrapExact(measureAt(s), candidate, maxWidth, maxLines);
      if (lines) return { lines, size: s };
    }
  }
  return null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "03 NOV 2026  14:28 UTC". Sempre UTC: quem ve o post confere a mesma hora. */
export function formatCardDate(date: Date | null): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${dd} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}  ${hh}:${mm} UTC`;
}

function formatPrice(value: number): string {
  const decimals = value < 1 ? 5 : value < 500 ? Math.min(Math.max((String(value).split('.')[1] ?? '').length, 2), 5) : 2;
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

/** Valor com sinal, na moeda da conta do trader (sem simbolo: o My Trades nao guarda moeda). */
export function formatSignedAmount(value: number): string {
  const abs = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${abs}`;
}

function formatSignedPercent(value: number): string {
  const abs = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${abs}%`;
}

// ── Card 1: leitura da analise ──────────────────────────────────────────────

export interface ReadShareData {
  symbol: string;
  timeframe: string;
  /** Cenario direcional: BULLISH | BEARISH | NEUTRAL. */
  scenario: string;
  /** Acao: BUY | SELL | HOLD/WAIT. */
  action: string;
  state: SignalStateCanonical;
  /** A leitura em prosa (resumo da analise). */
  read: string;
  /** A leitura foi escrita em ingles? Senao o card usa a frase fixa do estado. */
  readIsEnglish: boolean;
  date: Date;
}

export function publicScenario(scenario: string): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const value = String(scenario || '').trim().toUpperCase();
  return value === 'BULLISH' || value === 'BEARISH' ? value : 'NEUTRAL';
}

export function publicAction(action: string): 'BUY' | 'SELL' | 'WAIT' {
  const value = String(action || '').trim().toUpperCase();
  return value === 'BUY' || value === 'SELL' ? value : 'WAIT';
}

/** O fundo segue a decisao: so setup identificado (ENTER_NOW/ARMED com lado) ganha verde ou vermelho. */
export function readTheme(state: SignalStateCanonical, action: string): ShareTheme {
  const side = publicAction(action);
  if ((state === 'ENTER_NOW' || state === 'ARMED') && side !== 'WAIT') return side === 'BUY' ? 'bull' : 'bear';
  return 'watch';
}

const READ_STATUS: Record<SignalStateCanonical, string> = {
  ENTER_NOW: 'Setup identified',
  ARMED: 'Setup identified, entry pending',
  WATCH: 'Area marked to watch',
  NO_TRADE: 'No trade right now',
};

const READ_FALLBACK: Record<SignalStateCanonical, string> = {
  ENTER_NOW: 'The structure lines up and the plan passed the risk checks.',
  ARMED: 'The structure lines up and the plan passed the risk checks.',
  WATCH: 'Price is not at the level yet, so the AI is waiting for it.',
  NO_TRADE: 'The AI found no setup worth the risk on this chart.',
};

export function buildReadCard(data: ReadShareData): ShareCardModel {
  const theme = readTheme(data.state, data.action);
  const scenario = publicScenario(data.scenario);
  const hero =
    theme === 'bull' ? 'BULLISH' : theme === 'bear' ? 'BEARISH' : data.state === 'WATCH' ? 'WATCH' : 'NEUTRAL';
  const secondary =
    theme === 'watch' && scenario !== 'NEUTRAL' ? `Scenario: ${scenario === 'BULLISH' ? 'Bullish' : 'Bearish'}` : null;
  const sentences = data.readIsEnglish ? readSentences(data.read) : [];
  return {
    theme,
    date: formatCardDate(data.date),
    symbol: cardText(data.symbol).toUpperCase() || 'CHART',
    tag: cardText(data.timeframe) && data.timeframe !== 'UNKNOWN' ? cardText(data.timeframe) : null,
    hero,
    status: READ_STATUS[data.state] ?? READ_STATUS.NO_TRADE,
    secondary,
    read: [...sentences.slice(0, 6), READ_FALLBACK[data.state] ?? READ_FALLBACK.NO_TRADE],
    stats: [],
    footerUrl: 'tickrify.com/accuracy',
    footerLines: ['Not a signal. The final call is yours.', 'Illustrative candles'],
  };
}

/** Texto do post no X: ingles, sem numero de performance, sem prometer resultado. */
export function buildReadShareText(data: ReadShareData): string {
  const scenario = publicScenario(data.scenario);
  const side = publicAction(data.action).toLowerCase();
  const plan =
    data.state === 'ENTER_NOW' && side !== 'wait'
      ? `outlined a ${side} at market`
      : data.state === 'ARMED' && side !== 'wait'
        ? `outlined a pending ${side} order`
        : data.state === 'WATCH'
          ? 'marked an area to watch'
          : 'saw no trade';
  return [
    `${data.symbol} ${data.timeframe}: the AI read ${scenario} and ${plan}.`,
    '',
    'Not a signal, a second read before I commit. Its real hit rate is published:',
    'https://tickrify.com/accuracy?utm_source=x&utm_medium=social&utm_campaign=share_card',
  ].join('\n');
}

// ── Card 2: resultado do trade ──────────────────────────────────────────────

export type ClosedTradeVerdict = 'TP1' | 'TP2' | 'SL';

export interface TradeShareData {
  symbol: string;
  side: 'buy' | 'sell' | null;
  verdict: ClosedTradeVerdict;
  /** Valor registrado pelo trader (moeda da conta dele); null = nao registrou. */
  pnlAmount: number | null;
  /** Retorno em % registrado; null = nao registrou. */
  pnlPercent: number | null;
  /** Preco de entrada DIGITADO pelo trader ao marcar a operacao aberta. */
  entryPrice: number | null;
  closedAt: Date | null;
}

export type TradeResult = 'profit' | 'loss' | 'breakeven';

const VERDICT_STATUS: Record<ClosedTradeVerdict, string> = {
  TP1: 'Closed at target 1',
  TP2: 'Closed at target 2',
  SL: 'Closed at stop',
};
const VERDICT_HERO: Record<ClosedTradeVerdict, string> = {
  TP1: 'TARGET 1 HIT',
  TP2: 'TARGET 2 HIT',
  SL: 'STOP HIT',
};

const finite = (v: number | null): v is number => typeof v === 'number' && Number.isFinite(v);

/** Lucro, perda ou zero pelo valor registrado; sem valor, pelo resultado marcado. */
export function tradeResult(data: TradeShareData): TradeResult {
  const value = finite(data.pnlAmount) ? data.pnlAmount : finite(data.pnlPercent) ? data.pnlPercent : null;
  if (value === null) return data.verdict === 'SL' ? 'loss' : 'profit';
  return value > 0 ? 'profit' : value < 0 ? 'loss' : 'breakeven';
}

/**
 * "Hide amount" troca o valor pelo retorno (R ou %). O My Trades nao registra
 * R; vale o % quando existir. Sem valor ou sem retorno, o botao fica desligado.
 */
export function hideAmountState(data: TradeShareData): 'available' | 'no_amount' | 'no_return' {
  if (!finite(data.pnlAmount)) return 'no_amount';
  return finite(data.pnlPercent) ? 'available' : 'no_return';
}

export function buildTradeCard(data: TradeShareData, hideAmount: boolean): ShareCardModel {
  const result = tradeResult(data);
  const theme: ShareTheme = result === 'profit' ? 'bull' : result === 'loss' ? 'bear' : 'watch';
  const hide = hideAmount && hideAmountState(data) === 'available';
  const hero = finite(data.pnlAmount) && !hide
    ? formatSignedAmount(data.pnlAmount)
    : finite(data.pnlPercent)
      ? formatSignedPercent(data.pnlPercent)
      : VERDICT_HERO[data.verdict];
  const stats: ShareCardModel['stats'] = [];
  if (finite(data.entryPrice) && data.entryPrice > 0) stats.push({ label: 'Entry', value: formatPrice(data.entryPrice) });
  return {
    theme,
    date: formatCardDate(data.closedAt),
    symbol: cardText(data.symbol).toUpperCase() || 'TRADE',
    tag: data.side === 'buy' ? 'LONG' : data.side === 'sell' ? 'SHORT' : null,
    hero,
    status: VERDICT_STATUS[data.verdict],
    secondary: null,
    read: [],
    stats,
    footerUrl: 'tickrify.com',
    footerLines: ['Past results do not guarantee future results.', 'Illustrative candles'],
  };
}

/** Texto do post do trade: sem o valor e sem dizer que o Tickrify gerou o resultado. */
export function buildTradeShareText(data: TradeShareData): string {
  const side = data.side === 'buy' ? 'long' : data.side === 'sell' ? 'short' : 'trade';
  return [
    `${data.symbol} ${side} closed. Logged in my Tickrify trades.`,
    '',
    'https://tickrify.com?utm_source=x&utm_medium=social&utm_campaign=share_trade',
  ].join('\n');
}

// ── Assets e fontes ─────────────────────────────────────────────────────────

export interface ShareAssets {
  background: HTMLImageElement;
  logo: HTMLImageElement;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`share asset failed: ${src}`));
    img.src = src;
  });
  promise.catch(() => imageCache.delete(src));
  imageCache.set(src, promise);
  return promise;
}

export async function loadShareAssets(theme: ShareTheme, format: ShareFormat): Promise<ShareAssets> {
  const [background, logo] = await Promise.all([loadImage(backgroundSrc(theme, format)), loadImage(LOGO_SRC)]);
  return { background, logo };
}

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap';
let fontsPromise: Promise<void> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}

/**
 * Inter pesada so carrega quando o card abre (a pagina nao precisa dela).
 * Sem esperar a fonte, o Canvas desenha com a de reserva e o card sai com outra
 * tipografia sem erro nenhum.
 */
export function ensureShareFonts(): Promise<void> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    if (typeof document === 'undefined' || !document.fonts) return;
    if (!document.getElementById('tk-share-fonts')) {
      const link = document.createElement('link');
      link.id = 'tk-share-fonts';
      link.rel = 'stylesheet';
      link.href = FONTS_HREF;
      const loaded = new Promise<void>((resolve) => {
        link.onload = () => resolve();
        link.onerror = () => resolve();
      });
      document.head.appendChild(link);
      await withTimeout(loaded, 4000);
    }
    await withTimeout(
      Promise.all(
        ['500 40px Inter', '700 40px Inter', '800 40px Inter', '900 40px Inter', '400 20px "JetBrains Mono"', '500 20px "JetBrains Mono"'].map(
          (font) => document.fonts.load(font).catch(() => []),
        ),
      ),
      4000,
    );
  })();
  return fontsPromise;
}

// ── Desenho ─────────────────────────────────────────────────────────────────

interface Layout {
  pad: number;
  textW: number;
  dateY: number;
  dateSize: number;
  symbolGap: number;
  symbolSize: number;
  tagSize: number;
  heroGap: number;
  heroSize: number;
  statusGap: number;
  statusSize: number;
  secondaryGap: number;
  secondarySize: number;
  readGap: number;
  readSize: number;
  readLh: number;
  statsGap: number;
  statLabelSize: number;
  statValueSize: number;
  statColW: number;
  footerBottom: number;
  logoH: number;
  wordSize: number;
  urlSize: number;
  lineSize: number;
}

// Story: nada importante nos 250 de cima nem nos 250 de baixo (interface do app).
const LAYOUTS: Record<ShareFormat, Layout> = {
  post: {
    pad: 72, textW: 600, dateY: 96, dateSize: 19,
    symbolGap: 82, symbolSize: 60, tagSize: 22,
    heroGap: 26, heroSize: 132,
    statusGap: 52, statusSize: 28, secondaryGap: 34, secondarySize: 21,
    readGap: 44, readSize: 24, readLh: 34,
    statsGap: 52, statLabelSize: 16, statValueSize: 32, statColW: 200,
    footerBottom: 623, logoH: 50, wordSize: 28, urlSize: 21, lineSize: 18,
  },
  feed: {
    pad: 80, textW: 920, dateY: 716, dateSize: 24,
    symbolGap: 86, symbolSize: 72, tagSize: 28,
    heroGap: 30, heroSize: 168,
    statusGap: 58, statusSize: 32, secondaryGap: 40, secondarySize: 25,
    readGap: 52, readSize: 30, readLh: 42,
    statsGap: 64, statLabelSize: 19, statValueSize: 40, statColW: 250,
    footerBottom: 1286, logoH: 60, wordSize: 32, urlSize: 25, lineSize: 20,
  },
  story: {
    pad: 88, textW: 904, dateY: 960, dateSize: 28,
    symbolGap: 92, symbolSize: 84, tagSize: 32,
    heroGap: 34, heroSize: 190,
    statusGap: 64, statusSize: 36, secondaryGap: 44, secondarySize: 28,
    readGap: 60, readSize: 34, readLh: 48,
    statsGap: 72, statLabelSize: 21, statValueSize: 46, statColW: 270,
    footerBottom: 1640, logoH: 72, wordSize: 38, urlSize: 28, lineSize: 22,
  },
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (v: number) => 1 - Math.pow(1 - clamp01(v), 3);
const phase = (t: number, start: number, end: number) => easeOut((t - start) / (end - start));

function drawTracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number): void {
  let cursor = x;
  for (const char of text) {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + spacing;
  }
}

function measureTracked(ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
  let total = 0;
  for (const char of text) total += ctx.measureText(char).width + spacing;
  return Math.max(0, total - spacing);
}

/** Maior tamanho (ate `max`) em que o texto cabe em `width`. */
function fitSize(ctx: CanvasRenderingContext2D, text: string, font: (size: number) => string, max: number, min: number, width: number): number {
  ctx.font = font(max);
  const measured = ctx.measureText(text).width;
  if (measured <= width) return max;
  return Math.max(min, Math.floor((max * width) / measured));
}

/**
 * Desenha um quadro do card em `t` ms da animacao (>= ANIMATION_MS = quadro
 * final). O contexto e ajustado para a escala pedida: o canvas tem que ter
 * `SHARE_FORMATS[format] * scale` pixels.
 */
export function renderShareFrame(
  ctx: CanvasRenderingContext2D,
  model: ShareCardModel,
  format: ShareFormat,
  assets: ShareAssets,
  t: number,
  scale: number,
): void {
  const { w: W, h: H } = SHARE_FORMATS[format];
  const L = LAYOUTS[format];
  const theme = THEMES[model.theme];
  const done = t >= ANIMATION_MS;

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // 1. Base.
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, W, H);

  // 2. Fundo 3D: entra da esquerda para a direita com leve aproximacao.
  const wipe = done ? 1 : phase(t, 0, 700);
  const push = done ? 0 : 1 - phase(t, 0, 1100);
  if (wipe > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W * wipe, H);
    ctx.clip();
    const zoom = 1 + 0.06 * push;
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.drawImage(assets.background, -W / 2, -H / 2, W, H);
    ctx.restore();
  }

  // 3. Brilho na cor do estado, alto a direita.
  ctx.globalAlpha = wipe;
  const glowR = Math.max(W, H) * 0.6;
  const glow = ctx.createRadialGradient(W * 0.84, H * 0.08, 0, W * 0.84, H * 0.08, glowR);
  glow.addColorStop(0, `rgba(${theme.rgb}, 0.26)`);
  glow.addColorStop(0.45, `rgba(${theme.rgb}, 0.07)`);
  glow.addColorStop(1, `rgba(${theme.rgb}, 0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  // 4. Escurecimento para leitura.
  if (format === 'post') {
    const side = ctx.createLinearGradient(0, 0, W, 0);
    side.addColorStop(0, 'rgba(5, 7, 6, 0.95)');
    side.addColorStop(0.36, 'rgba(5, 7, 6, 0.86)');
    side.addColorStop(0.62, 'rgba(5, 7, 6, 0.22)');
    side.addColorStop(0.8, 'rgba(5, 7, 6, 0)');
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, W, H);
    const foot = ctx.createLinearGradient(0, H * 0.74, 0, H);
    foot.addColorStop(0, 'rgba(5, 7, 6, 0)');
    foot.addColorStop(1, 'rgba(5, 7, 6, 0.78)');
    ctx.fillStyle = foot;
    ctx.fillRect(0, H * 0.74, W, H * 0.26);
  } else {
    const [from, to] = [0.36, 0.56];
    const down = ctx.createLinearGradient(0, 0, 0, H);
    down.addColorStop(0, 'rgba(5, 7, 6, 0)');
    down.addColorStop(from, 'rgba(5, 7, 6, 0)');
    down.addColorStop(to, 'rgba(5, 7, 6, 0.9)');
    down.addColorStop(1, 'rgba(5, 7, 6, 0.97)');
    ctx.fillStyle = down;
    ctx.fillRect(0, 0, W, H);
  }

  // 5. Texto e logo.
  const x = L.pad;
  const rest = done ? 1 : phase(t, 1150, 1550);
  const restLift = (1 - rest) * 12;

  if (model.date) {
    const p = done ? 1 : phase(t, 250, 650);
    ctx.globalAlpha = p;
    ctx.font = `500 ${L.dateSize}px ${MONO}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.62)';
    drawTracked(ctx, model.date, x, L.dateY + (1 - p) * 8, L.dateSize * 0.12);
  }

  // Ativo, letra por letra, com a tag ao lado.
  const symbolY = L.dateY + L.symbolGap;
  const tagGap = L.tagSize * 0.7;
  let tagW = 0;
  if (model.tag) {
    ctx.font = `500 ${L.tagSize}px ${MONO}`;
    tagW = measureTracked(ctx, model.tag, L.tagSize * 0.08) + tagGap;
  }
  const symbolFont = (s: number) => `800 ${s}px ${HEAVY}`;
  const symbolSize = fitSize(ctx, model.symbol, symbolFont, L.symbolSize, Math.round(L.symbolSize * 0.45), L.textW - tagW);
  ctx.font = symbolFont(symbolSize);
  ctx.fillStyle = '#ffffff';
  const chars = Array.from(model.symbol);
  const stagger = Math.min(55, 500 / Math.max(1, chars.length));
  let cursor = x;
  chars.forEach((char, i) => {
    const p = done ? 1 : phase(t, 450 + i * stagger, 450 + i * stagger + 200);
    ctx.globalAlpha = p;
    ctx.fillText(char, cursor, symbolY + (1 - p) * 10);
    cursor += ctx.measureText(char).width;
  });
  if (model.tag) {
    ctx.globalAlpha = done ? 1 : phase(t, 900, 1150);
    ctx.font = `500 ${L.tagSize}px ${MONO}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    drawTracked(ctx, model.tag, cursor + tagGap, symbolY, L.tagSize * 0.08);
  }

  // Palavra ou valor grande, na cor do estado, com brilho.
  const heroFont = (s: number) => `900 ${s}px ${HEAVY}`;
  const heroSize = fitSize(ctx, model.hero, heroFont, L.heroSize, Math.round(L.heroSize * 0.4), L.textW);
  const heroY = symbolY + L.heroGap + heroSize * 0.74;
  const heroP = done ? 1 : phase(t, 800, 1300);
  ctx.globalAlpha = heroP;
  ctx.font = heroFont(heroSize);
  ctx.fillStyle = theme.color;
  ctx.shadowColor = `rgba(${theme.rgb}, 0.55)`;
  ctx.shadowBlur = heroSize * 0.32 * scale;
  ctx.fillText(model.hero, x, heroY + (1 - heroP) * 28);
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';

  let y = heroY;
  ctx.globalAlpha = rest;
  if (model.status) {
    y += L.statusGap;
    ctx.font = `700 ${L.statusSize}px ${HEAVY}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.fillText(model.status, x, y + restLift);
  }
  if (model.secondary) {
    y += L.secondaryGap;
    ctx.font = `500 ${L.secondarySize}px ${HEAVY}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(model.secondary, x, y + restLift);
  }

  // Topo do rodape (logo ou bloco da direita, o mais alto): a leitura nunca passa dele.
  const footerTop =
    L.footerBottom -
    Math.max(L.logoH, model.footerLines.length * L.lineSize * 1.6 + L.urlSize * 1.4) -
    L.readSize;
  const readLines = Math.min(2, Math.floor((footerTop - (y + L.readGap)) / L.readLh) + 1);
  if (model.read.length && readLines > 0) {
    const readFont = (s: number) => `500 ${s}px ${HEAVY}`;
    const readW = format === 'post' ? L.textW - 40 : L.textW;
    const picked = pickRead(
      (s) => {
        ctx.font = readFont(s);
        return (text) => ctx.measureText(text).width;
      },
      model.read,
      L.readSize,
      readW,
      readLines,
    );
    if (picked) {
      y += L.readGap;
      ctx.font = readFont(picked.size);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
      const lh = L.readLh * (picked.size / L.readSize);
      picked.lines.forEach((line, i) => ctx.fillText(line, x, y + i * lh + restLift));
      y += (picked.lines.length - 1) * lh;
    }
  }

  if (model.stats.length) {
    y += L.statsGap;
    model.stats.slice(0, 4).forEach((stat, i) => {
      const cx = x + i * L.statColW;
      ctx.font = `500 ${L.statLabelSize}px ${MONO}`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      drawTracked(ctx, stat.label.toUpperCase(), cx, y + restLift, L.statLabelSize * 0.14);
      const valueSize = fitSize(ctx, stat.value, (s) => `800 ${s}px ${HEAVY}`, L.statValueSize, Math.round(L.statValueSize * 0.5), L.statColW - 20);
      ctx.font = `800 ${valueSize}px ${HEAVY}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(stat.value, cx, y + L.statValueSize * 1.25 + restLift);
    });
  }

  // Rodape: logo e marca a esquerda, endereco e avisos a direita.
  const logoP = done ? 1 : phase(t, 1450, 1800);
  const logoH = L.logoH * (0.9 + 0.1 * logoP);
  const logoW = logoH * LOGO_RATIO;
  ctx.globalAlpha = logoP;
  ctx.drawImage(assets.logo, x, L.footerBottom - logoH, logoW, logoH);
  ctx.font = `800 ${L.wordSize}px ${HEAVY}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Tickrify', x + L.logoH * LOGO_RATIO + L.wordSize * 0.45, L.footerBottom - L.logoH * 0.3);

  ctx.globalAlpha = rest;
  ctx.textAlign = 'right';
  const right = W - L.pad;
  let fy = L.footerBottom;
  ctx.font = `400 ${L.lineSize}px ${MONO}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  for (const line of [...model.footerLines].reverse()) {
    ctx.fillText(line, right, fy);
    fy -= L.lineSize * 1.6;
  }
  ctx.font = `500 ${L.urlSize}px ${MONO}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.fillText(model.footerUrl, right, fy - L.urlSize * 0.35);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}

/** Quadro final no tamanho de exportacao (2x), em PNG. */
export async function renderSharePng(model: ShareCardModel, format: ShareFormat): Promise<Blob> {
  const [assets] = await Promise.all([loadShareAssets(model.theme, format), ensureShareFonts()]);
  const { w, h } = SHARE_FORMATS[format];
  const canvas = document.createElement('canvas');
  canvas.width = w * EXPORT_SCALE;
  canvas.height = h * EXPORT_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  renderShareFrame(ctx, model, format, assets, ANIMATION_MS, EXPORT_SCALE);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))), 'image/png');
  });
}

// ── Video ───────────────────────────────────────────────────────────────────

const VIDEO_TYPES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** Formato de video que o navegador grava do canvas; null esconde o botao. */
export function videoMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  if (typeof HTMLCanvasElement === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
  return VIDEO_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/**
 * Grava a animacao (~4 s a 30 fps, 12 Mbps). Redesenha todo quadro, mesmo
 * parado no final: o `captureStream` so emite quadro quando o canvas muda.
 * O canvas fica no documento (fora da tela) porque o Safari nao captura um
 * canvas solto. Tudo e liberado no fim ou no `abort`.
 */
export async function recordShareVideo(
  model: ShareCardModel,
  format: ShareFormat,
  signal: AbortSignal,
): Promise<{ blob: Blob; extension: 'mp4' | 'webm' }> {
  const mimeType = videoMimeType();
  if (!mimeType) throw new Error('video recording unsupported');
  const [assets] = await Promise.all([loadShareAssets(model.theme, format), ensureShareFonts()]);
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');

  const scale = VIDEO_SCALE[format];
  const { w, h } = SHARE_FORMATS[format];
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:-100000px;top:0;width:1px;height:1px;pointer-events:none;opacity:0;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    throw new Error('canvas 2d context unavailable');
  }
  renderShareFrame(ctx, model, format, assets, 0, scale);

  const stream = canvas.captureStream(VIDEO_FPS);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BITS });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  return new Promise((resolve, reject) => {
    let raf = 0;
    const cleanup = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((track) => track.stop());
      signal.removeEventListener('abort', onAbort);
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    };
    const onAbort = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };
    recorder.onstop = () => {
      cleanup();
      if (signal.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      const type = recorder.mimeType || mimeType;
      resolve({ blob: new Blob(chunks, { type: type.split(';')[0] }), extension: type.includes('mp4') ? 'mp4' : 'webm' });
    };
    recorder.onerror = () => {
      cleanup();
      reject(new Error('video recording failed'));
    };
    signal.addEventListener('abort', onAbort);

    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const elapsed = now - start;
      renderShareFrame(ctx, model, format, assets, elapsed, scale);
      if (elapsed >= VIDEO_MS) {
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    recorder.start(250);
    raf = requestAnimationFrame(tick);
  });
}
