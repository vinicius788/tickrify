import { ReactNode, useEffect } from 'react';
import Header from '@/components/landing/Header';
import Footer from '@/components/landing/Footer';

export type SiteSection = 'how' | 'platform' | 'accuracy' | 'pricing' | 'faq' | null;

interface SiteLayoutProps {
  children: ReactNode;
  /** Item do menu que fica marcado como página atual. */
  active?: SiteSection;
  /**
   * Cabeçalho reduzido (só logo e entrar). Usado na /try, onde a página existe
   * para UM clique: um menu completo ali só oferece saídas antes do "aha".
   */
  minimal?: boolean;
}

/**
 * Casca do site público (landing, /pricing, /try, /accuracy e páginas legais).
 *
 * Existe porque até 24/08/2026 só a home montava Header e Footer: quem caía em
 * /pricing pelo Google não via logo, menu nem link legal, e não tinha como
 * voltar para o site. Agora toda página pública passa por aqui.
 *
 * A classe tk-site carrega a paleta do site (index.css). É escopada de
 * propósito — o dashboard continua nos tokens de trading-tokens.css e não é
 * afetado por nada definido aqui.
 */
const SiteLayout = ({ children, active = null, minimal = false }: SiteLayoutProps) => {
  // Âncora vinda de outra página (/#platform, /#faq): quando o navegador procura
  // o alvo, o React ainda não montou a seção e o salto se perde. Aqui ele é
  // refeito uma vez, depois da montagem.
  useEffect(() => {
    const { hash } = window.location;
    if (!hash || hash.length < 2) return;
    const target = document.getElementById(hash.slice(1));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return (
    <div className="tk-site flex min-h-screen flex-col overflow-x-clip">
      <Header active={active} minimal={minimal} />
      <main className="flex-grow">{children}</main>
      <Footer />
    </div>
  );
};

export default SiteLayout;
