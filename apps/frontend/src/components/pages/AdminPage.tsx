import { useState } from 'react';
import { useAffiliateAdmin } from '@/hooks/useAffiliates';
import { useProblemReports } from '@/hooks/useProblemReports';
import { useFeatureFlags, type ResolvedFlag } from '@/hooks/useFeatureFlags';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useSeo, seoFor } from '@/hooks/useSeo';
import RelatosPainel, { OpinioesBonusPainel } from '@/components/admin/RelatosPainel';
import NotasPainel from '@/components/admin/NotasPainel';
import OrigemPainel from '@/components/admin/OrigemPainel';
import AfiliadosPainel from '@/components/admin/AfiliadosPainel';
import ChatPainel from '@/components/admin/ChatPainel';
import CancelamentosPainel from '@/components/admin/CancelamentosPainel';
import MotorPainel from '@/components/admin/MotorPainel';
import InicioPainel from '@/components/admin/InicioPainel';
import InspetorPainel from '@/components/admin/InspetorPainel';
import UsuarioPainel from '@/components/admin/UsuarioPainel';
import { useAdminChatThreads } from '@/lib/support-chat';

/**
 * Painel do dono. Em cima, o que pede acao (pedidos de afiliado, saques,
 * relatos); embaixo, abas com uma coisa por vez. As chaves do motor (a antiga
 * "Loja de apps") ficam na ultima aba, porque quase nunca se mexe nelas.
 *
 * PÁGINA INTERNA, NÃO PÚBLICA. `noindex` obrigatório: o /sign-in já foi parar
 * no índice do Google porque `Disallow` no robots.txt impede RASTREAR, não
 * INDEXAR. Uma URL /admin no índice é convite.
 *
 * O gate de verdade é do servidor (AuthGuard + AdminGuard). O que esta tela faz
 * com o 403 é escolher o que desenhar — ela nunca concede acesso a nada.
 */

/**
 * Só chaves de e-mail e de operação aparecem aqui. As do motor (contexto de
 * mercado, guarda de evento, modo demo) existem no código, mas não se mexe nelas
 * por este painel: o motor só muda na revisão mensal.
 */
const CHAVES_DE_OPERACAO = /^(EMAIL_|TELEGRAM_|CHAT_|TRIAL_|ENABLE_OUTCOME_TRACKING$)/;

const ORIGEM_ROTULO: Record<string, { texto: string; classe: string; ajuda: string }> = {
  banco: {
    texto: 'definido aqui',
    classe: 'border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] text-[var(--signal-buy)]',
    ajuda: 'Alguém mudou por este painel. Vence a variável de ambiente do Render.',
  },
  ambiente: {
    texto: 'vem do Render',
    classe: 'border-[var(--border-strong)] bg-[var(--fill-2)] text-[var(--tone-info-1)]',
    ajuda: 'Valor herdado da variável de ambiente. Mudar aqui passa a ignorá-la.',
  },
  padrao: {
    texto: 'padrão do código',
    classe: 'border-[var(--border-strong)] bg-[var(--fill-2)] text-[var(--text-dim)]',
    ajuda: 'Nada configurado em lugar nenhum: é o comportamento histórico do código.',
  },
};

