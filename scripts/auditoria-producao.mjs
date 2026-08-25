#!/usr/bin/env node
/**
 * AUDITORIA DE PRODUÇÃO — o que só dá para conferir com o site NO AR.
 *
 * Complementa scripts/auditoria-seguranca.mjs (que é estática e roda a cada
 * push). Aqui verificamos o que o código sozinho não prova: se o HTTPS está
 * mesmo forçado, se os cabeçalhos chegam ao navegador, se as rotas protegidas
 * respondem 401 de verdade, e se o certificado não está por vencer.
 *
 * POR QUE ISSO É UMA VERIFICAÇÃO SEPARADA
 * Cabeçalho configurado no código não é cabeçalho entregue ao usuário. Entre os
 * dois existem o Vercel, o Render e (em breve) a Cloudflare, e qualquer um deles
 * pode remover, sobrescrever ou não repassar. "Está no helmet" e "chega no
 * navegador" são afirmações diferentes — esta é a que importa.
 *
 * Uso:
 *   node scripts/auditoria-producao.mjs https://tickrify.onrender.com https://tickrify.com
 *   SMOKE_OPS_TOKEN=... node scripts/auditoria-producao.mjs <api> <site>
 *
 * Sai com 1 se qualquer verificação BLOQUEANTE falhar.
 */

import tls from 'tls';

const API = (process.argv[2] || process.env.BACKEND_URL || '').replace(/\/$/, '');
const SITE = (process.argv[3] || process.env.FRONTEND_URL || '').replace(/\/$/, '');
const OPS_TOKEN = process.env.SMOKE_OPS_TOKEN || process.env.INTERNAL_OPS_TOKEN || '';

if (!API) {
  console.error('Uso: node scripts/auditoria-producao.mjs <URL_DA_API> [URL_DO_SITE]');
  process.exit(2);
}

const resultados = [];
const registrar = (nome, severidade, problemas) =>
  resultados.push({ nome, severidade, ok: problemas.length === 0, problemas });

async function buscar(url, opcoes = {}) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), 20_000);
  try {
    return await fetch(url, { redirect: 'manual', signal: controlador.signal, ...opcoes });
  } finally {
    clearTimeout(timer);
  }
}

// ── 1. HTTPS forçado ────────────────────────────────────────────────────────
//
// Um 200 em http:// significa que existe uma janela em que a sessão do usuário
// trafega em claro. O certo é redirecionar (301/308) antes de qualquer conteúdo.
async function verificarRedirecionamentoHttps(base) {
  const problemas = [];
  const alvo = base.replace(/^https:/, 'http:');
  try {
    const r = await buscar(alvo);
    const local = r.headers.get('location') || '';
    if (![301, 302, 307, 308].includes(r.status)) {
      problemas.push(`${alvo} respondeu ${r.status} em vez de redirecionar para HTTPS`);
    } else if (!local.startsWith('https://')) {
      problemas.push(`${alvo} redireciona para "${local}", que não é HTTPS`);
    }
  } catch {
    // Conexão recusada em http:// significa que NÃO EXISTE nada escutando em
    // claro. Isso é mais seguro que redirecionar, não menos — então passa.
    // Só falha se algo responder 200 ali, que é o caso perigoso de verdade.
  }
  return problemas;
}

// ── 2. HSTS ─────────────────────────────────────────────────────────────────
//
// HSTS é o que protege a PRIMEIRA requisição depois da primeira visita: o
// navegador passa a recusar http:// sozinho. Sem `preload`, a primeiríssima
// visita da vida ainda pode ser interceptada.
function verificarHsts(cabecalho) {
  const problemas = [];
  if (!cabecalho) return ['Strict-Transport-Security ausente'];
  const maxAge = Number(cabecalho.match(/max-age=(\d+)/i)?.[1] ?? 0);
  if (maxAge < 31_536_000) problemas.push(`max-age=${maxAge} é menor que 1 ano (31536000)`);
  if (!/includeSubDomains/i.test(cabecalho)) problemas.push('sem includeSubDomains');
  if (!/preload/i.test(cabecalho)) problemas.push('sem preload');
  return problemas;
}

