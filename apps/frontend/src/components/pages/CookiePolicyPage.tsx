import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LegalPage, { type LegalSection } from '@/components/legal/LegalPage';
import { CONSENT_EVENT, getConsent, resetConsent, type ConsentValue } from '@/lib/consent';
import { seoFor, useSeo } from '@/hooks/useSeo';

/**
 * Política de cookies, /cookies. Página nova de 24/08/2026.
 *
 * A lista abaixo descreve o que o site CARREGA DE VERDADE: Clerk, Stripe,
 * Turnstile, PostHog e Meta Pixel. Ao acrescentar ou remover um provedor no
 * código, esta tabela muda junto — declarar cookie que não existe é tão errado
 * quanto esconder um que existe.
 */
const LAST_UPDATED = 'August 24, 2026';

const LABEL: Record<ConsentValue, string> = {
  granted: 'Analytics and marketing cookies are ON in this browser.',
  denied: 'Only essential cookies are running in this browser.',
};

/** Deixa a pessoa ver e refazer a escolha, que é metade do ponto da página. */
const ConsentControl = () => {
  const [choice, setChoice] = useState<ConsentValue | null>(null);

  useEffect(() => {
    const sync = () => setChoice(getConsent());
    sync();
    window.addEventListener(CONSENT_EVENT, sync);
    return () => window.removeEventListener(CONSENT_EVENT, sync);
  }, []);

  return (
    <>
      <p>
        <strong>{choice ? LABEL[choice] : 'You have not chosen yet, so only essential cookies are running.'}</strong>
      </p>
      {choice ? (
        <p>
          <button type="button" className="site-btn site-btn-ghost site-btn-sm" onClick={resetConsent}>
            Change my choice
          </button>
        </p>
      ) : null}
    </>
  );
};

const SECTIONS: LegalSection[] = [
  {
    id: 'what',
    title: 'What we use, in one paragraph',
    body: (
      <>
        <p>
          Cookies and similar storage keep you signed in, let payment work and, if you allow it, tell us which
          pages people actually use. We do not sell this data, and we do not run advertising cookies that follow
          you across unrelated websites.
        </p>
        <p>
          Nothing beyond the essential list below loads until you accept. Refusing costs you nothing: every part
          of the product works the same either way.
        </p>
      </>
    ),
  },
  {
    id: 'choice',
    title: 'Your current choice',
    body: <ConsentControl />,
  },
  {
    id: 'essential',
    title: 'Essential, always on',
    body: (
      <>
        <p>These cannot be switched off without breaking the product:</p>
        <ul>
          <li>
            <strong>Clerk</strong>, our authentication provider, sets a session cookie so you stay signed in
            between pages.
          </li>
          <li>
            <strong>Stripe</strong> sets cookies during checkout to process the payment and to detect fraud.
          </li>
          <li>
            <strong>Cloudflare Turnstile</strong> runs on the free demo at <Link to="/try">/try</Link> to tell a
            person from a bot, so one device cannot drain the free quota.
          </li>
          <li>
            <strong>Local storage on your own device</strong> holds your language, your theme and whether you have
            already used the free demo.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'analytics',
    title: 'Analytics, only with your permission',
    body: (
      <>
        <p>
          <strong>PostHog</strong> records which pages are visited and which steps of signup and checkout people
          complete. We use it to find where the product loses people, not to profile you. It stores an anonymous
          identifier in a cookie and in local storage.
        </p>
        <p>It does not load at all until you accept, and it stops if you change your choice above.</p>
      </>
    ),
  },
  {
    id: 'marketing',
    title: 'Marketing, only with your permission',
    body: (
      <>
        <p>
          <strong>Meta Pixel</strong> tells Meta when a visit that started from one of our ads led to a signup or a
          subscription, which is how the ad budget gets pointed at what works. It sets identifiers such as
          <code> _fbp</code> and <code> _fbc</code>.
        </p>
        <p>Like analytics, it does not load until you accept.</p>
      </>
    ),
  },
  {
    id: 'browser',
    title: 'Controlling cookies in your browser',
    body: (
      <p>
        Every major browser lets you block or delete cookies in its settings. Blocking essential cookies will stop
        you from signing in or paying. Clearing your browser data also clears the choice you made here, so the
        banner will ask again.
      </p>
    ),
  },
];

const CookiePolicyPage = () => {
  useSeo(seoFor('/cookies'));

  return (
    <LegalPage
      eyebrow="Legal"
      title="Cookie policy"
      intro="What gets stored on your device, who put it there, and how to turn off the parts that are not essential."
      updated={LAST_UPDATED}
      sections={SECTIONS}
      footer={
        <>
          <h3>Related</h3>
          <p>
            How we handle personal data is in the <Link to="/privacy">Privacy Policy</Link>. Questions:{' '}
            <a href="mailto:support@tickrify.com">support@tickrify.com</a>
          </p>
        </>
      }
    />
  );
};

export default CookiePolicyPage;
