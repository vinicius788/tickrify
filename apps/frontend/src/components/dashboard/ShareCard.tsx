import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Film, Loader2, RotateCcw, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import { tradeQueryKey, useAPIClient } from '@/lib/api';
import {
  ANIMATION_MS,
  SHARE_FORMATS,
  SHARE_FORMAT_ORDER,
  buildReadCard,
  buildReadShareText,
  buildTradeCard,
  buildTradeShareText,
  ensureShareFonts,
  hideAmountState,
  loadShareAssets,
  recordShareVideo,
  renderShareFrame,
  renderSharePng,
  tradeResult,
  videoMimeType,
  type ReadShareData,
  type ShareAssets,
  type ShareCardModel,
  type ShareFormat,
  type TradeShareData,
} from '@/lib/share-card';

/**
 * Botoes e modal de compartilhar: a leitura da analise (resultado) e o
 * resultado do trade (My Trades). O desenho mora em `lib/share-card.ts`; aqui
 * so ha interface. Imagem e video sao gerados no navegador: nada novo e
 * gravado e nenhum link publico e criado.
 */

function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'card';
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // O Safari ainda le o URL logo depois do clique.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function canShareFiles(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.canShare === 'function' &&
      typeof File !== 'undefined' &&
      navigator.canShare({ files: [new File([], 'x.png', { type: 'image/png' })] })
    );
  } catch {
    return false;
  }
}

type AmountToggle = {
  state: ReturnType<typeof hideAmountState>;
  on: boolean;
  onChange: (on: boolean) => void;
};

interface ShareBodyProps {
  model: ShareCardModel | null;
  shareText: string;
  fileBase: string;
  onTrack: (step: string, props?: Record<string, unknown>) => void;
  amountToggle?: AmountToggle;
}

