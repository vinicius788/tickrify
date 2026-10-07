import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Rect } from '@/lib/crop';
import { t } from '@/lib/texts';


const MIN_W = 240;
const MIN_H = 160;

/**
 * Plataforma sem deteccao automatica: o trader arrasta um retangulo sobre o
 * grafico. So essa area vai no print; livro de ofertas, saldo e ordens ficam
 * de fora. A area fica guardada para o site (page.ts).
 */
export function AreaSelect({ onDone, onCancel }: { onDone: (rect: Rect) => void; onCancel: () => void }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    start.current = { x: e.clientX, y: e.clientY };
    setRect(null);
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const s = start.current;
    setRect({ x: Math.min(s.x, e.clientX), y: Math.min(s.y, e.clientY), w: Math.abs(e.clientX - s.x), h: Math.abs(e.clientY - s.y) });
  };
  const up = () => {
    start.current = null;
    setDragging(false);
    setRect((r) => (r && r.w >= MIN_W && r.h >= MIN_H ? r : null));
  };

  const ready = rect && !dragging;
  return (
    <>
      <div className={`tk-select${rect ? ' has-rect' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        {rect && <div className="tk-select-rect" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />}
      </div>
      <div className="tk-select-help">
        <b>{t.dragTitle}</b> {t.dragBody}
        <div className="tk-small" style={{ margin: '4px 0 0' }}>{t.escCancel}</div>
      </div>
      {ready && (
        <div
          className="tk-select-actions"
          style={{ left: rect.x, top: Math.min(rect.y + rect.h + 10, window.innerHeight - 52) }}
        >
          <button type="button" className="tk-btn" onClick={() => onDone(rect)}>
            {t.useArea}
          </button>
          <button type="button" className="tk-btn sec" onClick={() => setRect(null)}>
            {t.redo}
          </button>
        </div>
      )}
    </>
  );
}
