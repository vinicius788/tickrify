import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import officialLogo from '@/assets/tickrify-logo-official.png';
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
      className="rounded-md border border-[var(--accent-green)] bg-transparent px-4 text-[var(--accent-green)] hover:bg-[var(--accent-green)] hover:text-black"
    >
      Login
    </Button>
  );

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--border)] bg-[rgba(8,8,8,0.72)] [backdrop-filter:blur(12px)]">
      <div className="container flex h-16 items-center justify-between gap-4">
        <a href="/" className="inline-flex items-center">
          <img src={officialLogo} alt="Tickrify" className="h-12 w-auto object-contain" />
        </a>

        <nav className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
                className="text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '14px',
                  fontWeight: 500,
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
                  <Button size="sm" className="rounded-md bg-[var(--accent-green)] px-4 font-semibold text-black hover:opacity-90">
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
                  <Button size="sm" className="rounded-md bg-[var(--accent-green)] px-3 text-black hover:opacity-90">
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
              <Button variant="ghost" size="icon" className="text-[var(--text-primary)] hover:bg-[var(--bg-card)]">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="border-[var(--border)] bg-[var(--bg-surface)]">
              <SheetTitle className="sr-only">Menu principal</SheetTitle>
              <div className="mt-6 flex flex-col gap-4">
                {navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
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
