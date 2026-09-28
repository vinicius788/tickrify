import { useState } from 'react';
import { Link } from 'react-router-dom';
import SiteLayout from '@/components/layout/SiteLayout';
import { seoFor, useSeo } from '@/hooks/useSeo';
import { useToast } from '@/hooks/use-toast';
import { formatUsd, useAffiliateDashboard, type CommissionStatus } from '@/hooks/useAffiliates';

/**
 * Painel do afiliado (/affiliate, logado, noindex).
 *
 * So exibe o que o servidor calculou: saldo, comissoes e saques chegam em
 * centavos de USD de /api/affiliates/me. O pedido de saque manda apenas PARA
 * ONDE pagar; o valor e todo o saldo disponivel, decidido no backend.
 * Texto em ingles, como /accuracy: a pagina publica do programa so existe em
 * ingles e o painel segue a mesma lingua.
 */

const STATUS_LABEL: Record<CommissionStatus, string> = {
  PENDING: 'Pending',
  AVAILABLE: 'Available',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};

const date = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

function CopyField({ label, value }: { label: string; value: string }) {
  const { toast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: 'Could not copy. Select the text and copy it manually.' });
    }
  };
  return (
    <div className="site-kpi">
      <div className="site-kpi-label">{label}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="break-all font-mono text-sm text-[var(--s-fg)]">{value}</code>
        <button type="button" onClick={copy} className="site-btn site-btn-sm site-btn-ghost">
          Copy
        </button>
      </div>
    </div>
  );
}

