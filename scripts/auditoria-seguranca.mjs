#!/usr/bin/env node
/**
 * AUDITORIA DE SEGURANÇA — o pente fino antes de ir ao ar (item 10).
 *
 * Roda no CI a cada push e BLOQUEIA o build. Não precisa de rede nem de banco:
 * tudo aqui é leitura de arquivo, para poder rodar em qualquer lugar e sempre.
 *
 * A parte que precisa de produção no ar (HTTPS, HSTS, cabeçalhos, se o /health
 * está mesmo fechado) vive em scripts/auditoria-producao.mjs.
 *
 * FILOSOFIA: cada verificação existe porque um erro REAL é possível ali, e a
 * mensagem de falha diz o que fazer — não só o que está errado. Auditoria que
 * cospe "FALHOU" sem explicar vira ruído que todo mundo aprende a ignorar.
 *
 * Uso:  node scripts/auditoria-seguranca.mjs [--json]
 * Sai com 1 se qualquer verificação BLOQUEANTE falhar.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(RAIZ, 'apps/backend');
const FRONTEND = join(RAIZ, 'apps/frontend');

const IGNORAR_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo', '_local', 'tmp', '.vercel',
]);

const resultados = [];

function verificar(nome, severidade, fn) {
  try {
    const problemas = fn() ?? [];
    resultados.push({ nome, severidade, ok: problemas.length === 0, problemas });
  } catch (erro) {
    resultados.push({
      nome,
      severidade,
      ok: false,
      problemas: [`a própria verificação quebrou: ${erro.message}`],
    });
  }
}

function listarArquivos(dir, filtro) {
  const saida = [];
  if (!existsSync(dir)) return saida;
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR_DIRS.has(entrada)) continue;
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) saida.push(...listarArquivos(caminho, filtro));
    else if (filtro(entrada)) saida.push(caminho);
  }
  return saida;
}

const ler = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(RAIZ, p);
const semComentarios = (texto) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const tsBackend = () => listarArquivos(BACKEND, (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
const tsxFrontend = () =>
  listarArquivos(join(FRONTEND, 'src'), (f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'));

// ════════════════════════════════════════════════════════════════════════════
//  1. SCHEMA vs MIGRAÇÕES
// ════════════════════════════════════════════════════════════════════════════
//
// Esta verificação nasceu de um bug REAL encontrado em 12/08/2026: a coluna
// `isDemo` — que é o portão da cota grátis inteira e o filtro que impede
// análise de demo de vazar para a vitrine — estava no schema.prisma e era usada
// em 36 lugares, mas NÃO era criada por nenhuma migração nem pelo hook de boot.
// Só existia em produção porque foi adicionada à mão pelo SQL Editor.
//
// Consequência: um banco criado do zero (staging, recuperação de desastre,
// ambiente novo) subia SEM a coluna e a primeira análise de qualquer usuário
// estourava. Isso não aparece de jeito nenhum em produção — lá a coluna existe
// e nunca reclama. Só aparece executando as migrações num Postgres limpo.
verificar('Todo campo do schema.prisma é criado por migração ou hook de boot', 'bloqueia', () => {
  const schema = ler(join(BACKEND, 'prisma/schema.prisma'));

  const sqlMigracoes = listarArquivos(join(BACKEND, 'prisma/migrations'), (f) => f.endsWith('.sql'))
    .map(ler)
    .join('\n');
  // O hook de boot (AiService/FeatureFlagsService/ReportsService) também cria
  // coluna, com ADD COLUMN IF NOT EXISTS. Conta como origem legítima.
  const hooksBoot = tsBackend()
    .filter((f) => /ADD COLUMN IF NOT EXISTS|CREATE TABLE IF NOT EXISTS/.test(ler(f)))
    .map(ler)
    .join('\n');
  const criadoEmAlgumLugar = sqlMigracoes + '\n' + hooksBoot;

  const faltando = [];
  const blocos = schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm);

  for (const [, modelo, corpo] of blocos) {
    for (const linha of corpo.split('\n')) {
      const limpa = linha.trim();
      if (!limpa || limpa.startsWith('//') || limpa.startsWith('@@') || limpa.startsWith('///')) continue;
      const campo = limpa.match(/^(\w+)\s+\w/);
      if (!campo) continue;

      const nome = campo[1];
      // Campos de relação não viram coluna; identificam-se pelo tipo começar
      // com maiúscula e não ter tipo escalar conhecido.
      const tipo = limpa.split(/\s+/)[1] ?? '';
      const ehRelacao = /^[A-Z]/.test(tipo) && !/^(String|Int|Float|Boolean|DateTime|Json|BigInt|Decimal|Bytes)/.test(tipo);
      if (ehRelacao) continue;

      if (!criadoEmAlgumLugar.includes(`"${nome}"`)) {
        faltando.push(
          `${modelo}.${nome} está no schema.prisma mas nenhuma migração nem hook de boot cria essa coluna — um banco novo subiria sem ela`,
        );
      }
    }
  }
  return faltando;
});

// ════════════════════════════════════════════════════════════════════════════
//  2. SQL CRU COM INTERPOLAÇÃO
// ════════════════════════════════════════════════════════════════════════════
//
// `$queryRawUnsafe`/`$executeRawUnsafe` com `${}` é injeção de SQL esperando
// acontecer. O projeto usa SQL cru legitimamente (DemoUsage, FeatureFlag,
// ProblemReport), então proibir SQL cru seria inútil — o que se proíbe é
// interpolar valor dentro dele. Com Prisma.sql`` os valores viram parâmetros.
verificar('Nenhum SQL cru com valor interpolado', 'bloqueia', () => {
  const problemas = [];
  for (const arquivo of tsBackend()) {
    const conteudo = semComentarios(ler(arquivo));
    const regex = /\$(?:query|execute)RawUnsafe\s*\(\s*`([^`]*)`/g;
    for (const achado of conteudo.matchAll(regex)) {
      if (achado[1].includes('${')) {
        problemas.push(
          `${rel(arquivo)}: interpolação dentro de RawUnsafe. Troque por Prisma.sql\`\` (parametriza) ou valide contra lista fechada.`,
        );
      }
    }
  }
  return problemas;
});

// ════════════════════════════════════════════════════════════════════════════
//  3. EXECUÇÃO DINÂMICA DE CÓDIGO
// ════════════════════════════════════════════════════════════════════════════
verificar('Nenhum eval / new Function', 'bloqueia', () => {
  const problemas = [];
  for (const arquivo of [...tsBackend(), ...tsxFrontend()]) {
    const conteudo = semComentarios(ler(arquivo));
    if (/\beval\s*\(/.test(conteudo)) problemas.push(`${rel(arquivo)}: usa eval()`);
    if (/new\s+Function\s*\(/.test(conteudo)) problemas.push(`${rel(arquivo)}: usa new Function()`);
  }
  return problemas;
});

// ════════════════════════════════════════════════════════════════════════════
//  4. HTML INJETADO NO FRONTEND
// ════════════════════════════════════════════════════════════════════════════
//
// A análise é texto vindo de um modelo de IA que leu uma IMAGEM enviada pelo
// usuário — ou seja, conteúdo influenciável por terceiro. Renderizar isso como
// HTML seria XSS com passo a passo pronto.
verificar('Nenhum dangerouslySetInnerHTML sem sanitização', 'bloqueia', () => {
  const problemas = [];
  for (const arquivo of tsxFrontend()) {
    const conteudo = ler(arquivo);
    if (!conteudo.includes('dangerouslySetInnerHTML')) continue;
    // JSON-LD gerado pelo próprio código é a exceção conhecida e segura.
    const ehJsonLd = /application\/ld\+json/.test(conteudo);
    const temSanitizador = /DOMPurify|sanitize/i.test(conteudo);
    if (!ehJsonLd && !temSanitizador) {
      problemas.push(
        `${rel(arquivo)}: dangerouslySetInnerHTML sem sanitizador. Texto de análise vem de modelo que leu imagem do usuário.`,
      );
    }
  }
  return problemas;
});

// ════════════════════════════════════════════════════════════════════════════
//  5. CORS ABERTO
// ════════════════════════════════════════════════════════════════════════════
verificar('CORS não é aberto para qualquer origem', 'bloqueia', () => {
  const problemas = [];
  for (const arquivo of tsBackend()) {
    const conteudo = semComentarios(ler(arquivo));
    if (/origin\s*:\s*['"`]\*['"`]/.test(conteudo)) problemas.push(`${rel(arquivo)}: origin: '*'`);
    if (/origin\s*:\s*true\b/.test(conteudo)) problemas.push(`${rel(arquivo)}: origin: true`);
    if (/Access-Control-Allow-Origin['"]\s*,\s*['"`]\*/.test(conteudo))
      problemas.push(`${rel(arquivo)}: cabeçalho Access-Control-Allow-Origin: *`);
  }
  return problemas;
});

