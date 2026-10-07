import { useCallback, useEffect, useState } from 'react';
import type { Usage } from '@/lib/api';
import type { Rect } from '@/lib/crop';
import type { CaptureReply, PanelMessage, ToBackground } from '@/lib/messages';
import type { PageMeta, Platform } from '@/lib/platform';
import { strings } from '@/lib/i18n';
import { AreaSelect } from './AreaSelect';
import { LevelsOverlay } from './LevelsOverlay';
import { Panel, readResult, type Pos, type UiView } from './Panel';
import { clearArea, findTradingViewChart, loadSavedArea, pageMeta, saveArea } from './page';

export type Bus = { subscribe: (fn: (message: PanelMessage) => void) => () => void };

const POS_KEY = 'tk_panel_pos';
const PANEL_W = 320;
const t = strings();

const defaultPos = (): Pos => ({ x: Math.max(8, window.innerWidth - PANEL_W - 16), y: 16 });
const clampPos = (p: Pos): Pos => ({
  x: Math.max(0, Math.min(window.innerWidth - PANEL_W, p.x)),
  y: Math.max(0, Math.min(window.innerHeight - 60, p.y)),
});
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const send = (message: ToBackground) => browser.runtime.sendMessage(message) as Promise<CaptureReply | undefined>;

export function App({ bus, logo, setHidden }: { bus: Bus; logo: string; setHidden: (hidden: boolean) => void }) {
  const [view, setView] = useState<UiView | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [platform, setPlatform] = useState<Platform>('other');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [minimized, setMinimized] = useState(false);
  // Sem posicao guardada, nasce no canto direito da janela do MOMENTO em que abre.
  const [savedPos, setPos] = useState<Pos | null>(null);
  const [levelsGone, setLevelsGone] = useState(false);
  const [moved, setMoved] = useState(false);
  const [reminderAt, setReminderAt] = useState<string | null>(null);

  useEffect(() => {
    void browser.storage.local.get(POS_KEY).then((stored) => {
      if (stored[POS_KEY]) setPos(stored[POS_KEY] as Pos);
    });
  }, []);

  /** Esconde tudo o que e da extensao, tira o print e mostra de novo. */
  const capture = useCallback(
    async (rect: Rect, meta: PageMeta, from: Platform) => {
      setHidden(true);
      // 2 quadros + folga: com a maquina ocupada, 2 quadros as vezes nao bastavam
      // e o painel saia no print (A10 da suite, 07/10).
      await nextFrame();
      await nextFrame();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const reply = await send({ type: 'tk:capture', rect, viewport: { width: window.innerWidth, height: window.innerHeight }, platform: from, meta }).catch(() => undefined);
      setHidden(false);
      if (!reply || !reply.ok) setView({ kind: 'error', reason: reply && !reply.ok ? reply.reason : 'failed' });
    },
    [setHidden],
  );

  const begin = useCallback(
    async (from: Platform) => {
      setMinimized(false);
      setLevelsGone(false);
      setMoved(false);
      setReminderAt(null);
      if (from === 'tradingview') {
        const rect = findTradingViewChart();
        if (rect) return capture(rect, pageMeta(from), from);
      }
      const saved = await loadSavedArea();
      if (saved) setView({ kind: 'confirm', rect: saved, meta: pageMeta(from) });
      else {
        setView(null);
        setSelecting(true);
      }
    },
    [capture],
  );

  useEffect(
    () =>
      bus.subscribe((message) => {
        if (message.type === 'tk:axis') {
          setView((current) =>
            current?.kind === 'result' && current.analysis.id === message.analysisId
              ? {
                  ...current,
                  analysis: {
                    ...current.analysis,
                    fullResponse: {
                      ...current.analysis.fullResponse,
                      analysis: { ...current.analysis.fullResponse?.analysis, priceAxis: message.axis },
                    },
                  },
                }
              : current,
          );
          return;
        }
        if (message.type === 'tk:start') {
          setPlatform(message.platform);
          setUsage(message.usage);
          void begin(message.platform);
          return;
        }
        if (message.view.kind === 'result') {
          setLevelsGone(false);
          setMoved(false);
          if (message.view.usage) setUsage(message.view.usage);
        }
        setSelecting(false);
        setMinimized(false);
        setView(message.view);
      }),
    [bus, begin],
  );

  // Grafico mexeu (rolar, arrastar, zoom, janela): as linhas perdem o
  // alinhamento e somem. Resultado reaberto pelo menu nunca tem linhas.
  const result = view?.kind === 'result' ? view : null;
  const levelsOn = Boolean(result && !result.restored && !levelsGone);
  useEffect(() => {
    if (!levelsOn || !result) return;
    const { rect } = result;
    const inside = (e: MouseEvent) => e.clientX >= rect.x && e.clientX <= rect.x + rect.w && e.clientY >= rect.y && e.clientY <= rect.y + rect.h;
    const hide = () => {
      setLevelsGone(true);
      setMoved(true);
    };
    const onPointer = (e: MouseEvent) => {
      if (inside(e) && !(e.target as Element | null)?.closest?.('tickrify-panel')) hide();
    };
    window.addEventListener('wheel', onPointer, { capture: true, passive: true });
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('wheel', onPointer, { capture: true });
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('resize', hide);
    };
  }, [levelsOn, result]);

  const close = () => {
    setView(null);
    setSelecting(false);
    setMinimized(false);
  };

  const pos = clampPos(savedPos ?? defaultPos());
  const parsed = result ? readResult(result.analysis, result.meta) : null;
  const takenAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    // translate="no": o tradutor do Chrome traduzia o painel na pagina traduzida
    // (visto em 06/10) e pode quebrar o React (mesmo bug do removeChild, CLAUDE.md 4.0).
    <div className="tk-root notranslate" translate="no">
      {selecting && (
        <AreaSelect
          onCancel={close}
          onDone={(rect) => {
            setSelecting(false);
            void saveArea(rect);
            setView({ kind: 'confirm', rect, meta: pageMeta(platform) });
          }}
        />
      )}

      {result && parsed?.fractions && parsed.rec !== 'WAIT' && levelsOn && (
        <LevelsOverlay rect={result.rect} fractions={parsed.fractions} prices={parsed.prices} side={t.side(parsed.side, parsed.entryType ? t.entryType(parsed.entryType) : null)} takenAt={takenAt} />
      )}

      {result && moved && parsed?.fractions && parsed.rec !== 'WAIT' && (
        <div className="tk-toast" style={{ left: result.rect.x + 12, top: result.rect.y + result.rect.h - 52 }}>
          {t.chartMoved}
        </div>
      )}

      {view && minimized && (
        <div className="tk-bubble" style={{ left: Math.min(pos.x + PANEL_W - 200, window.innerWidth - 210), top: pos.y }}>
          <button type="button" className="tk-bubble-open" onClick={() => setMinimized(false)} aria-label={t.openPanel}>
            <img className="tk-logo" src={logo} alt="" />
            <span className="tk-dot" style={{ background: !parsed ? '#8a91b4' : parsed.rec === 'BUY' ? '#00ff88' : parsed.rec === 'SELL' ? '#ff4d5e' : '#ffb800' }} />
            {view.kind === 'analyzing' ? 'Analyzing' : parsed ? `${parsed.rec} ${parsed.symbol}`.trim() : 'Tickrify'}
          </button>
          <button type="button" className="tk-icon-btn tk-x" onClick={close} aria-label={t.close} title={t.close}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      )}

      {view && !minimized && (
        <Panel
          view={view}
          usage={usage}
          platform={platform}
          logo={logo}
          pos={pos}
          reminderAt={reminderAt}
          onMove={(next) => {
            setPos(next);
            void browser.storage.local.set({ [POS_KEY]: next });
          }}
          onMinimize={() => setMinimized(true)}
          onConfirm={(meta) => view.kind === 'confirm' && void capture(view.rect, meta, platform)}
          onAgain={() => void send({ type: 'tk:again' })}
          onAdjustArea={() => {
            void clearArea();
            setView(null);
            setSelecting(true);
          }}
          onRemind={(label) => {
            setReminderAt(new Date(Date.now() + 15 * 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            void send({ type: 'tk:remind', minutes: 15, label });
          }}
        />
      )}
    </div>
  );
}
