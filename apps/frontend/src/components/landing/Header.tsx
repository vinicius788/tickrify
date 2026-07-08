import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import officialLogo from '@/assets/tickrify-logo-official.png';
import { Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SignInButton, SignUpButton, SignedIn, SignedOut, useUser } from '@clerk/clerk-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';

const Header = () => {
  const { isLoaded } = useUser();
  const { t } = useLanguage();
  const n = t.landing.nav;

  const navLinks = [
    { href: '#recursos', label: n.features },
    { href: '#como-funciona', label: n.how },
    { href: '#preview-dashboard', label: n.panel },
    { href: '#planos', label: n.plans },
    { href: '#faq', label: n.faq },
  ];

  const loginButton = (
    <Button
      size="sm"
      className="landing-login-button rounded-xl px-4 text-[13px] font-semibold"
    >
      {n.login}
    </Button>
  );

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--border-subtle)] bg-[rgba(5,5,8,0.7)] [backdrop-filter:blur(20px)_saturate(180%)]">
      <div className="container flex h-20 items-center justify-between gap-4">
        <a href="/" className="inline-flex items-center">
          <img
            src={officialLogo}
            alt="Tickrify"
            className="h-12 w-auto object-contain md:h-14"
            style={{ filter: 'drop-shadow(0 0 8px rgba(0,232,122,0.4))' }}
          />
        </a>

        <nav className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="landing-nav-link text-[14px] font-medium"
              style={{ fontFamily: 'var(--font-sans)' }}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <LanguageSwitcher />
          {isLoaded ? (
            <>
              <SignedOut>
                <SignInButton mode="modal">{loginButton}</SignInButton>
                <SignUpButton mode="modal" forceRedirectUrl="/dashboard" signInForceRedirectUrl="/dashboard">
                  <Button size="sm" className="landing-primary-button rounded-xl px-4 text-[13px] font-semibold">
                    {t.landing.hero.startFree}
                  </Button>
                </SignUpButton>
              </SignedOut>
              <SignedIn>
                <Link to="/dashboard">
                  <Button size="sm" className="landing-primary-button rounded-xl px-4 font-semibold">
                    {n.dashboard}
                  </Button>
                </Link>
              </SignedIn>
            </>
          ) : (
            <Link to="/sign-in">{loginButton}</Link>
          )}
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <LanguageSwitcher />
          {isLoaded ? (
            <>
              <SignedOut>
                <SignUpButton mode="modal" forceRedirectUrl="/dashboard" signInForceRedirectUrl="/dashboard">
                  <Button size="sm" className="landing-primary-button rounded-xl px-3 text-[13px] font-semibold">
                    {t.landing.hero.startFree}
                  </Button>
                </SignUpButton>
              </SignedOut>
              <SignedIn>
                <Link to="/dashboard">
                  <Button size="sm" className="landing-primary-button rounded-xl px-3">
                    {n.app}
                  </Button>
                </Link>
              </SignedIn>
            </>
          ) : (
            <Link to="/sign-in">{loginButton}</Link>
          )}

          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl border border-[var(--border-card)] text-[var(--text-primary)] hover:bg-[rgba(255,255,255,0.04)]"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="border-[var(--border-card)] bg-[rgba(12,13,20,0.96)]">
              <SheetTitle className="sr-only">{n.menu}</SheetTitle>
              <div className="mt-6 flex flex-col gap-4">
                {navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--border-accent)] hover:text-[var(--text-primary)]"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
};

export default Header;
