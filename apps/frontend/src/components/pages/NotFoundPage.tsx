import { Link } from 'react-router-dom';
import SiteLayout from '@/components/layout/SiteLayout';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * Página 404.
 *
 * Até 24/08/2026 o App não tinha rota curinga: qualquer link quebrado, link
 * antigo indexado ou erro de digitação renderizava uma TELA BRANCA, sem nem
 * cabeçalho para o visitante voltar. Agora cai aqui.
 */
const NotFoundPage = () => {
  const { t } = useLanguage();

  return (
    <SiteLayout>
      <section className="site-dark site-closer">
        <div className="site-wrap">
          <p className="site-eyebrow">Error 404</p>
          <h2 style={{ marginTop: '16px' }}>This page took a stop loss.</h2>
          <p>The link is broken or the page has moved. Nothing was lost from your account.</p>
          <div className="site-hero-actions" style={{ justifyContent: 'center' }}>
            <Link to="/" className="site-btn site-btn-primary">Back to home</Link>
            <Link to="/try" className="site-btn site-btn-ghost">{t.landing.footer.tryFree}</Link>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
};

export default NotFoundPage;
