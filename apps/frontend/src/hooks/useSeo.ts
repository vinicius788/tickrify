import { useEffect } from 'react';

/**
 * SEO por rota — auditoria de 10/08/2026.
 *
 * O achado: o site é uma SPA Vite sem SSR, então TODAS as rotas serviam o
 * mesmo `<title>` e a mesma meta description do `index.html`. Conferido ao
 * vivo: buscar tickrify.com/pricing devolvia "Tickrify — AI chart analysis
 * for traders", o título do home. Nenhuma rota podia rankear para nada
 * específico enquanto isso durasse.
 *
 * Por que um hook de mão em vez do `react-helmet-async`: dependência nova não
 * entra (o lockfile não atualiza na máquina local — ver CLAUDE.md). Isto faz
 * o necessário em ~40 linhas mexendo direto no `document.head`.
 *
 * ⚠️ Isto resolve o Googlebot, que renderiza JS. NÃO resolve crawler que não
 * executa JS (Bing, crawlers de IA, prévia de link do WhatsApp/Slack), porque
 * a meta só existe depois da hidratação. A correção completa é pré-renderizar
 * as rotas públicas no build — próximo passo, maior e separado.
 */

const SITE_URL = 'https://tickrify.com';

// Espelham o `index.html`. Servem de estado de repouso: como o React Router
// não recarrega o documento, sem restaurar no unmount a meta de uma página
// ficaria grudada na próxima rota que não usa este hook.
const DEFAULT_TITLE = 'Tickrify — AI chart analysis for traders';
const DEFAULT_DESCRIPTION =
  'Paste your chart — AI reads the entry, stop, targets and risk. A second opinion that confirms or kills your read before you enter. The final call is yours. 3 free analyses.';

export interface SeoOptions {
  /** Aparece na aba e como link azul na SERP. Mire 50–60 caracteres. */
  title: string;
  /** Snippet da SERP. Mire 150–160 caracteres — acima disso o Google corta. */
  description: string;
  /** Caminho canônico, começando com '/'. Vira a URL absoluta e limpa (sem UTM). */
  path: string;
  /** Página que responde mas não deve ser indexada. */
  noindex?: boolean;
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function useSeo({ title, description, path, noindex = false }: SeoOptions) {
  useEffect(() => {
    const url = `${SITE_URL}${path}`;

    document.title = title;
    upsertMeta('name', 'description', description);
    upsertLink('canonical', url);

    // og:* e twitter:* seguem o título da rota; sem isso o card compartilhado
    // de /pricing e /accuracy anunciaria o home.
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:url', url);
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);

    const robots = document.head.querySelector('meta[name="robots"]');
    if (noindex) {
      upsertMeta('name', 'robots', 'noindex, nofollow');
    } else if (robots) {
      robots.remove();
    }

    return () => {
      document.title = DEFAULT_TITLE;
      upsertMeta('name', 'description', DEFAULT_DESCRIPTION);
      upsertMeta('property', 'og:title', DEFAULT_TITLE);
      upsertMeta('property', 'og:description', DEFAULT_DESCRIPTION);
      upsertMeta('property', 'og:url', `${SITE_URL}/`);
      upsertMeta('name', 'twitter:title', DEFAULT_TITLE);
      upsertMeta('name', 'twitter:description', DEFAULT_DESCRIPTION);
      document.head.querySelector('meta[name="robots"]')?.remove();
    };
  }, [title, description, path, noindex]);
}

/**
 * JSON-LD por rota. Mesma mecânica: injeta um `<script>` marcado e remove no
 * unmount, para o schema de uma página não vazar para a seguinte.
 *
 * `id` precisa ser único por página (vira o id do elemento no DOM).
 */
export function useJsonLd(id: string, data: Record<string, unknown> | null) {
  useEffect(() => {
    if (!data) return;
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = `ld-${id}`;
    el.textContent = JSON.stringify(data);
    document.head.appendChild(el);
    return () => {
      el.remove();
    };
  }, [id, data]);
}
