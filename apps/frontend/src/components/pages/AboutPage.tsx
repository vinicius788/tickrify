import SiteLayout from '@/components/layout/SiteLayout';
import { seoFor, useJsonLd, useSeo } from '@/hooks/useSeo';

const AboutPage = () => {
  useSeo(seoFor('/about'));
  useJsonLd('about', {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    '@id': 'https://tickrify.com/about#webpage',
    name: 'About Tickrify',
    url: 'https://tickrify.com/about',
    about: {
      '@type': 'Organization',
      '@id': 'https://tickrify.com/#organization',
      name: 'Tickrify',
      founder: { '@type': 'Person', name: 'Vinicius Marques de Oliveira' },
      address: { '@type': 'PostalAddress', addressLocality: 'Belo Horizonte', addressCountry: 'BR' },
    },
  });

  return (
    <SiteLayout>
      <section className="site-dark site-phead">
        <div className="site-wrap">
          <span className="site-eyebrow">Company</span>
          <h1>About Tickrify</h1>
          <p>
            Tickrify is an independent, bootstrapped SaaS platform for AI-powered technical chart analysis.
            It is built by founder Vinicius Marques de Oliveira in Belo Horizonte, Brazil.
          </p>
        </div>
      </section>

      <section className="site-dark site-body-tight">
        <div className="site-wrap">
          <div className="site-prose">
            <h2>What Tickrify does</h2>
            <p>
              Tickrify uses AI to analyze trading charts and identify market structures. Each analysis can
              outline a potential entry, stop-loss and targets, or describe the scenarios a trader may want
              to wait for when conditions do not support a setup.
            </p>
            <p>
              The product is designed to make technical reasoning easier to review. Traders remain responsible
              for evaluating the analysis and making their own decisions.
            </p>

            <h2>Technology direction</h2>
            <p>
              Tickrify’s future goal is to develop specialized agents using Claude to improve analytical
              precision, technical reasoning and the engineering behind each analysis. This is a development
              objective, not a current product feature.
            </p>

            <h2>Company status</h2>
            <p>
              Tickrify is an independent, bootstrapped startup and has not been formally incorporated.
              The founder is based in Belo Horizonte, Brazil.
            </p>

            <h2>Contact</h2>
            <p>
              Visit <a href="https://tickrify.com">tickrify.com</a> for product information.
            </p>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
};

export default AboutPage;
