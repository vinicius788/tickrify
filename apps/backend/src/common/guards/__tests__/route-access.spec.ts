import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * REDE DE SEGURANÇA DO CONTROLE DE ACESSO (12/08/2026).
 *
 * A auditoria de acesso encontrou o seguinte: cada método de controller
 * declarava o próprio `@UseGuards(AuthGuard)`. O default era FAIL-OPEN — método
 * novo sem o decorator nascia PÚBLICO, sem erro de compilação e sem teste
 * falhando. A revisão precisava reparar na AUSÊNCIA de uma linha, que é
 * exatamente o tipo de coisa que a revisão não repara.
 *
 * O `GlobalAuthGuard` (APP_GUARD em app.module.ts) inverteu o default: agora a
 * omissão FECHA. Este teste protege as duas pontas dessa inversão:
 *
 *   1. O registro global existe. Se alguém remover o GlobalAuthGuard do
 *      app.module.ts num refactor, todas as rotas que perderam o
 *      `@UseGuards(AuthGuard)` abririam de uma vez — este teste falha antes.
 *
 *   2. Toda rota tem decisão EXPLÍCITA de acesso: ou `@Public()`, ou algum
 *      `@UseGuards(...)`. Rota nova sem nenhum dos dois quebra o CI com o nome
 *      do arquivo e do método.
 *
 * Por que uma varredura de FONTE em vez de subir o app e ler o RouterExplorer:
 * instanciar o AppModule exige Postgres, Redis e as chaves do Clerk/OpenAI —
 * o teste viraria integração e não rodaria no CI. A varredura de fonte é
 * determinística, roda em milissegundos e codifica a regra que queremos manter.
 *
 * ⚠️ Ao adicionar uma rota pública nova, inclua-a em RATE_LIMIT_EXEMPT apenas se
 * ela realmente não puder ter @Throttle. Endpoint aberto sem rate limit é como
 * o custo de API de terceiro vira prejuízo.
 */

const SRC_ROOT = resolve(__dirname, '../../..');

const HTTP_METHOD_DECORATORS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All'];

/** Rotas públicas que legitimamente não têm @Throttle próprio. */
const RATE_LIMIT_EXEMPT = new Set([
  // Ping do keep-warm a cada 5 min. O teto global de 150/min já cobre, e
  // limitar mais apertado derrubaria o próprio anti-hibernação.
  'health.controller.ts::getLiveness',
  // Fechadas pelo OpsTokenGuard: sem o INTERNAL_OPS_TOKEN nem chegam ao handler.
  'health.controller.ts::getReadiness',
  'health.controller.ts::getHealth',
  // Limitar o Stripe causaria reenvio em loop do webhook. A defesa é o HMAC.
  'stripe.controller.ts::handleWebhook',
]);

function listControllerFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue;
      found.push(...listControllerFiles(full));
      continue;
    }

    if (entry.endsWith('.controller.ts') && !entry.endsWith('.spec.ts')) {
      found.push(full);
    }
  }

  return found;
}

interface RouteInfo {
  file: string;
  method: string;
  httpDecorator: string;
  isPublic: boolean;
  hasGuard: boolean;
  hasThrottle: boolean;
  hasAuthGuard: boolean;
}

/**
 * Lê um controller e devolve uma entrada por handler HTTP, com os decorators
 * que estavam imediatamente acima dele (mais os do nível da classe, que valem
 * para todos os handlers do arquivo).
 */
