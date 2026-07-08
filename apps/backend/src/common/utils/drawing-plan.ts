import { Bias, Recommendation, clamp } from './analysis-normalizer';

export type DrawingElementType = 'line' | 'rectangle' | 'arrow' | 'label';

export interface DrawingElement {
  id: string;
  type: DrawingElementType;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  width?: number;
  height?: number;
  text?: string;
  label?: string;
  color?: string;
  strokeWidth?: number;
}

export interface DrawingPlan {
  elements: DrawingElement[];
}

function normalizeType(value: unknown): DrawingElementType {
  const type = String(value || '').trim().toLowerCase();

  if (type === 'line' || type === 'trendline' || type === 'support' || type === 'resistance') {
    return 'line';
  }

  if (type === 'rectangle' || type === 'rect' || type === 'zone' || type === 'box') {
    return 'rectangle';
  }

  if (type === 'arrow') {
    return 'arrow';
  }

  return 'label';
}

function normalizeCoord(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return clamp(numeric, 0, 1);
}

function normalizeColor(value: unknown, fallback = '#f59e0b'): string {
  const color = String(value || '').trim();
  if (!color) {
    return fallback;
  }
  return color;
}

function normalizeStrokeWidth(value: unknown, fallback = 2): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return clamp(numeric, 1, 6);
}

export function normalizeDrawingPlan(value: unknown): DrawingPlan | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const maybePlan = value as Record<string, any>;
  const elementsInput = Array.isArray(maybePlan.elements)
    ? maybePlan.elements
    : Array.isArray((maybePlan as any).drawing_plan?.elements)
      ? (maybePlan as any).drawing_plan.elements
      : null;

  if (!elementsInput || elementsInput.length === 0) {
    return null;
  }

  const elements: DrawingElement[] = elementsInput
    .filter((element: any) => element && typeof element === 'object')
    .map((element: any, index: number) => {
      const type = normalizeType(element.type);
      const id = String(element.id || `${type}_${index + 1}`).trim() || `${type}_${index + 1}`;
      const color = normalizeColor(
        element.color,
        type === 'line'
          ? '#22c55e'
          : type === 'arrow'
            ? '#38bdf8'
            : type === 'rectangle'
              ? '#f59e0b'
              : '#ffffff',
      );
      const strokeWidth = normalizeStrokeWidth(element.strokeWidth ?? element.width, 2);

      if (type === 'line' || type === 'arrow') {
        return {
          id,
          type,
          x1: normalizeCoord(element.x1, 0.15),
          y1: normalizeCoord(element.y1, 0.7),
          x2: normalizeCoord(element.x2, 0.85),
          y2: normalizeCoord(element.y2, 0.7),
          label: element.label ? String(element.label) : undefined,
          color,
          strokeWidth,
        };
      }

      if (type === 'rectangle') {
        return {
          id,
          type,
          x: normalizeCoord(element.x, 0.25),
          y: normalizeCoord(element.y, 0.55),
          width: normalizeCoord(element.width, 0.5),
          height: normalizeCoord(element.height, 0.2),
          label: element.label ? String(element.label) : undefined,
          color,
          strokeWidth,
        };
      }

      return {
        id,
        type: 'label',
        x: normalizeCoord(element.x, 0.2),
        y: normalizeCoord(element.y, 0.2),
        text: String(element.text || element.label || id),
        color,
        strokeWidth,
      };
    });

  if (elements.length === 0) {
    return null;
  }

  return { elements };
}

