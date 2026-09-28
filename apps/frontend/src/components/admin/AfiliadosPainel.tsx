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
  type PayoutStatus,
} from '@/hooks/useAffiliates';

/**
 * Afiliados no /admin: ativar/suspender, comissão individual, códigos,
 * clientes indicados, comissões e saques. Todo número vem do servidor; a taxa
 * vai em pontos-base (2000 = 20%) e o backend recusa acima de 50%.
 */

const COR_STATUS: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  SUSPENDED: 'bg-red-500/15 text-red-300 border-red-500/30',
  REQUESTED: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  APPROVED: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  PAID: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  REJECTED: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  PENDING: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  AVAILABLE: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  CANCELLED: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};

const ROTULO_STATUS: Record<AffiliateStatus, string> = {
  PENDING: 'aguardando aprovação',
  ACTIVE: 'ativo',
  REJECTED: 'rejeitado',
  SUSPENDED: 'suspenso',
};

const FILTROS_SAQUE: Array<{ chave: PayoutStatus | 'ALL'; rotulo: string }> = [
  { chave: 'REQUESTED', rotulo: 'pedidos' },
  { chave: 'APPROVED', rotulo: 'aprovados' },
  { chave: 'PAID', rotulo: 'pagos' },
  { chave: 'REJECTED', rotulo: 'rejeitados' },
  { chave: 'ALL', rotulo: 'todos' },
];

const dia = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '—');
const campo = 'w-28 rounded border border-white/10 bg-black/40 px-2 py-1 text-sm text-white';

function Detalhe({ id }: { id: string }) {
  const { data, isLoading, error } = useAffiliateAdminDetail(id);
  if (isLoading) return <p className="mt-3 text-xs text-zinc-500">Carregando…</p>;
  if (error || !data) return <p className="mt-3 text-xs text-red-400">Não carregou: {error?.message}</p>;
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-white/5 bg-black/40 p-3 text-[11px] text-zinc-400">
      <div>
        <p className="mb-1 font-semibold text-zinc-300">Clientes indicados ({data.referrals.length})</p>
        {data.referrals.length === 0 && <p>Nenhum ainda.</p>}
        {data.referrals.map((r) => (
          <p key={r.id} className="font-mono">
            {r.email ?? 'sem e-mail'} · {r.source} · desde {dia(r.createdAt)}
            {r.firstPaidAt ? ` · 1º pagamento ${dia(r.firstPaidAt)} · comissão até ${dia(r.commissionEndsAt)}` : ' · ainda não pagou'}
          </p>
        ))}
      </div>
      <div>
        <p className="mb-1 font-semibold text-zinc-300">Comissões ({data.commissions.length})</p>
        {data.commissions.length === 0 && <p>Nenhuma ainda.</p>}
        {data.commissions.map((c) => (
          <p key={c.id} className="font-mono">
            {dia(c.createdAt)} · {c.stripeInvoiceId} · pago {formatUsd(c.amountPaidCents)} · {c.rateBps / 100}% ={' '}
            {formatUsd(c.commissionCents)} · <span className="text-zinc-300">{c.status}</span>
            {c.status === 'PENDING' ? ` até ${dia(c.availableAt)}` : ''}
            {c.cancelledReason ? ` (${c.cancelledReason})` : ''}
          </p>
        ))}
      </div>
    </div>
  );
}

