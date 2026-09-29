/*
 * PostHog sem cookie nas paginas estaticas (blog/, tools/, for/).
 *
 * Essas 22 paginas sao servidas pelo Vercel antes da SPA e nao carregam o
 * analytics.ts do React: ate 29/09/2026 nao existia NENHUM evento delas e era
 * impossivel dizer qual post traz cadastro. Arquivo unico em vez de colar o
 * mesmo bloco nas 22 paginas.
 *
 * Mesmo modo do app para quem nao aceitou cookies (cookieless_mode do
 * posthog-js): nada e gravado no navegador; distinct_id e o sentinela
 * "$posthog_cookieless" e o PostHog calcula um hash diario no servidor. Por
 * isso nao pede aceite. Sem biblioteca: um POST por evento na API de captura.
 *
 * Eventos: $pageview; static_cta_clicked { href } em link para o app;
 * static_video_played { video } no primeiro play de cada video.
 */
(function () {
  var KEY = 'phc_r4Afv4BvNLhivvuhu72UkNjVTxtNAKjXmZoC3vAcfPAo';
  var URL_CAPTURE = 'https://us.i.posthog.com/i/v0/e/';

  function base() {
    var p = {
      $current_url: location.href,
      $host: location.host,
      $pathname: location.pathname,
      $referrer: document.referrer || '$direct',
      $referring_domain: document.referrer ? new URL(document.referrer).host : '$direct',
      $screen_width: window.screen && window.screen.width,
      $viewport_width: window.innerWidth,
      $device_type: window.innerWidth < 768 ? 'Mobile' : 'Desktop',
      $raw_user_agent: navigator.userAgent,
      $lib: 'tickrify-static',
      $cookieless_mode: true,
      $device_id: null,
      page_type: 'static',
    };
    try {
      p.$timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (e) {}
    var q = new URLSearchParams(location.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
      if (q.get(k)) p[k] = q.get(k);
    });
    return p;
  }

  function send(event, extra) {
    try {
      var props = base();
      if (extra) for (var k in extra) props[k] = extra[k];
      fetch(URL_CAPTURE, {
        method: 'POST',
        keepalive: true,
        // Corpo em texto puro: requisicao simples, sem preflight de CORS.
        body: JSON.stringify({
          api_key: KEY,
          event: event,
          distinct_id: '$posthog_cookieless',
          properties: props,
          timestamp: new Date().toISOString(),
        }),
      }).catch(function () {});
    } catch (e) {}
  }

  send('$pageview');

  // Link para o app (nao para outra pagina estatica, ancora ou site externo).
  document.addEventListener(
    'click',
    function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
      if (!a) return;
      var u;
      try {
        u = new URL(a.getAttribute('href'), location.href);
      } catch (e) {
        return;
      }
      if (u.host !== location.host) return;
      if (/^\/(blog|tools|for|calendar)(\/|$)/.test(u.pathname) || /\.(png|jpg|svg|ico)$/.test(u.pathname)) return;
      send('static_cta_clicked', { href: u.pathname + u.search });
    },
    true,
  );

  var seen = {};
  document.addEventListener(
    'play',
    function (ev) {
      var v = ev.target;
      if (!v || v.tagName !== 'VIDEO') return;
      var src = (v.currentSrc || v.getAttribute('src') || '').split('/').pop();
      if (seen[src]) return;
      seen[src] = 1;
      send('static_video_played', { video: src });
    },
    true,
  );
})();
