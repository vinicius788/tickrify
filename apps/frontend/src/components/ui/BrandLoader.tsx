/**
 * Logo animada de carregamento (so o icone, sem o nome).
 *
 * Arquivo proprio porque sao dois lugares que carregam: o fallback das rotas
 * lazy (App.tsx) e a espera do Clerk (ProtectedRoute). A animacao em si mora no
 * SVG de `public/`, que o index.html tambem usa antes do React montar: um
 * arquivo so, e a logo fica na MESMA posicao nas tres fases, sem pular.
 */
export function BrandLoader() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--bg)]" role="status" aria-live="polite">
      <img src="/tickrify-mark-loader.svg" alt="" width={64} height={77} className="h-[77px] w-16" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export default BrandLoader;