// ── 3. Certificado TLS ──────────────────────────────────────────────────────
function verificarCertificado(base) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port: Number(port) || 443, servername: hostname, timeout: 15_000 },
      () => {
        const cert = socket.getPeerCertificate();
        const problemas = [];
        if (!socket.authorized) problemas.push(`certificado não confiável: ${socket.authorizationError}`);
        if (cert?.valid_to) {
          const diasRestantes = Math.round((new Date(cert.valid_to) - Date.now()) / 86_400_000);
          if (diasRestantes < 0) problemas.push(`certificado VENCIDO há ${-diasRestantes} dias`);
          else if (diasRestantes < 15) problemas.push(`certificado vence em ${diasRestantes} dias`);
        }
        const versao = socket.getProtocol();
        // TLS 1.0/1.1 estão obsoletos desde 2021.
        if (versao && /TLSv1(\.[01])?$/.test(versao)) problemas.push(`negociou ${versao}, obsoleto`);
        socket.end();
        resolve(problemas);
      },
    );
    socket.on('error', (e) => resolve([`falha de TLS em ${hostname}: ${e.message}`]));
    socket.on('timeout', () => {
      socket.destroy();
      resolve([`timeout de TLS em ${hostname}`]);
    });
  });
}

async function main() {
  console.log(`\n═══ AUDITORIA DE PRODUÇÃO ═══\n  api:  ${API}\n  site: ${SITE || '(não informado)'}\n`);

  // ── Cabeçalhos da API ─────────────────────────────────────────────────────
  const raiz = await buscar(`${API}/api/health/live`);
  const h = (nome) => raiz.headers.get(nome);

  registrar('API responde no /health/live', 'bloqueia', raiz.status === 200 ? [] : [`HTTP ${raiz.status}`]);
  registrar('HSTS na API', 'bloqueia', verificarHsts(h('strict-transport-security')));

  registrar('Cabeçalhos de segurança na API', 'bloqueia', [
    ...(h('x-content-type-options') === 'nosniff' ? [] : ['X-Content-Type-Options: nosniff ausente']),
    ...(/DENY|SAMEORIGIN/i.test(h('x-frame-options') || '') ? [] : ['X-Frame-Options ausente (clickjacking)']),
    ...(h('content-security-policy') ? [] : ['Content-Security-Policy ausente']),
  ]);

  registrar(
    'API não revela a stack',
    'avisa',
    [
      ...(h('x-powered-by') ? [`X-Powered-By: ${h('x-powered-by')} — informa a stack de graça a quem varre`] : []),
      ...(/\d+\.\d+/.test(h('server') || '') ? [`Server: ${h('server')} expõe versão`] : []),
    ],
  );

  registrar('HTTPS forçado na API', 'bloqueia', await verificarRedirecionamentoHttps(API));
  registrar('Certificado da API', 'bloqueia', await verificarCertificado(API));

  // ── Rotas protegidas respondem 401/403 SEM credencial ─────────────────────
  //
  // Este é o coração da auditoria: prova, contra a produção real, que negar por
  // padrão está valendo. Se qualquer uma destas devolver 200, há vazamento.
  const protegidas = [
    ['/api/auth/me', 'dados da conta'],
    ['/api/ai/analyses', 'histórico de análises'],
    ['/api/ticks/balance', 'saldo de ticks'],
    ['/api/stripe/subscription', 'assinatura'],
    ['/api/prompts/list', 'prompts do motor (admin)'],
    ['/api/admin/flags', 'loja de apps (admin)'],
    ['/api/admin/reports', 'relatos de problema (admin)'],
  ];
  const vazando = [];
  for (const [caminho, oque] of protegidas) {
    try {
      const r = await buscar(`${API}${caminho}`);
      if (![401, 403].includes(r.status)) {
        vazando.push(`${caminho} (${oque}) respondeu ${r.status} SEM autenticação — esperado 401/403`);
      }
    } catch (erro) {
      vazando.push(`${caminho}: ${erro.message}`);
    }
  }
  registrar('Rotas protegidas negam acesso sem credencial', 'bloqueia', vazando);

  // ── Endpoints de operação exigem o token de ops ───────────────────────────
  const opsAbertos = [];
  for (const caminho of ['/api/health', '/api/health/ready']) {
    const r = await buscar(`${API}${caminho}`);
    if (![401, 403].includes(r.status)) {
      opsAbertos.push(`${caminho} respondeu ${r.status} sem x-ops-token — expõe estado de fila, banco e modelos`);
    }
  }
  registrar('Endpoints de operação exigem token', 'bloqueia', opsAbertos);

  if (OPS_TOKEN) {
    const r = await buscar(`${API}/api/health`, { headers: { 'x-ops-token': OPS_TOKEN } });
    registrar('Token de ops válido abre o /health', 'bloqueia', r.ok ? [] : [`HTTP ${r.status} com token válido`]);

    if (r.ok) {
      const corpo = await r.json().catch(() => ({}));
      // A vitrine vende "live candle grounding". Se estiver desligado, o site
      // afirma algo que a produção não faz — isso é incidente de claim.
      const grounding = corpo?.ai?.quickGrounding;
      registrar(
        'Grounding ligado (a vitrine vende isto)',
        'avisa',
        grounding === 'enabled' ? [] : [`quickGrounding=${grounding} — a landing vende "live candle grounding"`],
      );
    }
  } else {
    console.log('  (SMOKE_OPS_TOKEN não definido — pulei as verificações autenticadas de ops)\n');
  }

  // ── CORS ──────────────────────────────────────────────────────────────────
  const corsProblemas = [];
  try {
    const r = await buscar(`${API}/api/health/live`, { headers: { Origin: 'https://sitemalicioso.example' } });
    const permitido = r.headers.get('access-control-allow-origin');
    if (permitido === '*' || permitido === 'https://sitemalicioso.example') {
      corsProblemas.push(`origem desconhecida foi aceita (Access-Control-Allow-Origin: ${permitido})`);
    }
  } catch (erro) {
    corsProblemas.push(`não consegui testar CORS: ${erro.message}`);
  }
  registrar('CORS recusa origem desconhecida', 'bloqueia', corsProblemas);

  // ── Site (frontend) ───────────────────────────────────────────────────────
  if (SITE) {
    const site = await buscar(SITE);
    registrar('Site responde', 'bloqueia', site.status === 200 ? [] : [`HTTP ${site.status}`]);
    registrar('HSTS no site', 'bloqueia', verificarHsts(site.headers.get('strict-transport-security')));
    registrar('HTTPS forçado no site', 'bloqueia', await verificarRedirecionamentoHttps(SITE));
    registrar('Certificado do site', 'bloqueia', await verificarCertificado(SITE));

    // /admin não pode ser indexável.
    const admin = await buscar(`${SITE}/admin`);
    const htmlAdmin = admin.ok ? await admin.text() : '';
    registrar(
      '/admin sai com noindex',
      'bloqueia',
      /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(htmlAdmin)
        ? []
        : ['a página /admin não entrega noindex no HTML inicial — vai acabar no índice do Google'],
    );
  }

  // ── Relatório ─────────────────────────────────────────────────────────────
  const bloqueantes = resultados.filter((r) => r.severidade === 'bloqueia' && !r.ok);
  const avisos = resultados.filter((r) => r.severidade === 'avisa' && !r.ok);

  for (const r of resultados.filter((r) => r.ok)) console.log(`  ✓  ${r.nome}`);
  for (const r of avisos) {
    console.log(`\n  ⚠  ${r.nome}`);
    for (const p of r.problemas) console.log(`       ${p}`);
  }
  for (const r of bloqueantes) {
    console.log(`\n  ✗  ${r.nome}`);
    for (const p of r.problemas) console.log(`       ${p}`);
  }
  console.log(
    `\n───\n${resultados.filter((r) => r.ok).length} passaram · ${avisos.length} aviso(s) · ${bloqueantes.length} bloqueante(s)\n`,
  );

  process.exit(bloqueantes.length > 0 ? 1 : 0);
}

main().catch((erro) => {
  console.error(`\nA auditoria não completou: ${erro.message}\n`);
  process.exit(2);
});