const RISCO_ROTULO: Record<string, string> = {
  alto: 'border-[var(--signal-sell-border)] bg-[var(--signal-sell-bg)] text-[var(--signal-sell)]',
  medio: 'border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)] text-[var(--signal-hold)]',
  baixo: 'border-[var(--border-strong)] bg-[var(--fill-2)] text-[var(--text-dim)]',
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
    <Card className="border-[var(--border-strong)] bg-[var(--fill-1)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{def.label}</h3>
            {def.soldOnSite && (
              <Badge
                className="border-[var(--border-strong)] bg-[var(--fill-2)] text-[var(--tone-violet-1)]"
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

          <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-dim)]">{def.description}</p>
          <p className="mt-1.5 font-mono text-[11px] text-[var(--text-ghost)]">{flag.key}</p>
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
              // `left-0` e `shrink-0`: sem eles a bolinha partia do CENTRO do
              // botao e, ligada, saia para fora do trilho (05/10/2026).
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                ligada ? 'bg-[var(--signal-buy)]' : 'bg-[var(--fill-strong)]'
              }`}
            >
              <span
                className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-[var(--inverse-bg)] transition-transform ${
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
                className="w-20 rounded border border-[var(--border-strong)] bg-[var(--bg-inset)] px-2 py-1 text-right text-sm text-[var(--text-primary)]"
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

type Aba = 'inicio' | 'inspetor' | 'usuario' | 'chat' | 'afiliados' | 'origem' | 'relatos' | 'opinioes' | 'config' | 'cancelamentos' | 'motor';

/** Contador do topo. Zero fica apagado; acima de zero chama atencao e leva a aba. */
function Pendencia({ n, rotulo, onClick }: { n: number | null; rotulo: string; onClick: () => void }) {
  const ativo = (n ?? 0) > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-0 rounded-xl border px-4 py-3 text-left transition-colors ${
        ativo ? 'border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)]' : 'border-[var(--border-strong)] bg-[var(--fill-1)] hover:bg-[var(--fill-2)]'
      }`}
    >
      <div className={`text-2xl font-semibold ${ativo ? 'text-[var(--signal-hold)]' : 'text-[var(--text-faint)]'}`}>{n ?? '·'}</div>
      <div className="mt-0.5 text-xs text-[var(--text-dim)]">{rotulo}</div>
    </button>
  );
}

const ABAS: Array<{ chave: Aba; rotulo: string }> = [
  { chave: 'inicio', rotulo: 'Início' },
  { chave: 'inspetor', rotulo: 'Inspetor de análise' },
  { chave: 'usuario', rotulo: 'Usuário' },
  { chave: 'motor', rotulo: 'Motor' },
  { chave: 'chat', rotulo: 'Chat' },
  { chave: 'afiliados', rotulo: 'Afiliados' },
  { chave: 'origem', rotulo: 'Origem' },
  { chave: 'cancelamentos', rotulo: 'Cancelamentos' },
  { chave: 'relatos', rotulo: 'Relatos de problema' },
  { chave: 'opinioes', rotulo: 'Opiniões' },
  { chave: 'config', rotulo: 'Configurações' },
];

