import { Link } from 'react-router-dom';
import LegalPage, { type LegalSection } from '@/components/legal/LegalPage';
import { seoFor, useSeo } from '@/hooks/useSeo';

/**
 * Termos de Serviço, /terms.
 *
 * Até 24/08/2026 este texto só existia dentro de um diálogo no rodapé, em
 * português, num site cujo idioma público é inglês desde jun/2026. Um diálogo
 * não tem URL: não dá para linkar no checkout da Stripe, o buscador não indexa
 * e quem quer ler antes de pagar não consegue abrir numa aba. Agora é página.
 *
 * O CONTEÚDO é o mesmo do diálogo (vigência de 19/09/2025), traduzido cláusula
 * a cláusula. Nada foi acrescentado nem retirado: mudar o que os Termos dizem é
 * decisão do dono do produto, não de quem redesenha o site.
 */
const LAST_UPDATED = 'November 13, 2026';

const SECTIONS: LegalSection[] = [
  {
    id: 'acceptance',
    title: '1. Acceptance of these terms',
    body: (
      <p>
        By accessing or using the Tickrify website, extension or services, you confirm that you have read,
        understood and agree to these Terms of Service, to the <Link to="/privacy">Privacy Policy</Link> and to
        every associated policy.
      </p>
    ),
  },
  {
    id: 'service',
    title: '2. What the service is',
    body: (
      <>
        <p>
          Tickrify provides chart analysis tools, screen reading and AI generated indications to help identify
          possible buy and sell points. The service is offered for educational and informational purposes. Even
          where the platform indicates a buy or sell signal, that indication is not personalised financial advice,
          an investment recommendation, an offer, or a guarantee of profit.
        </p>
        <p>
          Trading decisions are the user&apos;s sole responsibility. Consult a licensed financial professional
          before making one.
        </p>
      </>
    ),
  },
  {
    id: 'eligibility',
    title: '3. Eligibility',
    body: <p>Use is permitted only to people aged 18 or over, or as the law of your region requires.</p>,
  },
  {
    id: 'accounts',
    title: '4. User accounts',
    body: (
      <>
        <p>By creating an account you agree to:</p>
        <ul>
          <li>provide accurate and current information;</li>
          <li>keep your credentials secure;</li>
          <li>take full responsibility for any activity carried out under your account.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'conduct',
    title: '5. Acceptable use',
    body: (
      <>
        <p>You may not use Tickrify for:</p>
        <ul>
          <li>illegal activity;</li>
          <li>accessing third party data;</li>
          <li>distributing malware or malicious code;</li>
          <li>attempting to breach, break or compromise the security of the platform;</li>
          <li>reverse engineering, scraping or unauthorised access to systems and APIs.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'ip',
    title: '6. Intellectual property',
    body: (
      <p>
        All code, design, algorithms, branding, software, extensions and content belong to Tickrify. Copying,
        cloning, redistributing or modifying any of it without authorisation is prohibited.
      </p>
    ),
  },
  {
    id: 'no-advice',
    title: '7. Not financial advice',
    body: (
      <>
        <p>
          All information, analysis and signals provided by Tickrify are educational. Even when the AI points to a
          possible trade, that does not constitute:
        </p>
        <ul>
          <li>financial advice;</li>
          <li>a professional recommendation;</li>
          <li>a regulated service;</li>
          <li>a guarantee of profit.</li>
        </ul>
        <p>
          Trading carries real risk. See our <Link to="/risk">risk disclosure</Link> and speak to a licensed
          professional.
        </p>
      </>
    ),
  },
  {
    id: 'liability',
    title: '8. Limitation of liability',
    body: (
      <p>
        Tickrify is not liable for direct, indirect, financial or consequential damages arising from use of the
        platform or from decisions taken on the basis of it. The risk is entirely the user&apos;s.
      </p>
    ),
  },
  {
    id: 'privacy',
    title: '9. Privacy and data security',
    body: (
      <p>
        Tickrify protects and encrypts sensitive data, including the images you submit for analysis. See the{' '}
        <Link to="/privacy">Privacy Policy</Link> for how we collect, use and store information.
      </p>
    ),
  },
  {
    id: 'third-parties',
    title: '10. Third party links and services',
    body: (
      <p>
        Tickrify is not responsible for the content, security or practices of external websites and services.
      </p>
    ),
  },
  {
    id: 'changes',
    title: '11. Changes to these terms',
    body: (
      <p>
        Tickrify may update these Terms without prior notice. Continued use of the platform means you accept the
        change.
      </p>
    ),
  },
  {
    id: 'termination',
    title: '12. Termination',
    body: (
      <p>
        Tickrify may suspend or close accounts for breach of these Terms, abusive use or suspicious activity.
      </p>
    ),
  },
  {
    id: 'law',
    title: '13. Governing law',
    body: <p>These Terms follow the laws of the jurisdiction in which Tickrify operates.</p>,
  },
  {
    id: 'restricted',
    title: '14. Regulatory statement: restricted jurisdictions',
    body: (
      <>
        <p>Tickrify is not licensed by financial regulators, including but not limited to:</p>
        <ul>
          <li>the Hong Kong SFC (Securities and Futures Commission);</li>
          <li>the CSRC (China Securities Regulatory Commission);</li>
          <li>any regulatory authority of Mainland China.</li>
        </ul>
        <p>
          The tools are educational and do not constitute an offer, a solicitation or professional advice in
          regulated markets.
        </p>
        <p>
          Users in restricted regions must comply with local law and seek licensed financial professionals.
        </p>
      </>
    ),
  },
  {
    id: 'refunds',
    title: '15. Refund and cancellation policy',
    body: (
      <>
        <p>
          <strong>Subscriptions can be cancelled at any time</strong>, from Settings in your dashboard. You keep
          your Ticks and full access until the end of the period you have already paid for, and you are not
          charged again after that.
        </p>
        <p>
          All purchases are final and non-refundable. By buying a digital product you agree that you have no right
          to a refund, chargeback or credit for a period already started.
        </p>
        <p>
          You are never asked to pay blind: a new account gets a 3-day free trial with 7 analyses and no card, and{' '}
          <Link to="/try">one analysis runs without an account at all</Link>. If an analysis fails, its Tick comes
          back automatically. If something else goes wrong with an analysis you paid for, write to
          support@tickrify.com and we will look at it.
        </p>
      </>
    ),
  },
];

const TermsPage = () => {
  useSeo(seoFor('/terms'));

  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Service"
      intro="The rules that govern your use of Tickrify. Read section 7 and section 15 in particular: what the analysis is, and what happens to your money."
      updated={LAST_UPDATED}
      sections={SECTIONS}
      footer={
        <>
          <h3>Contact</h3>
          <p>
            Questions about these Terms:{' '}
            <a href="mailto:support@tickrify.com">support@tickrify.com</a>
          </p>
        </>
      }
    />
  );
};

export default TermsPage;