const AffiliateDashboardPage = () => {
  useSeo(seoFor('/affiliate'));
  const { toast } = useToast();
  const { query, join, requestPayout } = useAffiliateDashboard();
  const [method, setMethod] = useState('');
  const data = query.data;
  const program = data?.program;

  const onJoin = () =>
    join.mutate(undefined, {
      onError: (e) => toast({ title: 'Could not join', description: e.message, variant: 'destructive' }),
    });

  const onPayout = () =>
    requestPayout.mutate(method.trim(), {
      onSuccess: () => {
        setMethod('');
        toast({ title: 'Payout requested', description: 'We review payouts manually and will contact you by email.' });
      },
      onError: (e) => toast({ title: 'Payout not requested', description: e.message, variant: 'destructive' }),
    });

  return (
    <SiteLayout>
      <section className="site-dark site-phead">
        <div className="site-wrap">
          <span className="site-eyebrow">Affiliate dashboard</span>
          <h1>Your referrals and earnings</h1>
          {query.isLoading ? <p>Loading your dashboard.</p> : null}
          {query.isError ? <p>Your dashboard is not loading right now. Refresh in a moment.</p> : null}
        </div>
      </section>

      {data && !data.affiliate ? (
        <section className="site-dark site-body-tight">
          <div className="site-wrap">
            <div className="site-callout">
              <h3>You are not in the affiliate program yet</h3>
              <p>
                Apply to earn recurring commissions on the traders you refer. Every application is reviewed.{' '}
                <Link to="/affiliates">Read the program details.</Link>
              </p>
              <button type="button" onClick={onJoin} disabled={join.isPending} className="site-btn site-btn-primary">
                {join.isPending ? 'Sending...' : 'Apply to join'}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {data?.affiliate?.status === 'PENDING' || data?.affiliate?.status === 'REJECTED' ? (
        <section className="site-dark site-body-tight">
          <div className="site-wrap">
            <div className="site-callout">
              {data.affiliate.status === 'PENDING' ? (
                <>
                  <h3>Your application is under review</h3>
                  <p>We review every application manually. Your referral link and coupon code will appear here once you are approved.</p>
                </>
              ) : (
                <>
                  <h3>Your application was not approved</h3>
                  <p>If you think this is a mistake, contact support@tickrify.com.</p>
                </>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {data?.affiliate && data.balances && data.stats ? (
        <section className="site-dark site-body-tight">
          <div className="site-wrap">
            {data.affiliate.status === 'SUSPENDED' ? (
              <div className="site-callout">
                <h3>Your affiliate account is suspended</h3>
                <p>New referrals and payouts are paused. Contact support@tickrify.com if you think this is a mistake.</p>
              </div>
            ) : null}

            <div className="mb-12">
              <span className="site-eyebrow">Share</span>
              <div className="site-kpis site-kpis-inline">
                <CopyField label="Referral link" value={`${window.location.origin}/?ref=${data.affiliate.referralCode}`} />
                <CopyField label="Coupon code" value={data.affiliate.couponCode ?? ""} />
              </div>
              <p className="site-note">
                Your commission: {data.affiliate.commissionPercent}% of what each referred customer pays for{' '}
                {program?.commissionMonths ?? 12} months.
              </p>
            </div>

            <div className="mb-12">
              <span className="site-eyebrow">Earnings</span>
              <div className="site-kpis">
                <div className="site-kpi">
                  <b>{formatUsd(data.balances.totalEarnedCents)}</b>
                  <div className="site-kpi-label">Total earned</div>
                </div>
                <div className="site-kpi">
                  <b>{formatUsd(data.balances.pendingCents)}</b>
                  <div className="site-kpi-label">Pending</div>
                  <div className="site-kpi-note">Clears {program?.holdDays ?? 30} days after payment</div>
                </div>
                <div className="site-kpi">
                  <b>{formatUsd(data.balances.availableCents)}</b>
                  <div className="site-kpi-label">Available</div>
                  {data.balances.inPayoutCents > 0 ? (
                    <div className="site-kpi-note">{formatUsd(data.balances.inPayoutCents)} in a payout request</div>
                  ) : null}
                </div>
                <div className="site-kpi">
                  <b>{formatUsd(data.balances.paidCents)}</b>
                  <div className="site-kpi-label">Paid out</div>
                </div>
              </div>
            </div>

            <div className="mb-12">
              <span className="site-eyebrow">Referrals</span>
              <div className="site-kpis">
                <div className="site-kpi">
                  <b>{data.stats.clicks}</b>
                  <div className="site-kpi-label">Link clicks</div>
                </div>
                <div className="site-kpi">
                  <b>{data.stats.signups}</b>
                  <div className="site-kpi-label">Signups</div>
                </div>
                <div className="site-kpi">
                  <b>{data.stats.paidCustomers}</b>
                  <div className="site-kpi-label">Paying customers</div>
                </div>
                <div className="site-kpi">
                  <b>{formatUsd(data.stats.revenueCents)}</b>
                  <div className="site-kpi-label">Revenue generated</div>
                </div>
              </div>
            </div>

            <div className="mb-12">
              <span className="site-eyebrow">Payout</span>
              {data.canRequestPayout ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    maxLength={200}
                    placeholder="Where to send it, e.g. PayPal: you@email.com"
                    aria-label="Payout destination"
                    className="min-w-[260px] flex-1 rounded-lg border border-[var(--s-hair)] bg-transparent px-3 py-2 text-base text-[var(--s-fg)]"
                  />
                  <button
                    type="button"
                    onClick={onPayout}
                    disabled={requestPayout.isPending || method.trim().length < 5}
                    className="site-btn site-btn-primary"
                  >
                    {requestPayout.isPending ? 'Requesting...' : `Request ${formatUsd(data.balances.availableCents)}`}
                  </button>
                </div>
              ) : (
                <p className="site-note">
                  {data.payouts?.some((p) => p.status === 'REQUESTED' || p.status === 'APPROVED')
                    ? 'You have a payout in progress. We will contact you when it is sent.'
                    : `You can request a payout once you have ${formatUsd((program?.minPayoutUsd ?? 50) * 100)} available.`}
                </p>
              )}
            </div>

            <div className="mb-12">
              <span className="site-eyebrow">Commission history</span>
              {data.commissions && data.commissions.length > 0 ? (
                <div className="site-tablewrap">
                  <table className="site-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Customer</th>
                        <th>Paid</th>
                        <th>Status</th>
                        <th>Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.commissions.map((c) => (
                        <tr key={c.id}>
                          <td>{date(c.createdAt)}</td>
                          <td>{c.customer}</td>
                          <td>{formatUsd(c.amountPaidCents)}</td>
                          <td>
                            {STATUS_LABEL[c.status]}
                            {c.status === 'PENDING' ? ` until ${date(c.availableAt)}` : ''}
                          </td>
                          <td>{formatUsd(c.commissionCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="site-note">No commissions yet. They appear here when a referred customer pays.</p>
              )}
            </div>

            {data.payouts && data.payouts.length > 0 ? (
              <div className="mb-12">
                <span className="site-eyebrow">Payout history</span>
                <div className="site-tablewrap">
                  <table className="site-table">
                    <thead>
                      <tr>
                        <th>Requested</th>
                        <th>Status</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.payouts.map((p) => (
                        <tr key={p.id}>
                          <td>{date(p.requestedAt)}</td>
                          <td>{p.status.charAt(0) + p.status.slice(1).toLowerCase()}{p.paidAt ? ` on ${date(p.paidAt)}` : ''}</td>
                          <td>{formatUsd(p.amountCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </SiteLayout>
  );
};

export default AffiliateDashboardPage;
