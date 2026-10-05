import { Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SignInButton, SignedIn, SignedOut, useUser } from '@clerk/clerk-react';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import lockup from '@/assets/tickrify-lockup.svg';
import type { SiteSection } from '@/components/layout/SiteLayout';

interface HeaderProps {
  /** Marca o item correspondente à página atual. */
  active?: SiteSection;
  /** Sem navegação: só logo, idioma e entrar. Ver SiteLayout. */
  minimal?: boolean;
}

/**
 * Cabeçalho do site público. Montado pelo SiteLayout em TODA página pública.
 *
 * Os links de âncora apontam para "/#alvo" e não para "#alvo": assim funcionam
 * também a partir de /pricing ou /accuracy, onde a seção não existe na página.
 */
const Header = ({ active = null, minimal = false }: HeaderProps) => {
  const { isLoaded, user } = useUser();
  // Menu do celular: sem depender do Clerk carregar. Enquanto nao ha sessao
  // confirmada, mostra analise gratis e login (antes o menu ficava sem os dois).
  const signedIn = isLoaded && Boolean(user);
  const { t } = useLanguage();
  const n = t.landing.nav;
  const f = t.landing.footer;

  const links: { key: SiteSection; href: string; label: string; route?: boolean }[] = [
    { key: 'how', href: '/#how', label: n.how },
    { key: 'platform', href: '/#platform', label: n.panel },
    { key: 'accuracy', href: '/accuracy', label: f.accuracy, route: true },
    { key: 'pricing', href: '/pricing', label: n.plans, route: true },
    { key: 'faq', href: '/#faq', label: n.faq },
  ];


  return (
    <header className="site-header">
      <div className="site-wrap">
        <Link to="/" className="site-logo" aria-label="Tickrify">
          <img src={lockup} alt="Tickrify" width={116} height={30} />
        </Link>

        {minimal ? null : (
        <nav className="site-nav">
          {links.map((link) =>
            link.route ? (
              <Link
                key={link.href}
                to={link.href}
                aria-current={active === link.key ? 'page' : undefined}
              >
                {link.label}
              </Link>
            ) : (
              <a key={link.href} href={link.href} aria-current={active === link.key ? 'page' : undefined}>
                {link.label}
              </a>
            ),
          )}
        </nav>
        )}

        <div className="site-header-actions">
          <div className="hidden md:block">
            <LanguageSwitcher />
          </div>

          {/* 05/10/2026: "Log in" visivel em TODA largura (no celular ficava
              escondido e quem ja tinha conta so achava o "Sign in" no rodape do
              cadastro). O botao principal leva a analise gratis (/try), igual
              ao da home: antes tinha o MESMO texto e abria o cadastro. */}
          {isLoaded ? (
            <>
              <SignedOut>
                <SignInButton mode="modal">
                  <button type="button" className="site-btn site-btn-ghost site-btn-sm">
                    {n.login}
                  </button>
                </SignInButton>
                <Link to="/try" className="site-btn site-btn-primary site-btn-sm hidden sm:inline-flex">
                  {t.landing.hero.startFree}
                </Link>
              </SignedOut>
              <SignedIn>
                <Link to="/dashboard" className="site-btn site-btn-primary site-btn-sm">
                  {n.dashboard}
                </Link>
              </SignedIn>
            </>
          ) : (
            <Link to="/sign-in" className="site-btn site-btn-ghost site-btn-sm">
              {n.login}
            </Link>
          )}

          {minimal ? null : (
          <Sheet>
            <SheetTrigger asChild>
              {/* Some so a partir de 940px, onde a barra de links aparece
                  (.site-nav). Com `md:hidden` (768px) sobrava uma faixa sem
                  nenhum dos dois. */}
              <button
                type="button"
                aria-label={n.menu}
                className="site-btn site-btn-ghost site-btn-icon min-[940px]:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            {/* `tk-site` fica no miolo, NUNCA no SheetContent: o `.tk-site` tem
                `position: relative` e ganha do `fixed` do painel, que ia parar
                no fim da pagina e o menu "nao abria" no celular (05/10/2026). */}
            <SheetContent side="right" className="border-white/10 bg-[#08090a] text-[#f7f7f5]">
              <SheetTitle className="sr-only">{n.menu}</SheetTitle>
              <div className="tk-site mt-8 flex flex-col gap-3">
                <SheetClose asChild>
                  {signedIn ? (
                    <Link to="/dashboard" className="site-btn site-btn-primary site-btn-block">
                      {n.dashboard}
                    </Link>
                  ) : (
                    <Link to="/try" className="site-btn site-btn-primary site-btn-block">
                      {t.landing.hero.startFree}
                    </Link>
                  )}
                </SheetClose>
                {links.map((link) => (
                  <SheetClose asChild key={link.href}>
                    <a href={link.href} className="site-menu-link">
                      {link.label}
                    </a>
                  </SheetClose>
                ))}
                {/* Pagina de login, nao o modal: com o menu aberto o modal do
                    Clerk ficaria por baixo do bloqueio de clique do painel. */}
                {signedIn ? null : (
                  <SheetClose asChild>
                    <Link to="/sign-in" className="site-menu-link">
                      {n.login}
                    </Link>
                  </SheetClose>
                )}
                <div className="mt-2">
                  <LanguageSwitcher />
                </div>
              </div>
            </SheetContent>
          </Sheet>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
