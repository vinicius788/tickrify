import { Button } from '@/components/ui/button';

/**
 * Estado vazio que ENSINA em vez de se desculpar.
 *
 * Regra (27/07/2026): tela vazia não informa ausência — ela conta o que a tela
 * vai virar e oferece UMA ação. "Nenhum favorito ainda" não ajuda ninguém;
 * "seus setups salvos moram aqui" explica o valor antes de existir dado.
 *
 * Único componente para os três lugares (Diário, My Trades, Dashboard) —
 * se cada tela inventar o seu, elas divergem na primeira mudança de copy.
 */
interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  ctaLabel: string;
  onCta: () => void;
}

const EmptyState = ({ icon: Icon, title, description, ctaLabel, onCta }: EmptyStateProps) => (
  <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
    <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)]">
      <Icon className="h-5 w-5 text-[var(--accent-green)]" />
    </div>

    <div className="max-w-md space-y-2">
      <p className="text-base font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{description}</p>
    </div>

    <Button type="button" onClick={onCta} size="sm" className="mt-1">
      {ctaLabel}
    </Button>
  </div>
);

export default EmptyState;
