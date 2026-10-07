export type Platform = 'tradingview' | 'other';
export type PageMeta = { symbol?: string; timeframe?: string };

// Mesmas regras do DTO do backend (create-analysis.dto.ts): o que nao passar
// aqui nao e mandado, para a analise nunca ser recusada por causa disso.
const SYMBOL_RE = /^[A-Za-z0-9:._/!-]{2,32}$/;
const TIMEFRAME_RE = /^[A-Za-z0-9]{1,8}$/;

export function detectPlatform(url: string): Platform {
  try {
    const u = new URL(url);
    const tv = u.hostname === 'tradingview.com' || u.hostname.endsWith('.tradingview.com');
    return tv && u.pathname.startsWith('/chart') ? 'tradingview' : 'other';
  } catch {
    return 'other';
  }
}

/** "15" -> 15m, "240" -> 4h, "D" -> 1D: o seletor do TradingView mostra os dois formatos. */
function normalizeTimeframe(raw: string | undefined): string | undefined {
  const text = (raw ?? '').trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) {
    const minutes = Number(text);
    if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
    return `${minutes}m`;
  }
  const short = text.match(/^(\d+)\s*(m|h|D|W|M)$/);
  if (short) return `${short[1]}${short[2]}`;
  if (/^[DWM]$/.test(text)) return `1${text}`;
  return undefined;
}

/** Primeira "palavra" do titulo que parece um par: BTCUSDT, EURJPY, XAUUSD, NAS100. */
function symbolFromTitle(title: string): string | undefined {
  for (const part of title.split(/[\s|]+/)) {
    if (/^[A-Z][A-Z0-9]{4,15}$/.test(part) && /[A-Z]{3}/.test(part)) return part;
  }
  return undefined;
}

const QUOTES = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD', 'BRL', 'BTC', 'ETH'];

/** Par escrito com separador: "BTC USDT", "EUR/USD" no titulo; "BTC_USDT", "ETH/USDT", "sol-usdt" na URL. */
function pairFrom(text: string, caseSensitive: boolean): string | undefined {
  const re = caseSensitive ? /\b([A-Z]{2,6})[ /_-]([A-Z]{3,5})\b/g : /(?:^|\/)([a-z]{2,6})[/_-]([a-z]{3,5})(?=$|\/)/gi;
  for (const m of text.matchAll(re)) {
    const quote = m[2]!.toUpperCase();
    if (QUOTES.includes(quote)) return `${m[1]!.toUpperCase()}${quote}`;
  }
  return undefined;
}

function pathOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return '';
  }
}

/**
 * Simbolo e tempo grafico lidos da pagina, sem ler preco nem nada da conta.
 * TradingView: `?symbol=` da URL e o seletor de tempo do cabecalho; outros
 * sites: titulo da aba e endereco (par como BTC_USDT). O trader confirma ou corrige.
 */
export function readPageMeta(input: { url: string; title: string; timeframeText?: string }): PageMeta {
  const meta: PageMeta = {};
  let symbol: string | undefined;
  if (detectPlatform(input.url) === 'tradingview') {
    try {
      symbol = new URL(input.url).searchParams.get('symbol') ?? undefined;
    } catch {
      symbol = undefined;
    }
  }
  symbol = symbol || symbolFromTitle(input.title) || pairFrom(input.title, true) || pairFrom(pathOf(input.url), false);
  if (symbol && SYMBOL_RE.test(symbol)) meta.symbol = symbol;
  const timeframe = normalizeTimeframe(input.timeframeText);
  if (timeframe && TIMEFRAME_RE.test(timeframe)) meta.timeframe = timeframe;
  return meta;
}