export function buildDemoDrawingPlan(recommendation: Recommendation, bias: Bias): DrawingPlan {
  if (recommendation === 'BUY') {
    return {
      elements: [
        {
          id: 'support_1',
          type: 'line',
          x1: 0.1,
          y1: 0.74,
          x2: 0.9,
          y2: 0.74,
          color: '#22c55e',
          label: 'Support',
          strokeWidth: 3,
        },
        {
          id: 'trend_1',
          type: 'line',
          x1: 0.2,
          y1: 0.8,
          x2: 0.78,
          y2: 0.35,
          color: '#16a34a',
          label: 'Bull trend',
          strokeWidth: 3,
        },
        {
          id: 'entry_1',
          type: 'arrow',
          x1: 0.42,
          y1: 0.72,
          x2: 0.48,
          y2: 0.58,
          color: '#38bdf8',
          label: 'Entry',
          strokeWidth: 3,
        },
      ],
    };
  }

  if (recommendation === 'SELL') {
    return {
      elements: [
        {
          id: 'resistance_1',
          type: 'line',
          x1: 0.1,
          y1: 0.26,
          x2: 0.9,
          y2: 0.26,
          color: '#ef4444',
          label: 'Resistance',
          strokeWidth: 3,
        },
        {
          id: 'trend_1',
          type: 'line',
          x1: 0.2,
          y1: 0.25,
          x2: 0.82,
          y2: 0.75,
          color: '#dc2626',
          label: 'Bear trend',
          strokeWidth: 3,
        },
        {
          id: 'entry_1',
          type: 'arrow',
          x1: 0.56,
          y1: 0.28,
          x2: 0.52,
          y2: 0.46,
          color: '#38bdf8',
          label: 'Entry',
          strokeWidth: 3,
        },
      ],
    };
  }

  return {
    elements: [
      {
        id: 'range_top_1',
        type: 'line',
        x1: 0.12,
        y1: 0.32,
        x2: 0.88,
        y2: 0.32,
        color: '#eab308',
        label: 'Range top',
        strokeWidth: 3,
      },
      {
        id: 'range_bottom_1',
        type: 'line',
        x1: 0.12,
        y1: 0.7,
        x2: 0.88,
        y2: 0.7,
        color: '#eab308',
        label: 'Range bottom',
        strokeWidth: 3,
      },
      {
        id: 'wait_zone_1',
        type: 'rectangle',
        x: 0.2,
        y: 0.38,
        width: 0.6,
        height: 0.26,
        color: bias === 'neutral' ? '#eab308' : '#f59e0b',
        label: 'Wait zone',
        strokeWidth: 2,
      },
    ],
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toPixel(value: number | undefined, size: number, fallback: number): number {
  return Math.round(clamp(value ?? fallback, 0, 1) * size);
}

function buildArrowHead(x1: number, y1: number, x2: number, y2: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 14;
  const leftAngle = angle + Math.PI - Math.PI / 8;
  const rightAngle = angle + Math.PI + Math.PI / 8;
  const x3 = x2 + size * Math.cos(leftAngle);
  const y3 = y2 + size * Math.sin(leftAngle);
  const x4 = x2 + size * Math.cos(rightAngle);
  const y4 = y2 + size * Math.sin(rightAngle);

  return `${x2},${y2} ${Math.round(x3)},${Math.round(y3)} ${Math.round(x4)},${Math.round(y4)}`;
}

export function renderAnnotatedImage(
  originalImageUrl: string,
  drawingPlan: DrawingPlan,
  width = 1200,
  height = 675,
): string {
  const elementSvg = drawingPlan.elements
    .map((element) => {
      const color = escapeXml(String(element.color || '#f59e0b'));
      const strokeWidth = clamp(Number(element.strokeWidth || 2), 1, 6);

      if (element.type === 'line') {
        const x1 = toPixel(element.x1, width, 0.1);
        const y1 = toPixel(element.y1, height, 0.5);
        const x2 = toPixel(element.x2, width, 0.9);
        const y2 = toPixel(element.y2, height, 0.5);
        const label = element.label
          ? `<text x="${x1 + 8}" y="${y1 - 8}" fill="${color}" font-size="18" font-weight="700">${escapeXml(
              element.label,
            )}</text>`
          : '';

        return `
          <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}" />
          ${label}
        `;
      }

      if (element.type === 'rectangle') {
        const x = toPixel(element.x, width, 0.25);
        const y = toPixel(element.y, height, 0.55);
        const rectWidth = toPixel(element.width, width, 0.4);
        const rectHeight = toPixel(element.height, height, 0.2);
        const label = element.label
          ? `<text x="${x + 8}" y="${y - 8}" fill="${color}" font-size="18" font-weight="700">${escapeXml(
              element.label,
            )}</text>`
          : '';

        return `
          <rect x="${x}" y="${y}" width="${rectWidth}" height="${rectHeight}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="${strokeWidth}" />
          ${label}
        `;
      }

      if (element.type === 'arrow') {
        const x1 = toPixel(element.x1, width, 0.45);
        const y1 = toPixel(element.y1, height, 0.7);
        const x2 = toPixel(element.x2, width, 0.52);
        const y2 = toPixel(element.y2, height, 0.58);
        const label = element.label
          ? `<text x="${x2 + 10}" y="${y2 - 10}" fill="${color}" font-size="18" font-weight="700">${escapeXml(
              element.label,
            )}</text>`
          : '';
        return `
          <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}" />
          <polygon points="${buildArrowHead(x1, y1, x2, y2)}" fill="${color}" />
          ${label}
        `;
      }

      const x = toPixel(element.x, width, 0.2);
      const y = toPixel(element.y, height, 0.2);
      const text = escapeXml(String(element.text || element.label || element.id));
      return `<text x="${x}" y="${y}" fill="${color}" font-size="18" font-weight="700">${text}</text>`;
    })
    .join('\n');

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <image href="${escapeXml(originalImageUrl)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />
      <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(0,0,0,0.02)" />
      ${elementSvg}
    </svg>
  `;

  const base64Svg = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${base64Svg}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function ensureReasoningReferencesDrawing(
  reasoning: string,
  drawingPlan: DrawingPlan,
): string {
  const ids = drawingPlan.elements.map((element) => element.id).filter(Boolean);

  if (ids.length < 2) {
    return reasoning;
  }

  const referenced = ids.filter((id) => new RegExp(`\\b${escapeRegex(id)}\\b`, 'i').test(reasoning));

  if (referenced.length >= 2) {
    return reasoning;
  }

  const [firstId, secondId] = ids;
  const appendix = `Referencias visuais: ${firstId} e ${secondId}.`;
  const normalizedReasoning = String(reasoning || '').trim();

  if (!normalizedReasoning) {
    return appendix;
  }

  return `${normalizedReasoning}\n\n${appendix}`;
}

