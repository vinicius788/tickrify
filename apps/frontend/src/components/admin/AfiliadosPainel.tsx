import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  formatUsd,
  useAffiliateAdmin,
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
  PENDING: { texto: 'aguardando aprovação', classe: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  ACTIVE: { texto: 'ativo', classe: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  REJECTED: { texto: 'rejeitado', classe: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30' },
  SUSPENDED: { texto: 'suspenso', classe: 'bg-red-500/15 text-red-300 border-red-500/30' },
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
const campo = 'w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-base text-white sm:w-32 sm:text-sm';

function Titulo({ children, n }: { children: string; n?: number }) {
  return (
    <h3 className="mb-3 mt-8 text-sm font-semibold text-zinc-200 first:mt-0">
      {children}
      {n !== undefined && <span className="ml-1.5 text-zinc-500">({n})</span>}
    </h3>
  );
}

function Vazio({ children }: { children: string }) {
  return <p className="rounded-lg border border-white/5 px-4 py-3 text-sm text-zinc-500">{children}</p>;
}

/** Clientes indicados e comissoes de um afiliado. */
function Detalhe({ id }: { id: string }) {
  const { data, isLoading, error } = useAffiliateAdminDetail(id);
  if (isLoading) return <p className="mt-3 text-xs text-zinc-500">Carregando…</p>;
  if (error || !data) return <p className="mt-3 text-xs text-red-400">Não carregou: {error?.message}</p>;
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-white/5 bg-black/40 p-3 text-xs text-zinc-400">
      <div>
        <p className="mb-1 font-semibold text-zinc-300">Clientes que ele trouxe ({data.referrals.length})</p>
        {data.referrals.length === 0 && <p>Nenhum ainda.</p>}
        {data.referrals.map((r) => (
          <p key={r.id}>
            {r.email ?? 'sem e-mail'} · veio pelo {r.source === 'coupon' ? 'cupom' : 'link'} em {dia(r.createdAt)}
            {r.firstPaidAt ? ` · pagou pela 1ª vez em ${dia(r.firstPaidAt)}` : ' · ainda não pagou'}
          </p>
        ))}
      </div>
      <div>
        <p className="mb-1 font-semibold text-zinc-300">Comissões ({data.commissions.length})</p>
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

function PedidoAfiliado({
  afiliado,
  ocupado,
  onSalvar,
}: {
  afiliado: AdminAffiliate;
  ocupado: boolean;
  onSalvar: (patch: Patch) => void;
}) {
  const quem = afiliado.email ?? afiliado.referralCode;
  return (
    <Card className="border-amber-500/30 bg-amber-500/[0.04] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{quem}</p>
          <p className="mt-0.5 text-xs text-zinc-400">Pediu para ser afiliado em {dia(afiliado.createdAt)}</p>
          {afiliado.application ? (
            <div className="mt-3 space-y-1.5 text-sm text-zinc-300">
              <p>
                <span className="text-zinc-500">Canal:</span> {CANAL[afiliado.application.platform] ?? afiliado.application.platform}
                {' · '}
                <span className="text-zinc-500">Audiência:</span>{' '}
                {AUDIENCIA[afiliado.application.audience] ?? afiliado.application.audience}
              </p>
              <p className="break-all">
                <span className="text-zinc-500">Link:</span>{' '}
                {linkSeguro(afiliado.application.url) ? (
                  <a
                    href={afiliado.application.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-sky-300 underline underline-offset-2"
                  >
                    {afiliado.application.url}
                  </a>
                ) : (
                  afiliado.application.url
                )}
              </p>
              <p className="whitespace-pre-wrap">
                <span className="text-zinc-500">Como vai divulgar:</span> {afiliado.application.note}
              </p>
              <p className="text-xs text-zinc-500">Abra o link e confira se a comunidade existe e combina com a Tickrify antes de aprovar.</p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-zinc-500">Pediu antes do formulário existir: sem canal nem link informados.</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={ocupado} onClick={() => onSalvar({ status: 'ACTIVE' })}>
            Aprovar
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
      </div>
    </Card>
  );
}

function LinhaAfiliado({
  afiliado,
  ocupado,
  onSalvar,
}: {
  afiliado: AdminAffiliate;
  ocupado: boolean;
  onSalvar: (patch: Patch) => void;
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
    <Card className="border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">{quem}</p>
            <Badge className={status.classe}>{status.texto}</Badge>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Comissão {afiliado.commissionRateBps / 100}% · código <span className="font-mono">{afiliado.couponCode}</span>
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            {afiliado.clicks} cliques no link · {afiliado.signups} cadastros · trouxe {formatUsd(afiliado.revenueCents)} em
            vendas
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            A receber: {formatUsd(afiliado.pendingCents + afiliado.availableCents)} · já pago: {formatUsd(afiliado.paidCents)}
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
          <Button size="sm" variant="ghost" onClick={() => setEditando((v) => !v)}>
            {editando ? 'Cancelar' : 'Editar'}
          </Button>
        </div>
      </div>

      {editando && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-white/5 bg-black/30 p-3 text-xs text-zinc-400">
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
        </div>
      )}

      <button
        type="button"
        onClick={() => setDetalhe((v) => !v)}
        className="mt-3 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
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
    <Card className={`p-4 ${aberto ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-white/10 bg-white/[0.02]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">
            {formatUsd(saque.amountCents)} para {saque.affiliate.user.email ?? saque.affiliate.referralCode}
          </p>
          <p className="mt-1 break-all text-xs text-zinc-300">Enviar para: {saque.method}</p>
          <p className="mt-1 text-xs text-zinc-500">
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
  const { affiliates, payouts, update, decide } = useAffiliateAdmin();
  const { toast } = useToast();
  const [historico, setHistorico] = useState(false);

  if (affiliates.error?.message === 'SEM_ACESSO') return null;

  const salvar = (id: string, patch: Patch) =>
    update.mutate(
      { id, patch },
      {
        onSuccess: () =>
          toast({
            title:
              patch.status === 'ACTIVE'
                ? 'Afiliado aprovado'
                : patch.status === 'REJECTED'
                  ? 'Pedido rejeitado'
                  : patch.status === 'SUSPENDED'
                    ? 'Afiliado suspenso'
                    : 'Salvo',
          }),
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

  if (affiliates.isLoading) return <p className="text-sm text-zinc-500">Carregando…</p>;
  if (affiliates.error) return <p className="text-sm text-red-400">Não carregou: {affiliates.error.message}</p>;

  return (
    <section>
      <Titulo n={pedidos.length}>Pedidos para aprovar</Titulo>
      {pedidos.length === 0 ? (
        <Vazio>Nenhum pedido novo.</Vazio>
      ) : (
        <div className="space-y-3">
          {pedidos.map((a) => (
            <PedidoAfiliado key={a.id} afiliado={a} ocupado={update.isPending} onSalvar={(p) => salvar(a.id, p)} />
          ))}
        </div>
      )}

      <Titulo n={saquesAbertos.length}>Saques para pagar</Titulo>
      <p className="-mt-2 mb-3 text-xs text-zinc-500">
        O pagamento é feito por você, fora do site (PayPal, Pix, etc.). Aqui você só registra.
      </p>
      {payouts.error && <p className="text-sm text-red-400">{payouts.error.message}</p>}
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
            className="mt-3 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
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
      <p className="-mt-2 mb-3 text-xs text-zinc-500">
        Comissão padrão de 20%. Ela não aparece no site: cada afiliado só vê a própria.
      </p>
      {demais.length === 0 ? (
        <Vazio>Nenhum afiliado aprovado ainda.</Vazio>
      ) : (
        <div className="space-y-3">
          {demais.map((a) => (
            <LinhaAfiliado key={a.id} afiliado={a} ocupado={update.isPending} onSalvar={(p) => salvar(a.id, p)} />
          ))}
        </div>
      )}
    </section>
  );
}
