import { messageText, translatedAnnotation } from '@/lib/i18n/messages';
import { LOCALES, formatNumber, type Language } from '@/lib/i18n';
import { definirAnaliseAtual } from '@/lib/breadcrumbs';
import { useState, useEffect } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Eye,
  Lightbulb,
  Minus,
  ShieldAlert,
  SlidersVertical,
  Target,
  Zap,
} from 'lucide-react';
import { useEconomicCalendar } from '@/hooks/useEconomicCalendar';
import { useMarketContext } from '@/hooks/useMarketContext';
import { PositionSizingCalculator } from './PositionSizingCalculator';
import { AnalysisEvidencePanel } from './AnalysisEvidencePanel';
import { MarketResultCard } from './MarketResult';
import { MarketPlanCard, WatchPlanCard, isWatchLevels, isWatchPlan, watchWindowOpen } from './WatchPlanCard';
import { WatchEntryLog } from './WatchEntryLog';
import { ReadModePanel, WherePriceIs, type ReadModeData } from './ReadModePanel';
import { LevelMapCard, WatchVerdict } from './PendingLevels';
import { AnalysisShareButton } from './ShareCard';
import type { ReadShareData } from '@/lib/share-card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import type { AIAnalysisResponse, WatchEntry, WatchLevels } from '@/lib/api';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  calcStopPercent,
  calcTPPercent,
  getRecommendationMeta,
  getScenarioMeta,
  normalizeConfluenceScore,
  resolveSignalState,
  signalStateTone,
  entrySide,
  forexPipSize,
  formatAssetPrice,
  signalStateLabel,
} from '@/lib/trading-ui';
import { asRecord } from '@/lib/utils';
import { computeDirectionalRiskReward } from '@/lib/trade-plan';
import { useExpiryClock, watchTone, WATCH_TONE_CLASSES } from '@/lib/setups';

interface AnalysisResultProps {
  analysisData: AIAnalysisResponse | null;
  uploadedImage: string | null;
  /**
   * Analise de exemplo fixa (SampleAnalyses): mesma tela, sem nada "de agora".
   * Calendario e contexto ao vivo seriam de hoje, nao do dia do grafico; o
   * card de compartilhar e o relato de problema sao de analise da pessoa.
   */
  sample?: boolean;
  /** Conta pode criar alerta de nivel (painel real, conta nao travada). */
  alertsEnabled?: boolean;
  /** Raiz do painel (`/dashboard` ou `/demo`) para o link do setup. */
  base?: string;
}

type MarketSession = { name: string; abbr: string; open: boolean };

function getOpenSessions(date: Date): MarketSession[] {
  const h = date.getUTCHours() + date.getUTCMinutes() / 60;
  const inRange = (start: number, end: number) =>
    start < end ? h >= start && h < end : h >= start || h < end;
  return [
    { name: 'Sydney',    abbr: 'SYD', open: inRange(22, 7)  },
    { name: 'Tóquio',    abbr: 'TKY', open: inRange(0,  9)  },
    { name: 'Londres',   abbr: 'LDN', open: inRange(7, 16)  },
    { name: 'Nova York', abbr: 'NY',  open: inRange(13, 22) },
  ];
}

function toNumber(value: unknown): number | null {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Fallbacks em PT que o backend persiste quando a IA não preenche um campo.
 * Para usuários em outros idiomas esses textos vazavam em português; aqui eles
 * viram "ausente" ('') para que cada seção use seu próprio fallback i18n
 * (notInformed / noAnalysis / noSummary / noPatterns) ou se oculte.
 * Cobre análises antigas já persistidas — não exige reprocessar nada.
 */
const BACKEND_PT_FALLBACKS = new Set([
  'Não informado',
  'Contexto de sessão não informado.',
  'Análise técnica indisponível.',
  'Indicadores não informados.',
  'Padrões não informados.',
  'Padrões identificados não informados.',
  'Validação estrutural não informada.',
  'Fatores de risco não informados.',
  'Sem justificativa para o lado oposto.',
  'Resumo executivo indisponível.',
  'Sem justificativa gerada.',
  'Analise gerada sem justificativa detalhada.',
]);

/**
 * Travessão fora do texto que o modelo escreve.
 *
 * O motor devolve "HTF bias — estrutura visível" e "3/3 aligned — strong
 * setup". O travessão é a assinatura mais reconhecível de texto gerado por IA,
 * e o produto inteiro já foi limpo dele: sem isto aqui, cada análise nova
 * reintroduz o que o site levou um dia para tirar.
 *
 * SÓ o travessão cercado de espaço vira vírgula. Hífen de intervalo de preço
 * (4230.20-4286.85) e de palavra composta (volume-confirmed) fica intocado —
 * confundir os dois foi exatamente o que quebrou a lista de riscos.
 */
export function softenDashes(text: string): string {
  return text.replace(/\s+[—–]\s+/g, ', ').replace(/\s*—\s*/g, ', ');
}

/**
 * Emoji fora do texto do modelo.
 *
 * O motor decora a saída: "🎯 Bullish OB/FVG confluence", "💧 Unswept
 * liquidity", "🕯️ Upper-wick rejection". Numa mesa de operação isso é ruído —
 * emoji renderiza diferente em cada sistema e denuncia texto gerado. O mesmo
 * argumento do travessão.
 *
 * Os marcadores do checklist (✅ ❌) NÃO passam por aqui: quem os consome é o
 * `parseStructureChecklist`, que roda ANTES e os converte em ✓/✕ na cor do
 * sistema. Ver a ordem em que os dois são chamados no componente.
 */
export function stripEmoji(text: string): string {
  // Em `replace` separados de propósito: juntar tudo num conjunto de caracteres
  // com o seletor de variação dentro dispara o no-misleading-character-class do
  // ESLint, e a regra tem razão — o conjunto passaria a casar meio grafema.
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\uFE0F\u200D]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+/gm, '')
    .trim();
}

/**
 * Funil ÚNICO de todo texto vindo do modelo antes de virar tela.
 *
 * Faz duas coisas: descarta os textos de fallback em português que o backend
 * ainda emite (ver BACKEND_PT_FALLBACKS) e tira o travessão. Todo campo de
 * prosa da análise passa por aqui — se um dia precisar de mais uma limpeza,
 * ela entra NESTA função, não espalhada por 15 chamadas.
 */
export function cleanModelText(value: unknown): string {
  const text = String(value || '').trim();
  if (BACKEND_PT_FALLBACKS.has(text)) {
    return '';
  }
  return stripEmoji(softenDashes(text));
}

/**
 * Parser da leitura em camadas do deep. O modelo escreve o executiveSummary
 * com blocos "Rótulo: texto" (um por linha, rótulo no idioma de saída).
 * Detecta esses blocos para renderizar cards estruturados; linhas sem rótulo
 * (ex.: o aviso final "a direção é uma hipótese") viram rodapé.
 * Se houver menos de 2 blocos, a UI cai no texto corrido de sempre —
 * análises quick e antigas continuam idênticas (zero risco de regressão).
 */
interface SummaryBlock {
  label: string;
  text: string;
}

/**
 * Rótulos canônicos que o modelo emite em inglês (contrato fixo do deep).
 * A interface traduz via i18n; rótulos desconhecidos (análises antigas) passam como vieram.
 */
const CANONICAL_DEEP_LABELS: Record<string, string> = {
  'READING': 'deepReading',
  'VOLATILITY': 'deepVolatility',
  'SCENARIOS': 'deepScenarios',
  'MULTI-TIMEFRAME': 'deepMtf',
  'MARKET PHASE': 'deepPhase',
  'VOLUME': 'deepVolume',
  'REVERSAL RISK': 'deepReversalRisk',
};

function localizeDeepLabel(label: string, dict: Record<string, string>): string {
  const key = CANONICAL_DEEP_LABELS[label.trim().toUpperCase()];
  return key && dict[key] ? dict[key] : label;
}

function parseSummaryBlocks(summary: string): { blocks: SummaryBlock[]; footer: string[] } {
  const blocks: SummaryBlock[] = [];
  const footer: string[] = [];
  for (const raw of String(summary || '').split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    // "Rótulo: texto" — rótulo curto (2-42 chars), opcionalmente numerado "1) "
    const m = line.match(/^(?:\d+\)\s*)?([^:：]{2,42})[:：]\s+(.+)$/);
    if (m && m[2]) {
      blocks.push({ label: m[1].trim(), text: m[2].trim() });
    } else {
      footer.push(line);
    }
  }
  return { blocks, footer };
}

function formatSignedPercentInLanguage(value: number | null, language: Language): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  const signal = value >= 0 ? '+' : '';
  return `${signal}${formatNumber(value, language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function formatPositivePercentInLanguage(value: number | null, language: Language): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `+${formatNumber(Math.abs(value), language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/**
 * Gatilho do plano condicional de um WAIT, lido do TEXTO do motor.
 *
 * No WAIT o motor deixa entry/stop/alvos em null e escreve o gatilho em prosa
 * ("If price closes above $X... becomes BUY"). Devolve `null` quando o texto
 * nao traz preco nenhum: sem nivel, nao ha plano para mostrar. O lado so e
 * dado quando o texto aponta UM lado; os dois ou nenhum = `neutral`. Nada e
 * extraido nem calculado: o que a tela mostra continua sendo o texto inteiro.
 */
export function classifyWaitTrigger(text: string | null): 'buy' | 'sell' | 'neutral' | null {
  if (!text || !/\d[\d.,]*\d/.test(text)) return null;
  // BUY/SELL/LONG/SHORT so em maiuscula: "long wick" e "short-term" sao prosa.
  const buy = /\b(BUY|LONG)\b/.test(text) || /\b(compra|achat|kauf)\b/i.test(text) || text.includes('買い');
  const sell = /\b(SELL|SHORT)\b/.test(text) || /\b(venda|venta|vente|verkauf)\b/i.test(text) || text.includes('売り');
  return buy === sell ? 'neutral' : buy ? 'buy' : 'sell';
}

/**
 * Quebra um campo do modelo em itens de lista.
 *
 * NÃO quebra em vírgula nem em ponto-e-vírgula, que era o que a versão
 * anterior fazia (`/[\n;,]/`). O modelo escreve prosa, não CSV: "Bullish
 * OB/FVG confluence at 4240.50-4255.95, preferred long limit zone" virava dois
 * itens, um deles começando com letra minúscula no meio da frase. Conferido na
 * tela em 25/08/2026.
 *
 * Quebra no marcador que o modelo de fato usa: emoji no início do item (ele
 * decora cada padrão com um), quebra de linha, bullet ou numeração. O emoji é
 * usado como fronteira e depois descartado pelo `cleanModelText`.
 */
export function splitItems(text: unknown): string[] {
  const raw = String(text || '').trim();
  if (!raw) {
    return [];
  }

  const porEmoji = raw.split(/\s*(?=\p{Extended_Pictographic}\uFE0F?\s)/u);
  const partes = porEmoji.length > 1 ? porEmoji : raw.split(/\r?\n+/);

  return partes
    .flatMap((parte) => parte.split(/(?=(?:^|\s)\d{1,2}\s*[).\]]\s+)/g))
    .map((parte) =>
      parte
        .replace(/^\s*[•*▪]\s*/, '')
        .replace(/^\s*\d{1,2}\s*[).\]]\s*/, '')
        .replace(/^\s*[-–—]\s+/, '')
        .trim(),
    )
    .filter((parte) => parte.length > 0);
}

/**
 * Fatores de risco do modelo, virando lista.
 *
 * O QUE ESTAVA ERRADO (achado em produção, 25/08/2026)
 * A versão anterior quebrava o texto em `/[\n•-]+/`. O hífen ali dentro NÃO é
 * marcador de lista: ele parte qualquer palavra composta. "Late-stage trend"
 * virava "Late" + "stage trend"; "volume-confirmed" virava "volume" +
 * "confirmed". E o filtro seguinte, que descartava pedaço curto ou iniciado em
 * minúscula, APAGAVA a metade órfã. Na tela: um fator de risco começando no
 * meio da palavra e outro terminando no meio da frase.
 *
 * Pior: `riskFactors` chega como ARRAY, e o chamador passava tudo por
 * `String()` antes, o que junta os itens com vírgula. Os quatro riscos viravam
 * um parágrafo só e depois eram recortados em lugar errado.
 *
 * REGRAS AGORA
 * 1. Array é respeitado: cada elemento é um item.
 * 2. Quebra só onde há marcador de verdade: quebra de linha, bullet no início,
 *    ou numeração "1)" / "2." / "3]".
 * 3. NUNCA descarta texto. Fragmento que começa em minúscula é continuação e
 *    volta colado no item anterior. Perder metade de um aviso de risco é pior
 *    do que mostrar um item mal formatado.
 */
