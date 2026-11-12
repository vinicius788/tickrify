import { useEffect } from 'react';
import SEO_ROUTES from '@/lib/seo-routes.json';

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
 * O aviso que ficava aqui dizia que isto não resolvia crawler sem JS e que a
 * correção seria pré-renderizar no build. Isso FOI FEITO: `scripts/prerender.mjs`
 * escreve o `<head>` de cada rota desde 10/08/2026 e, desde 14/09/2026, também
 * o corpo e o JSON-LD (`scripts/geo-body.mjs`). Este hook continua necessário
 * porque a navegação dentro da SPA não recarrega o documento: ele é o que
 * ajusta a meta quando o usuário vai de /pricing para /accuracy sem sair.
 */

const SITE_URL = 'https://tickrify.com';

// Espelham o `index.html`. Servem de estado de repouso: como o React Router
// não recarrega o documento, sem restaurar no unmount a meta de uma página
// ficaria grudada na próxima rota que não usa este hook.
const DEFAULT_TITLE = 'Tickrify: AI chart analysis for traders';
const DEFAULT_DESCRIPTION =
  'AI chart analysis that says Enter now, Watch or No trade, with the levels. Free demo without signup, then a 3-day free trial with 7 analyses. No card.';

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

export type SeoRoutePath = keyof typeof SEO_ROUTES;

/**
 * Meta de uma rota, lida do MESMO arquivo que `scripts/prerender.mjs` consome
 * no build. Uma fonte só, de propósito: o script escreve o `<head>` que o
 * crawler recebe e este hook escreve o que o usuário vê ao navegar dentro da
 * SPA. Com os títulos em dois lugares, eles divergiriam na primeira edição —
 * e a divergência seria invisível, porque cada metade só aparece pra um público.
 */
export function seoFor(path: SeoRoutePath): SeoOptions {
  const entry = SEO_ROUTES[path];
  return {
    title: entry.title,
    description: entry.description,
    // /privacidade é rota legada e aponta o canonical para /privacy.
    path: 'canonicalPath' in entry ? entry.canonicalPath : path,
    // Sem esta linha o `noindex` do JSON só valia no pré-render: a rota nascia
    // noindex no HTML cru e a hidratação apagava a meta, porque o hook restaura
    // o estado de repouso quando não recebe a flag. Um crawler que executa JS
    // via a página como indexável.
    noindex: 'noindex' in entry ? entry.noindex : false,
  };
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
    // O pré-render (scripts/geo-body.mjs) já entrega este mesmo bloco no HTML
    // cru, com este mesmo id, para o crawler que não executa JS. Sem remover o
    // que veio de lá, a página passaria a ter dois elementos com o mesmo id e
    // dois blocos de schema, que é HTML inválido e structured data duplicado.
    document.getElementById(`ld-${id}`)?.remove();
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
