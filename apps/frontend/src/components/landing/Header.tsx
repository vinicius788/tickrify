import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { Link } from "react-router-dom";
import { SignInButton, SignedIn, SignedOut, useUser } from "@clerk/clerk-react";

const Header = () => {
  const { isLoaded } = useUser();
  const navLinks = [
    { href: "#analysis-preview", label: "Painel" },
    { href: "#features", label: "Recursos" },
    { href: "#how-it-works", label: "Como Funciona" },
    { href: "#pricing", label: "Planos" },
    { href: "#faq", label: "FAQ" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container relative flex h-16 items-center justify-between">
        {/* Logo */}
        <a href="/" className="flex items-center space-x-2">
          <img src="/logo.png" alt="Tickrify" className="h-8 w-auto" />
        </a>

        {/* Desktop Floating Island Navigation */}
        <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="flex items-center gap-2 rounded-full border bg-card/70 p-1.5 backdrop-blur-sm shadow-sm">
                <nav className="flex items-center gap-1">
                    {navLinks.map((link) => (
                    <a
                        key={link.href}
                        href={link.href}
                        className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                        {link.label}
                    </a>
                    ))}
                </nav>
            </div>
        </div>

        {/* Desktop Right Side - Login Button (always visible) */}
        <div className="hidden md:flex items-center">
          {isLoaded ? (
            <>
              <SignedOut>
                <SignInButton mode="modal">
                  <Button size="sm" className="rounded-full">Login</Button>
                </SignInButton>
              </SignedOut>
              <SignedIn>
                <Link to="/dashboard">
                  <Button size="sm" className="rounded-full">Dashboard</Button>
                </Link>
              </SignedIn>
            </>
          ) : (
            // Fallback: sempre mostra botão de login se Clerk não estiver carregado
            <Link to="/sign-in">
              <Button size="sm" className="rounded-full">Login</Button>
            </Link>
          )}
        </div>

        {/* Mobile Menu */}
        <div className="flex items-center md:hidden">
            {isLoaded ? (
              <>
                <SignedOut>
                  <SignInButton mode="modal">
                    <Button size="sm">Login</Button>
                  </SignInButton>
                </SignedOut>
                <SignedIn>
                  <Link to="/dashboard" className="mr-2">
                    <Button size="sm">Dashboard</Button>
                  </Link>
                </SignedIn>
              </>
            ) : (
              // Fallback: sempre mostra botão de login se Clerk não estiver carregado
              <Link to="/sign-in" className="mr-2">
                <Button size="sm">Login</Button>
              </Link>
            )}
            <Sheet>
                <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                    <Menu className="h-5 w-5" />
                </Button>
                </SheetTrigger>
                <SheetContent side="left">
                <SheetTitle className="sr-only">Menu Principal</SheetTitle>
                <a href="/" className="flex items-center space-x-2 mb-6">
                    <img src="/logo.png" alt="Tickrify" className="h-8 w-auto" />
                </a>
                <nav className="flex flex-col space-y-3">
                    {navLinks.map((link) => (
                    <a
                        key={link.href}
                        href={link.href}
                        className="p-2 rounded-md text-base font-medium transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground"
                    >
                        {link.label}
                    </a>
                    ))}
                </nav>
                </SheetContent>
            </Sheet>
        </div>
      </div>
    </header>
  );
};

export default Header;