export function normalizeRiskFactorsForView(value: unknown): string[] {
  const chunks = Array.isArray(value)
    ? value.map((item) => String(item ?? ''))
    : [String(value ?? '')];

  const items: string[] = [];

  for (const chunk of chunks) {
    for (const line of chunk.split(/\r?\n+/)) {
      // "1) ... 2) ..." na mesma linha: quebra ANTES do número, sem comê-lo.
      for (const part of line.split(/(?=(?:^|\s)\d{1,2}\s*[).\]]\s+)/g)) {
        const text = part
          .replace(/^\s*[•*▪]\s*/, '')
          .replace(/^\s*\d{1,2}\s*[).\]]\s*/, '')
          .replace(/^\s*[-–—]\s+/, '')
          .trim();

        if (!text) {
          continue;
        }

        if (items.length > 0 && /^[a-záéíóúãõàâêôç]/.test(text)) {
          items[items.length - 1] = `${items[items.length - 1]} ${text}`;
        } else {
          items.push(text);
        }
      }
    }
  }

  return items;
}

interface ChecklistItem {
  ok: boolean;
  warning?: boolean;
  notApplicable?: boolean;
  label: string;
  detail: string;
}

interface StructureChecklist {
  items: ChecklistItem[];
  score: string | null;
  scoreMismatch: boolean;
}

/**
 * O checklist de critérios, que o modelo devolve como UM parágrafo:
 *
 *   "✅ HTF bias, estrutura visível. ✅ Premium/Discount zone, entrada abaixo
 *    do meio. ❌ MTF inferido de um gráfico só. → 6/7 → BUY limit setup."
 *
 * Isto já É uma lista: sete critérios, cada um aprovado ou não, e um placar no
 * fim. Entregar como prosa com emoji joga no leitor o trabalho de separar o que
 * passou do que não passou — e num painel onde todo o resto é dado alinhado,
 * era o único bloco que parecia saída de chat.
 *
 * Virando estrutura, o passa/não-passa vai para a COR (verde/vermelho), que é a
 * mesma regra do resto do produto: cor é dado, nunca decoração.
 *
 * Se o formato do modelo mudar e a leitura render menos de dois critérios, o
 * chamador volta a mostrar o parágrafo cru. Parser nunca some com texto.
 */
// Checklist do motor v10 (26/10/2026): "C1 PASS ...; C2 Location: FAIL ...;
// ... 5/7 ARMED", sem emoji. Um rotulo curto pode vir entre o codigo e o veredito.
/**
 * Tira o estado ou a direcao que o modelo escreveu no checklist, em qualquer
 * criterio, com ou sem placar: "→ SELL", "→ 5/7 → BUY limit setup",
 * "6/7 WATCH", "4/7 passes → HOLD-WATCH" e uma palavra de estado solta no fim
 * (". WATCH"). O placar n/7 fica. A palavra solta so conta em maiusculas,
 * para nao cortar texto comum ("buyers", "sell-side").
 */
const MODEL_STATE = '(?:NO[_ ]TRADE|WATCH|ARMED|ENTER[_ ]NOW|WAIT|HOLD(?:-WATCH)?|BUY|SELL)';
const ARROW_STATE = new RegExp(`\\s*(?:→|->)\\s*${MODEL_STATE}(?![\\w-])[^|;\\n]*`, 'giu');
const SCORE_STATE = new RegExp(`(\\b[0-7]\\s*/\\s*7\\b(?:\\s*passes)?)\\s*[,:-]?\\s*${MODEL_STATE}(?![\\w-])[^|;\\n]*`, 'giu');
const BARE_STATE = new RegExp(`([.,;])\\s*${MODEL_STATE}(?![\\w-])\\.?\\s*$`, 'u');

/** Frases em que o modelo manda operar (6 idiomas). So para a tela, quando o codigo decidiu NO_TRADE. */
const MODEL_ACTION = new RegExp(
  [
    String.raw`\b(?:buy|sell)(?:ing)?\s+(?:at|on|from|near|limit|stop|if|when|after|above|below|the)\b`,
    String.raw`\b(?:enter|entering|entry)\s+(?:a\s+)?(?:long|short|at|on|near|from|if|when|after|above|below|only|the\s+trade)\b`,
    String.raw`\bgo(?:ing)?\s+(?:long|short)\b`,
    String.raw`\b(?:long|short)\s+(?:entry|setup|position|trade|from|at|near|if)\b`,
    String.raw`\b(?:place|set)\s+(?:a|an|the)?\s*(?:limit|stop|buy|sell|order)\b`,
    String.raw`\blimit\s+(?:buy|sell|order)\b`,
    String.raw`\bwatch\s+(?:for\s+)?(?:a\s+|the\s+)?(?:long|short|buy|sell|entry|\d)`,
    String.raw`\b(?:compra|comprar|venda|vender)\s+(?:em|no|na|a|perto|se|quando|acima|abaixo|ap[oó]s|limit)\b`,
    String.raw`\bentrada\s+(?:em|no|na|de\s+compra|de\s+venda|long|short)\b`,
    String.raw`\bentrar\s+(?:em|no|na|comprado|vendido|long|short)\b`,
    String.raw`\b(?:compra|comprar|venta|vender)\s+(?:en|cerca|si|cuando|por)\b`,
    String.raw`\b(?:acheter|achat|vendre|vente)\s+(?:à|a|au|près|si|quand|sur)\b`,
    String.raw`\b(?:kaufen|kauf|verkaufen|verkauf)\s+(?:bei|über|unter|wenn|ab)\b`,
    String.raw`\beinstieg\s+(?:bei|über|unter|ab)\b`,
    String.raw`\d\s*(?:付近)?で?の?(?:買い|売り|エントリー)`,
    String.raw`(?:買い|売り)(?:エントリー|注文|を検討|を狙)`,
  ].join('|'),
  'iu',
);

