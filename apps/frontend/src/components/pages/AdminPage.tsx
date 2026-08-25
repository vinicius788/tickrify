import { useState } from 'react';
import { useFeatureFlags, type ResolvedFlag } from '@/hooks/useFeatureFlags';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useSeo } from '@/hooks/useSeo';
import RelatosPainel from '@/components/admin/RelatosPainel';

/**
 * Loja de apps interna — liga e desliga funções sem redeploy.
 *
 * PÁGINA INTERNA, NÃO PÚBLICA. `noindex` obrigatório: o /sign-in já foi parar
 * no índice do Google porque `Disallow` no robots.txt impede RASTREAR, não
 * INDEXAR. Uma URL /admin no índice é convite.
 *
 * O gate de verdade é do servidor (AuthGuard + AdminGuard). O que esta tela faz
 * com o 403 é escolher o que desenhar — ela nunca concede acesso a nada.
 */

const ORIGEM_ROTULO: Record<string, { texto: string; classe: string; ajuda: string }> = {
  banco: {
    texto: 'definido aqui',
    classe: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    ajuda: 'Alguém mudou por este painel. Vence a variável de ambiente do Render.',
  },
  ambiente: {
    texto: 'vem do Render',
    classe: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    ajuda: 'Valor herdado da variável de ambiente. Mudar aqui passa a ignorá-la.',
  },
  padrao: {
    texto: 'padrão do código',
    classe: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    ajuda: 'Nada configurado em lugar nenhum — é o comportamento histórico do código.',
  },
};

const RISCO_ROTULO: Record<string, string> = {
  alto: 'bg-red-500/15 text-red-300 border-red-500/30',
  medio: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  baixo: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};

function LinhaFlag({
  flag,
  onSalvar,
  onLimpar,
  salvando,
}: {
  flag: ResolvedFlag;
  onSalvar: (valor: string) => void;
  onLimpar: () => void;
  salvando: boolean;
}) {
  const { definition: def } = flag;
  const ligada = flag.value === 'true' || (def.type === 'number' && Number(flag.value) > 0);
  const origem = ORIGEM_ROTULO[flag.source] ?? ORIGEM_ROTULO.padrao;
  const [rascunho, setRascunho] = useState(flag.value);

  const alternar = () => {
    const proximo = flag.value === 'true' ? 'false' : 'true';
    // Confirmação só no que dói: função de risco alto ou vendida na vitrine.
    if ((def.risk === 'alto' || def.soldOnSite) && proximo === 'false') {
      const aviso = def.soldOnSite
        ? `"${def.label}" é vendida na vitrine do site. Desligar torna uma afirmação pública falsa.\n\n${def.description}\n\nDesligar mesmo assim?`
        : `${def.description}\n\nDesligar "${def.label}"?`;
      if (!window.confirm(aviso)) return;
    }
    onSalvar(proximo);
  };

  return (
    <Card className="border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{def.label}</h3>
            {def.soldOnSite && (
              <Badge
                className="border-purple-500/30 bg-purple-500/15 text-purple-300"
                title="A landing page vende esta função. Desligar torna uma afirmação pública falsa."
              >
                vendida na vitrine
              </Badge>
            )}
            <Badge className={RISCO_ROTULO[def.risk]}>risco {def.risk}</Badge>
            <Badge className={origem.classe} title={origem.ajuda}>
              {origem.texto}
            </Badge>
          </div>

          <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{def.description}</p>
          <p className="mt-1.5 font-mono text-[11px] text-zinc-600">{flag.key}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {def.type === 'boolean' ? (
            <button
              type="button"
              onClick={alternar}
              disabled={salvando}
              role="switch"
              aria-checked={ligada}
              aria-label={`${ligada ? 'Desligar' : 'Ligar'} ${def.label}`}
              className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-40 ${
                ligada ? 'bg-emerald-500' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                  ligada ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                disabled={salvando}
                className="w-20 rounded border border-white/10 bg-black/40 px-2 py-1 text-right text-sm text-white"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={salvando || rascunho === flag.value}
                onClick={() => onSalvar(rascunho)}
              >
                salvar
              </Button>
            </div>
          )}

          {flag.source === 'banco' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={salvando}
              onClick={onLimpar}
              title="Remove o override e devolve o controle para a variável de ambiente do Render"
            >
              reverter
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function AdminPage() {
  useSeo({ title: 'Admin · Tickrify', description: 'Área interna.', path: '/admin', noindex: true });
  const { flags, cache, isLoading, error, semAcesso, setFlag, clearFlag } = useFeatureFlags();
  const { toast } = useToast();

  const salvando = setFlag.isPending || clearFlag.isPending;

  const salvar = (key: string, value: string) =>
    setFlag.mutate(
      { key, value },
      {
        onSuccess: (f) =>
          toast({
            title: `${f.definition.label}: ${f.value}`,
            description:
              'Vale na hora para a API. O worker (onde a análise roda) pega em até 1 minuto.',
          }),
        onError: (e) => toast({ title: 'Não salvou', description: e.message, variant: 'destructive' }),
      },
    );

  if (semAcesso) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)] px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold text-white">Sem acesso</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Esta área é restrita a administradores.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-base)] px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-white">Loja de apps</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Liga e desliga funções sem redeploy. Toda mudança fica registrada com autor e horário.
          </p>
        </header>

        {cache && (
          <div className="mb-5 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-zinc-400">
            {cache.ultimoErro ? (
              <span className="text-amber-300">
                Banco de flags indisponível — tudo está resolvendo pela variável de ambiente.
                Nada quebrou, mas mudanças feitas aqui não vão valer até voltar. ({cache.ultimoErro})
              </span>
            ) : (
              <>
                {cache.overridesNoBanco} função(ões) definida(s) por este painel; o resto vem do
                Render ou do padrão do código.
              </>
            )}
          </div>
        )}

        {isLoading && <p className="text-sm text-zinc-500">Carregando…</p>}
        {error && !semAcesso && (
          <p className="text-sm text-red-400">Não deu para carregar: {error.message}</p>
        )}

        <div className="space-y-3">
          {flags.map((flag) => (
            <LinhaFlag
              key={flag.key}
              flag={flag}
              salvando={salvando}
              onSalvar={(valor) => salvar(flag.key, valor)}
              onLimpar={() => clearFlag.mutate(flag.key)}
            />
          ))}
        </div>

        <RelatosPainel />

        <p className="mt-6 text-xs leading-relaxed text-zinc-600">
          A análise roda no worker, que é um processo separado com o próprio cache: mudanças levam
          até 1 minuto para valer lá. O <code>/api/health</code> mostra o valor efetivo de cada
          função e de onde ele veio.
        </p>
      </div>
    </div>
  );
}