function ShareBody({ model, shareText, fileBase, onTrack, amountToggle }: ShareBodyProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const s = t.analysis.share;

  const [format, setFormat] = useState<ShareFormat>('post');
  const [assets, setAssets] = useState<{ key: string; value: ShareAssets } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [replay, setReplay] = useState(0);
  const [recording, setRecording] = useState(false);
  const [boxW, setBoxW] = useState(0);
  const [viewH, setViewH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800));

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef(model);
  const scaleRef = useRef(1);
  const timeRef = useRef(ANIMATION_MS);
  const exportRef = useRef<{ key: string; promise: Promise<Blob> } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const videoType = useMemo(() => videoMimeType(), []);
  const nativeShare = useMemo(() => canShareFiles(), []);

  const assetKey = model ? `${model.theme}:${format}` : '';
  const ready = assets !== null && assets.key === assetKey;

  // Arte e fontes antes do primeiro quadro: sem isso o card sai sem fundo ou com a fonte de reserva.
  useEffect(() => {
    if (!model) return;
    let alive = true;
    setLoadFailed(false);
    Promise.all([loadShareAssets(model.theme, format), ensureShareFonts()])
      .then(([value]) => {
        if (alive) setAssets({ key: `${model.theme}:${format}`, value });
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [model, format]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      setBoxW(el.clientWidth);
      setViewH(window.innerHeight);
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, []);

  const { w, h } = SHARE_FORMATS[format];
  const maxH = Math.min(viewH * 0.55, 640);
  const displayW = Math.max(0, Math.min(boxW, (maxH * w) / h));
  const displayH = (displayW * h) / w;
  // O canvas da previa segue o devicePixelRatio, nunca abaixo de 2x.
  const pixelScale = (displayW / w) * Math.max(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  useLayoutEffect(() => {
    modelRef.current = model;
    scaleRef.current = pixelScale;
  });

  const draw = useCallback(
    (time: number) => {
      const canvas = canvasRef.current;
      const current = modelRef.current;
      if (!canvas || !current || !assets) return;
      const scale = scaleRef.current;
      const pw = Math.max(1, Math.round(w * scale));
      const ph = Math.max(1, Math.round(h * scale));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) renderShareFrame(ctx, current, format, assets.value, time, scale);
    },
    [assets, format, w, h],
  );

  // Animacao ao abrir, ao trocar o formato e no "replay". Para sozinha no fim e ao fechar.
  const hasBox = displayW > 0;
  useEffect(() => {
    if (!ready || !hasBox) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      timeRef.current = ANIMATION_MS;
      draw(ANIMATION_MS);
      return;
    }
    let frame = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      timeRef.current = Math.min(ANIMATION_MS, now - start);
      draw(timeRef.current);
      if (timeRef.current < ANIMATION_MS) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, draw, replay, hasBox]);

  // Tamanho ou dado mudou (girar o celular, "Hide amount"): redesenha o quadro atual.
  useEffect(() => {
    if (ready) draw(timeRef.current);
  }, [ready, draw, pixelScale, model]);

  const exportKey = model ? `${format}:${JSON.stringify(model)}` : '';
  const getPng = useCallback((): Promise<Blob> => {
    if (!model) return Promise.reject(new Error('no card'));
    if (exportRef.current?.key !== exportKey) {
      const promise = renderSharePng(model, format);
      promise.catch(() => {
        if (exportRef.current?.promise === promise) exportRef.current = null;
      });
      exportRef.current = { key: exportKey, promise };
    }
    return exportRef.current.promise;
  }, [model, format, exportKey]);

  // Deixa o PNG final pronto: copiar no Safari precisa responder rapido ao clique.
  useEffect(() => {
    if (ready) getPng().catch(() => {});
  }, [ready, getPng]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const copyImage = useCallback(
    async (successTitle: string): Promise<boolean> => {
      try {
        // A promise vai direto no ClipboardItem: o Safari so aceita a escrita
        // dentro do clique. Firefox nao tem imagem no clipboard e cai no aviso.
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': getPng() })]);
        toast({ title: successTitle });
        return true;
      } catch {
        toast({ title: s.copyFailed, variant: 'destructive' });
        return false;
      }
    },
    [getPng, s.copyFailed, toast],
  );

  const handleCopy = async () => {
    if (await copyImage(s.copied)) onTrack('copied', { format });
  };

  const handleX = async () => {
    // Nenhuma rede aceita imagem por URL de intent: copia a imagem, abre o
    // compositor com o texto, a pessoa cola. A copia vem ANTES do window.open:
    // depois dele a pagina perde o foco e o clipboard recusa.
    await copyImage(s.copiedPaste);
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener,noreferrer');
    onTrack('x_opened', { format });
  };

  const handleDownload = async () => {
    try {
      downloadBlob(await getPng(), `${fileBase}-${format}.png`);
      onTrack('downloaded', { format });
    } catch {
      toast({ title: s.failed, variant: 'destructive' });
    }
  };

  const handleNativeShare = async () => {
    try {
      const file = new File([await getPng()], `${fileBase}-${format}.png`, { type: 'image/png' });
      await navigator.share({ files: [file], text: shareText });
      onTrack('native_shared', { format });
    } catch {
      /* Cancelar o menu do sistema rejeita a promise. Nao e erro. */
    }
  };

  const handleVideo = async () => {
    if (!model || recording) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRecording(true);
    try {
      const { blob, extension } = await recordShareVideo(model, format, controller.signal);
      downloadBlob(blob, `${fileBase}-${format}.${extension}`);
      onTrack('video_downloaded', { format, extension });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        toast({ title: s.videoFailed, variant: 'destructive' });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (!controller.signal.aborted) setRecording(false);
    }
  };

  const toggleHint =
    amountToggle?.state === 'available' ? s.hideAmountHint : amountToggle?.state === 'no_amount' ? s.noAmount : s.noReturn;
  const formatLabel: Record<ShareFormat, string> = { post: s.formatPost, feed: s.formatFeed, story: s.formatStory };

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-1">
        {SHARE_FORMAT_ORDER.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={format === value}
            onClick={() => {
              if (format !== value) setFormat(value);
            }}
            className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
              format === value
                ? 'bg-[var(--inverse-bg)] text-[var(--inverse-fg)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {formatLabel[value]}
          </button>
        ))}
      </div>

      <div ref={wrapRef} className="flex w-full min-w-0 justify-center">
        <div className="relative" style={{ width: displayW, height: displayH }}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={s.previewAlt}
            className={`h-full w-full rounded-lg border border-[var(--border-subtle)] ${ready ? '' : 'invisible'}`}
          />
          {!ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs text-[var(--text-secondary)]">
              {loadFailed ? (
                <span>{s.failed}</span>
              ) : (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>{s.preparing}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {amountToggle && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border-subtle)] px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">{s.hideAmount}</p>
            <p className="text-xs text-[var(--text-secondary)]">{toggleHint}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={amountToggle.on}
            aria-label={s.hideAmount}
            disabled={amountToggle.state !== 'available'}
            onClick={() => amountToggle.onChange(!amountToggle.on)}
            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border border-[var(--border-subtle)] transition-colors disabled:opacity-40 ${
              amountToggle.on ? 'bg-[var(--signal-buy)]' : 'bg-[var(--bg-overlay)]'
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-[var(--text-primary)] transition-transform ${
                amountToggle.on ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleX} disabled={!ready}>
          {s.postX}
        </Button>
        <Button type="button" variant="outline" onClick={handleCopy} disabled={!ready} className="gap-2">
          <Copy className="h-4 w-4" />
          {s.copy}
        </Button>
        <Button type="button" variant="outline" onClick={handleDownload} disabled={!ready} className="gap-2">
          <Download className="h-4 w-4" />
          {s.download}
        </Button>
        {videoType && (
          <Button type="button" variant="outline" onClick={handleVideo} disabled={!ready || recording} className="gap-2">
            {recording ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
            {recording ? s.recording : s.downloadVideo}
          </Button>
        )}
        {nativeShare && (
          <Button type="button" variant="outline" onClick={handleNativeShare} disabled={!ready} className="gap-2">
            <Share2 className="h-4 w-4" />
            {s.more}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={() => setReplay((n) => n + 1)}
          disabled={!ready}
          aria-label={s.replay}
          className="gap-2 text-[var(--text-secondary)]"
        >
          <RotateCcw className="h-4 w-4" />
          {s.replay}
        </Button>
      </div>
    </div>
  );
}

function ShareDialog({
  open,
  onOpenChange,
  title,
  note,
  ...body
}: ShareBodyProps & { open: boolean; onOpenChange: (open: boolean) => void; title: string; note: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{note}</DialogDescription>
        </DialogHeader>
        {/* So monta aberto: fechar desmonta, para a animacao e cancela o video. */}
        {open && <ShareBody {...body} />}
      </DialogContent>
    </Dialog>
  );
}

const triggerClass =
  'gap-1.5 border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]';

/** Leitura da analise. Nunca mostra entrada, stop ou alvo (ver `lib/share-card.ts`). */
export function AnalysisShareButton({ data }: { data: ReadShareData }) {
  const { t } = useLanguage();
  const s = t.analysis.share;
  const [open, setOpen] = useState(false);
  const model = useMemo(() => buildReadCard(data), [data]);
  const verdict = data.action;

  const onTrack = useCallback(
    (step: string, props?: Record<string, unknown>) => track('analysis_shared', { step, card: 'read', verdict, ...props }),
    [verdict],
  );

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(true);
          onTrack('opened');
        }}
        className={triggerClass}
      >
        <Share2 className="h-3.5 w-3.5" />
        {s.cta}
      </Button>
      <ShareDialog
        open={open}
        onOpenChange={setOpen}
        title={s.title}
        note={s.note}
        model={model}
        shareText={buildReadShareText(data)}
        fileBase={`tickrify-${slugify(data.symbol)}-${slugify(data.timeframe)}`}
        onTrack={onTrack}
      />
    </>
  );
}

export type TradeShareInput = Omit<TradeShareData, 'entryPrice' | 'closedAt'>;

/**
 * Resultado do trade. Usa so o que o trader registrou: valor e resultado do
 * My Trades e, da operacao marcada (`/api/trades/:id`), o preco de entrada
 * digitado e a data do fechamento. O valor nunca vai para o PostHog.
 */
export function TradeShareButton({ analysisId, trade }: { analysisId: string; trade: TradeShareInput }) {
  const { t } = useLanguage();
  const s = t.analysis.share;
  const { getTrade } = useAPIClient();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [logged, setLogged] = useState<{ entryPrice: number | null; closedAt: Date | null } | null>(null);
  const [hideAmount, setHideAmount] = useState(false);

  const data: TradeShareData = useMemo(
    () => ({ ...trade, entryPrice: logged?.entryPrice ?? null, closedAt: logged?.closedAt ?? null }),
    [trade, logged],
  );
  const model = useMemo(() => (logged ? buildTradeCard(data, hideAmount) : null), [data, hideAmount, logged]);
  const result = tradeResult(data);

  const onTrack = useCallback(
    (step: string, props?: Record<string, unknown>) =>
      track('analysis_shared', { step, card: 'trade', result, hideAmount, ...props }),
    [result, hideAmount],
  );

  const handleOpen = () => {
    setLogged(null);
    setHideAmount(false);
    setOpen(true);
    onTrack('opened');
    queryClient
      .fetchQuery({ queryKey: tradeQueryKey(analysisId), queryFn: () => getTrade(analysisId) })
      .then((view) => {
        const closed = [...view.timeline].reverse().find((entry) => entry.status === 'closed');
        const closedAt = closed ? new Date(closed.at) : null;
        setLogged({
          entryPrice: view.entryPrice,
          closedAt: closedAt && !Number.isNaN(closedAt.getTime()) ? closedAt : null,
        });
      })
      // Analise sem operacao marcada (WATCH, por exemplo): fica so com o que o My Trades tem.
      .catch(() => setLogged({ entryPrice: null, closedAt: null }));
  };

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={handleOpen} className={triggerClass}>
        <Share2 className="h-3.5 w-3.5" />
        {s.shareResult}
      </Button>
      <ShareDialog
        open={open}
        onOpenChange={setOpen}
        title={s.titleTrade}
        note={s.noteTrade}
        model={model}
        shareText={buildTradeShareText(data)}
        fileBase={`tickrify-${slugify(trade.symbol)}-trade`}
        onTrack={onTrack}
        amountToggle={{ state: hideAmountState(data), on: hideAmount, onChange: setHideAmount }}
      />
    </>
  );
}