function LinhaAfiliado({
  afiliado,
  salvando,
  onSalvar,
}: {
  afiliado: AdminAffiliate;
  salvando: boolean;
  onSalvar: (patch: Partial<Pick<AdminAffiliate, 'status' | 'commissionRateBps' | 'referralCode' | 'couponCode'>>) => void;
}) {
  const [taxa, setTaxa] = useState(String(afiliado.commissionRateBps / 100));
  const [ref, setRef] = useState(afiliado.referralCode);
  const [cupom, setCupom] = useState(afiliado.couponCode);
  const [aberto, setAberto] = useState(false);

  const taxaBps = Math.round(Number(taxa.replace(',', '.')) * 100);
  const mudou =
    taxaBps !== afiliado.commissionRateBps || ref.toUpperCase() !== afiliado.referralCode || cupom.toUpperCase() !== afiliado.couponCode;

  const salvar = () => {
    if (!Number.isInteger(taxaBps) || taxaBps < 0 || taxaBps > 5000) {
      window.alert('Comissão entre 0 e 50%.');
      return;
    }
    onSalvar({
      ...(taxaBps !== afiliado.commissionRateBps ? { commissionRateBps: taxaBps } : {}),
      ...(ref.toUpperCase() !== afiliado.referralCode ? { referralCode: ref } : {}),
      ...(cupom.toUpperCase() !== afiliado.couponCode ? { couponCode: cupom } : {}),
    });
  };

  const quem = afiliado.email ?? afiliado.referralCode;
  const mudarStatus = (proximo: AffiliateStatus, aviso?: string) => {
    if (aviso && !window.confirm(aviso)) return;
    onSalvar({ status: proximo });
  };
  // Approve / Reject / Suspend / Reactivate, conforme o estado atual (o backend recusa o resto).
  const acoes: Array<{ rotulo: string; proximo: AffiliateStatus; aviso?: string }> =
    afiliado.status === 'PENDING'
      ? [
          { rotulo: 'aprovar', proximo: 'ACTIVE' },
          { rotulo: 'rejeitar', proximo: 'REJECTED', aviso: `Rejeitar o pedido de ${quem}?` },
        ]
      : afiliado.status === 'REJECTED'
        ? [{ rotulo: 'aprovar', proximo: 'ACTIVE' }]
        : afiliado.status === 'ACTIVE'
          ? [{ rotulo: 'suspender', proximo: 'SUSPENDED', aviso: `Suspender ${quem}? Link e cupom param e não entram comissões novas. As já ganhas ficam.` }]
          : [{ rotulo: 'reativar', proximo: 'ACTIVE' }];

  return (
    <Card className="border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{afiliado.email ?? 'sem e-mail'}</h3>
            <Badge className={COR_STATUS[afiliado.status]}>{ROTULO_STATUS[afiliado.status]}</Badge>
            {afiliado.commissionRateBps !== 2000 && (
              <Badge className="border-purple-500/30 bg-purple-500/15 text-purple-300">taxa especial</Badge>
            )}
            {!afiliado.stripePromotionCodeId && (
              <Badge className="border-amber-500/30 bg-amber-500/15 text-amber-300" title="Cupom não está na Stripe: o checkout usa o cupom direto, mas digitar o código na Stripe não funciona.">
                sem promotion code
              </Badge>
            )}
          </div>
          <p className="mt-1.5 text-xs text-zinc-400">
            {afiliado.clicks} cliques · {afiliado.signups} cadastros · receita {formatUsd(afiliado.revenueCents)} · pendente{' '}
            {formatUsd(afiliado.pendingCents)} · disponível {formatUsd(afiliado.availableCents)} · pago {formatUsd(afiliado.paidCents)}
          </p>
        </div>
        <div className="flex gap-1.5">
          {acoes.map((a) => (
            <Button
              key={a.rotulo}
              size="sm"
              variant={a.proximo === 'ACTIVE' ? 'secondary' : 'ghost'}
              disabled={salvando}
              onClick={() => mudarStatus(a.proximo, a.aviso)}
            >
              {a.rotulo}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3 text-[11px] text-zinc-500">
        <label className="flex flex-col gap-1">
          comissão %
          <input className={campo} value={taxa} onChange={(e) => setTaxa(e.target.value)} disabled={salvando} />
        </label>
        <label className="flex flex-col gap-1">
          referralCode
          <input className={campo} value={ref} onChange={(e) => setRef(e.target.value)} disabled={salvando} />
        </label>
        <label className="flex flex-col gap-1">
          couponCode
          <input className={campo} value={cupom} onChange={(e) => setCupom(e.target.value)} disabled={salvando} />
        </label>
        <Button size="sm" variant="secondary" disabled={salvando || !mudou} onClick={salvar}>
          salvar
        </Button>
        <button type="button" onClick={() => setAberto((v) => !v)} className="text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">
          {aberto ? 'esconder' : 'ver'} clientes e comissões
        </button>
      </div>

      {aberto && <Detalhe id={afiliado.id} />}
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
    const nota = window.prompt(action === 'reject' ? 'Motivo da rejeição (vai para o registro):' : 'Referência do pagamento (ex.: id da transação):');
    if (nota === null) return;
    onDecidir(action, nota.trim() || undefined);
  };
  return (
    <Card className="border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white">
            {formatUsd(saque.amountCents)} · {saque.affiliate.user.email ?? saque.affiliate.referralCode}
          </p>
          <p className="mt-1 break-all text-[11px] text-zinc-400">Enviar para: {saque.method}</p>
          <p className="mt-1 text-[11px] text-zinc-500">
            pedido {dia(saque.requestedAt)}
            {saque.paidAt ? ` · pago ${dia(saque.paidAt)}` : ''}
            {saque.adminNote ? ` · nota: ${saque.adminNote}` : ''}
          </p>
        </div>
        <Badge className={COR_STATUS[saque.status]}>{saque.status.toLowerCase()}</Badge>
      </div>
      {(saque.status === 'REQUESTED' || saque.status === 'APPROVED') && (
        <div className="mt-3 flex flex-wrap gap-2">
          {saque.status === 'REQUESTED' && (
            <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => onDecidir('approve')}>
              aprovar
            </Button>
          )}
          {saque.status === 'APPROVED' && (
            <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => pedirNota('mark_paid')}>
              marcar como pago
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => pedirNota('reject')}>
            rejeitar
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function AfiliadosPainel() {
  const [filtro, setFiltro] = useState<PayoutStatus | 'ALL'>('REQUESTED');
  const { affiliates, payouts, update, decide } = useAffiliateAdmin(filtro);
  const { toast } = useToast();

  if (affiliates.error?.message === 'SEM_ACESSO') return null;

  const salvar = (id: string, patch: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate(
      { id, patch },
      {
        onSuccess: (r) =>
          toast({
            title: 'Afiliado salvo',
            description:
              r.stripeSync === 'failed'
                ? 'Salvo no banco, mas o promotion code NÃO sincronizou na Stripe. Ver o log do Render.'
                : r.stripeSync === 'skipped'
                  ? 'Sem STRIPE_AFFILIATE_COUPON_ID: nada foi criado na Stripe.'
                  : 'Stripe sincronizada.',
          }),
        onError: (e) => toast({ title: 'Não salvou', description: e.message, variant: 'destructive' }),
      },
    );

  const decidir = (id: string, action: 'approve' | 'reject' | 'mark_paid', note?: string) =>
    decide.mutate(
      { id, action, note },
      {
        onSuccess: () => toast({ title: action === 'mark_paid' ? 'Saque marcado como pago' : action === 'approve' ? 'Saque aprovado' : 'Saque rejeitado' }),
        onError: (e) => toast({ title: 'Não salvou', description: e.message, variant: 'destructive' }),
      },
    );

  return (
    <section className="mt-10">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-white">Afiliados</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Novos afiliados entram aguardando aprovação. Comissão padrão 20%; nenhuma taxa aparece na página pública, e cada afiliado vê só a própria.
        </p>
      </header>

      <h3 className="mb-2 text-sm font-semibold text-zinc-300">Saques</h3>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTROS_SAQUE.map((f) => (
          <Button key={f.chave} size="sm" variant={filtro === f.chave ? 'secondary' : 'ghost'} onClick={() => setFiltro(f.chave)}>
            {f.rotulo}
          </Button>
        ))}
      </div>
      {payouts.isLoading && <p className="text-sm text-zinc-500">Carregando…</p>}
      {payouts.error && <p className="text-sm text-red-400">{payouts.error.message}</p>}
      {payouts.data?.length === 0 && <p className="text-sm text-zinc-500">Nenhum saque neste filtro.</p>}
      <div className="space-y-3">
        {payouts.data?.map((s) => (
          <LinhaSaque key={s.id} saque={s} ocupado={decide.isPending} onDecidir={(action, note) => decidir(s.id, action, note)} />
        ))}
      </div>

      <h3 className="mb-2 mt-6 text-sm font-semibold text-zinc-300">Afiliados ({affiliates.data?.length ?? 0})</h3>
      {affiliates.isLoading && <p className="text-sm text-zinc-500">Carregando…</p>}
      {affiliates.error && <p className="text-sm text-red-400">{affiliates.error.message}</p>}
      {affiliates.data?.length === 0 && <p className="text-sm text-zinc-500">Ninguém entrou no programa ainda.</p>}
      <div className="space-y-3">
        {affiliates.data?.map((a) => (
          <LinhaAfiliado key={a.id} afiliado={a} salvando={update.isPending} onSalvar={(patch) => salvar(a.id, patch)} />
        ))}
      </div>
    </section>
  );
}
