import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, Loader2, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import type { SignalStateCanonical } from '@/lib/trading-ui';

/**
 * Card de compartilhamento da análise.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE (regra do repo: arquivo novo precisa de
 * justificativa) ──────────────────────────────────────────────────────────
 * O `AnalysisResult.tsx` já tem 1.500 linhas. O desenho do card é ~250 linhas
 * de Canvas 2D que não têm nada a ver com renderizar a tela da análise, e o
 * `wrapText` é função pura que dá para testar sem navegador. Componente e
 * desenho moram juntos porque são a MESMA coisa (o card); separá-los criaria
 * um `.ts` de 250 linhas com um único consumidor.
 *
 * ── DECISÕES QUE NÃO PODEM SER DESFEITAS SEM PENSAR ──────────────────────
 *
 * 1. **O card NÃO mostra entry, stop nem alvo.** De propósito. Um post com
 *    níveis de preço abertos lê como SINAL, e o posicionamento inteiro do
 *    produto ("segunda opinião, não sinal") foi construído em duas sprints de
 *    auditoria de claim. O card mostra a LEITURA e o porquê. Quem quiser os
 *    níveis abre o painel.
 *
 * 2. **O texto DENTRO da imagem é em inglês, sempre**, mesmo com a interface
 *    em outro idioma. Duas razões: a imagem é artefato PÚBLICO (mesma regra do
 *    site) e texto de vitrine em 6 idiomas é exatamente onde este projeto já
 *    produziu claim falso três vezes. Um idioma na imagem = uma superfície
 *    para conferir. Os BOTÕES, que são interface, seguem o i18n normal.
 *
 * 3. **WAIT/HOLD ganha card igual aos outros.** ~39% das análises são WAIT, e
 *    "a IA disse para não operar, e aqui está o porquê" é o único conteúdo
 *    desta categoria que nenhum concorrente publica. Esconder o WAIT do
 *    compartilhamento transformaria a ferramenta em máquina de print de sinal
 *    e o produto passaria a mentir por omissão.
 *
 * 4. **Zero dependência nova.** Canvas 2D nativo. `html2canvas`/`satori` fariam
 *    isto em menos linhas, mas o lockfile não atualiza na máquina do dono
 *    (restrição registrada no CLAUDE.md).
 *
 * 5. O gráfico do usuário NÃO entra no card. A imagem não é persistida
 *    (`Analysis.imageUrl` é opcional e o backend parou de salvar para economizar
 *    espaço), então card com print funcionaria na hora da análise e quebraria
 *    ao recompartilhar pelo histórico. Card sem print funciona sempre.
 */

// ── Paleta: espelha os tokens de `styles/trading-tokens.css` ────────────────
// Canvas não lê variável CSS, então os valores são literais aqui. Se um token
// mudar lá, mude aqui junto — divergência aparece como card fora da identidade.
const C = {
  bg: '#050508',
  text: '#fafafa',
  muted: '#888888',
  faint: '#4a4a4a',
  line: 'rgba(255, 255, 255, 0.08)',
  track: 'rgba(255, 255, 255, 0.08)',
} as const;

const TONE = {
  buy: { fg: '#00ff88', bg: 'rgba(0, 255, 136, 0.12)', border: 'rgba(0, 255, 136, 0.30)' },
  sell: { fg: '#ff4444', bg: 'rgba(255, 68, 68, 0.12)', border: 'rgba(255, 68, 68, 0.30)' },
  hold: { fg: '#ffb800', bg: 'rgba(255, 184, 0, 0.14)', border: 'rgba(255, 184, 0, 0.32)' },
} as const;

const SANS = "'Geist', system-ui, sans-serif";
const MONO = "'Geist Mono', ui-monospace, monospace";

const W = 1200;
const H = 675;
const PAD = 64;
const SCALE = 2; // 2400x1350 — nítido em tela retina e no feed do X.

export interface ShareCardData {
  symbol: string;
  timeframe: string;
  /** Leitura direcional mostrada no card, independente da ação. */
  scenario: string;
  /** Ação operacional separada: BUY | SELL | HOLD/WAIT. */
  action: string;
  /** Estado do copiloto: o rótulo da linha abaixo do cenário. */
  state: SignalStateCanonical;
  /** Cor do cenário: direção só em ENTER_NOW/ARMED, neutra em WATCH/NO_TRADE. */
  tone: 'buy' | 'sell' | 'hold';
  /** A leitura em prosa — o "porquê". É o que o card existe para mostrar. */
  read: string;
  /** Só em WAIT: o que faria a IA mudar de ideia. Omitido se não houver. */
  flip?: string | null;
  date: Date;
}

