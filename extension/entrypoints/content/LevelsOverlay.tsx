import type { Rect } from '@/lib/crop';
import { t } from '@/lib/texts';
import { placeLevels, type LevelFractions, type LevelKey } from '@/lib/levels';

export type LevelPrices = Record<LevelKey, string | null>;

const LABEL: Record<Exclude<LevelKey, 'entry'>, string> = { stop: t.stop, tp1: 'TP1', tp2: 'TP2' };

/**
 * Entrada, stop e alvos desenhados por cima do grafico, no retangulo que foi
 * recortado. A altura vem da fracao estimada pelo motor; o preco escrito na
 * etiqueta e o exato. E so uma camada da extensao: nao toca no grafico.
 */
export function LevelsOverlay({
  rect,
  fractions,
  prices,
  side,
  takenAt,
}: {
  rect: Rect;
  fractions: LevelFractions;
  prices: LevelPrices;
  side: string;
  takenAt: string;
}) {
  const marks = placeLevels(fractions, rect.h);
  if (marks.length === 0) return null;
  const top = (key: LevelKey) => marks.find((m) => m.key === key && m.top !== null)?.top ?? null;
  const zone = (a: number | null, b: number | null, cls: string) =>
    a === null || b === null ? null : (
      <div className={`tk-zone ${cls}`} style={{ top: Math.min(a, b), height: Math.abs(a - b) }} />
    );

  return (
    <div className="tk-levels-layer" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      {zone(top('entry'), top('tp1'), 'reward')}
      {zone(top('entry'), top('stop'), 'risk')}
      {marks.map((m) => {
        const text = `${m.key === 'entry' ? side : LABEL[m.key]} ${prices[m.key] ?? ''}`.trim();
        if (m.top === null) {
          return (
            <div
              key={m.key}
              className={`tk-tag ${m.key} edge`}
              style={m.edge === 'above' ? { top: 6 } : { bottom: 44 }}
            >
              {`${text} ${m.edge === 'above' ? t.aboveView : t.belowView}`}
            </div>
          );
        }
        return (
          <div key={m.key}>
            <div className={`tk-line ${m.key}`} style={{ top: m.top }} />
            <div className={`tk-tag ${m.key}`} style={{ top: m.top }}>
              {text}
            </div>
          </div>
        );
      })}
      <div className="tk-credit">
        <b>Tickrify</b> {t.levelsCredit(takenAt)}
      </div>
    </div>
  );
}
