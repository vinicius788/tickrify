import { useAuth } from '@clerk/clerk-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { adminListRatings, adminPublishRating, type AdminRating } from '@/lib/ratings';

const MOTIVO: Record<string, string> = {
  levels_off: 'Níveis errados',
  too_many_waits: 'WAIT demais',
  hard_to_understand: 'Difícil de entender',
  too_slow: 'Lento',
  wrong_symbol: 'Ativo/tempo errado',
  other: 'Outra coisa',
};

function estrelas(n: number) {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
}

/**
 * Notas das análises (estrelas abaixo do resultado) e o que vai para o site.
 * "Publicar" só funciona com a licença do assinante e um comentário; o
 * servidor confere de novo.
 */
const NotasPainel = () => {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-ratings'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('sem token');
      return adminListRatings(token);
    },
  });
  const publicar = useMutation({
    mutationFn: async ({ id, published }: { id: string; published: boolean }) => {
      const token = await getToken();
      if (!token) throw new Error('sem token');
      return adminPublishRating(id, { published }, token);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-ratings'] }),
  });

  if (isLoading) return <p className="text-sm text-[var(--text-faint)]">Carregando notas…</p>;
  if (isError || !data) return <p className="text-sm text-[var(--tone-down-2)]">Não consegui carregar as notas.</p>;

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-[var(--border-strong)] bg-[var(--fill-1)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Notas das análises</h3>
        <p className="mt-1 text-xs text-[var(--text-faint)]">
          Estrelas que os assinantes dão abaixo do resultado. No site só entra o que a pessoa autorizou e você publicou.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-[var(--text-soft)]">
          {data.averages.length === 0 ? (
            <span className="text-[var(--text-faint)]">Nenhuma nota ainda.</span>
          ) : (
            data.averages.map((linha) => (
              <span key={linha.recommendation ?? 'sem'}>
                {linha.recommendation ?? 'sem veredito'}: <b>{linha.average ?? '·'}</b> <span className="text-[var(--text-faint)]">({linha.count})</span>
              </span>
            ))
          )}
        </div>
      </Card>

      {data.items.map((nota: AdminRating) => (
        <Card key={nota.id} className="border-[var(--border-strong)] bg-[var(--fill-1)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-[var(--tone-warn-2)]">
                {estrelas(nota.rating)}{' '}
                <span className="text-xs text-[var(--text-faint)]">
                  · {nota.userEmail ?? 'sem e-mail'} · {nota.recommendation ?? '·'} · {new Date(nota.createdAt).toLocaleDateString('pt-BR')}
                </span>
              </p>
              {nota.comment ? <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text-primary)]">&ldquo;{nota.comment}&rdquo;</p> : null}
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                {(nota.reasons ?? []).map((motivo) => (
                  <span key={motivo} className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[var(--text-dim)]">
                    {MOTIVO[motivo] ?? motivo}
                  </span>
                ))}
                <span className={`rounded-full border px-2 py-0.5 ${nota.quoteConsent ? 'border-emerald-500/40 text-[var(--tone-up-2)]' : 'border-[var(--border-strong)] text-[var(--text-faint)]'}`}>
                  {nota.quoteConsent ? `autorizou citar${nota.displayName ? ` como "${nota.displayName}"` : ''}` : 'não autorizou citar'}
                </span>
              </div>
            </div>
            <button
              type="button"
              disabled={!nota.quoteConsent || !nota.comment || publicar.isPending}
              onClick={() => publicar.mutate({ id: nota.id, published: !nota.published })}
              className={`rounded-full border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${nota.published ? 'border-[var(--signal-buy)] bg-[var(--signal-buy)] text-[var(--on-accent)]' : 'border-[var(--border-heavy)] text-[var(--text-primary)]'}`}
            >
              {nota.published ? 'Publicado (tirar)' : 'Publicar'}
            </button>
          </div>
        </Card>
      ))}
    </div>
  );
};

export default NotasPainel;