/**
 * O cenário e a ação são conceitos distintos: WAIT pode ter viés comprador.
 * Ambos os rótulos são compartilhados entre a imagem e o texto do post.
 */
export function publicScenario(scenario: string): string {
  const value = String(scenario || '').trim().toUpperCase();
  return value === 'BULLISH' || value === 'BEARISH' ? value : 'NEUTRAL';
}

export function publicAction(action: string): string {
  const value = String(action || '').trim().toUpperCase();
  return value === 'BUY' || value === 'SELL' ? value : 'WAIT';
}

const PUBLIC_STATE: Record<SignalStateCanonical, string> = {
  ENTER_NOW: 'ENTER NOW',
  ARMED: 'PENDING ORDER',
  WATCH: 'WATCH',
  NO_TRADE: 'NO TRADE',
};

/** Rótulo público do estado, sempre em inglês (a imagem e o post são públicos); ENTER_NOW com a direção. */
export function publicState(state: SignalStateCanonical, action: string): string {
  const side = publicAction(action);
  if (state === 'ENTER_NOW' && side !== 'WAIT') return `${side} NOW`;
  return PUBLIC_STATE[state] ?? PUBLIC_STATE.NO_TRADE;
}

/**
 * Quebra texto em linhas que cabem em `maxWidth`, com no máximo `maxLines`.
 * Estourou? A última linha recebe reticências. Palavra maior que a linha
 * inteira é cortada no meio em vez de vazar para fora do card.
 *
 * Exportada porque é pura: dá para testar sem navegador (só precisa de um
 * `measureText`), e é a única parte do desenho onde um bug fica invisível —
 * texto vazando para fora do canvas não gera erro nenhum.
 */
export function wrapText(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = '';

  const pushTruncated = (line: string) => {
    let candidate = line;
    while (candidate.length > 1 && measure(`${candidate}…`) > maxWidth) {
      candidate = candidate.slice(0, -1);
    }
    lines.push(`${candidate.trimEnd()}…`);
  };

  const fit = (word: string): string => {
    let head = word;
    while (head.length > 1 && measure(head) > maxWidth) head = head.slice(0, -1);
    return head;
  };

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (measure(next) <= maxWidth) {
      current = next;
      continue;
    }

    // Palavra sozinha maior que a linha inteira: corta no meio.
    if (!current) current = fit(word);

    if (lines.length === maxLines - 1) {
      pushTruncated(current);
      return lines;
    }

    lines.push(current);
    current = fit(word);
  }

  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

/**
 * Desenha texto com espaçamento entre letras, caractere a caractere.
 *
 * `ctx.letterSpacing` resolveria em uma linha, mas não existe no Firefox — e
 * quando não existe é ignorado em silêncio, então o card sairia com os rótulos
 * apertados só em um navegador e ninguém veria.
 */
function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
): number {
  let cursor = x;
  for (const char of text) {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + spacing;
  }
  return Math.max(0, cursor - x - spacing);
}

function measureTracked(ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
  let total = 0;
  for (const char of text) total += ctx.measureText(char).width + spacing;
  return Math.max(0, total - spacing);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Rótulo minúsculo, mono, caixa alta e espaçado. */
function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): number {
  ctx.font = `500 11px ${MONO}`;
  ctx.fillStyle = C.muted;
  return drawTracked(ctx, text.toUpperCase(), x, y, 1.6);
}

/**
 * Desenha o card e devolve o PNG.
 *
 * `document.fonts.ready` não é opcional: sem ele o Canvas desenha com a fonte
 * de fallback do sistema se a Geist ainda não chegou, e o card sai com outra
 * tipografia sem erro nenhum — falha silenciosa, a pior categoria.
 */
