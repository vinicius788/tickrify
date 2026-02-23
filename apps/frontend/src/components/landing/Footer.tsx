import { Bot, Instagram } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import TermsOfServiceDialog from "@/components/landing/TermsOfServiceDialog";

const XBrandIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="currentColor"
    className={className}
  >
    <path d="M18.901 1.153h3.68l-8.04 9.19 9.456 12.504h-7.403l-5.793-7.57-6.63 7.57H.49l8.6-9.83L0 1.154h7.595l5.243 6.932 6.063-6.933Zm-1.29 19.512h2.04L6.486 3.258H4.298l13.313 17.407Z" />
  </svg>
);

const Footer = () => {
  const footerLinks = {
    Plataforma: [
      { title: "Features", href: "#features" },
      { title: "Planos", href: "#pricing" },
    ],
    Empresa: [
      { title: "Sobre Nós", href: "#" },
      { title: "Termos de Serviço", href: "#terms" },
    ],
  };

  return (
    <footer className="bg-card">
      <div className="container py-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <div className="flex flex-col space-y-4 md:col-span-1">
             <a href="/" className="flex items-center space-x-2">
                <Bot className="h-8 w-8 text-primary" />
                <span className="text-xl font-bold">Tickrify</span>
              </a>
              <p className="text-muted-foreground text-sm">
                Análise de Trading com IA.
              </p>
              <div className="flex space-x-4">
                <a
                  href="https://x.com/tickrify"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="X"
                  className="text-muted-foreground hover:text-primary"
                >
                  <XBrandIcon />
                </a>
                <a
                  href="https://instagram.com/tickrify"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Instagram"
                  className="text-muted-foreground hover:text-primary"
                >
                  <Instagram />
                </a>
              </div>
          </div>
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="font-semibold">{category}</h4>
              <ul className="mt-4 space-y-2">
                {links.map((link) => (
                  <li key={link.title}>
                    {link.title === "Termos de Serviço" ? (
                      <TermsOfServiceDialog />
                    ) : (
                      <a href={link.href} className="text-muted-foreground hover:text-primary transition-colors">
                        {link.title}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <Separator className="my-8" />
        <div className="text-center text-sm text-muted-foreground">
          <p>
            © {new Date().getFullYear()} Tickrify. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
