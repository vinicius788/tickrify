import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface CopyPriceProps {
  /** Valor cru que vai para a area de transferencia (sem separador de milhar nem moeda). */
  value: number | null | undefined;
  /** Preco ja formatado para a tela. */
  text: string;
  className?: string;
}

const FEEDBACK_MS = 1400;

/**
 * Preco de plano que copia o valor cru com um clique (ou Enter/Espaco).
 * Sem valor numerico valido, vira so texto.
 */
export function CopyPrice({ value, text, className = '' }: CopyPriceProps) {
  const { t } = useLanguage();
  const r = t.analysis.result;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return <span className={className}>{text}</span>;
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), FEEDBACK_MS);
  };

  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-label={`${r.copyPrice}: ${text}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void copy();
        }}
        className={`cursor-pointer rounded-sm text-inherit tabular-nums transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-secondary)] ${className}`}
      >
        <span key="price">{text}</span>
      </button>
      {copied ? (
        <span
          key="copied"
          role="status"
          className="pointer-events-none absolute bottom-full right-0 z-10 mb-1 whitespace-nowrap rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-primary)]"
        >
          {r.copied}
        </span>
      ) : null}
    </span>
  );
}

interface PriceTemplateProps {
  /** Frase com marcadores como {price}; os demais marcadores ja devem estar trocados. */
  template: string;
  prices: Record<string, { value: number | null | undefined; text: string }>;
}

/** Monta uma frase da i18n trocando cada marcador de preco por um CopyPrice. */
export function PriceTemplate({ template, prices }: PriceTemplateProps) {
  const parts = template.split(/(\{\w+\})/);
  return (
    <>
      {parts.map((part, i) => {
        const hit = part.startsWith('{') ? prices[part.slice(1, -1)] : undefined;
        return hit
          ? <CopyPrice key={`p${i}`} value={hit.value} text={hit.text} />
          : <span key={`t${i}`}>{part}</span>;
      })}
    </>
  );
}