// ════════════════════════════════════════════════════════════════════════════
//  6. CABEÇALHOS DE SEGURANÇA
// ════════════════════════════════════════════════════════════════════════════
verificar('Helmet com HSTS, CSP, frameguard e noSniff', 'bloqueia', () => {
  const arquivo = join(BACKEND, 'src/common/utils/security-headers.ts');
  if (!existsSync(arquivo)) return ['security-headers.ts não existe'];
  const conteudo = ler(arquivo);
  const faltando = [];
  if (!/contentSecurityPolicy/.test(conteudo)) faltando.push('CSP ausente');
  if (!/hsts/.test(conteudo)) faltando.push('HSTS ausente');
  if (!/maxAge:\s*31_?536_?000/.test(conteudo)) faltando.push('HSTS com max-age menor que 1 ano');
  if (!/includeSubDomains:\s*true/.test(conteudo)) faltando.push('HSTS sem includeSubDomains');
  if (!/preload:\s*true/.test(conteudo)) faltando.push('HSTS sem preload');
  if (!/frameguard/.test(conteudo)) faltando.push('frameguard ausente (clickjacking)');
  if (!/noSniff:\s*true/.test(conteudo)) faltando.push('noSniff ausente');
  if (!/upgradeInsecureRequests/.test(conteudo)) faltando.push('upgrade-insecure-requests ausente');

  const main = ler(join(BACKEND, 'src/main.ts'));
  if (!/app\.use\(helmet\(/.test(main)) faltando.push('main.ts não aplica o helmet');
  return faltando;
});

// ════════════════════════════════════════════════════════════════════════════
//  7. TRAVA DO FALLBACK DE AUTENTICAÇÃO LEGADO
// ════════════════════════════════════════════════════════════════════════════
//
// ALLOW_LEGACY_AUTH_FALLBACK=true em produção é bypass de autenticação. O boot
// tem que ABORTAR, não avisar: aviso em log de deploy ninguém lê.
verificar('ALLOW_LEGACY_AUTH_FALLBACK aborta o boot em produção', 'bloqueia', () => {
  const main = ler(join(BACKEND, 'src/main.ts'));
  if (!/ALLOW_LEGACY_AUTH_FALLBACK/.test(main)) return ['a trava sumiu do main.ts'];
  if (!/throw new Error\([\s\S]{0,200}ALLOW_LEGACY_AUTH_FALLBACK|ALLOW_LEGACY_AUTH_FALLBACK[\s\S]{0,400}?throw new Error/.test(main))
    return ['a trava existe mas não aborta o boot (deveria lançar erro, não só avisar)'];
  return [];
});

// ════════════════════════════════════════════════════════════════════════════
//  8. PAPEL LIDO DO BANCO, NUNCA DO TOKEN
// ════════════════════════════════════════════════════════════════════════════
verificar('AuthGuard lê o papel do banco e ignora metadata do token', 'bloqueia', () => {
  const guard = ler(join(BACKEND, 'src/modules/auth/auth.guard.ts'));
  const problemas = [];
  if (/claims\??\.\s*(public_metadata|unsafe_metadata|private_metadata)/.test(guard))
    problemas.push('auth.guard.ts lê metadata do token — o papel tem que vir do banco');
  if (!/role:\s*true/.test(guard))
    problemas.push('auth.guard.ts não seleciona `role` do banco');
  const specs = listarArquivos(join(BACKEND, 'src/modules/auth'), (f) => f.endsWith('.spec.ts'));
  if (!specs.some((f) => /metadata/.test(ler(f))))
    problemas.push('sumiu o teste que garante que metadata de admin forjada é ignorada');
  return problemas;
});

// ════════════════════════════════════════════════════════════════════════════
//  9. NEGAR POR PADRÃO
// ════════════════════════════════════════════════════════════════════════════
verificar('Guard global registrado e teste de cobertura de rotas presente', 'bloqueia', () => {
  const problemas = [];
  const appModule = ler(join(BACKEND, 'src/app.module.ts'));
  if (!/useClass:\s*GlobalAuthGuard/.test(appModule))
    problemas.push('GlobalAuthGuard não está registrado como APP_GUARD — rota nova nasceria pública');
  const teste = join(BACKEND, 'src/common/guards/__tests__/route-access.spec.ts');
  if (!existsSync(teste))
    problemas.push('sumiu o teste que exige decisão explícita de acesso em toda rota');
  return problemas;
});

// ════════════════════════════════════════════════════════════════════════════
//  10. MOEDA DECIDIDA NO SERVIDOR
// ════════════════════════════════════════════════════════════════════════════
//
// Até 29/07/2026 o backend aceitava `body.currency`. Um POST com 'brl' assinava
// o plano de US$29 por ~US$10, porque o price BRL estava congelado. Isto é
// fronteira de segurança, não preferência de UX.
verificar('Moeda de cobrança nunca vem do cliente', 'bloqueia', () => {
  const problemas = [];
  for (const nome of ['modules/payments/stripe.controller.ts', 'modules/ticks/ticks.controller.ts']) {
    const arquivo = join(BACKEND, 'src', nome);
    if (!existsSync(arquivo)) continue;
    const conteudo = semComentarios(ler(arquivo));
    if (/body\.currency/.test(conteudo))
      problemas.push(`${nome}: lê body.currency — a moeda tem que ser fixada no servidor`);
    if (!/currency(?::\s*Currency)?\s*=\s*['"]usd['"]/.test(conteudo))
      problemas.push(`${nome}: não fixa a moeda em 'usd'`);
  }
  return problemas;
});

// ════════════════════════════════════════════════════════════════════════════
//  11. VARIÁVEIS EXPOSTAS AO NAVEGADOR
// ════════════════════════════════════════════════════════════════════════════
//
// Tudo que começa com VITE_ vai para o bundle e é PÚBLICO. Um nome com SECRET,
// PRIVATE ou SERVICE_ROLE ali é chave vazada para qualquer visitante.
verificar('Nenhuma variável VITE_ com cara de segredo', 'bloqueia', () => {
  const problemas = [];
  const suspeito = /VITE_[A-Z0-9_]*(SECRET|PRIVATE|SERVICE_ROLE|_SK|PASSWORD|CLERK_SECRET)[A-Z0-9_]*/g;
  const arquivos = [
    ...tsxFrontend(),
    ...listarArquivos(FRONTEND, (f) => f === '.env.example' || f === '.env.production.example'),
  ];
  for (const arquivo of arquivos) {
    for (const achado of ler(arquivo).matchAll(suspeito)) {
      problemas.push(`${rel(arquivo)}: ${achado[0]} — tudo com prefixo VITE_ vai para o bundle público`);
    }
  }
  return problemas;
});

// ════════════════════════════════════════════════════════════════════════════
//  12. VARREDURA DE SEGREDOS CONFIGURADA
// ════════════════════════════════════════════════════════════════════════════
verificar('Varredura de segredos existe e bloqueia o build', 'bloqueia', () => {
  const problemas = [];
  if (!existsSync(join(RAIZ, '.gitleaks.toml'))) problemas.push('.gitleaks.toml sumiu');
  const wf = join(RAIZ, '.github/workflows/secrets.yml');
  if (!existsSync(wf)) problemas.push('.github/workflows/secrets.yml sumiu');
  else if (!/--log-opts=("--all"|--all)/.test(ler(wf)))
    problemas.push('a varredura não cobre o histórico inteiro (--log-opts=--all)');
  const ci = ler(join(RAIZ, '.github/workflows/ci.yml'));
  if (!/segredos/.test(ci)) problemas.push('o job `build` não depende da varredura de segredos');
  return problemas;
});

// ════════════════════════════════════════════════════════════════════════════
//  13. ARQUIVOS DE AMBIENTE FORA DO GIT
// ════════════════════════════════════════════════════════════════════════════
verificar('Nenhum .env rastreado pelo git', 'bloqueia', () => {
  try {
    const saida = execSync('git ls-files', { cwd: RAIZ, encoding: 'utf8' });
    return saida
      .split('\n')
      .filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.example'))
      .map((f) => `${f} está rastreado — rotacione as chaves ANTES de limpar o histórico`);
  } catch {
    return [];
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  14. TYPECHECK QUE REALMENTE CHECA
// ════════════════════════════════════════════════════════════════════════════
//
// Descoberto em 19/08/2026: o script `typecheck` do frontend era
// `tsc --noEmit` num tsconfig com "files": [] e "references". Nesse formato o
// tsc não segue as referências: não checa NADA e sai 0. Um typecheck que mente
// é pior que não ter, porque cria confiança falsa — dois bugs reais passaram
// por ele. Só `tsc -b` (build mode) segue project references.
verificar('O typecheck do frontend realmente checa (tsc -b)', 'bloqueia', () => {
  const pkg = JSON.parse(ler(join(FRONTEND, 'package.json')));
  const script = pkg.scripts?.typecheck ?? '';
  const tsconfig = JSON.parse(ler(join(FRONTEND, 'tsconfig.json')).replace(/,(\s*[}\]])/g, '$1'));
  const usaReferences = Array.isArray(tsconfig.references) && tsconfig.references.length > 0;

  if (usaReferences && !/tsc\s+-b/.test(script)) {
    return [
      `o tsconfig usa project references, mas o script é "${script}" — sem \`tsc -b\` ele não checa nada e sai 0`,
    ];
  }
  return [];
});

verificar('Typecheck e testes rodam no CI e bloqueiam o build', 'bloqueia', () => {
  const ci = ler(join(RAIZ, '.github/workflows/ci.yml'));
  const problemas = [];
  if (!/^\s{2}typecheck:/m.test(ci)) problemas.push('não existe job de typecheck no CI');
  const needs = ci.match(/build:[\s\S]*?needs:([\s\S]*?)steps:/)?.[1] ?? '';
  for (const exigido of ['lint', 'typecheck', 'test', 'segredos']) {
    if (!needs.includes(exigido)) problemas.push(`o job \`build\` não depende de \`${exigido}\``);
  }
  return problemas;
});

// ════════════════════════════════════════════════════════════════════════════
//  15. DEPENDÊNCIAS COM VULNERABILIDADE CONHECIDA
// ════════════════════════════════════════════════════════════════════════════
//
// Só `critical` bloqueia. `high` avisa: em projeto com dependência transitiva
// funda, bloquear em high transforma a auditoria em obstáculo permanente e a
// primeira reação passa a ser desligá-la.
verificar('Nenhuma vulnerabilidade crítica nas dependências', 'bloqueia', () => {
  try {
    const saida = execSync('pnpm audit --json --audit-level=critical', {
      cwd: RAIZ,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const dados = JSON.parse(saida);
    const criticas = dados?.metadata?.vulnerabilities?.critical ?? 0;
    return criticas > 0 ? [`${criticas} vulnerabilidade(s) crítica(s) — rode \`pnpm audit\` para ver`] : [];
  } catch (erro) {
    // pnpm audit sai != 0 quando ACHA algo; o JSON vem no stdout mesmo assim.
    try {
      const dados = JSON.parse(erro.stdout || '{}');
      const criticas = dados?.metadata?.vulnerabilities?.critical ?? 0;
      return criticas > 0 ? [`${criticas} vulnerabilidade(s) crítica(s) — rode \`pnpm audit\``] : [];
    } catch {
      return [];
    }
  }
});

verificar('Vulnerabilidades altas nas dependências', 'avisa', () => {
  try {
    execSync('pnpm audit --json', { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return [];
  } catch (erro) {
    try {
      const dados = JSON.parse(erro.stdout || '{}');
      const altas = dados?.metadata?.vulnerabilities?.high ?? 0;
      return altas > 0 ? [`${altas} vulnerabilidade(s) alta(s) — avalie, não bloqueia`] : [];
    } catch {
      return [];
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  16. VARIÁVEIS DE AMBIENTE DOCUMENTADAS
// ════════════════════════════════════════════════════════════════════════════
//
// Avisa, não bloqueia: variável nova sem entrada no .env.example é como um
// ambiente novo sobe quebrado, mas não é falha de segurança em si.
verificar('Toda variável de ambiente usada está no .env.example', 'avisa', () => {
  const exemplos = [
    join(BACKEND, '.env.example'),
    join(BACKEND, '.env.production.example'),
  ].filter(existsSync).map(ler).join('\n');

  const usadas = new Set();
  for (const arquivo of tsBackend()) {
    for (const achado of ler(arquivo).matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)) {
      usadas.add(achado[1]);
    }
  }
  const padrao = new Set(['NODE_ENV', 'PORT', 'npm_package_version', 'CI']);
  return [...usadas]
    .filter((v) => !padrao.has(v) && !exemplos.includes(v))
    .sort()
    .map((v) => `${v} é usada no código mas não está em nenhum .env.example`);
});

// ════════════════════════════════════════════════════════════════════════════
//  RELATÓRIO
// ════════════════════════════════════════════════════════════════════════════

const bloqueantes = resultados.filter((r) => r.severidade === 'bloqueia' && !r.ok);
const avisos = resultados.filter((r) => r.severidade === 'avisa' && !r.ok);
const passaram = resultados.filter((r) => r.ok);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ resultados, bloqueantes: bloqueantes.length }, null, 2));
} else {
  console.log('\n═══ AUDITORIA DE SEGURANÇA ═══\n');
  for (const r of passaram) console.log(`  ✓  ${r.nome}`);
  for (const r of avisos) {
    console.log(`\n  ⚠  ${r.nome}`);
    for (const p of r.problemas) console.log(`       ${p}`);
  }
  for (const r of bloqueantes) {
    console.log(`\n  ✗  ${r.nome}`);
    for (const p of r.problemas) console.log(`       ${p}`);
  }
  console.log(
    `\n───\n${passaram.length} passaram · ${avisos.length} aviso(s) · ${bloqueantes.length} bloqueante(s)\n`,
  );
  if (bloqueantes.length > 0) {
    console.log('NADA VAI AO AR até os bloqueantes acima serem resolvidos.\n');
  }
}

process.exit(bloqueantes.length > 0 ? 1 : 0);
