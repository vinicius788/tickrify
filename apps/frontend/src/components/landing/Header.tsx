import { Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SignInButton, SignUpButton, SignedIn, SignedOut, useUser } from '@clerk/clerk-react';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import lockup from '@/assets/tickrify-lockup.svg';
import type { SiteSection } from '@/components/layout/SiteLayout';

interface HeaderProps {
  /** Marca o item correspondente à página atual. */
  active?: SiteSection;
}

/**
 * Cabeçalho do site público. Montado pelo SiteLayout em TODA página pública.
 *
 * Os links de âncora apontam para "/#alvo" e não para "#alvo": assim funcionam
 * também a partir de /pricing ou /accuracy, onde a seção não existe na página.
 */
const Header = ({ active = null }: HeaderProps) => {
  const { isLoaded } = useUser();
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
        <a href="/" className="site-logo" aria-label="Tickrify">
          <img src={lockup} alt="Tickrify" width={116} height={30} />
        </a>

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

        <div className="site-header-actions">
          <div className="hidden md:block">
            <LanguageSwitcher />
          </div>

          {isLoaded ? (
            <>
              <SignedOut>
                <span className="hidden sm:inline-flex">
                  <SignInButton mode="modal">
                    <button type="button" className="site-btn site-btn-ghost site-btn-sm">
                      {n.login}
                    </button>
                  </SignInButton>
                </span>
                <SignUpButton
                  mode="modal"
                  forceRedirectUrl="/dashboard"
                  signInForceRedirectUrl="/dashboard"
                >
                  <button type="button" className="site-btn site-btn-primary site-btn-sm">
                    {t.landing.hero.startFree}
                  </button>
                </SignUpButton>
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

          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label={n.menu}
                className="site-btn site-btn-ghost h-9 w-9 rounded-xl p-0 md:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="tk-site border-[var(--s-hair)] bg-[#0e1012] text-[var(--s-fg)]"
            >
              <SheetTitle className="sr-only">{n.menu}</SheetTitle>
              <div className="mt-8 flex flex-col gap-3">
                {links.map((link) => (
                  <a key={link.href} href={link.href} className="site-menu-link">
                    {link.label}
                  </a>
                ))}
                <div className="mt-2">
                  <LanguageSwitcher />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
};

export default Header;
