import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { seoFor, useSeo } from '@/hooks/useSeo';

/**
 * Política de privacidade, EM INGLÊS (29/07/2026).
 *
 * Estava inteira em português num site cujo idioma padrão é inglês desde
 * jun/2026: o rodapé dizia "Privacy Policy" e a página abria em português.
 *
 * A data abaixo é uma CONSTANTE, de propósito. Antes era
 * `new Date().toLocaleDateString(...)`, ou seja, a página sempre afirmava ter
 * sido atualizada HOJE, qualquer que fosse o dia em que o visitante entrasse,
 * uma alegação falsa da mesma família das que a auditoria de 27/07 removeu da
 * vitrine. Ao editar o texto desta página, atualize esta data na mão.
 */
const LAST_UPDATED = 'July 29, 2026';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-10">
    <h2 className="mb-3 text-lg font-bold text-[var(--text-primary)]">{title}</h2>
    <div className="space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">{children}</div>
  </section>
);

const PrivacyPolicyPage = () => {
  // O canonical é FIXO em /privacy mesmo quando a rota servida é /privacidade.
  // As duas rotas renderizam este mesmo componente, o que criava conteúdo
  // duplicado, e o sitemap listava justamente a versão não canônica.
  useSeo(seoFor('/privacy'));

  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="container max-w-3xl py-16">
        <Link
          to="/"
          className="mb-10 inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <header className="mb-12">
          <p className="font-terminal text-xs uppercase tracking-widest text-[var(--accent-green)] mb-2">
            Legal
          </p>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">Privacy Policy</h1>
          <p className="mt-3 text-sm text-[var(--text-secondary)]">Last updated: {LAST_UPDATED}</p>
        </header>

        <Section title="1. Who we are">
          <p>
            <strong className="text-[var(--text-primary)]">Tickrify</strong> is an AI-powered technical chart analysis
            platform, operated from Brazil. For any question about this policy, contact us at{' '}
            <a href="mailto:contato@tickrify.com" className="text-[var(--accent-green)] underline underline-offset-2">
              contato@tickrify.com
            </a>.
          </p>
        </Section>

        <Section title="2. Data we collect">
          <p>We collect only the data the platform needs to work:</p>
          <ul className="ml-4 mt-2 list-disc space-y-1">
            <li><strong className="text-[var(--text-primary)]">Account data:</strong> name, email address and password (handled by Clerk, our authentication provider).</li>
            <li><strong className="text-[var(--text-primary)]">Payment data:</strong> billing information processed by Stripe. Tickrify never stores card numbers.</li>
            <li><strong className="text-[var(--text-primary)]">Uploaded images:</strong> the charts you upload for analysis. We store them so your analysis history stays available to you.</li>
            <li><strong className="text-[var(--text-primary)]">Usage data:</strong> number of analyses run, current plan, Tick balance and transaction history.</li>
            <li><strong className="text-[var(--text-primary)]">Technical data:</strong> IP address, device type and browser, collected automatically for security and diagnostics.</li>
          </ul>
        </Section>

        <Section title="3. How we use your data">
          <p>We use your data to:</p>
          <ul className="ml-4 mt-2 list-disc space-y-1">
            <li>Provide and improve the platform;</li>
            <li>Process payments and manage subscriptions;</li>
            <li>Send transactional messages (payment confirmations, balance alerts);</li>
            <li>Keep accounts secure and prevent fraud;</li>
            <li>Meet legal and regulatory obligations.</li>
          </ul>
          <p className="mt-3">
            We do not sell, rent or share your personal data with third parties for marketing purposes.
          </p>
        </Section>

        <Section title="4. Who we share data with">
          <p>Your data is shared only with the providers the platform depends on to operate:</p>
          <ul className="ml-4 mt-2 list-disc space-y-1">
            <li><strong className="text-[var(--text-primary)]">Clerk</strong>, authentication and account management;</li>
            <li><strong className="text-[var(--text-primary)]">Stripe</strong>, payment processing;</li>
            <li><strong className="text-[var(--text-primary)]">AI provider</strong>, processing chart images to generate analyses;</li>
            <li><strong className="text-[var(--text-primary)]">Supabase</strong>, database and file storage;</li>
            <li><strong className="text-[var(--text-primary)]">Render</strong>, server infrastructure.</li>
          </ul>
          <p className="mt-3">
            These providers operate in several countries, which means your data may be processed outside your country of
            residence. All of them are contractually required to protect your data and to use it only for the purposes
            described here.
          </p>
        </Section>

        <Section title="5. Storage and security">
          <p>
            Your data is stored on secure servers. We use encryption in transit (TLS/HTTPS) and at rest. Access is
            restricted to the systems and people who need it to operate the platform.
          </p>
          <p>
            Chart images you upload for analysis are kept in secure cloud storage. You can request their deletion at any
            time.
          </p>
        </Section>

        <Section title="6. Your rights">
          <p>
            Tickrify is operated from Brazil and follows the Brazilian General Data Protection Law (LGPD, Law
            13.709/2018). You have the right to:
          </p>
          <ul className="ml-4 mt-2 list-disc space-y-1">
            <li><strong className="text-[var(--text-primary)]">Access:</strong> confirm that we process your data, and obtain a copy of it;</li>
            <li><strong className="text-[var(--text-primary)]">Correction:</strong> correct incomplete, inaccurate or outdated data;</li>
            <li><strong className="text-[var(--text-primary)]">Deletion:</strong> request deletion of data processed with your consent;</li>
            <li><strong className="text-[var(--text-primary)]">Portability:</strong> request transfer of your data to another provider;</li>
            <li><strong className="text-[var(--text-primary)]">Withdrawal of consent:</strong> withdraw your consent at any time;</li>
            <li><strong className="text-[var(--text-primary)]">Objection:</strong> object to processing you believe does not comply with the law.</li>
          </ul>
          <p className="mt-3">
            If you are located outside Brazil, your local law may grant you further rights. Write to us at the address
            below and we will handle your request under whichever rules give you the stronger protection.
          </p>
          <p className="mt-3">
            To exercise any of these rights, email{' '}
            <a href="mailto:contato@tickrify.com" className="text-[var(--accent-green)] underline underline-offset-2">
              contato@tickrify.com
            </a>. We respond within 15 business days.
          </p>
        </Section>

        <Section title="7. Data retention">
          <p>
            We keep your data for as long as your account is active. After you close your account, personal data is
            deleted within 90 days, except where retention is required by law (for example, tax records under Brazilian
            tax legislation).
          </p>
        </Section>

        <Section title="8. Cookies and tracking">
          <p>
            Tickrify uses cookies that are essential for authentication and sessions. We do not use advertising or
            cross-site tracking cookies. Session data is managed by Clerk.
          </p>
        </Section>

        <Section title="9. Children and minors">
          <p>
            The platform is intended for people aged 18 and over. We do not knowingly collect data from minors. If we
            find that an account was created by a minor, we delete it.
          </p>
        </Section>

        <Section title="10. Changes to this policy">
          <p>
            We may update this policy from time to time. If a change is material, we will notify you by email or with a
            notice on the platform at least 15 days in advance. Continued use after that notice means you accept the
            change.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>For anything related to this policy or to how we handle your personal data, contact us:</p>
          <p className="mt-2">
            <strong className="text-[var(--text-primary)]">Email:</strong>{' '}
            <a href="mailto:contato@tickrify.com" className="text-[var(--accent-green)] underline underline-offset-2">
              contato@tickrify.com
            </a>
          </p>
        </Section>

        <div className="mt-12 border-t border-[var(--border-subtle)] pt-8 text-xs text-[var(--text-muted)]">
          <p>
            This policy is governed by the laws of the Federative Republic of Brazil. Any dispute relating to the
            processing of personal data will be submitted to the competent Brazilian courts.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicyPage;