function parseController(file: string): RouteInfo[] {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const shortName = file.split('/').pop() as string;

  // Decorators no nível da CLASSE: tudo entre o topo do arquivo e a linha do
  // `export class`. Valem para todo handler do controller.
  const classDeclarationIndex = lines.findIndex((line) => /^\s*export class /.test(line));
  const classHeader = lines.slice(0, classDeclarationIndex === -1 ? 0 : classDeclarationIndex);
  const classIsPublic = classHeader.some((line) => /^\s*@Public\(\)/.test(line));
  const classHasGuard = classHeader.some((line) => /^\s*@UseGuards\(/.test(line));
  const classHasAuthGuard = classHeader.some((line) => /^\s*@UseGuards\([^)]*AuthGuard/.test(line));

  const routes: RouteInfo[] = [];

  for (let i = classDeclarationIndex + 1; i < lines.length; i++) {
    const decoratorMatch = lines[i].match(
      new RegExp(`^\\s*@(${HTTP_METHOD_DECORATORS.join('|')})\\(`),
    );
    if (!decoratorMatch) continue;

    // Sobe até o começo do bloco de decorators deste handler (para trás,
    // enquanto as linhas forem decorator, continuação de decorator, comentário
    // ou vazias).
    let start = i;
    while (start > 0) {
      const previous = lines[start - 1].trim();
      const isDecoratorish =
        previous.startsWith('@') ||
        previous.startsWith('//') ||
        previous.startsWith('*') ||
        previous.startsWith('/*') ||
        previous.startsWith(')') ||
        previous.startsWith('}') ||
        previous.startsWith(']') ||
        previous === '';
      if (!isDecoratorish) break;
      start--;
    }

    // Desce até a assinatura do método BALANCEANDO PARÊNTESES. Sem isto, um
    // decorator multilinha como
    //   @UseInterceptors(FileInterceptor('image', { ... }))
    // faz a varredura parar dentro dele e ler "FileInterceptor" como nome do
    // handler — e, pior, corta o bloco antes do @Throttle que vem depois, o que
    // faria a rota parecer sem rate limit.
    let end = i;
    let depth = 0;
    let signature = '';

    while (end < lines.length - 1) {
      const current = lines[end];
      for (const char of current) {
        if (char === '(') depth++;
        else if (char === ')') depth--;
      }

      end++;
      if (depth > 0) continue;

      const candidate = lines[end].trim();
      if (candidate === '' || candidate.startsWith('//') || candidate.startsWith('*')) continue;
      if (candidate.startsWith('@')) continue;

      signature = candidate;
      break;
    }

    const block = lines.slice(start, end).join('\n');
    const methodName =
      signature.match(/^(?:async\s+)?(?:private\s+|public\s+)?([A-Za-z0-9_]+)\s*\(/)?.[1] ??
      `linha_${i + 1}`;

    routes.push({
      file: shortName,
      method: methodName,
      httpDecorator: decoratorMatch[1],
      isPublic: classIsPublic || /@Public\(\)/.test(block),
      hasGuard: classHasGuard || /@UseGuards\(/.test(block),
      hasThrottle: /@Throttle\(/.test(block),
      hasAuthGuard: classHasAuthGuard || /@UseGuards\([^)]*AuthGuard/.test(block),
    });
  }

  return routes;
}

describe('controle de acesso das rotas', () => {
  const controllerFiles = listControllerFiles(SRC_ROOT);
  const routes = controllerFiles.flatMap(parseController);

  it('encontra os controllers e as rotas do backend', () => {
    // Sanidade: se a varredura parar de achar arquivo, os testes abaixo passariam
    // vazios e a proteção viraria teatro.
    expect(controllerFiles.length).toBeGreaterThanOrEqual(9);
    expect(routes.length).toBeGreaterThanOrEqual(25);
  });

  it('registra o GlobalAuthGuard como APP_GUARD (negar por padrão)', () => {
    const appModule = readFileSync(join(SRC_ROOT, 'app.module.ts'), 'utf8');

    expect(appModule).toContain('GlobalAuthGuard');
    expect(appModule).toMatch(/provide:\s*APP_GUARD,\s*useClass:\s*GlobalAuthGuard/);

    // O rate limit tem de vir ANTES da autenticação: rejeita abuso sem tocar o banco.
    expect(appModule.indexOf('AppThrottlerGuard')).toBeLessThan(
      appModule.indexOf('useClass: GlobalAuthGuard'),
    );
  });

  it('toda rota tem decisão EXPLÍCITA de acesso: @Public() ou @UseGuards()', () => {
    const semDecisao = routes
      .filter((route) => !route.isPublic && !route.hasGuard)
      .map((route) => `${route.file}::${route.method} (@${route.httpDecorator})`);

    expect(semDecisao).toEqual([]);
  });

  it('nenhuma rota é @Public() e AuthGuard ao mesmo tempo', () => {
    // @Public() + @UseGuards(OpsTokenGuard) é legítimo — é o caso do /health.
    // O que NÃO pode é @Public() junto do AuthGuard: o resultado seria uma rota
    // que LÊ como fechada no código e responde aberta em produção, porque o
    // @Public() vence o guard global. Isso é o pior estado possível — pior que
    // abrir de propósito, porque ninguém vai desconfiar dela numa auditoria.
    const contraditorias = routes
      .filter((route) => route.isPublic && route.hasAuthGuard)
      .map((route) => `${route.file}::${route.method}`);

    expect(contraditorias).toEqual([]);
  });

  it('toda rota pública tem rate limit próprio', () => {
    const semLimite = routes
      .filter((route) => route.isPublic && !route.hasThrottle)
      .map((route) => `${route.file}::${route.method}`)
      .filter((id) => !RATE_LIMIT_EXEMPT.has(id));

    expect(semLimite).toEqual([]);
  });

  it('as rotas de prompt continuam exigindo AdminGuard', () => {
    const promptController = controllerFiles.find((f) => f.endsWith('prompt.controller.ts'));
    expect(promptController).toBeDefined();

    const source = readFileSync(promptController as string, 'utf8');
    const promptRoutes = parseController(promptController as string);

    expect(promptRoutes.length).toBeGreaterThanOrEqual(5);
    expect(source).not.toContain('@Public()');

    for (const route of promptRoutes) {
      expect(route.hasGuard).toBe(true);
    }
    // AdminGuard em TODOS os handlers, não só na maioria.
    const adminOccurrences = source.match(/AdminGuard/g) ?? [];
    expect(adminOccurrences.length).toBeGreaterThanOrEqual(promptRoutes.length);
  });

  it('a lista de rotas públicas é exatamente a esperada', () => {
    // Trava explícita: abrir uma rota nova obriga a editar esta lista, e a
    // edição aparece no diff. É a diferença entre "abrimos de propósito" e
    // "abriu e ninguém viu".
    const publicas = routes
      .filter((route) => route.isPublic)
      .map((route) => `${route.file}::${route.method}`)
      .sort();

    expect(publicas).toEqual(
      [
        'ai.controller.ts::getAccuracy',
        'ai.controller.ts::getPublicAnalyses',
        'calendar.controller.ts::getEvents',
        'demo.controller.ts::analyze',
        'demo.controller.ts::status',
        'health.controller.ts::getHealth',
        'health.controller.ts::getLiveness',
        'health.controller.ts::getReadiness',
        'market.controller.ts::getContext',
        'stripe.controller.ts::handleWebhook',
      ].sort(),
    );
  });
});