export default function AdminPage() {
  useSeo(seoFor('/admin'));
  const { flags, cache, isLoading, error, semAcesso, setFlag, clearFlag } = useFeatureFlags();
  const { toast } = useToast();
  // `?aba=chat` vem do e-mail de aviso de mensagem nova.
  const [aba, setAba] = useState<Aba>(() => {
    const pedida = new URLSearchParams(window.location.search).get('aba');
    return ABAS.some((a) => a.chave === pedida) ? (pedida as Aba) : 'inicio';
  });
  // Links entre abas: da ficha da pessoa para a análise, da análise para a pessoa.
  const [analiseAberta, setAnaliseAberta] = useState<string | null>(null);
  const [usuarioAberto, setUsuarioAberto] = useState<string | null>(null);
  const irParaAnalise = (id: string) => {
    setAnaliseAberta(id);
    setAba('inspetor');
  };
  const irParaUsuario = (id: string) => {
    setUsuarioAberto(id);
    setAba('usuario');
  };
  const conversas = useAdminChatThreads();
  const conversasNovas = conversas.data ? conversas.data.items.filter((t) => t.unread > 0).length : null;
  const { affiliates, payouts } = useAffiliateAdmin();
  const { contagem } = useProblemReports('aberto');
  const { contagem: contagemOpinioes } = useProblemReports('aberto', 'feedback');

  const pedidosAfiliado = affiliates.data ? affiliates.data.filter((a) => a.status === 'PENDING').length : null;
  const saquesAbertos = payouts.data
    ? payouts.data.filter((p) => p.status === 'REQUESTED' || p.status === 'APPROVED').length
    : null;
  const relatosAbertos = contagem.aberto ?? 0;
  const opinioesNovas = contagemOpinioes.aberto ?? 0;
  const nadaPendente =
    pedidosAfiliado === 0 && saquesAbertos === 0 && relatosAbertos === 0 && opinioesNovas === 0 && (conversasNovas ?? 0) === 0;

  const salvando = setFlag.isPending || clearFlag.isPending;
  const chavesVisiveis = flags.filter((f) => CHAVES_DE_OPERACAO.test(f.key));

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
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Sem acesso</h1>
          <p className="mt-2 text-sm text-[var(--text-dim)]">
            Esta área é restrita a administradores.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-base)] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-[1600px]">
        <header className="mb-4">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Painel</h1>
          <p className="mt-1 text-sm text-[var(--text-dim)]">O que precisa de você:</p>
        </header>

        {nadaPendente ? (
          <div className="mb-6 rounded-xl border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-4 py-3 text-sm text-[var(--signal-buy)]">
            Nada pendente. Tudo em dia.
          </div>
        ) : (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Pendencia n={conversasNovas} rotulo="conversas com mensagem nova" onClick={() => setAba('chat')} />
            <Pendencia n={pedidosAfiliado} rotulo="pedidos de afiliado para aprovar" onClick={() => setAba('afiliados')} />
            <Pendencia n={saquesAbertos} rotulo="saques de afiliado para pagar" onClick={() => setAba('afiliados')} />
            <Pendencia n={relatosAbertos} rotulo="relatos de problema abertos" onClick={() => setAba('relatos')} />
            <Pendencia n={opinioesNovas} rotulo="opiniões novas" onClick={() => setAba('opinioes')} />
          </div>
        )}

        <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-[var(--border-strong)]" role="tablist">
          {ABAS.map((a) => (
            <button
              key={a.chave}
              type="button"
              role="tab"
              aria-selected={aba === a.chave}
              onClick={() => setAba(a.chave)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                aba === a.chave ? 'border-[var(--text-primary)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-faint)] hover:text-[var(--text-soft)]'
              }`}
            >
              {a.rotulo}
            </button>
          ))}
        </nav>

        {aba === 'inicio' && <InicioPainel />}

        {aba === 'inspetor' && <InspetorPainel analiseInicial={analiseAberta} onUsuario={irParaUsuario} />}

        {aba === 'usuario' && <UsuarioPainel usuarioInicial={usuarioAberto} onAnalise={irParaAnalise} onChat={() => setAba('chat')} />}

        {aba === 'chat' && <ChatPainel />}

        {aba === 'afiliados' && <AfiliadosPainel />}

        {aba === 'relatos' && <RelatosPainel />}

        {aba === 'opinioes' && (
          <div className="flex flex-col gap-8">
            <OpinioesBonusPainel />
            <NotasPainel />
            <RelatosPainel kind="feedback" />
          </div>
        )}

        {aba === 'origem' && <OrigemPainel />}

        {aba === 'cancelamentos' && <CancelamentosPainel />}

        {aba === 'motor' && <MotorPainel />}

        {aba === 'config' && (
          <>
            <div className="mb-5 rounded-lg border border-[var(--border-strong)] bg-[var(--fill-1)] px-4 py-3 text-sm text-[var(--text-soft)]">
              Você não precisa mexer aqui no dia a dia. Estas são as chaves de e-mail, Telegram, chat, trial e medição de
              acerto. Desligar algo marcado como &quot;vendida na vitrine&quot; torna falsa uma promessa do site.
              {cache?.ultimoErro && (
                <span className="mt-2 block text-[var(--tone-warn-1)]">
                  O banco destas chaves não respondeu, então vale o que está no Render. Nada quebrou, mas mudanças feitas
                  aqui só valem quando ele voltar.
                </span>
              )}
            </div>

            {isLoading && <p className="text-sm text-[var(--text-faint)]">Carregando…</p>}
            {error && !semAcesso && (
              <p className="text-sm text-[var(--tone-down-2)]">Não deu para carregar: {error.message}</p>
            )}

            <div className="grid gap-3 xl:grid-cols-2">
              {chavesVisiveis.map((flag) => (
                <LinhaFlag
                  key={flag.key}
                  flag={flag}
                  salvando={salvando}
                  onSalvar={(valor) => salvar(flag.key, valor)}
                  onLimpar={() => clearFlag.mutate(flag.key)}
                />
              ))}
            </div>

            <p className="mt-6 text-xs leading-relaxed text-[var(--text-ghost)]">
              Mudanças valem na hora para o site e em até 1 minuto para a análise.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
