import { Link } from 'react-router-dom';
import LegalPage, { type LegalSection } from '@/components/legal/LegalPage';
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
 *
 * 24/08/2026: passou a usar a casca LegalPage (cabeçalho, rodapé e índice
 * como as outras legais) e a seção de cookies passou a apontar para a política
 * própria, que descreve consentimento de verdade.
 *
 * O contato é support@tickrify.com (desde 21/09/2026; antes tickrify@gmail.com),
 * o MESMO das outras páginas legais e do rodapé. Antes de 25/08 esta página
 * dizia um endereço, os Termos outro e o rodapé um terceiro. Ao trocar, trocar
 * no rodapé e nas quatro páginas legais.
 */
const LAST_UPDATED = 'October 12, 2026';

const SECTIONS: LegalSection[] = [
  {
    id: 'who',
    title: '1. Who we are',
    body: (
      <p>
        <strong>Tickrify</strong> is an AI powered technical chart analysis platform, operated from Brazil. For any
        question about this policy, contact us at <a href="mailto:support@tickrify.com">support@tickrify.com</a>.
      </p>
    ),
  },
  {
    id: 'collect',
    title: '2. Data we collect',
    body: (
      <>
        <p>We collect only the data the platform needs to work:</p>
        <ul>
          <li><strong>Account data:</strong> name, email address and password (handled by Clerk, our authentication provider).</li>
          <li><strong>Payment data:</strong> billing information processed by Stripe. Tickrify never stores card numbers.</li>
          <li><strong>Uploaded images:</strong> the charts you upload for analysis. We store them so your analysis history stays available to you.</li>
          <li><strong>Usage data:</strong> number of analyses run, current plan, Tick balance and transaction history.</li>
          <li><strong>Chat messages:</strong> the messages you send in the in-app chat. We keep them so we can answer you and see the conversation history.</li>
          <li><strong>Technical data:</strong> IP address, device type and browser, collected automatically for security and diagnostics.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'use',
    title: '3. How we use your data',
    body: (
      <>
        <p>We use your data to:</p>
        <ul>
          <li>provide and improve the platform;</li>
          <li>process payments and manage subscriptions;</li>
          <li>send transactional messages (payment confirmations, balance alerts);</li>
          <li>keep accounts secure and prevent fraud;</li>
          <li>meet legal and regulatory obligations.</li>
        </ul>
        <p>We do not sell, rent or share your personal data with third parties for marketing purposes.</p>
      </>
    ),
  },
  {
    id: 'share',
    title: '4. Who we share data with',
    body: (
      <>
        <p>Your data is shared only with the providers the platform depends on to operate:</p>
        <ul>
          <li><strong>Clerk</strong>, authentication and account management;</li>
          <li><strong>Stripe</strong>, payment processing;</li>
          <li><strong>AI provider</strong>, processing chart images to generate analyses;</li>
          <li><strong>Supabase</strong>, database and file storage;</li>
          <li><strong>Render</strong>, server infrastructure.</li>
        </ul>
        <p>
          These providers operate in several countries, which means your data may be processed outside your country
          of residence. All of them are contractually required to protect your data and to use it only for the
          purposes described here.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    title: '5. Storage and security',
    body: (
      <>
        <p>
          Your data is stored on secure servers. We use encryption in transit (TLS/HTTPS) and at rest. Access is
          restricted to the systems and people who need it to operate the platform.
        </p>
        <p>
          Chart images you upload for analysis are kept in secure cloud storage. You can request their deletion at
          any time.
        </p>
      </>
    ),
  },
  {
    id: 'rights',
    title: '6. Your rights',
    body: (
      <>
        <p>
          Tickrify is operated from Brazil and follows the Brazilian General Data Protection Law (LGPD, Law
          13.709/2018). You have the right to:
        </p>
        <ul>
          <li><strong>Access:</strong> confirm that we process your data, and obtain a copy of it;</li>
          <li><strong>Correction:</strong> correct incomplete, inaccurate or outdated data;</li>
          <li><strong>Deletion:</strong> request deletion of data processed with your consent;</li>
          <li><strong>Portability:</strong> request transfer of your data to another provider;</li>
          <li><strong>Withdrawal of consent:</strong> withdraw your consent at any time;</li>
          <li><strong>Objection:</strong> object to processing you believe does not comply with the law.</li>
        </ul>
        <p>
          If you are located outside Brazil, your local law may grant you further rights. Write to us at the
          address below and we will handle your request under whichever rules give you the stronger protection.
        </p>
        <p>
          To exercise any of these rights, email <a href="mailto:support@tickrify.com">support@tickrify.com</a>. We
          respond within 15 business days.
        </p>
      </>
    ),
  },
  {
    id: 'retention',
    title: '7. Data retention',
    body: (
      <p>
        We keep your data for as long as your account is active. After you close your account, personal data is
        deleted within 90 days, except where retention is required by law (for example, tax records under Brazilian
        tax legislation).
      </p>
    ),
  },
  {
    id: 'cookies',
    title: '8. Cookies and tracking',
    body: (
      <p>
        Cookies needed to sign you in and to take payment are always on. Analytics and marketing cookies load only
        after you accept them, and you can change that choice at any time. What each one does, and who sets it, is
        listed in the <Link to="/cookies">cookie policy</Link>.
      </p>
    ),
  },
  {
    id: 'minors',
    title: '9. Children and minors',
    body: (
      <p>
        The platform is intended for people aged 18 and over. We do not knowingly collect data from minors. If we
        find that an account was created by a minor, we delete it.
      </p>
    ),
  },
  {
    id: 'changes',
    title: '10. Changes to this policy',
    body: (
      <p>
        We may update this policy from time to time. If a change is material, we will notify you by email or with a
        notice on the platform at least 15 days in advance. Continued use after that notice means you accept the
        change.
      </p>
    ),
  },
];

const PrivacyPolicyPage = () => {
  // O canonical é FIXO em /privacy mesmo quando a rota servida é /privacidade.
  // As duas rotas renderizam este mesmo componente, o que criava conteúdo
  // duplicado, e o sitemap listava justamente a versão não canônica.
  useSeo(seoFor('/privacy'));

  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      intro="What we collect, why we need it, who else sees it, and how to get it deleted."
      updated={LAST_UPDATED}
      sections={SECTIONS}
      footer={
        <>
          <h3>Contact and jurisdiction</h3>
          <p>
            For anything related to this policy or to how we handle your personal data, write to{' '}
            <a href="mailto:support@tickrify.com">support@tickrify.com</a>.
          </p>
          <p>
            This policy is governed by the laws of the Federative Republic of Brazil. Any dispute relating to the
            processing of personal data will be submitted to the competent Brazilian courts.
          </p>
        </>
      }
    />
  );
};

export default PrivacyPolicyPage;
