import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Rótulo pequeno em maiúsculas acima do título (ex.: "ÁREA DE TRABALHO · DASHBOARD"). */
  eyebrow?: ReactNode;
  /** Título principal. Use <em>palavra</em> para o acento em itálico/serifa secundária. */
  title: ReactNode;
  /** Subtítulo opcional com a frase de valor. */
  subtitle?: ReactNode;
  /** Conteúdo à direita (botões de ação, etc.). */
  actions?: ReactNode;
  className?: string;
  /** Tamanho do título display. */
  size?: "md" | "lg";
}

/**
 * Cabeçalho editorial padrão da Tickrify: sobrancelha monoespaçada + título em
 * serifa display (com acento itálico via <em>) + subtítulo. Puramente visual —
 * não altera nenhum dado ou fluxo. Use em todas as telas para manter consistência.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
  size = "lg",
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="tk-eyebrow mb-2">{eyebrow}</div> : null}
        <h1
          className={cn(
            "tk-display tk-display-em",
            size === "lg"
              ? "text-3xl sm:text-4xl md:text-5xl"
              : "text-2xl sm:text-3xl",
          )}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export default PageHeader;
