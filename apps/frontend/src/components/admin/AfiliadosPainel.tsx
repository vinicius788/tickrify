import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  AFFILIATE_CODE_PATTERN,
  cleanAffiliateCode,
  formatUsd,
  useAffiliateAdmin,
  useAffiliateProgram,
  useAffiliateAdminDetail,
  type AdminAffiliate,
  type AdminPayout,
  type AffiliateStatus,
} from '@/hooks/useAffiliates';

/**
 * Afiliados no /admin, na ordem do que pede acao: pedidos para aprovar, saques
 * para pagar, e so depois a lista de afiliados (edicao escondida atras de
 * "editar"). Todo numero vem do servidor; a taxa vai em pontos-base
 * (2000 = 20%) e o backend recusa acima de 50%.
 */

type Patch = Partial<Pick<AdminAffiliate, 'status' | 'commissionRateBps' | 'referralCode' | 'couponCode'>>;

const STATUS: Record<AffiliateStatus, { texto: string; classe: string }> = {
  PENDING: { texto: 'aguardando aprovação', classe: 'border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)] text-[var(--signal-hold)]' },
  ACTIVE: { texto: 'ativo', classe: 'border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] text-[var(--signal-buy)]' },
  REJECTED: { texto: 'rejeitado', classe: 'border-[var(--border-strong)] bg-[var(--fill-2)] text-[var(--text-dim)]' },
  SUSPENDED: { texto: 'suspenso', classe: 'border-[var(--signal-sell-border)] bg-[var(--signal-sell-bg)] text-[var(--signal-sell)]' },
};

const STATUS_SAQUE: Record<AdminPayout['status'], string> = {
  REQUESTED: 'pedido',
  APPROVED: 'aprovado, falta pagar',
  PAID: 'pago',
  REJECTED: 'rejeitado',
};

const COMISSAO: Record<string, string> = {
  PENDING: 'segurando 30 dias',
  AVAILABLE: 'disponível',
  PAID: 'paga',
  CANCELLED: 'cancelada',
};

const CANAL: Record<string, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X (Twitter)',
  telegram: 'Telegram',
  discord: 'Discord',
  website: 'Site ou blog',
  other: 'Outro',
};

const AUDIENCIA: Record<string, string> = {
  under_1k: 'menos de 1 mil',
  '1k_10k': '1 mil a 10 mil',
  '10k_50k': '10 mil a 50 mil',
  '50k_plus': 'mais de 50 mil',
};