export async function drawShareCard(data: ShareCardData): Promise<Blob> {
  try {
    await document.fonts.ready;
  } catch {
    /* Sem Font Loading API: segue com o fallback do sistema. */
  }

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  const tone = TONE[data.tone] ?? TONE.hold;

  // ── Fundo ────────────────────────────────────────────────────────────────
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Brilho superior na cor do veredito: dá identidade sem escrever nada.
  const glow = ctx.createRadialGradient(W / 2, -120, 0, W / 2, -120, 620);
  glow.addColorStop(0, tone.bg);
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 380);

  // Régua no topo, cor do veredito.
  ctx.fillStyle = tone.fg;
  ctx.fillRect(0, 0, W, 3);

  // ── Cabeçalho ────────────────────────────────────────────────────────────
  ctx.font = `700 31px ${SANS}`;
  ctx.fillStyle = C.text;
  ctx.fillText('tickrify', PAD, 76);
  const brandWidth = ctx.measureText('tickrify').width;
  drawLabel(ctx, 'AI chart analysis', PAD + brandWidth + 16, 74);

  ctx.font = `400 13px ${MONO}`;
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'right';
  ctx.fillText(
    data.date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
    W - PAD,
    74,
  );
  ctx.textAlign = 'left';

  ctx.fillStyle = C.line;
  ctx.fillRect(PAD, 104, W - PAD * 2, 1);

  // ── Ativo ────────────────────────────────────────────────────────────────
  ctx.font = `600 46px ${MONO}`;
  ctx.fillStyle = C.text;
  const symbol = data.symbol.slice(0, 14);
  ctx.fillText(symbol, PAD, 172);
  const symbolWidth = ctx.measureText(symbol).width;

  ctx.font = `400 22px ${MONO}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(data.timeframe.slice(0, 10), PAD + symbolWidth + 18, 172);

  // ── Veredito ──────────────────────────────────────────────────────
  const pillY = 206;
  const pillH = 58;
  const verdictLabel = publicScenario(data.scenario);
  ctx.font = `700 27px ${MONO}`;
  const pillW = measureTracked(ctx, verdictLabel, 3) + 52;

  roundedRect(ctx, PAD, pillY, pillW, pillH, 10);
  ctx.fillStyle = tone.bg;
  ctx.fill();
  ctx.strokeStyle = tone.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = tone.fg;
  drawTracked(ctx, verdictLabel, PAD + 26, pillY + 39, 3);

  ctx.font = `600 16px ${MONO}`;
  ctx.fillStyle = tone.fg;
  ctx.fillText(publicState(data.state, data.action), PAD, pillY + pillH + 25);

  // ── Hora da leitura ──────────────────────────────────────────────────────
  // Era a "confiança" em %, que saiu do produto em 30/09/2026: ela era pedida
  // ao modelo como chance de bater o TP1 e, medida em produção, não separou
  // nada (39,6% x 39,7%). No lugar vai a hora exata da leitura, em UTC: é o
  // que deixa quem vê o post conferir depois o que o mercado fez.
  const readAt = `${data.date.toISOString().slice(11, 16)} UTC`;

  ctx.font = `500 11px ${MONO}`;
  ctx.fillStyle = C.muted;
  drawTracked(ctx, 'READ AT', W - PAD - measureTracked(ctx, 'READ AT', 1.6), pillY + 12, 1.6);

  ctx.textAlign = 'right';
  ctx.font = `700 38px ${SANS}`;
  ctx.fillStyle = C.text;
  ctx.fillText(readAt, W - PAD, pillY + 56);
  ctx.textAlign = 'left';

  // ── A leitura ────────────────────────────────────────────────────────────
  // Mede tudo ANTES de desenhar para centralizar o bloco entre o cabeçalho e o
  // rodapé. Sem isto, uma leitura de duas linhas deixava ~180px de vazio no pé
  // do card e o post parecia inacabado — e o tamanho do texto varia a cada
  // análise, então não existe um `y` fixo que sirva para todas.
  const bodyWidth = W - PAD * 2;
  const AREA_TOP = 320;
  const AREA_BOTTOM = H - 98;

  // Quantas linhas cabem, em vez de um teto fixo. O teto era 4 e cortava a
  // leitura com "…" deixando ~90px de vazio abaixo — visto no primeiro card
  // real gerado (XAUUSD 5m, 02/09/2026): o corte comeu justamente a parte
  // acionável da frase, com espaço sobrando na imagem.
  //
  // As constantes de altura moram aqui e não espalhadas pelo desenho: LABEL_H,
  // READ_LH e as do flip são as MESMAS usadas para avançar o `y` mais abaixo.
  // Se divergirem, o bloco é medido com um número e desenhado com outro, e o
  // texto passa por cima do rodapé sem erro nenhum.
  const LABEL_H = 30;
  const READ_LH = 33;
  const FLIP_GAP = 34;
  const FLIP_LABEL_H = 26;
  const FLIP_LH = 28;
  const AREA_HEIGHT = AREA_BOTTOM - AREA_TOP;

  ctx.font = `400 21px ${SANS}`;
  const maxReadLines = Math.max(1, Math.floor((AREA_HEIGHT - LABEL_H) / READ_LH));
  const readLines = wrapText(
    (text) => ctx.measureText(text).width,
    data.read || 'No written read available for this analysis.',
    bodyWidth,
    maxReadLines,
  );

  // A leitura tem prioridade e NUNCA é encurtada para o "what would change it"
  // caber: ela é o motivo de o card existir. O flip entra com o que sobrou, e
  // só se sobrar espaço para as DUAS linhas dele — flip de uma linha só sai
  // truncado no meio da condição, o que é pior do que não ter flip nenhum.
  const flip = String(data.flip || '').trim();
  const spaceLeft = AREA_HEIGHT - LABEL_H - readLines.length * READ_LH;
  const flipFits = spaceLeft >= FLIP_GAP + FLIP_LABEL_H + FLIP_LH * 2;

  ctx.font = `400 18px ${SANS}`;
  const flipLines =
    flip && flipFits
      ? wrapText((text) => ctx.measureText(text).width, flip, bodyWidth, 2)
      : [];

  const blockHeight =
    LABEL_H +
    readLines.length * READ_LH +
    (flipLines.length ? FLIP_GAP + FLIP_LABEL_H + flipLines.length * FLIP_LH : 0);
  let y = AREA_TOP + Math.max(0, (AREA_HEIGHT - blockHeight) / 2);

  drawLabel(ctx, 'The read', PAD, y);
  y += LABEL_H;

  ctx.font = `400 21px ${SANS}`;
  ctx.fillStyle = 'rgba(250, 250, 250, 0.90)';
  for (const line of readLines) {
    ctx.fillText(line, PAD, y + 16);
    y += READ_LH;
  }

  if (flipLines.length) {
    y += FLIP_GAP;
    drawLabel(ctx, 'What would change it', PAD, y);
    y += FLIP_LABEL_H;

    ctx.font = `400 18px ${SANS}`;
    ctx.fillStyle = 'rgba(250, 250, 250, 0.62)';
    for (const line of flipLines) {
      ctx.fillText(line, PAD, y + 14);
      y += FLIP_LH;
    }
  }

  // ── Rodapé ───────────────────────────────────────────────────────────────
  ctx.fillStyle = C.line;
  ctx.fillRect(PAD, H - 98, W - PAD * 2, 1);

  ctx.font = `400 16px ${SANS}`;
  ctx.fillStyle = C.muted;
  ctx.fillText('Not a signal. The final call is yours.', PAD, H - 50);

  // "tickrify.com" cinza + "/accuracy" verde: o link é o convite a conferir os
  // números publicados, que é o único argumento que o concorrente não copia.
  ctx.font = `500 15px ${MONO}`;
  const domain = 'tickrify.com';
  const path = '/accuracy';
  const pathWidth = ctx.measureText(path).width;
  const domainWidth = ctx.measureText(domain).width;
  ctx.fillStyle = C.faint;
  ctx.fillText(domain, W - PAD - pathWidth - domainWidth, H - 50);
  ctx.fillStyle = TONE.buy.fg;
  ctx.fillText(path, W - PAD - pathWidth, H - 50);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('canvas.toBlob returned null'))),
      'image/png',
    );
  });
}

/**
 * Texto que acompanha o post no X.
 *
 * SEMPRE em inglês e SEM número de performance. É texto público, e o repo já
 * gastou uma sprint inteira removendo alegação não verificável da vitrine —
 * texto pré-preenchido é exatamente onde uma delas voltaria sem revisão.
 * Descreve o que a IA leu; não promete resultado.
 */
export function buildShareText(data: ShareCardData): string {
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

function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'analysis';
}

export function ShareCardButton({ data }: { data: ShareCardData }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const s = t.analysis.share;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewUrl = useRef<string | null>(null);

  // Object URL é memória retida pelo documento até ser revogado à mão. Sem
  // isto, cada abertura do card vaza um PNG de algumas centenas de KB pela
  // sessão inteira.
  const releasePreview = useCallback(() => {
    if (previewUrl.current) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    }
  }, []);

  useEffect(() => releasePreview, [releasePreview]);

  const handleOpen = useCallback(async () => {
    setBusy(true);
    try {
      const png = await drawShareCard(data);
      releasePreview();
      previewUrl.current = URL.createObjectURL(png);
      setPreview(previewUrl.current);
      setBlob(png);
      setOpen(true);
      track('analysis_shared', { step: 'opened', verdict: data.action });
    } catch {
      toast({ title: s.failed, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }, [data, releasePreview, s.failed, toast]);

  const copyToClipboard = useCallback(
    async (successTitle: string): Promise<void> => {
      if (!blob) return;
      try {
        // ClipboardItem de imagem não existe no Firefox; o catch cai no aviso
        // que manda usar Download, em vez de o botão não fazer nada.
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast({ title: successTitle });
      } catch {
        toast({ title: s.copyFailed, variant: 'destructive' });
      }
    },
    [blob, s.copyFailed, toast],
  );

  const handleCopy = useCallback(async () => {
    await copyToClipboard(s.copied);
    track('analysis_shared', { step: 'copied', verdict: data.action });
  }, [copyToClipboard, data.action, s.copied]);

  const handleDownload = useCallback(() => {
    if (!preview) return;
    const link = document.createElement('a');
    link.href = preview;
    link.download = `tickrify-${slugify(data.symbol)}-${slugify(data.timeframe)}.png`;
    link.click();
    track('analysis_shared', { step: 'downloaded', verdict: data.action });
  }, [preview, data.symbol, data.timeframe, data.action]);

  const handleX = useCallback(async () => {
    // Nenhuma rede social aceita imagem por URL de intent. O fluxo que funciona
    // é o mesmo da fomo: copia a imagem, abre o compositor com o texto pronto,
    // a pessoa cola. A cópia vem ANTES do window.open de propósito — depois
    // dele o documento perde o foco e o clipboard recusa a escrita.
    await copyToClipboard(s.copiedPaste);
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(buildShareText(data))}`,
      '_blank',
      'noopener,noreferrer',
    );
    track('analysis_shared', { step: 'x_opened', verdict: data.action });
  }, [copyToClipboard, data, s.copiedPaste]);

  const handleNativeShare = useCallback(async () => {
    if (!blob) return;
    const file = new File([blob], 'tickrify-analysis.png', { type: 'image/png' });
    try {
      await navigator.share({ files: [file], text: buildShareText(data) });
      track('analysis_shared', { step: 'native_shared', verdict: data.action });
    } catch {
      /* Cancelar o menu do sistema rejeita a promise. Não é erro. */
    }
  }, [blob, data]);

  // No celular isto abre o menu nativo (Instagram, WhatsApp, Telegram, notas).
  // É o caminho que mais importa: o print de trade circula no telefone.
  const canNativeShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    typeof File !== 'undefined' &&
    navigator.canShare({ files: [new File([], 'x.png', { type: 'image/png' })] });

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleOpen}
        disabled={busy}
        className="gap-1.5 border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
        {s.cta}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            releasePreview();
            setPreview(null);
            setBlob(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{s.title}</DialogTitle>
            <DialogDescription>{s.note}</DialogDescription>
          </DialogHeader>

          {preview && (
            <img
              src={preview}
              alt={s.title}
              className="w-full rounded-lg border border-[var(--border-subtle)]"
            />
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleX}>
              {s.postX}
            </Button>
            <Button type="button" variant="outline" onClick={handleCopy} className="gap-2">
              <Copy className="h-4 w-4" />
              {s.copy}
            </Button>
            <Button type="button" variant="outline" onClick={handleDownload} className="gap-2">
              <Download className="h-4 w-4" />
              {s.download}
            </Button>
            {canNativeShare && (
              <Button type="button" variant="outline" onClick={handleNativeShare} className="gap-2">
                <Share2 className="h-4 w-4" />
                {s.more}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ShareCardButton;