export function stripContradictingActions(text: string): string {
  return text
    .split('\n')
    .map((line) => line.split(/(?<=[.!?])\s+|(?<=[。！？])/u).filter((sentence) => !MODEL_ACTION.test(sentence)).join(' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function stripModelState(text: string): string {
  return text.replace(ARROW_STATE, '').replace(SCORE_STATE, '$1').replace(BARE_STATE, '$1').trim();
}

const PASS_FAIL_ITEM = /\bC([1-7])\b([^;|\n]{0,30}?)\b(PASS|FAIL)\b\s*[:,-]?\s*/giu;
const PASS_FAIL_TAIL = /[\s.;,]*\b([0-7])\s*\/\s*7\b\s*[:,-]?\s*([^\n]*?)\.?\s*$/u;

function parsePassFailChecklist(text: string): StructureChecklist | null {
  const matches = [...text.matchAll(PASS_FAIL_ITEM)];
  if (new Set(matches.map((m) => m[1])).size !== 7) return null;
  let score: string | null = null;
  const items: ChecklistItem[] = matches.map((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? text.length : text.length;
    let detail = text.slice(start, end);
    if (i === matches.length - 1) {
      const tail = detail.match(PASS_FAIL_TAIL);
      if (tail && typeof tail.index === 'number') {
        // O estado escrito pelo modelo ("6/7 WATCH") fica de fora: a tela so mostra o do codigo.
        score = `${tail[1]}/7`;
        detail = detail.slice(0, tail.index);
      }
    }
    const label = m[2].replace(/[:\s-]+$/u, '').trim();
    return {
      ok: m[3].toUpperCase() === 'PASS',
      notApplicable: false,
      label: label ? `C${m[1]} ${label}` : `C${m[1]}`,
      detail: detail.replace(/[\s;,|]+$/u, '').replace(/\.$/, '').trim(),
    };
  });
  const reported = (score as string | null)?.match(/^([0-7])\/7$/);
  const scoreMismatch = reported != null && Number(reported[1]) !== items.filter((item) => item.ok).length;
  return { items, score: scoreMismatch ? null : score, scoreMismatch };
}

export function parseStructureChecklist(text: string): StructureChecklist {
  if (!text) {
    return { items: [], score: null, scoreMismatch: false };
  }
  const v10 = parsePassFailChecklist(text);
  if (v10) return v10;

  let rest = text;
  let score: string | null = null;

  // Cauda "→ 6/7 → BUY limit setup."
  const tail = rest.match(/→\s*(\d+\s*\/\s*\d+)\s*(?:passes)?\s*(?:→\s*(.+?))?\s*$/i);
  if (tail && typeof tail.index === 'number') {
    score = tail[1].replace(/\s+/g, '');
    rest = rest.slice(0, tail.index).trim();
  }

  const items: ChecklistItem[] = [];

  // O modelo usa "| N/A ..." para critérios sem dado. Preserve o item como
  // não avaliável; não o cole ao ❌ anterior nem pinte de reprovação.
  const separated = rest.replace(/\|\s*(N\/A)\b/giu, ' ⚪ $1');
  for (const raw of separated.split(/(?=[✅❌✔✖⚠⚪])/u)) {
    const chunk = raw.trim();
    const marker = chunk.charAt(0);
    if (!chunk || !'✅❌✔✖⚠⚪'.includes(marker)) {
      continue;
    }

    const body = chunk.slice(1).replace(/^\uFE0F/, '').trim().replace(/\s*\|\s*$/, '').replace(/\.$/, '');
    if (!body) {
      continue;
    }

    // Rótulo curto + explicação. O separador exige ESPAÇO depois, senão o "R:R"
    // seria cortado no próprio dois-pontos.
    const split = body.match(/^(.{2,40}?)\s*[:,]\s+(.+)$/s);

    items.push({
      ok: marker === '✅' || marker === '✔',
      notApplicable: marker === '⚪',
      ...(marker === '⚠' ? { warning: true } : {}),
      label: split ? split[1].trim() : '',
      detail: split ? split[2].trim() : body,
    });
  }

  // Só confira quando os sete itens aparecem: uma resposta antiga pode trazer
  // um resumo parcial, com placar do checklist completo.
  const reported = score?.match(/^([0-7])\/7$/);
  const scoreMismatch = items.length === 7 && reported != null &&
    Number(reported[1]) !== items.filter((item) => item.ok).length;
  return { items, score: scoreMismatch ? null : score, scoreMismatch };
}

const AnalysisResult = ({ analysisData, uploadedImage, sample = false, alertsEnabled = false, base = '/dashboard' }: AnalysisResultProps) => {
  // Diz ao botão de reportar problema qual análise está na tela. Sem isto o
  // relato chega sem o id e vira caça ao tesouro no histórico do usuário.
  useEffect(() => {
    definirAnaliseAtual(sample ? null : analysisData?.id ?? null);
    return () => definirAnaliseAtual(null);
  }, [analysisData?.id, sample]);

  const { toast } = useToast();
  const { t, language } = useLanguage();
  const formatSignedPercent = (value: number | null) => formatSignedPercentInLanguage(value, language);
  const formatPositivePercent = (value: number | null) => formatPositivePercentInLanguage(value, language);

  const r = t.analysis.result;
  const sessionLabels: Record<string, string> = {
    SYD: t.analysis.sessions.sydney,
    TKY: t.analysis.sessions.tokyo,
    LDN: t.analysis.sessions.london,
    NY: t.analysis.sessions.newYork,
  };
  const [showInvalidation, setShowInvalidation] = useState(false);
  // Entrada registrada pelo trader neste WATCH; segue a analise aberta na tela.
  const [watchEntry, setWatchEntry] = useState<WatchEntry | null>(analysisData?.watchEntry ?? null);
  useEffect(() => {
    setWatchEntry(analysisData?.watchEntry ?? null);
  }, [analysisData?.id, analysisData?.watchEntry]);

  // ⚠️ ESTES DOIS HOOKS PRECISAM FICAR ACIMA DO `return` DE BAIXO.
  //
  // Bug real corrigido em 19/08/2026: eles eram chamados lá embaixo, DEPOIS do
  // `if (!analysisData) return ...`. Isso muda a QUANTIDADE de hooks entre um
  // render e outro — e o React exige que ela seja idêntica sempre. Na primeira
  // vez que este componente renderizasse sem análise e depois com análise (ou
  // vice-versa) sem desmontar no meio, o React quebraria com "Rendered more
  // hooks than during the previous render". Hoje isso não acontece porque o pai
  // não monta este componente sem dados — ou seja, era uma mina esperando uma
  // mudança de renderização no dashboard.
  //
  // Os dois hooks já tratam símbolo nulo internamente (`if (!symbol ...) return`),
  // então no caminho sem análise eles não disparam requisição nenhuma. O símbolo
  // de verdade continua sendo calculado mais abaixo, para exibição.
  const simboloParaContexto = (() => {
    if (!analysisData || sample) return null;
    // Mesma origem do `symbol` calculado mais abaixo, só que resistente a
    // analysisData nulo. Não reaproveita aquela variável de propósito: ela é
    // declarada depois do early return e usa 'UNKNOWN' como último recurso —
    // e 'UNKNOWN' é justamente o valor que os dois hooks tratam como "não busque".
    const resposta = asRecord(analysisData.fullResponse);
    const bloco = asRecord(resposta.analysis);
    return (
      String(bloco.symbol || bloco.ticker || bloco.asset || resposta.symbol || resposta.ticker || '')
        .trim() || null
    );
  })();
  const { events: calEvents, loading: calLoading, unreliable: calUnreliable } = useEconomicCalendar(simboloParaContexto);
  const { data: liveMarket } = useMarketContext(simboloParaContexto);
  const watchExpires = Date.parse(analysisData?.watch?.expiresAt ?? '');
  const now = useExpiryClock(watchExpires);

  if (!analysisData) {
    return (
      <Card className="surface-terminal-elevated rounded-xl">
        <CardContent className="space-y-4 p-6">
          <Alert className="border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)]">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{r.demoTitle}</AlertTitle>
            <AlertDescription>
              {r.demoDesc}
            </AlertDescription>
          </Alert>
          <div className="text-sm text-[var(--text-secondary)]">
            {t.interfaceExtras.emptyResult}
          </div>
        </CardContent>
      </Card>
    );
  }

  const fullResponse = asRecord(analysisData.fullResponse);
  const analysis = { ...asRecord(fullResponse.analysis) };
  const messages = asRecord(fullResponse.displayMessages);
  const analysisMessages = asRecord(analysis.displayMessages);
  const displayReasoning = translatedAnnotation(t, language, translatedAnnotation(t, language, analysisData.reasoning ?? '', messages.stalePrint), messages.drawingReferences);
  for (const field of ['reasoning', 'executiveSummary', 'technicalAnalysis']) {
    analysis[field] = translatedAnnotation(t, language, String(analysis[field] ?? ''), messages.stalePrint);
  }
  analysis.reasoning = translatedAnnotation(t, language, String(analysis.reasoning ?? ''), messages.drawingReferences);
  analysis.multiTimeframeAlignment = translatedAnnotation(t, language, String(analysis.multiTimeframeAlignment ?? ''), analysisMessages.multiTimeframePrefix);
  const marketStructure = asRecord(analysis.marketStructure);
  const symbol = String(
    analysis.symbol || analysis.ticker || analysis.asset || fullResponse.symbol || fullResponse.ticker || 'UNKNOWN',
  ).trim() || 'UNKNOWN';
  const timeframe = String(analysis.timeframe || analysis.period || fullResponse.timeframe || 'UNKNOWN').trim() || 'UNKNOWN';
  const formatPrice = (value: number | null) => formatAssetPrice(value, symbol, LOCALES[language]);

  const recommendationMeta = getRecommendationMeta(analysisData.recommendation);
  const scenarioMeta = getScenarioMeta(analysisData.bias || marketStructure.bias, analysisData.recommendation);
  // Rotulo principal = estado do copiloto. A direcao fica como cenario.
  const signalState = resolveSignalState(
    fullResponse.signalState,
    analysisData.recommendation,
    analysis.entryType,
    analysis.alternativeScenario,
  );
  const stateTone = signalStateTone(signalState, analysisData.recommendation);
  const stateActive = signalState === 'ENTER_NOW' || signalState === 'ARMED';
  const watchPlan = isWatchPlan(fullResponse.watchPlan) ? fullResponse.watchPlan : null;
  const continuation = fullResponse.continuation as { status?: unknown; direction?: unknown; level?: unknown } | null | undefined;
  const continuationStatus = typeof continuation?.status === 'string' ? r.continuationStatus[continuation.status as keyof typeof r.continuationStatus] : undefined;
  const continuationLine =
    continuationStatus && typeof continuation?.level === 'number' && (continuation.direction === 'long' || continuation.direction === 'short')
      ? (continuation.direction === 'long' ? r.continuationBuy : r.continuationSell)
          .replace('{level}', formatPrice(continuation.level))
          .replace('{status}', continuationStatus)
      : null;
  // Niveis do WATCH calculados pelo motor (desde 03/11/2026). undefined: analise
  // antiga ou sem velas reais (alvos do modelo, como antes); null: o motor
  // rejeitou a geometria no nivel do WATCH (sem alvos nem R na tela).
  const watchLevels: WatchLevels | null | undefined = isWatchLevels(fullResponse.watchLevels)
    ? fullResponse.watchLevels
    : signalState === 'WATCH' && fullResponse.dataMode === 'real_data' && 'watchLevels' in fullResponse ? null : undefined;
  const levelsEstimated = fullResponse.dataMode === 'print';
  const entryWarnings = Array.isArray(fullResponse.entryWarnings) ? fullResponse.entryWarnings.filter((item) => item === 2 || item === 7) : [];
  // WATCH com plano: cartao unico. Analise antiga sem plano segue no desenho anterior.
  const watchLayout = signalState === 'WATCH' && watchPlan !== null;
  const watchClosed = watchLayout && !watchWindowOpen(analysisData.watch, now);

  const detectedSession = String(analysis.detectedSession || fullResponse.detectedSession || '').trim() || null;
  const sessionNote =
    cleanModelText(analysis.sessionNote) || cleanModelText(fullResponse.sessionNote) || null;

  // Preço 0/negativo nunca é válido — significa "não informado" (ex.: HOLD sem
  // plano de trade). Trata como ausente para exibir "N/A" em vez de "$ 0.00000".
  const positivePriceOrNull = (v: number | null): number | null =>
    v !== null && v > 0 ? v : null;
  const currentPrice = positivePriceOrNull(toNumber(analysis.currentPrice));
  const entry = positivePriceOrNull(toNumber(analysis.entry));
  const stopLoss = positivePriceOrNull(toNumber(analysis.stopLoss));
  const takeProfit1 = positivePriceOrNull(toNumber(analysis.takeProfit1));
  const takeProfit2 = positivePriceOrNull(toNumber(analysis.takeProfit2));

  const stopPercent = entry !== null && stopLoss !== null ? calcStopPercent(entry, stopLoss) : null;
  const takeProfit1Percent = entry !== null && takeProfit1 !== null ? calcTPPercent(entry, takeProfit1) : null;
  const takeProfit2Percent = entry !== null && takeProfit2 !== null ? calcTPPercent(entry, takeProfit2) : null;

  // Distância em pips (apenas forex), preservando décimos nas cotações fracionárias. null em outros mercados.
  const pipSize = forexPipSize(symbol);
  const pipsBetween = (a: number | null, b: number | null): number | null =>
    pipSize && a !== null && b !== null ? Math.round((Math.abs(a - b) / pipSize) * 10) / 10 : null;
  const stopPips = pipsBetween(entry, stopLoss);
  const tp1Pips = pipsBetween(entry, takeProfit1);
  const tp2Pips = pipsBetween(entry, takeProfit2);

  const confluenceRaw = toNumber(analysis.confluenceScore);
  const confluence = confluenceRaw !== null ? normalizeConfluenceScore(confluenceRaw) : null;

  // v7.0 new fields
  const invalidationLevel = toNumber(analysis.invalidationLevel);
  const invalidationNote = String(analysis.invalidationNote || '').trim() || null;
  const entryType = String(analysis.entryType || '').trim() || null;
  const entryCondition = String(analysis.entryCondition || '').trim() || null;
  const partialExitStrategy = String(analysis.partialExitStrategy || '').trim() || null;
  // 0 = "não preenchido" — trata como ausente para nunca exibir chips "0%"
  // (vale para probabilidades e para o plano de saída em análises HOLD).
  const positiveOrNull = (v: number | null): number | null => (v !== null && v > 0 ? v : null);
  const tp1ClosePercent = positiveOrNull(toNumber(analysis.tp1ClosePercent));
  const tp2ClosePercent = positiveOrNull(toNumber(analysis.tp2ClosePercent));
  const breakevenTrigger = String(analysis.breakevenTrigger || '').trim() || null;
  const tradeTone = recommendationMeta.tone;
  const rrTp1 = computeDirectionalRiskReward(entry, stopLoss, takeProfit1, tradeTone);
  const rrTp2 = computeDirectionalRiskReward(entry, stopLoss, takeProfit2, tradeTone);
  const invalidTradePlan = (tradeTone === 'buy' || tradeTone === 'sell') &&
    entry !== null && stopLoss !== null &&
    ((takeProfit1 !== null && rrTp1 === null) || (takeProfit2 !== null && rrTp2 === null));
  const hasStructuredExit = tp1ClosePercent !== null || tp2ClosePercent !== null || breakevenTrigger !== null;
  const alternativeScenario = String(analysis.alternativeScenario || '').trim() || null;
  const trendStrength = String(analysis.trendStrength || '').trim() || null;
  const trendStrengthNote = String(analysis.trendStrengthNote || '').trim() || null;
  const marketRegime = String(analysis.marketRegime || '').trim().toLowerCase() || null;
  const marketRegimeNote = String(analysis.marketRegimeNote || '').trim() || null;
  const multiTimeframeAlignment = String(analysis.multiTimeframeAlignment || '').trim() || null;
  const evidence = asRecord(fullResponse.evidence);
  const unverifiedMtfAlignment = Boolean(multiTimeframeAlignment) && evidence.version === 1 &&
    evidence.additionalChartsDelivered === 0;

  // R/R por alvo, calculado direto dos níveis (consistente e funciona em análises antigas).
  // Sem plano direcional verificável, não mostra razão fornecida só em texto.
  // O número principal é o do TP1 (30/09/2026): é o alvo que a /accuracy mede.
  // Era o do TP2, e quem lia "R/R 2.1" ao lado de um acerto medido no TP1
  // multiplicava as duas coisas e superestimava o resultado.
  const riskReward = invalidTradePlan || tradeTone === 'hold' ? null : rrTp1 ?? rrTp2;
  // R/R baixo (< 1.5) = vermelho + aviso; >= 2 verde; entre = amarelo.
  const riskRewardLabel = riskReward !== null && rrTp1 === null ? r.rrTp1Label.replace('TP1', 'TP2') : r.rrTp1Label;
  const riskRewardLow = riskReward !== null && riskReward < 1.5;
  const riskRewardTone = riskReward === null
    ? 'text-[var(--text-secondary)]'
    : riskReward < 1.5
      ? 'text-[var(--signal-sell)]'
      : riskReward >= 2
        ? 'text-[var(--signal-buy)]'
        : 'text-[var(--signal-hold)]';

  const timestamp = new Date(analysisData.createdAt);
  const openSessions = getOpenSessions(timestamp);
  const hasLiveMarket = !!liveMarket && (
    liveMarket.fundingRatePercent !== null ||
    liveMarket.openInterest !== null ||
    liveMarket.longShortRatio !== null ||
    liveMarket.fearGreedValue !== null
  );

  // #3 — Leitura automática do contexto ao vivo (não muda o sinal; só interpreta os dados).
  const liveReadings: string[] = [];
  if (liveMarket) {
    const f = liveMarket.fundingRatePercent;
    if (f !== null) {
      if (f >= 0.03) liveReadings.push(r.live.fundingHigh);
      else if (f <= -0.01) liveReadings.push(r.live.fundingNeg);
    }
    const ls = liveMarket.longShortRatio;
    if (ls !== null) {
      if (ls >= 2) liveReadings.push(r.live.crowdLong);
      else if (ls <= 0.6) liveReadings.push(r.live.crowdShort);
    }
    const fg = liveMarket.fearGreedValue;
    if (fg !== null) {
      if (fg <= 25) liveReadings.push(r.live.fearExtreme);
      else if (fg >= 75) liveReadings.push(r.live.greedExtreme);
    }
  }
  const formattedTimestamp = timestamp.toLocaleString(LOCALES[language], {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const imageUrl =
    analysisData.annotated_image_url ||
    fullResponse.annotated_image_url ||
    analysisData.original_image_url ||
    fullResponse.original_image_url ||
    analysisData.imageUrl ||
    uploadedImage ||
    null;


  // Selo de encaixe com a estratégia do usuário (Tarefa 4 do backend).
  // `strategyFit`/`strategyFitReason` vêm no TOPO do `fullResponse` (irmãos de
  // `analysis`/`recommendation`, não dentro de `analysis`) — ver
  // `strategyFitProps` em `ai.adapter.ts`. Nulos quando o usuário não tem
  // perfil de estratégia; nesse caso o selo simplesmente não aparece.
  //
  // TRAVA 1, camada de apresentação: o selo é renderizado AO LADO do veredito
  // (dentro do mesmo header, junto do chip de convicção), nunca no lugar dele,
  // e `recommendationMeta`/`convictionTier` abaixo não leem `strategyFit` em
  // nenhum momento. Um WAIT com `strategyFit: 'ideal'` continua WAIT.
  const strategyFitValue = String(fullResponse.strategyFit || '').trim().toLowerCase();
  const strategyFit =
    strategyFitValue === 'ideal' || strategyFitValue === 'good' || strategyFitValue === 'poor' || strategyFitValue === 'conflict'
      ? (strategyFitValue as 'ideal' | 'good' | 'poor' | 'conflict')
      : null;
  // Vem do modelo: precisa do MESMO funil de limpeza de emoji/travessão que
  // todo o resto do texto gerado, senão o selo vira a única parte da tela com
  // emoji sobrevivendo.
  const strategyFitReason = cleanModelText(fullResponse.strategyFitReason);
  const STRATEGY_FIT_LABEL: Record<'ideal' | 'good' | 'poor' | 'conflict', string> = {
    ideal: r.strategyFitIdeal,
    good: r.strategyFitGood,
    poor: r.strategyFitPoor,
    conflict: r.strategyFitConflict,
  };
  const STRATEGY_FIT_TONE: Record<'ideal' | 'good' | 'poor' | 'conflict', string> = {
    ideal: 'bg-[var(--signal-buy-bg)] border-[var(--signal-buy-border)] text-[var(--signal-buy)]',
    good: 'border-[var(--border-accent)] text-[var(--text-primary)]',
    poor: 'bg-[var(--signal-hold-bg)] border-[var(--signal-hold-border)] text-[var(--signal-hold)]',
    conflict: 'bg-[var(--signal-sell-bg)] border-[var(--signal-sell-border)] text-[var(--signal-sell)]',
  };

  const copyValue = async (label: string, value: number | null) => {
    if (value === null) {
      return;
    }

    try {
      await navigator.clipboard.writeText(String(value));
      toast({
        title: r.copied,
        description: `${label} ${r.copySuffix}`,
      });
    } catch (error) {
      console.error('Falha ao copiar valor:', error);
    }
  };

  // O validador rebaixou para NO_TRADE: a prosa do modelo ainda fala do plano recusado.
  const downgradeNote = signalState === 'NO_TRADE'
    ? (analysisData.fullResponse?.validatorNotes ?? []).find((note): note is { from?: string; to?: string; reason: string } => typeof note === 'object' && note.to === 'NO_TRADE' && note.from !== 'NO_TRADE')
    : undefined;
  const downgradedToNoTrade = downgradeNote !== undefined;
  const finalDecisionReasons = r.finalDecisionReasons as Record<string, string>;
  const finalDecision = downgradeNote
    ? r.finalDecision.replace('{reason}', finalDecisionReasons[downgradeNote.reason] ?? r.finalDecisionReasons.other)
    : null;
  /** So na tela: tira da prosa do modelo o que contradiz a decisao final. */
  const modelProse = (text: string) => (downgradedToNoTrade ? stripContradictingActions(text) : text);
  const technicalAnalysis =
    modelProse(cleanModelText(analysis.technicalAnalysis) || cleanModelText(analysis.reasoning) || cleanModelText(displayReasoning)) ||
    r.noAnalysis;
  const modelSummary = modelProse(cleanModelText(analysis.executiveSummary) || cleanModelText(analysis.technicalSummary));
  const executiveSummary = downgradedToNoTrade ? modelSummary || r.downgradedSummary : modelSummary;
  const whyNotOpposite = cleanModelText(analysis.whyNotOpposite);
  // Checklist e paragrafo de reserva sem o estado ou a direcao que o modelo
  // escreveu ("6/7 WATCH", "MTF 2/3 → SELL"): a tela so mostra a decisao do codigo.
  const structureValidation = stripModelState(cleanModelText(analysis.structureValidation));
  // A ORDEM importa: o checklist precisa dos marcadores ✅/❌ para saber o que
  // passou, e o cleanModelText remove emoji. Então ele lê a versão que ainda
  // tem os marcadores (ja sem o estado do modelo), e o parágrafo de reserva usa a versão limpa.
  const parsedChecklist = parseStructureChecklist(
    structureValidation ? stripModelState(softenDashes(String(analysis.structureValidation).trim())) : '',
  );
  // C6 (geometria) com os niveis do motor, nunca o calculo do modelo: no WATCH,
  // os que valeriam ao destravar no nivel; no ENTER_NOW de analise com o campo
  // novo, os do sinal. Analise antiga segue com o texto do modelo.
  const geometryLevels = signalState === 'WATCH' && watchLevels
    ? { ...watchLevels, text: r.watch.geometryWatch }
    : signalState === 'ENTER_NOW' && 'watchLevels' in fullResponse && entry !== null && stopLoss !== null && takeProfit1 !== null && entry !== stopLoss
      ? { entry, stopLoss, takeProfit1, tp1R: Math.abs(takeProfit1 - entry) / Math.abs(entry - stopLoss), text: r.watch.geometryEnter }
      : null;
  const geometryDetail = geometryLevels
    ? geometryLevels.text
        .replace('{entry}', formatPrice(geometryLevels.entry))
        .replace('{stop}', formatPrice(geometryLevels.stopLoss))
        .replace('{tp1}', formatPrice(geometryLevels.takeProfit1))
        .replace('{r}', formatNumber(geometryLevels.tp1R, language, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }))
    : watchLevels === null ? r.watch.targetsRejected : null;
  const checklist = geometryDetail
    ? {
        ...parsedChecklist,
        items: parsedChecklist.items.map((item) => (/^C6\b/.test(item.label) ? { ...item, detail: geometryDetail } : item)),
      }
    : parsedChecklist;

  // Linhas da estrutura de mercado. Montadas em dado, não em <p> soltos: assim
  // a coluna de rótulos alinha igual à dos Operation Levels, e um campo vazio
  // some da grade em vez de imprimir "Not informed" no meio da leitura.
  const structureRows: Array<{ key: string; label: string; value: string; tone?: string }> = [
    { key: 'bias', label: t.analysis.bias, value: t.scenarioLabels[scenarioMeta.label] },
    { key: 'structure', label: t.analysis.structure, value: cleanModelText(marketStructure.lastStructure) },
    { key: 'bos', label: 'BOS / CHoCH', value: cleanModelText(marketStructure.breakOfStructure) },
    { key: 'zone', label: t.analysis.priceZone, value: cleanModelText(marketStructure.priceZone) },
    { key: 'ob', label: 'Order Block', value: cleanModelText(marketStructure.orderBlock) },
    {
      key: 'trend',
      label: t.analysis.trendStrength,
      value: trendStrength
        ? [
            trendStrength === 'strong'
              ? t.analysis.strongTrend
              : trendStrength === 'weak'
                ? t.analysis.weakTrend
                : t.analysis.moderateTrend,
            trendStrengthNote,
          ]
            .filter(Boolean)
            .join(', ')
        : '',
      tone: trendStrength === 'strong' ? 'buy' : trendStrength === 'weak' ? 'sell' : 'hold',
    },
    {
      key: 'regime',
      label: t.analysis.marketRegime,
      value: marketRegime
        ? [
            marketRegime === 'trending'
              ? t.analysis.regimeTrending
              : marketRegime === 'volatile'
                ? t.analysis.regimeVolatile
                : t.analysis.regimeRanging,
            marketRegimeNote,
          ]
            .filter(Boolean)
            .join(', ')
        : '',
      tone: marketRegime === 'trending' ? 'buy' : marketRegime === 'volatile' ? 'sell' : 'hold',
    },
    {
      key: 'mtf', label: t.analysis.mtfAlignment,
      value: unverifiedMtfAlignment ? t.analysis.mtfEvidenceWarning : cleanModelText(multiTimeframeAlignment),
      tone: unverifiedMtfAlignment ? 'hold' : undefined,
    },
  ].filter((row) => row.value.length > 0);

  const patternItems = splitItems(analysis.identifiedPatterns).map((item) => cleanModelText(translatedAnnotation(t, language, item, messages.stalePrint))).filter(Boolean);
  // Indicadores são PROSA, não lista: o prompt pede "no máximo 2 frases". A
  // versão anterior picava no ponto-e-vírgula e na vírgula, e o painel exibia
  // "supporting bullish momentum. Pure price action analysis is primary" como
  // se fosse um item próprio. Parágrafo é a leitura honesta do campo.
  const keyIndicatorsText = cleanModelText(analysis.keyIndicators);
  // Valor CRU de propósito: `cleanModelText` devolve string e achatava o
  // array de riscos numa linha só. A limpeza é aplicada item a item depois.
  const riskItems = normalizeRiskFactorsForView(analysis.riskFactors)
    .map((item) => cleanModelText(translatedAnnotation(t, language, item, messages.stalePrint)))
    .filter((item) => item.length > 0);

  // "What would change my mind": vira o WAIT/HOLD (o resultado mais comum do
  // motor) em orientação acionável — composto SÓ de campos que o motor já
  // devolve hoje (nenhuma mudança de prompt; regra: motor só muda com medição).
  // Use the same canonical action as the header, including legacy WAIT aliases.
  const isWaitVerdict = recommendationMeta.tone === 'hold';
  // Quando o gatilho traz preco, o card vira "No entry yet. Here is the plan:"
  // e o gatilho ganha o lado (ver `classifyWaitTrigger`). Sem preco, fica o
  // card antigo, com o titulo antigo.
  const triggerLabel = (text: string, fallback: string) => {
    const side = classifyWaitTrigger(text);
    if (side === null) return fallback;
    return side === 'buy' ? r.planBuyTrigger : side === 'sell' ? r.planSellTrigger : r.planTrigger;
  };
  const waitFlipItems: Array<{ label: string; text: string }> = [];
  const waitHasPlan =
    isWaitVerdict && !downgradedToNoTrade && (classifyWaitTrigger(entryCondition) !== null || classifyWaitTrigger(alternativeScenario) !== null);
  if (isWaitVerdict) {
    const entryShown = entryCondition ? modelProse(entryCondition) : null;
    const alternativeShown = alternativeScenario ? modelProse(alternativeScenario) : null;
    if (entryShown) waitFlipItems.push({ label: triggerLabel(entryShown, r.flipEntry), text: entryShown });
    if (alternativeShown) waitFlipItems.push({ label: triggerLabel(alternativeShown, r.flipAlt), text: alternativeShown });
    if (invalidationLevel !== null && invalidationLevel > 0) {
      waitFlipItems.push({
        label: r.flipInvalidation,
        text: `${formatPrice(invalidationLevel)}${invalidationNote ? `: ${invalidationNote}` : ''}`,
      });
    } else if (invalidationNote) {
      waitFlipItems.push({ label: r.flipInvalidation, text: invalidationNote });
    }
    if (whyNotOpposite) waitFlipItems.push({ label: r.flipWhyNot, text: whyNotOpposite });
  }

  /**
   * Dados do card compartilhável.
   *
   * A LEITURA vem do executiveSummary quando existe. No deep ele é escrito em
   * blocos "RÓTULO: texto" (um por linha) — jogar isso cru na imagem colocaria
   * os rótulos do modelo dentro do card, então aqui pega-se o bloco READING
   * (ou o primeiro) e usa-se só o texto.
   *
   * NÃO reaproveita a variável `technicalAnalysis`: ela já embute o fallback
   * traduzido (`r.noAnalysis`), e o card não deve exibir texto de interface.
   * O card escolhe uma frase inteira sem preço; vazio ou fora do inglês, usa a
   * frase fixa do estado (`buildReadCard` em lib/share-card.ts).
   *
   * O card existe para TODO veredito, WAIT incluído.
   */
  const shareRead = (() => {
    if (executiveSummary) {
      const { blocks } = parseSummaryBlocks(executiveSummary);
      if (blocks.length >= 2) {
        const reading = blocks.find((b) => b.label.trim().toUpperCase() === 'READING');
        return (reading || blocks[0]).text;
      }
      return executiveSummary;
    }
    return (
      cleanModelText(analysis.technicalAnalysis) ||
      cleanModelText(analysis.reasoning) ||
      cleanModelText(displayReasoning)
    );
  })();

  // Modo leitura: a leitura, onde o preco esta e a acao, em toda analise.
  const biasKey = String(analysisData.bias || marketStructure.bias || '').trim().toLowerCase();
  const readReason = (() => {
    const first = (executiveSummary || cleanModelText(analysis.technicalAnalysis)).split(/(?<=[.!?])\s/)[0] ?? '';
    return first.length > 220 ? `${first.slice(0, 219).trimEnd()}…` : first;
  })();
  const engineContract = asRecord(asRecord(fullResponse.engine).contract);
  const readMode: ReadModeData = {
    state: signalState,
    bias: biasKey === 'bullish' || biasKey === 'bearish' ? biasKey : 'neutral',
    strength: trendStrength === 'strong' || trendStrength === 'moderate' || trendStrength === 'weak' ? trendStrength : null,
    reason: readReason,
    location: analysisData.fullResponse?.location ?? null,
    currentPrice,
    dataMode: analysisData.fullResponse?.dataMode ?? null,
    levels: { entry, stopLoss, takeProfit1, takeProfit2 },
    watchPlan,
    watchReach: analysisData.fullResponse?.watchReach ?? null,
    noTradeReason: typeof engineContract.no_trade_reason === 'string' ? messageText(t, language, engineContract.no_trade_reason_code, engineContract.no_trade_reason_params, engineContract.no_trade_reason) : readReason || null,
  };

  const shareData: ReadShareData = {
    symbol,
    timeframe,
    scenario: scenarioMeta.label,
    action: recommendationMeta.label,
    state: signalState,
    read: shareRead,
    // A prosa sai no idioma pedido na analise (o da interface); o card e so em ingles.
    readIsEnglish: language === 'en',
    trendStrength: trendStrength === 'strong' || trendStrength === 'moderate' || trendStrength === 'weak' ? trendStrength : null,
    date: timestamp,
    watchSide: watchLayout && !watchClosed && watchPlan ? (watchPlan.direction === 'long' ? 'buy' : 'sell') : null,
  };

  // Tudo o que o WATCH escreve sai daqui: numeros do servidor, frases do codigo.
  const watchText = (() => {
    if (!watchLayout || !watchPlan) return null;
    const w = r.watch;
    const long = watchPlan.direction === 'long';
    // "$ 4,260.00" nunca quebra entre o simbolo e o numero.
    const money = (value: number) => formatPrice(value).replace(/ /g, '\u00a0');
    const zone = watchPlan.zoneLow === watchPlan.zoneHigh
      ? money(watchPlan.zoneLow)
      : w.zoneRange.replace('{low}', money(watchPlan.zoneLow)).replace('{high}', money(watchPlan.zoneHigh));
    const headline = [
      currentPrice !== null ? w.noEntryAt.replace('{price}', money(currentPrice)) : '',
      (long ? w.waitPullback : w.waitRally).replace('{zone}', zone),
    ].filter(Boolean).join(' ');

    const clauses = cleanModelText(watchPlan.trigger).split(/;\s*/).filter(Boolean);
    const conditional = clauses.find((clause) => /\b(only if|only after|once|if)\b/i.test(clause));
    const raw = clauses.length > 1 && conditional ? conditional : cleanModelText(watchPlan.trigger);
    const condition = raw ? `${raw[0].toUpperCase()}${raw.slice(1).replace(/\.$/, '')}.` : null;

    const target1Price = watchLevels ? watchLevels.takeProfit1 : watchPlan.target1;
    const failed = checklist.items
      .filter((item) => !item.ok && !item.notApplicable)
      .map((item) => item.label.match(/^C([1-7])\b/)?.[1])
      .flatMap((code) => {
        if (code === '7') {
          return currentPrice !== null
            ? [w.criteria.c7.replace('{price}', money(currentPrice)).replace('{target}', money(target1Price))]
            : [w.criteria.c7NoPrice];
        }
        const text = code ? (w.criteria as Record<string, string>)[`c${code}`] : undefined;
        return text ? [text] : [];
      });
    const risks = riskItems
      .flatMap((item) => item.split(/;\s*/))
      .map((item) => item.trim().replace(/\.$/, ''))
      .filter(Boolean)
      .map((item) => {
        const sentence = item.length > 110 ? item.split(/(?<=[.!?])\s/)[0] : item;
        return `${sentence[0].toUpperCase()}${sentence.slice(1)}`;
      });

    const cancelled = (long ? w.cancelBelow : w.cancelAbove)
      .replace('{tf}', timeframe === 'UNKNOWN' ? '' : timeframe)
      .replace('{price}', money(watchPlan.invalidation))
      .replace(/[ \t]{2,}/g, ' ');
    const invalidationDigits = String(watchPlan.invalidation);
    const opposite = (alternativeScenario ? cleanModelText(alternativeScenario) : '')
      .split(/(?<=[.!?。])\s+/)
      .filter((sentence) => sentence && !sentence.replace(/,/g, '').includes(invalidationDigits) && !/invalidat/i.test(sentence));
    const oppositeLine = opposite[0] ? `${opposite[0][0].toLowerCase()}${opposite[0].slice(1).replace(/\.$/, '')}` : null;
    return {
      headline,
      condition,
      whyWait: [...failed, ...risks].slice(0, 3),
      cancelled,
      oppositeLine,
      planBRepeats: opposite.length <= 1,
    };
  })();
  // Fora da validade do plano, um evento nao afeta esta analise.
  const eventInPlan = (minutesUntil: number | null | undefined) =>
    !watchLayout || (!watchClosed && (!Number.isFinite(watchExpires) || (minutesUntil ?? 0) * 60_000 <= watchExpires - now));

  const HeaderIcon = stateTone === 'buy' ? ArrowUp : stateTone === 'sell' ? ArrowDown : signalState === 'WATCH' ? Eye : Minus;

  const signalToneClasses =
    stateTone === 'buy'
      ? 'bg-[var(--signal-buy-bg)] border-[var(--signal-buy-border)] text-[var(--signal-buy)]'
      : stateTone === 'sell'
        ? 'bg-[var(--signal-sell-bg)] border-[var(--signal-sell-border)] text-[var(--signal-sell)]'
        : 'bg-[var(--signal-hold-bg)] border-[var(--signal-hold-border)] text-[var(--signal-hold)]';
  // Cenario em cor so junto de ordem/entrada; no WATCH e no NO_TRADE fica neutro.
  const scenarioToneClasses = !stateActive
    ? 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
    : scenarioMeta.tone === 'buy'
      ? 'border-[var(--signal-buy-border)] text-[var(--signal-buy)]'
      : scenarioMeta.tone === 'sell'
        ? 'border-[var(--signal-sell-border)] text-[var(--signal-sell)]'
        : 'border-[var(--border-subtle)] text-[var(--text-secondary)]';
  // Ordem pendente: o preco da limit e o que a cancela (mesma regra do runLimitOrder).
  const pendingInvalidation = watchPlan?.invalidation ?? (invalidationLevel !== null && invalidationLevel > 0 ? invalidationLevel : null);
  const pendingTarget = watchPlan?.target1 ?? takeProfit1;

  const isDemo = Boolean(analysisData.isDemo);
  // "I entered" num WATCH: so na analise real da propria conta (nunca exemplo ou demo).
  const entryLogFor = !sample && !isDemo && analysisData.id ? analysisData.id : null;
  const clarity = t.productClarity;
  // Presentation only: reuse stored evidence, never infer a new signal or level.
  // Preview the first stored paragraph; the complete reading stays in the technical panel.
  const readingReason = shareRead.split(/\n+/).find((line) => line.trim()) || '';
  const readingInvalidation = positivePriceOrNull(invalidationLevel) ?? watchPlan?.invalidation ?? null;
  const readingRisk = readingInvalidation !== null
    ? `${formatPrice(readingInvalidation)}${invalidationNote ? `: ${cleanModelText(invalidationNote)}` : ''}`
    : cleanModelText(invalidationNote) || riskItems[0];

  // WAIT keeps the original explanation → plan → technical reading order.
  // Its clarity guide follows the full reading; active entries retain the header guide.
  // Com o resumo logo acima, "Why this read" so aparece se disser outra coisa.
  const whyRepeatsSummary = isWaitVerdict && readingReason.trim() !== '' && executiveSummary.includes(readingReason.trim());
  const readingGuide = !invalidTradePlan ? (
    <dl aria-label={clarity.readingGuide} className="mt-4 space-y-3 border-t border-[var(--border-subtle)] pt-4 text-sm">
      {!whyRepeatsSummary && (
        <div key="why">
          <dt className="tabular-nums text-xs font-medium text-[var(--text-secondary)]">{clarity.why}</dt>
          <dd className="mt-1 whitespace-pre-wrap leading-relaxed text-[var(--text-primary)]">{readingReason || clarity.reasonMissing}</dd>
        </div>
      )}
      {!watchLayout && (
        <div key="risk">
          <dt className="tabular-nums text-xs font-medium text-[var(--text-secondary)]">{clarity.risk}</dt>
          <dd className="mt-1 whitespace-pre-wrap leading-relaxed text-[var(--text-primary)]">{readingRisk || clarity.riskMissing}</dd>
        </div>
      )}
      <div>
        <dt className="tabular-nums text-xs font-medium text-[var(--text-secondary)]">{clarity.next}</dt>
        <dd className="mt-1 leading-relaxed text-[var(--text-secondary)]">{clarity.reviewConditions}</dd>
      </div>
    </dl>
  ) : null;

  /** A leitura (executiveSummary). No WAIT sobe para logo abaixo do plano. */
  const summaryBlock = (
    <div className="rounded-md border border-[var(--border-emphasis)] bg-[var(--bg-overlay)] p-3">
      {finalDecision && <p data-testid="final-decision" className="mb-2 text-sm font-semibold leading-relaxed text-[var(--text-primary)]">{finalDecision}</p>}
      <h4 className="tk-display mb-2 text-base text-[var(--text-primary)]">{t.analysis.executiveSummary}</h4>
      {(() => {
        const { blocks, footer } = parseSummaryBlocks(executiveSummary);
        if (blocks.length < 2) {
          // Texto corrido (análise quick ou formato antigo) — render original.
          return (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">
              {executiveSummary || r.noSummary}
            </p>
          );
        }
        return (
          <div className="space-y-2">
            {blocks.map((b, i) => (
              <div
                key={i}
                className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
              >
                <p className="mb-0.5 tabular-nums text-xs font-medium text-[var(--signal-buy)]">
                  {localizeDeepLabel(b.label, t.analysis as unknown as Record<string, string>)}
                </p>
                <p className="text-sm leading-relaxed text-[var(--text-primary)]">{b.text}</p>
              </div>
            ))}
            {footer.length > 0 && (
              <p className="pt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                {footer.join(' ')}
              </p>
            )}
          </div>
        );
      })()}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* ── Demo notice (subtle) ────────────────────────────────────── */}
      {isDemo && (
        <div className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-4 py-2.5 text-xs text-[var(--text-secondary)]">
          <span>{r.demoBanner}</span>
          <a href="/dashboard/plans" className="ml-3 flex-shrink-0 font-semibold text-[var(--signal-buy)] hover:underline">
            {r.viewPlans}
          </a>
        </div>
      )}

      <Card className="surface-terminal-elevated rounded-xl fade-in-stagger" style={{ animationDelay: '0ms' }}>
        <CardContent className="p-5 md:p-6">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)] md:gap-4">
            <span className="whitespace-nowrap tabular-nums font-semibold text-[var(--text-primary)]">{symbol}</span>
            <span className="whitespace-nowrap tabular-nums">{timeframe}</span>
            <div
              data-testid="signal-state"
              data-closed={watchClosed ? 'true' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium ${watchClosed ? WATCH_TONE_CLASSES.neutral : signalToneClasses}`}
            >
              <HeaderIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
              <span>{watchClosed ? r.watch.chipClosed : watchLayout ? (watchPlan?.direction === 'long' ? r.watch.chipBuy : r.watch.chipSell) : signalStateLabel(t.analysis, signalState, entrySide(watchPlan, analysisData.recommendation))}</span>
            </div>
            {/* Janela encerrada: o selo fica cinza e o desfecho (o que o mercado fez) vem ao lado, pela regra unica. */}
            {watchClosed && analysisData.watch ? (
              <span key="closed-verdict" data-testid="closed-verdict" className="contents">
                <WatchVerdict watch={analysisData.watch} tone={watchTone(analysisData.watch, now)} caption={false} />
              </span>
            ) : null}
            {strategyFit && (
              <span
                title={r.strategyFitNote}
                className={`whitespace-nowrap rounded-sm border px-2 py-0.5 tabular-nums text-xs font-medium ${STRATEGY_FIT_TONE[strategyFit]}`}
              >
                {r.strategyFitTitle}: {STRATEGY_FIT_LABEL[strategyFit]}
              </span>
            )}
            {!watchLayout && (
              <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-1 ${scenarioToneClasses}`}>
                {t.analysis.bias}:{' '}
                <strong className="font-semibold">{t.scenarioLabels[scenarioMeta.label]}</strong>
              </span>
            )}
            <span className="whitespace-nowrap tabular-nums md:ml-auto">{formattedTimestamp}</span>
            {/* Demo anônima não compartilha: o card leva a marca e o link da
                /accuracy, e um print gerado a partir de dado de demonstração
                circulando como leitura real é a mesma classe de problema que a
                auditoria de 27/07 removeu da vitrine. */}
            {!isDemo && !sample && !invalidTradePlan && <AnalysisShareButton data={shareData} />}
            {detectedSession && (
              <span className="whitespace-nowrap rounded-sm border border-[var(--border-subtle)] px-2 py-0.5 tabular-nums text-xs text-[var(--text-secondary)]">
                {detectedSession.replace('_', ' ')}
              </span>
            )}
          </div>
          {continuationLine && (
            <p data-testid="setup-continuation" className="mt-3 text-sm leading-relaxed text-[var(--text-primary)]">{continuationLine}</p>
          )}
          {watchText && !watchClosed && <p data-testid="watch-headline" className="mt-3 text-sm leading-relaxed text-[var(--text-primary)]">{watchText.headline}</p>}
          {isWaitVerdict && !watchLayout && (
            // Explica o WAIT onde ele aparece: sem isto a pessoa le so a
            // palavra e entende que a ferramenta nao respondeu.
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
              {signalState === 'WATCH' ? r.watchExplain : r.noTradeExplain}
              {waitFlipItems.length > 0 && <span>{` ${r.waitExplainPlan}`}</span>}
            </p>
          )}
          {stateActive && !invalidTradePlan && (
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
              {signalState === 'ARMED' ? clarity.pendingEntry : clarity.entryNow}
            </p>
          )}
          {!isWaitVerdict && readingGuide}
          {strategyFit && (
            // Bloco visível (não só tooltip): a nota anti-claim precisa ser
            // lida, não descoberta em hover. Nunca reescreve nem substitui o
            // veredito acima — só complementa.
            <div className="mt-3 flex flex-wrap items-start gap-x-2 gap-y-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-2 text-xs">
              <span
                className={`whitespace-nowrap rounded-sm border px-2 py-0.5 tabular-nums text-xs font-medium ${STRATEGY_FIT_TONE[strategyFit]}`}
              >
                {r.strategyFitTitle}: {STRATEGY_FIT_LABEL[strategyFit]}
              </span>
              {strategyFitReason && <span className="text-[var(--text-secondary)]">{strategyFitReason}</span>}
              <span className="w-full text-xs text-[var(--text-tertiary)]">{r.strategyFitNote}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {!watchLayout && <ReadModePanel data={readMode} formatPrice={formatPrice} />}

      {/* NO_TRADE com velas reais: os dois lados do preco, calculados pelo codigo. Analise antiga ou print: nada. */}
      {signalState === 'NO_TRADE' && (analysisData.fullResponse?.aiLevel || (analysisData.fullResponse?.dataMode === 'real_data' && analysisData.fullResponse.levelMap)) ? (
        <LevelMapCard
          levelMap={analysisData.fullResponse?.dataMode === 'real_data' ? analysisData.fullResponse.levelMap ?? null : null}
          aiLevel={analysisData.fullResponse?.aiLevel ?? null}
          analysisId={analysisData.id ?? null}
          alerts={alertsEnabled && !sample}
          formatPrice={formatPrice}
        />
      ) : null}

      {invalidTradePlan && (
        <Alert className="border-[var(--signal-sell)] bg-[var(--signal-sell-bg)]" role="alert">
          <AlertTriangle className="h-4 w-4 text-[var(--signal-sell)]" />
          <AlertDescription className="font-semibold text-[var(--signal-sell)]">
            {r.invalidTradePlan}
          </AlertDescription>
        </Alert>
      )}

      {unverifiedMtfAlignment && (
        <Alert className="border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)]" role="alert">
          <AlertTriangle className="h-4 w-4 text-[var(--signal-hold)]" />
          <AlertDescription className="text-[var(--signal-hold)]">
            {t.analysis.mtfEvidenceWarning}
          </AlertDescription>
        </Alert>
      )}

      {isWaitVerdict && !watchLayout && waitFlipItems.length > 0 && (
        // O bloco usava borda + fundo ambar. Problema: o badge HOLD ja e ambar
        // (--signal-hold), entao a tela tinha duas coisas ambar significando
        // coisas diferentes, e em UI de trading ambar le como ALERTA. Isto aqui
        // nao e alerta, e o raciocinio. Superficie neutra, igual aos outros cards.
        <Card
          className={`surface-terminal rounded-xl fade-in-stagger ${waitHasPlan ? 'border border-[var(--border-accent)]' : ''}`}
          style={{ animationDelay: '40ms' }}
        >
          <CardContent className="p-5 md:p-6">
            <p className="tk-display mb-3 flex items-center gap-2 text-[15px]">
              <Lightbulb className="h-4 w-4 text-[var(--tone-warn-2)]" />
              {waitHasPlan ? r.planTitle : r.flipTitle}
            </p>
            <div className="space-y-3 text-sm">
              {waitFlipItems.map((item, idx) => (
                <div key={`${idx}-${item.label}`}>
                  <p className="tabular-nums text-xs font-medium text-[var(--text-secondary)]">
                    {item.label}
                  </p>
                  <p className="mt-0.5 leading-relaxed text-[var(--text-primary)]/85">{item.text}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {watchLayout && watchPlan && watchText && (
        <>
          <WatchPlanCard
            plan={watchPlan}
            levels={watchLevels}
            currentPrice={currentPrice}
            symbol={symbol}
            formatPrice={formatPrice}
            estimated={levelsEstimated}
            watch={analysisData.watch}
            reach={analysisData.fullResponse?.watchReach ?? null}
            condition={watchText.condition}
            actionsFor={alertsEnabled && !sample && !isDemo && analysisData.id ? analysisData.id : null}
            base={base}
            closed={watchClosed}
            now={now}
            footer={entryLogFor && isWatchLevels(watchLevels) && (!watchEntry || watchEntry.plan === 'level') ? (
              <WatchEntryLog analysisId={entryLogFor} plan="level" levels={watchLevels} entry={watchEntry} onChange={setWatchEntry} formatPrice={formatPrice} base={base} closed={watchClosed} />
            ) : null}
          />
          {/* O plano a mercado ao lado do plano no nivel; some com a janela encerrada. */}
          {(!watchClosed || watchEntry?.plan === 'market') && isWatchLevels(fullResponse.marketLevels) ? (
            <MarketPlanCard
              direction={watchPlan.direction}
              levels={fullResponse.marketLevels}
              formatPrice={formatPrice}
              footer={entryLogFor && (!watchEntry || watchEntry.plan === 'market') ? (
                <WatchEntryLog analysisId={entryLogFor} plan="market" levels={fullResponse.marketLevels} entry={watchEntry} onChange={setWatchEntry} formatPrice={formatPrice} base={base} closed={watchClosed} />
              ) : null}
            />
          ) : null}
          {!watchClosed && <Card data-testid="watch-why-changes" className="surface-terminal rounded-xl fade-in-stagger" style={{ animationDelay: '50ms' }}>
            <CardContent className="grid gap-5 p-5 md:grid-cols-2 md:gap-8 md:p-6">
              {watchText.whyWait.length > 0 ? (
                <section key="why" data-testid="watch-why">
                  <h4 className="tk-display text-[15px] text-[var(--text-primary)]">{r.watch.whyWaitTitle}</h4>
                  <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-[var(--text-primary)]/85">
                    {watchText.whyWait.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="mt-[9px] h-1 w-1 flex-shrink-0 rounded-full bg-[var(--text-muted)]" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <section key="changes" data-testid="watch-changes">
                <h4 className="tk-display text-[15px] text-[var(--text-primary)]">{r.watch.changesTitle}</h4>
                <dl className="mt-2 space-y-1.5 text-sm leading-relaxed">
                  <div key="cancel">
                    <dt className="inline font-semibold text-[var(--text-primary)]">{r.watch.cancelledIf}</dt>
                    <dd className="ml-1 inline text-[var(--text-primary)]/85">{watchText.cancelled}</dd>
                  </div>
                  {watchText.oppositeLine ? (
                    <div key="opposite">
                      <dt className="inline font-semibold text-[var(--text-primary)]">{r.watch.opposite}</dt>
                      <dd className="ml-1 inline text-[var(--text-primary)]/85">{watchText.oppositeLine}</dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            </CardContent>
          </Card>}
        </>
      )}

      {isWaitVerdict && (
        <Card className="surface-terminal rounded-xl fade-in-stagger" style={{ animationDelay: '60ms' }}>
          <CardContent className="p-5 md:p-6">
            {summaryBlock}
            {readingGuide}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
        <div className="min-w-0 flex-1">
          <Card className="surface-terminal rounded-xl fade-in-stagger" style={{ animationDelay: '80ms' }}>
            <CardHeader className="pb-3">
              <CardTitle className="tk-display text-lg">{t.analysis.chartAnalyzed}</CardTitle>
            </CardHeader>
            <CardContent>
              {imageUrl ? (
                <img
                  src={String(imageUrl)}
                  alt={t.analysis.chartAnalyzed}
                  className="block h-auto max-h-[70vh] w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] object-contain"
                />
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] text-sm text-[var(--text-secondary)]">
                  {t.analysis.imageUnavailable}
                </div>
              )}
              <AnalysisEvidencePanel evidence={fullResponse.evidence} />
            </CardContent>
          </Card>
        </div>

        {/* Card de niveis so em BUY/SELL. No WAIT ele contradizia o veredito
            (entrada, stop e alvos de um trade que a IA manda nao fazer) e alguem
            podia operar esses precos. O plano de gatilhos acima substitui. */}
        {!isWaitVerdict && (
        <Card
          data-testid="levels-card"
          className="surface-terminal-elevated h-fit w-full rounded-xl fade-in-stagger md:sticky md:top-24 md:w-[300px] md:flex-none"
          style={{ animationDelay: '200ms' }}
        >
          <CardHeader className="pb-2">
            <CardTitle className="tk-display text-lg">{t.analysis.levels}</CardTitle>
            {levelsEstimated && (
              <p data-testid="levels-estimated" className="text-xs text-[var(--text-secondary)]">{r.levelsEstimated}</p>
            )}
            {entryWarnings.map((item) => (
              <p key={item} data-testid={`entry-warning-${item}`} className="text-xs text-[var(--accent-yellow)]">
                {item === 2 ? r.entryWarningLocation : r.entryWarningRoom}
              </p>
            ))}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {signalState === 'ARMED' && entry !== null && !invalidTradePlan && (
              <div data-testid="pending-order" className="rounded-md border border-[var(--border-accent)] bg-[var(--bg-overlay)] p-3 text-xs">
                <p className="tabular-nums text-xs font-medium text-[var(--text-secondary)]">
                  {r.pending.title}
                </p>
                <p className="mt-1 tabular-nums text-sm font-semibold text-[var(--text-primary)]">
                  {r.pending.limitAt.replace('{price}', formatPrice(entry))}
                </p>
                <p className="mt-2 text-[var(--text-secondary)]">{r.pending.cancelIf}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[var(--text-primary)]/85">
                  {pendingInvalidation !== null && <li>{r.pending.cancelClose.replace('{price}', formatPrice(pendingInvalidation))}</li>}
                  {pendingTarget !== null && <li>{r.pending.cancelTarget.replace('{price}', formatPrice(pendingTarget))}</li>}
                  {watchPlan && <li>{r.pending.cancelExpiry.replace('{n}', String(watchPlan.validForCandles))}</li>}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-3">
              <div>
                <p className="text-xs text-[var(--text-secondary)]">{riskRewardLabel}</p>
                <p className={`tabular-nums text-base font-semibold ${riskRewardTone}`}>
                  {riskReward !== null ? `${formatNumber(riskReward, language, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })} : 1` : 'N/A'}
                </p>
                {!invalidTradePlan && tradeTone !== 'hold' && (rrTp1 !== null || rrTp2 !== null) && (
                  <p className="tabular-nums text-[10px] text-[var(--text-secondary)]">
                    {[rrTp1 !== null ? `TP1 ${formatNumber(rrTp1, language, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })}` : null, rrTp2 !== null ? `TP2 ${formatNumber(rrTp2, language, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                {riskRewardLow && (
                  <p className="mt-0.5 tabular-nums text-[10px] font-semibold text-[var(--signal-sell)]">
                    {r.rrBelowIdeal}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-[var(--text-secondary)]">{t.analysis.confluence}</p>
                <p className="tabular-nums text-base font-semibold text-[var(--text-primary)]">
                  {confluence ? confluence.display : 'N/A'}
                </p>
              </div>
            </div>

            <div className="space-y-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <div className="flex items-center justify-between gap-3 rounded px-2 py-1">
                <span className="text-[var(--text-secondary)]">{t.analysis.currentPrice}</span>
                <button
                  type="button"
                  className="tabular-nums font-semibold text-[var(--text-primary)] transition-opacity hover:opacity-80"
                  onClick={() => void copyValue(t.analysis.currentPrice, currentPrice)}
                >
                  {formatPrice(currentPrice)}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded border-t border-[var(--border-subtle)] px-2 py-1">
                <span className="text-[var(--text-secondary)]">● {t.analysis.entry}</span>
                <button
                  type="button"
                  className="tabular-nums font-semibold text-[var(--text-primary)] transition-opacity hover:opacity-80"
                  onClick={() => void copyValue(t.analysis.entry, entry)}
                >
                  {formatPrice(entry)}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded border-t border-[var(--border-subtle)] px-2 py-1">
                <span className="whitespace-nowrap text-[var(--signal-sell)]">▼ {t.analysis.stopLoss}</span>
                <button
                  type="button"
                  className="text-right tabular-nums font-semibold text-[var(--signal-sell)] transition-opacity hover:opacity-80"
                  onClick={() => void copyValue(t.analysis.stopLoss, stopLoss)}
                >
                  {formatPrice(stopLoss)} <span className="tabular-nums text-xs">{formatSignedPercent(stopPercent)}</span>
                  {stopPips !== null && <span className="ml-1 tabular-nums text-[10px] text-[var(--signal-sell)]/70">{stopPips}p</span>}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded border-t border-[var(--border-subtle)] px-2 py-1">
                <span className="text-[var(--signal-buy)]">▲ TP1</span>
                <button
                  type="button"
                  className="text-right tabular-nums font-semibold text-[var(--signal-buy)] transition-opacity hover:opacity-80"
                  onClick={() => void copyValue(t.analysis.tp1, takeProfit1)}
                >
                  {formatPrice(takeProfit1)} <span className="tabular-nums text-xs">{formatPositivePercent(takeProfit1Percent)}</span>
                  {tp1Pips !== null && <span className="ml-1 tabular-nums text-[10px] text-[var(--signal-buy)]/70">{tp1Pips}p</span>}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded border-t border-[var(--border-subtle)] px-2 py-1">
                <span className="text-[var(--signal-buy)]">▲ TP2</span>
                <button
                  type="button"
                  className="text-right tabular-nums font-semibold text-[var(--signal-buy)] transition-opacity hover:opacity-80"
                  onClick={() => void copyValue(t.analysis.tp2, takeProfit2)}
                >
                  {formatPrice(takeProfit2)} <span className="tabular-nums text-xs">{formatPositivePercent(takeProfit2Percent)}</span>
                  {tp2Pips !== null && <span className="ml-1 tabular-nums text-[10px] text-[var(--signal-buy)]/70">{tp2Pips}p</span>}
                </button>
              </div>

              {entryType && (
                <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2 py-1.5 text-xs">
                  <span className="text-[var(--text-secondary)]">{t.analysis.entryType}: </span>
                  <span className="tabular-nums font-medium text-[var(--text-primary)]">{entryType}</span>
                  {/* Trava de coerência: com R/R abaixo do ideal, não exibir "entrar a
                      mercado agora" (contradiz o aviso). Mostra orientação de aguardar recuo. */}
                  {invalidTradePlan ? null : riskRewardLow && entryType.toLowerCase() === 'market' ? (
                    <p className="mt-0.5 text-[var(--signal-hold)]">{r.entryCautionRRLow}</p>
                  ) : (
                    entryCondition && <p className="mt-0.5 text-[var(--text-secondary)]">{entryCondition}</p>
                  )}
                </div>
              )}

              {invalidationLevel !== null && invalidationLevel > 0 && (
                <div className="rounded border border-[var(--signal-sell)]/30 bg-[var(--signal-sell-bg)] px-2 py-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setShowInvalidation((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 text-left"
                    aria-expanded={showInvalidation}
                  >
                    <span>
                      <span className="text-[var(--signal-sell)]">{t.analysis.invalidation}: </span>
                      <span className="tabular-nums font-semibold text-[var(--signal-sell)]">{formatPrice(invalidationLevel)}</span>
                    </span>
                    {invalidationNote && (
                      <ChevronDown
                        className={`h-3.5 w-3.5 flex-shrink-0 text-[var(--signal-sell)] transition-transform ${showInvalidation ? 'rotate-180' : ''}`}
                      />
                    )}
                  </button>
                  {showInvalidation && invalidationNote && (
                    <p className="mt-1 text-[var(--signal-sell)]/70">{invalidationNote}</p>
                  )}
                </div>
              )}

              {sessionNote && (
                <p className="rounded-sm bg-[var(--bg-overlay)] px-2 py-1.5 text-xs text-[var(--text-secondary)]">
                  {sessionNote}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        )}
      </div>

      {/* O que o mercado fez com o plano 48h depois (sweeper). So plano real
          da pessoa: exemplo fixo tem o proprio "depois" e demo nao e medida. */}
      {!sample && !isDemo && !isWaitVerdict && !invalidTradePlan && analysisData.id && analysisData.createdAt && (
        <MarketResultCard
          analysisId={analysisData.id}
          createdAt={analysisData.createdAt}
          marketOutcome={analysisData.marketOutcome}
          marketTp1R={analysisData.marketTp1R}
          marketTp2Hit={analysisData.marketTp2Hit}
        />
      )}

      <Card className="surface-terminal rounded-xl fade-in-stagger" style={{ animationDelay: '140ms' }}>
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="technical-panel" className="border-none">
            <AccordionTrigger className="px-5 py-4 tk-display text-lg hover:no-underline md:px-6">
              <span className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-[var(--text-secondary)]" />
                {t.analysis.technicalPanel}
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5 md:px-6 md:pb-6">
              <Accordion
                type="multiple"
                defaultValue={['live-market', 'calendar', 'sessions', 'market-structure', 'technical-analysis', 'risk-factors']}
                className="w-full"
              >
                {/* ── Contexto ao vivo (cripto) ──────────────────────── */}
                {hasLiveMarket && liveMarket && (
                  <AccordionItem value="live-market" className="border-[var(--border-subtle)]">
                    <AccordionTrigger className="tk-display text-[15px] hover:no-underline">
                      <span className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-[var(--signal-buy)]" />
                        {t.analysis.liveMarket.title}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        {liveMarket.fundingRatePercent !== null && (
                          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-2">
                            <p className="text-[var(--text-secondary)]">{t.analysis.liveMarket.fundingRate}</p>
                            <p className={`tabular-nums font-semibold ${liveMarket.fundingRatePercent >= 0 ? 'text-[var(--signal-buy)]' : 'text-[var(--signal-sell)]'}`}>
                              {`${liveMarket.fundingRatePercent >= 0 ? '+' : ''}${formatNumber(liveMarket.fundingRatePercent, language, { minimumFractionDigits: 4, maximumFractionDigits: 4, useGrouping: false })}%`}
                            </p>
                          </div>
                        )}
                        {liveMarket.longShortRatio !== null && (
                          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-2">
                            <p className="text-[var(--text-secondary)]">{t.analysis.liveMarket.longShort}</p>
                            <p className="tabular-nums font-semibold text-[var(--text-primary)]">
                              {formatNumber(liveMarket.longShortRatio, language, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })}
                              {liveMarket.longAccountPercent !== null && liveMarket.shortAccountPercent !== null && (
                                <span className="ml-1 text-[10px] text-[var(--text-secondary)]">
                                  ({liveMarket.longAccountPercent}% / {liveMarket.shortAccountPercent}%)
                                </span>
                              )}
                            </p>
                          </div>
                        )}
                        {liveMarket.openInterest !== null && (
                          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-2">
                            <p className="text-[var(--text-secondary)]">{t.analysis.liveMarket.openInterest}</p>
                            <p className="tabular-nums font-semibold text-[var(--text-primary)]">
                              {liveMarket.openInterest.toLocaleString(LOCALES[language], { maximumFractionDigits: 0 })}
                            </p>
                          </div>
                        )}
                        {liveMarket.fearGreedValue !== null && (
                          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-2">
                            <p className="text-[var(--text-secondary)]">{t.analysis.liveMarket.fearGreed}</p>
                            <p className={`tabular-nums font-semibold ${liveMarket.fearGreedValue >= 55 ? 'text-[var(--signal-buy)]' : liveMarket.fearGreedValue <= 45 ? 'text-[var(--signal-sell)]' : 'text-[var(--signal-hold)]'}`}>
                              {liveMarket.fearGreedValue}
                              {liveMarket.fearGreedClassification && (
                                <span className="ml-1 text-[10px] text-[var(--text-secondary)]">{liveMarket.fearGreedClassification}</span>
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                      {liveReadings.length > 0 && (
                        <ul className="mt-2 space-y-1 border-t border-[var(--border-subtle)] pt-2">
                          {liveReadings.map((r, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[11px] text-[var(--text-secondary)]">
                              <span className="mt-0.5 flex-shrink-0 text-[var(--signal-hold)]">▸</span>
                              <span>{r}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {liveMarket.binanceSymbol && (
                        <p className="mt-2 text-[10px] text-[var(--text-secondary)]">
                          Binance {liveMarket.binanceSymbol} · alternative.me
                        </p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )}

                {/* ── Eventos Econômicos ─────────────────────────────── */}
                {!sample && (
                <AccordionItem value="calendar" className="border-[var(--border-subtle)]">
                    <AccordionTrigger className="tk-display text-[15px] hover:no-underline">
                      <span className="flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-[var(--tone-warn-2)]" />
                        {t.analysis.economicEvents}
                        {calEvents.some((e) => e.impact === 'High' && (e.minutesUntil ?? 999) <= 60 && eventInPlan(e.minutesUntil)) && (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 tabular-nums text-xs font-medium text-[var(--tone-warn-2)]">
                            {r.calHighImpactBadge}
                          </span>
                        )}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      {calLoading ? (
                        <p className="text-xs text-[var(--text-secondary)]">{r.calChecking}</p>
                      ) : calUnreliable ? (
                        // NUNCA mostrar o "✅ limpo" aqui: quando a fonte falhou,
                        // events==[] não significa "sem notícia", significa "não
                        // sabemos". Bug real encontrado em 25/08/2026 — a tela
                        // afirmava tranquilidade que o backend não tinha checado.
                        <p className="text-xs text-[var(--tone-warn-2)]">{r.calUnavailable}</p>
                      ) : calEvents.length === 0 ? (
                        <p className="text-xs text-[var(--text-secondary)] opacity-60">
                          {t.analysis.noHighImpactEvents}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {calEvents.map((ev, i) => {
                            const isHigh = ev.impact === 'High';
                            const isSoon = (ev.minutesUntil ?? 999) <= 30;
                            const isJustHappened = (ev.minutesUntil ?? 0) < 0;
                            const borderColor = isHigh ? 'border-amber-500/40' : 'border-[var(--border-subtle)]';
                            const bgColor = isHigh ? 'bg-amber-500/6' : 'bg-[var(--bg-elevated)]';

                            let timeLabel = '';
                            if (isJustHappened) {
                              timeLabel = r.calAgo.replace('{t}', `${Math.abs(ev.minutesUntil ?? 0)}min`);
                            } else if ((ev.minutesUntil ?? 0) < 60) {
                              timeLabel = r.calIn.replace('{t}', `${ev.minutesUntil}min`);
                            } else {
                              const h = Math.floor((ev.minutesUntil ?? 0) / 60);
                              const m = (ev.minutesUntil ?? 0) % 60;
                              timeLabel = r.calIn.replace('{t}', `${h}h${m > 0 ? ` ${m}min` : ''}`);
                            }

                            return (
                              <div
                                key={i}
                                className={`rounded-md border px-3 py-2 text-xs ${borderColor} ${bgColor}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-1.5">
                                    {isHigh && isSoon && <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-[var(--tone-warn-2)]" />}
                                    <span className={`font-medium ${isHigh ? 'text-[var(--tone-warn-1)]' : 'text-[var(--text-primary)]'}`}>
                                      {ev.title}
                                    </span>
                                  </div>
                                  <span className={`flex-shrink-0 rounded px-1.5 py-0.5 tabular-nums font-semibold ${
                                    isJustHappened
                                      ? 'bg-[var(--bg-overlay)] text-[var(--text-secondary)]'
                                      : isSoon && isHigh
                                        ? 'bg-amber-500/20 text-[var(--tone-warn-2)]'
                                        : 'bg-[var(--bg-overlay)] text-[var(--text-secondary)]'
                                  }`}>
                                    {timeLabel}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center gap-3 text-[var(--text-secondary)]">
                                  <span className="rounded bg-[var(--bg-overlay)] px-1.5 py-0.5 tabular-nums font-semibold">
                                    {ev.country}
                                  </span>
                                  <span className={`font-medium ${isHigh ? 'text-[var(--tone-warn-2)]' : 'text-[var(--text-secondary)]'}`}>
                                    {ev.impact === 'High' ? r.highImpact : r.medImpact}
                                  </span>
                                  {ev.time && ev.time !== 'All Day' && (
                                    <span>{ev.time} ET</span>
                                  )}
                                  {isHigh && !isJustHappened && eventInPlan(ev.minutesUntil) && (
                                    <span className="text-[var(--tone-warn-2)]">
                                      {r.calMayAffect}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )}

                {watchLayout && readMode.location && (
                  <AccordionItem value="where-price" className="border-[var(--border-subtle)]">
                    <AccordionTrigger className="tk-display text-[15px] hover:no-underline">
                      <span className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-[var(--text-secondary)]" />
                        {r.readMode.whereTitle}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <WherePriceIs data={readMode} formatPrice={formatPrice} />
                    </AccordionContent>
                  </AccordionItem>
                )}

                <AccordionItem value="sessions" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="tk-display text-[15px] hover:no-underline">
                    <span className="flex items-center gap-2">
                      <Minus className="h-4 w-4 text-[var(--text-secondary)]" />
                      {t.analysis.marketSessions}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {openSessions.map((s) => (
                        <span
                          key={s.abbr}
                          className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 tabular-nums text-xs ${
                            s.open
                              ? 'border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] text-[var(--signal-buy)]'
                              : 'border-[var(--border-subtle)] text-[var(--text-secondary)] opacity-40'
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${s.open ? 'bg-[var(--signal-buy)]' : 'bg-[var(--text-secondary)]'}`} />
                          {s.abbr} · {sessionLabels[s.abbr] ?? s.name}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-[var(--text-secondary)] opacity-50">
                      {t.analysis.sessionNote}
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="market-structure" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="tk-display text-[15px] hover:no-underline">
                    <span className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-[var(--text-secondary)]" />
                      {t.analysis.marketStructure}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    {/* Grade rótulo/valor, o mesmo desenho dos Operation Levels.
                        Antes eram <p> soltos com "Rótulo: valor" no meio da
                        frase: o olho não tinha coluna para descer. */}
                    <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-2">
                      {structureRows.map((row) => (
                        <div key={row.key} className="bg-[var(--bg-elevated)] px-3 py-2.5">
                          <dt className="tabular-nums text-xs text-[var(--text-tertiary)]">
                            {row.label}
                          </dt>
                          <dd
                            className={`mt-1 text-sm leading-relaxed ${
                              row.tone === 'buy'
                                ? 'text-[var(--signal-buy)]'
                                : row.tone === 'sell'
                                  ? 'text-[var(--signal-sell)]'
                                  : row.tone === 'hold'
                                    ? 'text-[var(--signal-hold)]'
                                    : 'text-[var(--text-primary)]'
                            }`}
                          >
                            {row.value}
                          </dd>
                        </div>
                      ))}
                    </dl>

                    {/* Checklist. Dois critérios é o piso para valer a pena
                        estruturar; abaixo disso o parágrafo cru é mais honesto
                        do que uma lista de um item só. */}
                    {checklist.items.length >= 2 ? (
                      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2">
                          <span className="tabular-nums text-xs text-[var(--text-tertiary)]">
                            {t.analysis.structureValidation}
                          </span>
                          {checklist.scoreMismatch ? (
                            <span className="tabular-nums text-xs text-[var(--signal-hold)]">
                              {t.analysis.checklistScoreMismatch}
                            </span>
                          ) : checklist.score ? (
                            <span className="tabular-nums text-xs text-[var(--text-primary)]">
                              {checklist.score}
                            </span>
                          ) : null}
                        </div>
                        <ul className="divide-y divide-[var(--border-subtle)]">
                          {checklist.items.map((item, index) => (
                            <li
                              key={`${item.label}-${index}`}
                              className="flex items-start gap-2.5 px-3 py-2.5 text-sm"
                            >
                              <span
                                className={`mt-px flex-shrink-0 tabular-nums text-xs ${
                                  item.notApplicable ? 'text-[var(--text-tertiary)]' : item.warning ? 'text-[var(--signal-hold)]' : item.ok ? 'text-[var(--signal-buy)]' : 'text-[var(--signal-sell)]'
                                }`}
                              >
                                {item.notApplicable ? '-' : item.warning ? '!' : item.ok ? '✓' : '✕'}
                              </span>
                              <span className="text-[var(--text-secondary)] leading-relaxed">
                                {item.label ? (
                                  <strong className="font-medium text-[var(--text-primary)]">{item.label}</strong>
                                ) : null}
                                {item.detail ? <span>{`${item.label ? ' ' : ''}${item.detail}`}</span> : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : structureValidation ? (
                      <p className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-sm leading-relaxed text-[var(--text-secondary)]">
                        {structureValidation}
                      </p>
                    ) : null}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="technical-analysis" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="tk-display text-[15px] hover:no-underline">
                    <span className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-[var(--text-secondary)]" />
                      {t.analysis.technicalAnalysis}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">
                    {technicalAnalysis}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="patterns" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="tk-display text-[15px] hover:no-underline">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[var(--text-secondary)]" />
                      {t.analysis.identifiedPatterns}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {/* Lista, não etiqueta. Cada padrão é uma frase inteira, e
                        etiqueta de largura variável com uma frase dentro vira
                        colcha de retalhos — era o que estava na tela. */}
                    {patternItems.length > 0 ? (
                      <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
                        {patternItems.map((item, index) => (
                          <li key={`${item}-${index}`} className="flex items-start gap-2.5">
                            <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-[var(--text-muted)]" />
                            <span className="leading-relaxed">{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-[var(--text-secondary)]">{t.analysis.noPatterns}</p>
                    )}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="indicators" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="tk-display text-[15px] hover:no-underline">
                    <span className="flex items-center gap-2">
                      <SlidersVertical className="h-4 w-4 text-[var(--text-secondary)]" />
                      {t.analysis.keyIndicators}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {keyIndicatorsText ? (
                      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{keyIndicatorsText}</p>
                    ) : (
                      <p className="text-sm text-[var(--text-secondary)]">{t.analysis.noIndicators}</p>
                    )}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="risk-factors" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="tk-display text-[15px] hover:no-underline">
                    <span className="flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-[var(--signal-sell)]" />
                      {t.analysis.riskFactors}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {riskItems.length > 0 ? (
                      <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
                        {riskItems.map((item, index) => (
                          <li key={`${item}-${index}`} className="flex items-start gap-2">
                            <span className="mt-0.5 flex-shrink-0 text-[var(--signal-sell)]">●</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-[var(--text-secondary)]">{t.analysis.noRiskFactors}</p>
                    )}
                  </AccordionContent>
                </AccordionItem>

                {(partialExitStrategy || hasStructuredExit) && (
                  <AccordionItem value="exit-plan" className="border-[var(--border-subtle)]">
                    <AccordionTrigger className="tk-display text-[15px] hover:no-underline">
                      <span className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-[var(--signal-buy)]" />
                        {t.analysis.partialExit}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-sm leading-relaxed text-[var(--text-secondary)]">
                      {hasStructuredExit && (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {tp1ClosePercent !== null && (
                            <span className="rounded-full border border-[var(--signal-buy)]/30 bg-[var(--signal-buy-bg)] px-2.5 py-1 tabular-nums text-xs text-[var(--signal-buy)]">
                              TP1: {Math.round(tp1ClosePercent)}%
                            </span>
                          )}
                          {tp2ClosePercent !== null && (
                            <span className="rounded-full border border-[var(--signal-buy)]/30 bg-[var(--signal-buy-bg)] px-2.5 py-1 tabular-nums text-xs text-[var(--signal-buy)]">
                              TP2: {Math.round(tp2ClosePercent)}%
                            </span>
                          )}
                          {breakevenTrigger && (
                            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                              {t.analysis.breakeven}: {breakevenTrigger}
                            </span>
                          )}
                        </div>
                      )}
                      {partialExitStrategy && (
                        <div className="rounded-md border border-[var(--signal-buy)]/20 bg-[var(--signal-buy-bg)] p-3">
                          {partialExitStrategy}
                        </div>
                      )}
                      <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                        {t.analysis.exitPlanOptional}
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                )}

                {alternativeScenario && !watchText?.planBRepeats && (
                  <AccordionItem value="plan-b" className="border-[var(--border-subtle)]">
                    <AccordionTrigger className="tk-display text-[15px] hover:no-underline">
                      <span className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-[var(--tone-warn-2)]" />
                        {t.analysis.planB}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-sm leading-relaxed text-[var(--text-secondary)]">
                      <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                        {alternativeScenario}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}

                {whyNotOpposite && (
                  <AccordionItem value="opposite" className="border-[var(--border-subtle)]">
                    <AccordionTrigger className="tk-display text-[15px] hover:no-underline">
                      <span className="flex items-center gap-2">
                        <CircleHelp className="h-4 w-4 text-[var(--text-secondary)]" />
                        {t.analysis.whyNotOpposite}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-sm leading-relaxed text-[var(--text-secondary)]">
                      {whyNotOpposite}
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>

              {/* No WAIT a calculadora sairia com a entrada e o stop de um trade
                  que o veredito manda NAO fazer; e a leitura ja subiu para o topo. */}
              {!isWaitVerdict && (
                <>
                  <div className="mt-4">
                    {!invalidTradePlan && tradeTone !== 'hold' && <PositionSizingCalculator entry={entry} stopLoss={stopLoss} />}
                  </div>

                  <div className="mt-4 border-t-2 border-[var(--border-emphasis)] pt-4">{summaryBlock}</div>
                </>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
    </div>
  );
};

export default AnalysisResult;
