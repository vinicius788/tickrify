import { Link } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import SiteLayout from '@/components/layout/SiteLayout';
import { seoFor, useSeo } from '@/hooks/useSeo';
import { useAffiliateProgram } from '@/hooks/useAffiliates';

/**
 * Pagina publica do programa de afiliados (26/09/2026).
 *
 * SEM porcentagem de comissao (decisao do dono, 28/09): a taxa so aparece no
 * painel do proprio afiliado e no admin. Entrada por aprovacao manual.
 * Prazos e minimo vem de /api/affiliates/program (as mesmas constantes do
 * backend); sem resposta da API, a pagina diz que nao carregou.
 *
 * O desconto do cliente e anunciado como "at least": o checkout aplica o
 * MAIOR desconto disponivel (a oferta EARLY35 ganha dos 10% enquanto existir).
 */
const AffiliatesPage = () => {
  useSeo(seoFor('/affiliates'));
  const { isSignedIn } = useAuth();
  const { data: program, isError } = useAffiliateProgram();

  const joinHref = isSignedIn ? '/affiliate' : `/sign-up?redirect_url=${encodeURIComponent('/affiliate')}`;

  return (
    <SiteLayout>
      <section className="site-dark site-phead">
        <div className="site-wrap">
          <span className="site-eyebrow">Affiliate program</span>
          <h1>Earn recurring commissions by referring traders to Tickrify.</h1>
          {program ? (
            <p>
              <strong>
                Approved partners receive recurring commissions for eligible customers they refer, on every billing
                cycle of their first {program.commissionMonths} months.
              </strong>{' '}
              Commissions are based on what the customer actually pays.
            </p>
          ) : (
            <p>{isError ? 'The program details are not loading right now. Refresh in a moment.' : 'Loading the program details.'}</p>
          )}
          <div className="site-hero-actions">
            <Link to={joinHref} className="site-btn site-btn-primary">
              Apply to join
            </Link>
            <Link to="/pricing" className="site-btn site-btn-ghost">
              See what they get
            </Link>
          </div>
        </div>
      </section>

      {program ? (
        <>
          <section className="site-dark site-body-tight">
            <div className="site-wrap">
              {/* .site-sblk e so o cabecalho da secao (limitado a 34ch no desktop). */}
              <div className="site-sblk">
                <span className="site-eyebrow">For your audience</span>
                <h2>A fair start for the traders you send</h2>
              </div>
              <div className="site-prose">
                <p>
                  {program.customerDiscountPercent
                    ? `Your link and your code give them at least ${program.customerDiscountPercent}% off their first payment. If a bigger launch offer is running, they get that one instead: they always pay the lower price.`
                    : 'They get the same product and the same price as everyone else, plus the free trial every account starts with.'}{' '}
                  Tickrify reads their chart cold and returns a structured analysis, or tells them to wait. It is a
                  second opinion, not a signal service, and it never promises profits.
                </p>
              </div>

              <div className="site-sblk mt-16">
                <span className="site-eyebrow">How it works</span>
              </div>
              <div>
                <div className="site-step">
                  <span className="site-step-n">01</span>
                  <h3>Apply with your Tickrify account</h3>
                  <p>
                    It is free. Tell us where your audience is and how you would share Tickrify. We review every
                    application; once approved, you get a personal referral link and a coupon code.
                  </p>
                </div>
                <div className="site-step">
                  <span className="site-step-n">02</span>
                  <h3>Share your link or your code</h3>
                  <p>
                    A click on your link counts for {program.attributionDays} days. If someone types your coupon code, that
                    code wins over any link they clicked before.
                  </p>
                </div>
                <div className="site-step">
                  <span className="site-step-n">03</span>
                  <h3>Get paid on real payments</h3>
                  <p>
                    Each commission clears {program.holdDays} days after the payment, which covers refunds. Once you have
                    ${program.minPayoutUsd} available, request a payout from your dashboard.
                  </p>
                </div>
              </div>

              <div className="site-sblk mt-16">
                <span className="site-eyebrow">The fine print</span>
              </div>
              <div className="mb-16">
                <ul className="site-prose list-disc space-y-2 pl-5">
                  <li>
                    Commission is calculated on the amount the customer actually paid, excluding taxes, for{' '}
                    {program.commissionMonths} months from their first payment. Your rate is shown in your partner dashboard.
                  </li>
                  <li>Refunded or disputed payments do not earn commission.</li>
                  <li>Referring yourself, or a second account of your own, does not count.</li>
                  <li>
                    Payouts are reviewed and sent manually. The minimum payout is ${program.minPayoutUsd}.
                  </li>
                  <li>
                    Promote honestly: Tickrify is an analysis tool, not financial advice, and no one should be told it
                    guarantees returns.
                  </li>
                </ul>
              </div>

              <div className="site-callout">
                <h3>Ready to share it?</h3>
                <p>Apply in one click. We will review your application.</p>
                <Link to={joinHref} className="site-btn site-btn-primary">
                  Apply to join
                </Link>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </SiteLayout>
  );
};

export default AffiliatesPage;
