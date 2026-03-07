import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SignInButton, SignedIn, SignedOut, useUser } from '@clerk/clerk-react';

const Header = () => {
  const { isLoaded } = useUser();

  const navLinks = [
    { href: '#recursos', label: 'Recursos' },
    { href: '#como-funciona', label: 'Como Funciona' },
    { href: '#preview-dashboard', label: 'Painel' },
    { href: '#planos', label: 'Planos' },
    { href: '#faq', label: 'FAQ' },
  ];

  const loginButton = (
    <Button
      size="sm"
      className="rounded-md border border-[var(--signal-buy)] bg-transparent px-4 text-[var(--signal-buy)] hover:bg-[var(--signal-buy)] hover:text-black"
    >
      Login
    </Button>
  );

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--border-subtle)] bg-[rgba(10,11,13,0.74)] [backdrop-filter:blur(12px)]">
      <div className="container flex h-16 items-center justify-between gap-4">
        <a href="/" className="inline-flex items-center gap-2">
          <img src="/icon.png" alt="Tickrify" className="h-8 w-8" />
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.1rem',
              letterSpacing: '0.05em',
              color: '#E8ECF4',
            }}
          >
            TICKRIFY
          </span>
        </a>

        <nav className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '0.875rem',
                fontWeight: 400,
              }}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {isLoaded ? (
            <>
              <SignedOut>
                <SignInButton mode="modal">{loginButton}</SignInButton>
              </SignedOut>
              <SignedIn>
                <Link to="/dashboard">
                  <Button size="sm" className="rounded-md bg-[var(--signal-buy)] px-4 font-semibold text-black hover:opacity-90">
                    Dashboard
                  </Button>
                </Link>
              </SignedIn>
            </>
          ) : (
            <Link to="/sign-in">{loginButton}</Link>
          )}
        </div>

        <div className="flex items-center gap-2 md:hidden">
          {isLoaded ? (
            <>
              <SignedOut>
                <SignInButton mode="modal">{loginButton}</SignInButton>
              </SignedOut>
              <SignedIn>
                <Link to="/dashboard">
                  <Button size="sm" className="rounded-md bg-[var(--signal-buy)] px-3 text-black hover:opacity-90">
                    App
                  </Button>
                </Link>
              </SignedIn>
            </>
          ) : (
            <Link to="/sign-in">{loginButton}</Link>
          )}

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="border-[var(--border-subtle)] bg-[var(--bg-surface)]">
              <SheetTitle className="sr-only">Menu principal</SheetTitle>
              <div className="mt-6 flex flex-col gap-4">
                {navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
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