/** Link do pedido so vira clicavel se for https (o servidor ja exige; aqui e a segunda trava). */
const linkSeguro = (url: string) => (/^https:\/\//i.test(url) ? url : null);

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
const campo = 'w-full rounded border border-[var(--border-strong)] bg-[var(--bg-inset)] px-2 py-1.5 text-base text-[var(--text-primary)] sm:w-32 sm:text-sm';

function Titulo({ children, n }: { children: string; n?: number }) {
  return (
    <h3 className="mb-3 mt-8 text-sm font-semibold text-[var(--text-soft)] first:mt-0">
      {children}
      {n !== undefined && <span className="ml-1.5 text-[var(--text-faint)]">({n})</span>}
    </h3>
  );
}

function Vazio({ children }: { children: string }) {
  return <p className="rounded-lg border border-[var(--border-subtle)] px-4 py-3 text-sm text-[var(--text-faint)]">{children}</p>;
}

/** Clientes indicados e comissoes de um afiliado. */
function Detalhe({ id }: { id: string }) {
  const { data, isLoading, error } = useAffiliateAdminDetail(id);
  if (isLoading) return <p className="mt-3 text-xs text-[var(--text-faint)]">Carregando…</p>;
  if (error || !data) return <p className="mt-3 text-xs text-[var(--tone-down-2)]">Não carregou: {error?.message}</p>;
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-xs text-[var(--text-dim)]">
      <div>
        <p className="mb-1 font-semibold text-[var(--text-soft)]">Clientes que ele trouxe ({data.referrals.length})</p>
        {data.referrals.length === 0 && <p>Nenhum ainda.</p>}
        {data.referrals.map((r) => (
          <p key={r.id}>
            {r.email ?? 'sem e-mail'} · veio pelo {r.source === 'coupon' ? 'cupom' : 'link'} em {dia(r.createdAt)}
            {r.firstPaidAt ? ` · pagou pela 1ª vez em ${dia(r.firstPaidAt)}` : ' · ainda não pagou'}
          </p>
        ))}
      </div>
      <div>
        <p className="mb-1 font-semibold text-[var(--text-soft)]">Comissões ({data.commissions.length})</p>
        {data.commissions.length === 0 && <p>Nenhuma ainda.</p>}
        {data.commissions.map((c) => (
          <p key={c.id}>
            {dia(c.createdAt)} · cliente pagou {formatUsd(c.amountPaidCents)} · comissão {formatUsd(c.commissionCents)} (
            {c.rateBps / 100}%) · {COMISSAO[c.status] ?? c.status}
            {c.status === 'PENDING' ? ` até ${dia(c.availableAt)}` : ''}
            {c.cancelledReason ? ` (${c.cancelledReason === 'refund' ? 'reembolso' : 'disputa'})` : ''}
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * Pedido pendente. O codigo que a pessoa escolheu vem preenchido e pode ser
 * trocado antes de aprovar; aprovar manda o mesmo codigo para o cupom e para o
 * link. Se a Stripe recusar, o pedido continua pendente e o motivo fica aqui.
 */
function PedidoAfiliado({
  afiliado,
  ocupado,
  semCupom,
  erro,
  onSalvar,
}: {
  afiliado: AdminAffiliate;
  ocupado: boolean;
  semCupom: boolean;
  erro: string | null;
  onSalvar: (patch: Patch) => void;
}) {
  const quem = afiliado.email ?? afiliado.referralCode;
  const [codigo, setCodigo] = useState(afiliado.couponCode);
  const codigoOk = AFFILIATE_CODE_PATTERN.test(codigo);
  const aprovar = () =>
    onSalvar({
      status: 'ACTIVE',
      ...(codigo !== afiliado.couponCode ? { couponCode: codigo } : {}),
      ...(codigo !== afiliado.referralCode ? { referralCode: codigo } : {}),
    });
  return (
    <Card className="border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{quem}</p>
          <p className="mt-0.5 text-xs text-[var(--text-dim)]">Pediu para ser afiliado em {dia(afiliado.createdAt)}</p>
          <label className="mt-3 flex flex-col gap-1 text-xs text-[var(--text-dim)]">
            Código de cupom (vale também para o link ?ref=). Pode trocar antes de aprovar.
            <input
              className={`${campo} font-mono uppercase sm:w-44`}
              value={codigo}
              maxLength={20}
              onChange={(e) => setCodigo(cleanAffiliateCode(e.target.value))}
              disabled={ocupado}
            />
          </label>
          {!codigoOk && <p className="mt-1 text-xs text-[var(--tone-down-2)]">Use 4 a 20 letras (A a Z) ou números.</p>}
          {erro && (
            <p className="mt-2 rounded border border-[var(--signal-sell-border)] bg-[var(--signal-sell-bg)] px-2 py-1.5 text-xs text-[var(--signal-sell)]">
              Não aprovado: {erro}
            </p>
          )}
          {afiliado.application ? (
            <div className="mt-3 space-y-1.5 text-sm text-[var(--text-soft)]">
              <p>
                <span className="text-[var(--text-faint)]">Canal:</span>{' '}
                {afiliado.application.platform ? CANAL[afiliado.application.platform] ?? afiliado.application.platform : 'não informado'}
                {' · '}
                <span className="text-[var(--text-faint)]">Audiência:</span>{' '}
                {afiliado.application.audience ? AUDIENCIA[afiliado.application.audience] ?? afiliado.application.audience : 'não informada'}
              </p>
              <p className="break-all">
                <span className="text-[var(--text-faint)]">Link:</span>{' '}
                {!afiliado.application.url ? (
                  'não informado'
                ) : linkSeguro(afiliado.application.url) ? (
                  <a
                    href={afiliado.application.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-[var(--tone-info-1)] underline underline-offset-2"
                  >
                    {afiliado.application.url}
                  </a>
                ) : (
                  afiliado.application.url
                )}
              </p>
              {afiliado.application.note ? (
                <p className="whitespace-pre-wrap">
                  <span className="text-[var(--text-faint)]">Recado:</span> {afiliado.application.note}
                </p>
              ) : null}
              <p className="text-xs text-[var(--text-faint)]">Se houver link, abra e confira se a comunidade combina com a Tickrify antes de aprovar.</p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-[var(--text-faint)]">Não preencheu nada além do e-mail da conta.</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <Button size="sm" disabled={ocupado || !codigoOk} onClick={aprovar}>
              Aprovar com {codigoOk ? codigo : 'o código'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={ocupado}
              onClick={() => window.confirm(`Rejeitar o pedido de ${quem}?`) && onSalvar({ status: 'REJECTED' })}
            >
              Rejeitar
            </Button>
          </div>
          {semCupom && (
            <p className="max-w-[220px] text-right text-[11px] text-[var(--text-faint)]">
              Para aprovar falta o cupom de afiliado na Stripe (aviso no topo).
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function LinhaAfiliado({
  afiliado,
  ocupado,
  onSalvar,
  onPagar,
}: {
  afiliado: AdminAffiliate;
  ocupado: boolean;
  onSalvar: (patch: Patch) => void;
  onPagar: (note?: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [detalhe, setDetalhe] = useState(false);
  const [taxa, setTaxa] = useState(String(afiliado.commissionRateBps / 100));
  const [ref, setRef] = useState(afiliado.referralCode);
  const [cupom, setCupom] = useState(afiliado.couponCode);

  const quem = afiliado.email ?? afiliado.referralCode;
  const taxaBps = Math.round(Number(taxa.replace(',', '.')) * 100);
  const mudou =
    taxaBps !== afiliado.commissionRateBps ||
    ref.toUpperCase() !== afiliado.referralCode ||
    cupom.toUpperCase() !== afiliado.couponCode;

  const salvar = () => {
    if (!Number.isInteger(taxaBps) || taxaBps < 0 || taxaBps > 5000) {
      window.alert('A comissão tem que ficar entre 0 e 50%.');
      return;
    }
    onSalvar({
      ...(taxaBps !== afiliado.commissionRateBps ? { commissionRateBps: taxaBps } : {}),
      ...(ref.toUpperCase() !== afiliado.referralCode ? { referralCode: ref } : {}),
      ...(cupom.toUpperCase() !== afiliado.couponCode ? { couponCode: cupom } : {}),
    });
    setEditando(false);
  };

  const status = STATUS[afiliado.status];

  return (
    <Card className="border-[var(--border-strong)] bg-[var(--fill-1)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{quem}</p>
            <Badge className={status.classe}>{status.texto}</Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--text-dim)]">
            Comissão {afiliado.commissionRateBps / 100}% · código <span className="font-mono">{afiliado.couponCode}</span>
          </p>
          <p className="mt-1 text-xs text-[var(--text-dim)]">
            {`${afiliado.clicks} cliques no link · ${afiliado.signups} cadastros · ${afiliado.paidSales} vendas pagas (${afiliado.paidCustomers} clientes) · receita ${formatUsd(afiliado.revenueCents)}`}
          </p>
          <p className="mt-1 text-xs text-[var(--text-dim)]">
            Comissão devida: {formatUsd(afiliado.pendingCents + afiliado.availableCents)} (disponível para pagar:{' '}
            {formatUsd(afiliado.availableCents)}, em carência de 30 dias: {formatUsd(afiliado.pendingCents)}) · já paga:{' '}
            {formatUsd(afiliado.paidCents)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {afiliado.status === 'ACTIVE' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={ocupado}
              onClick={() =>
                window.confirm(`Suspender ${quem}? O link e o cupom param de funcionar. O que ele já ganhou continua valendo.`) &&
                onSalvar({ status: 'SUSPENDED' })
              }
            >
              Suspender
            </Button>
          )}
          {(afiliado.status === 'SUSPENDED' || afiliado.status === 'REJECTED') && (
            <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => onSalvar({ status: 'ACTIVE' })}>
              {afiliado.status === 'SUSPENDED' ? 'Reativar' : 'Aprovar'}
            </Button>
          )}
          {afiliado.availableCents > 0 && (
            <Button
              size="sm"
              variant="secondary"
              disabled={ocupado}
              onClick={() => {
                const nota = window.prompt(
                  `Registrar que você pagou ${formatUsd(afiliado.availableCents)} a ${quem} (Pix)? Nota opcional, ex.: id do Pix.`,
                  '',
                );
                if (nota !== null) onPagar(nota.trim() || undefined);
              }}
            >
              Marcar como pago
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setEditando((v) => !v)}>
            {editando ? 'Cancelar' : 'Editar'}
          </Button>
        </div>
      </div>

      {editando && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-3 text-xs text-[var(--text-dim)]">
          <label className="flex w-full flex-col gap-1 sm:w-auto">
            Comissão (%)
            <input className={campo} value={taxa} onChange={(e) => setTaxa(e.target.value)} disabled={ocupado} />
          </label>
          <label className="flex w-full flex-col gap-1 sm:w-auto">
            Código do link (?ref=)
            <input className={campo} value={ref} onChange={(e) => setRef(e.target.value)} disabled={ocupado} />
          </label>
          <label className="flex w-full flex-col gap-1 sm:w-auto">
            Código de cupom
            <input className={campo} value={cupom} onChange={(e) => setCupom(e.target.value)} disabled={ocupado} />
          </label>
          <Button size="sm" disabled={ocupado || !mudou} onClick={salvar}>
            Salvar
          </Button>
          <p className="w-full text-[11px] text-[var(--text-faint)]">
            Trocar o código de cupom desativa o antigo na Stripe e cria o novo. As vendas antigas continuam deste afiliado.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => setDetalhe((v) => !v)}
        className="mt-3 text-xs text-[var(--text-faint)] underline-offset-2 hover:text-[var(--text-soft)] hover:underline"
      >
        {detalhe ? 'Esconder' : 'Ver'} clientes e comissões
      </button>
      {detalhe && <Detalhe id={afiliado.id} />}
    </Card>
  );
}

function LinhaSaque({
  saque,
  ocupado,
  onDecidir,
}: {
  saque: AdminPayout;
  ocupado: boolean;
  onDecidir: (action: 'approve' | 'reject' | 'mark_paid', note?: string) => void;
}) {
  const pedirNota = (action: 'reject' | 'mark_paid') => {
    const nota = window.prompt(
      action === 'reject' ? 'Por que está rejeitando? (fica registrado)' : 'Anote a referência do pagamento (ex.: id da transação do PayPal):',
    );
    if (nota === null) return;
    onDecidir(action, nota.trim() || undefined);
  };
  const aberto = saque.status === 'REQUESTED' || saque.status === 'APPROVED';
  return (
    <Card className={`p-4 ${aberto ? 'border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)]' : 'border-[var(--border-strong)] bg-[var(--fill-1)]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {formatUsd(saque.amountCents)} para {saque.affiliate.user.email ?? saque.affiliate.referralCode}
          </p>
          <p className="mt-1 break-all text-xs text-[var(--text-soft)]">Enviar para: {saque.method}</p>
          <p className="mt-1 text-xs text-[var(--text-faint)]">
            Pedido em {dia(saque.requestedAt)} · {STATUS_SAQUE[saque.status]}
            {saque.paidAt ? ` em ${dia(saque.paidAt)}` : ''}
            {saque.adminNote ? ` · nota: ${saque.adminNote}` : ''}
          </p>
        </div>
        {aberto && (
          <div className="flex flex-wrap gap-2">
            {saque.status === 'REQUESTED' ? (
              <Button size="sm" disabled={ocupado} onClick={() => onDecidir('approve')}>
                Aprovar
              </Button>
            ) : (
              <Button size="sm" disabled={ocupado} onClick={() => pedirNota('mark_paid')}>
                Já paguei
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => pedirNota('reject')}>
              Rejeitar
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function AfiliadosPainel() {
  const { affiliates, payouts, update, decide, settle } = useAffiliateAdmin();
  const { data: programa } = useAffiliateProgram();
  const { toast } = useToast();
  const [historico, setHistorico] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  // Desconto do cliente vem do cupom de STRIPE_AFFILIATE_COUPON_ID; null = falta
  // ou esta invalido (o servidor recusa a aprovacao e diz o motivo exato).
  const semCupom = Boolean(programa) && programa?.customerDiscountPercent == null;

  if (affiliates.error?.message === 'SEM_ACESSO') return null;

  const salvar = (id: string, patch: Patch) =>
    update.mutate(
      { id, patch },
      {
        onSuccess: () => {
          setErros(({ [id]: _antigo, ...resto }) => resto);
          toast({
            title:
              patch.status === 'ACTIVE'
                ? 'Afiliado aprovado'
                : patch.status === 'REJECTED'
                  ? 'Pedido rejeitado'
                  : patch.status === 'SUSPENDED'
                    ? 'Afiliado suspenso'
                    : 'Salvo',
          });
        },
        onError: (e) => {
          if (patch.status === 'ACTIVE') setErros((atual) => ({ ...atual, [id]: e.message }));
          toast({ title: 'Não salvou', description: e.message, variant: 'destructive' });
        },
      },
    );

  const pagar = (id: string, note?: string) =>
    settle.mutate(
      { id, note },
      {
        onSuccess: (r) => toast({ title: `Pagamento de ${formatUsd(r.amountCents)} registrado` }),
        onError: (e) => toast({ title: 'Não salvou', description: e.message, variant: 'destructive' }),
      },
    );

  const decidir = (id: string, action: 'approve' | 'reject' | 'mark_paid', note?: string) =>
    decide.mutate(
      { id, action, note },
      {
        onSuccess: () =>
          toast({ title: action === 'mark_paid' ? 'Saque marcado como pago' : action === 'approve' ? 'Saque aprovado' : 'Saque rejeitado' }),
        onError: (e) => toast({ title: 'Não salvou', description: e.message, variant: 'destructive' }),
      },
    );

  const lista = affiliates.data ?? [];
  const pedidos = lista.filter((a) => a.status === 'PENDING');
  const demais = lista.filter((a) => a.status !== 'PENDING');
  const saques = payouts.data ?? [];
  const saquesAbertos = saques.filter((s) => s.status === 'REQUESTED' || s.status === 'APPROVED');
  const saquesFechados = saques.filter((s) => s.status === 'PAID' || s.status === 'REJECTED');

  if (affiliates.isLoading) return <p className="text-sm text-[var(--text-faint)]">Carregando…</p>;
  if (affiliates.error) return <p className="text-sm text-[var(--tone-down-2)]">Não carregou: {affiliates.error.message}</p>;

  return (
    <section>
      {semCupom && (
        <Card className="mb-6 border-[var(--signal-sell-border)] bg-[var(--signal-sell-bg)] p-4 text-sm text-[var(--text-soft)]">
          <p className="font-semibold text-[var(--signal-sell)]">Falta o cupom de afiliado: nenhum pedido pode ser aprovado.</p>
          <p className="mt-1">
            Na Stripe, crie um cupom de 10% com duração "once" (Produtos, Cupons). Copie o id dele e ponha em
            STRIPE_AFFILIATE_COUPON_ID no Render (Environment). Salvar a variável reinicia o serviço; depois é só aprovar.
          </p>
        </Card>
      )}
      <Titulo n={pedidos.length}>Pedidos para aprovar</Titulo>
      {pedidos.length === 0 ? (
        <Vazio>Nenhum pedido novo.</Vazio>
      ) : (
        <div className="space-y-3">
          {pedidos.map((a) => (
            <PedidoAfiliado
              key={a.id}
              afiliado={a}
              ocupado={update.isPending}
              semCupom={semCupom}
              erro={erros[a.id] ?? null}
              onSalvar={(p) => salvar(a.id, p)}
            />
          ))}
        </div>
      )}

      <Titulo n={saquesAbertos.length}>Saques para pagar</Titulo>
      <p className="-mt-2 mb-3 text-xs text-[var(--text-faint)]">
        O pagamento é feito por você, fora do site (PayPal, Pix, etc.). Aqui você só registra.
      </p>
      {payouts.error && <p className="text-sm text-[var(--tone-down-2)]">{payouts.error.message}</p>}
      {saquesAbertos.length === 0 ? (
        <Vazio>Nenhum saque esperando.</Vazio>
      ) : (
        <div className="space-y-3">
          {saquesAbertos.map((s) => (
            <LinhaSaque key={s.id} saque={s} ocupado={decide.isPending} onDecidir={(action, note) => decidir(s.id, action, note)} />
          ))}
        </div>
      )}
      {saquesFechados.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setHistorico((v) => !v)}
            className="mt-3 text-xs text-[var(--text-faint)] underline-offset-2 hover:text-[var(--text-soft)] hover:underline"
          >
            {historico ? 'Esconder' : 'Ver'} saques antigos ({saquesFechados.length})
          </button>
          {historico && (
            <div className="mt-3 space-y-3">
              {saquesFechados.map((s) => (
                <LinhaSaque key={s.id} saque={s} ocupado={decide.isPending} onDecidir={() => undefined} />
              ))}
            </div>
          )}
        </>
      )}

      <Titulo n={demais.length}>Afiliados</Titulo>
      <p className="-mt-2 mb-3 text-xs text-[var(--text-faint)]">
        Comissão padrão de 20%. Ela não aparece no site: cada afiliado só vê a própria.
      </p>
      {demais.length === 0 ? (
        <Vazio>Nenhum afiliado aprovado ainda.</Vazio>
      ) : (
        <div className="space-y-3">
          {demais.map((a) => (
            <LinhaAfiliado
              key={a.id}
              afiliado={a}
              ocupado={update.isPending || settle.isPending}
              onSalvar={(p) => salvar(a.id, p)}
              onPagar={(note) => pagar(a.id, note)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
