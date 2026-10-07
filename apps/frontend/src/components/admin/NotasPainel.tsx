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

  if (isLoading) return <p className="text-sm text-zinc-500">Carregando notas…</p>;
  if (isError || !data) return <p className="text-sm text-red-400">Não consegui carregar as notas.</p>;

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-white/10 bg-white/[0.02] p-4">
        <h3 className="text-sm font-semibold text-white">Notas das análises</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Estrelas que os assinantes dão abaixo do resultado. No site só entra o que a pessoa autorizou e você publicou.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-zinc-300">
          {data.averages.length === 0 ? (
            <span className="text-zinc-500">Nenhuma nota ainda.</span>
          ) : (
            data.averages.map((linha) => (
              <span key={linha.recommendation ?? 'sem'}>
                {linha.recommendation ?? 'sem veredito'}: <b>{linha.average ?? '·'}</b> <span className="text-zinc-500">({linha.count})</span>
              </span>
            ))
          )}
        </div>
      </Card>

      {data.items.map((nota: AdminRating) => (
        <Card key={nota.id} className="border-white/10 bg-white/[0.02] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-amber-400">
                {estrelas(nota.rating)}{' '}
                <span className="text-xs text-zinc-500">
                  · {nota.userEmail ?? 'sem e-mail'} · {nota.recommendation ?? '·'} · {new Date(nota.createdAt).toLocaleDateString('pt-BR')}
                </span>
              </p>
              {nota.comment ? <p className="mt-2 whitespace-pre-wrap text-sm text-white">&ldquo;{nota.comment}&rdquo;</p> : null}
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                {(nota.reasons ?? []).map((motivo) => (
                  <span key={motivo} className="rounded-full border border-white/10 px-2 py-0.5 text-zinc-400">
                    {MOTIVO[motivo] ?? motivo}
                  </span>
                ))}
                <span className={`rounded-full border px-2 py-0.5 ${nota.quoteConsent ? 'border-emerald-500/40 text-emerald-400' : 'border-white/10 text-zinc-500'}`}>
                  {nota.quoteConsent ? `autorizou citar${nota.displayName ? ` como "${nota.displayName}"` : ''}` : 'não autorizou citar'}
                </span>
              </div>
            </div>
            <button
              type="button"
              disabled={!nota.quoteConsent || !nota.comment || publicar.isPending}
              onClick={() => publicar.mutate({ id: nota.id, published: !nota.published })}
              className={`rounded-full border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${nota.published ? 'border-emerald-500 bg-emerald-500 text-black' : 'border-white/20 text-white'}`}
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
