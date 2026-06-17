/**
 * Verifica se o prompt ATIVO no banco está em dia com o prompt do CÓDIGO (v7.1).
 *
 * Por quê: o motor envia para a IA o prompt da tabela PromptConfig (banco), não
 * o arquivo de código. O código só é usado quando NÃO há config ativa. Se o banco
 * estiver com uma versão antiga, as edições recentes de prompt NÃO chegam na IA.
 *
 * Como rodar (na pasta apps/backend, com a DATABASE_URL de produção):
 *   DATABASE_URL="postgres://...sua_url_do_render..." npx ts-node scripts/check-active-prompt.ts
 *
 * Conexão idêntica à do worker (adapter PrismaPg), pra bater 100% com produção.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolvePrismaDatasourceUrl } from '../src/modules/database/prisma.datasource';
import TRADING_SYSTEM_PROMPT from '../src/common/prompts/trading-system-prompt';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolvePrismaDatasourceUrl() }),
});

// Marcadores que SÓ existem na v7.1 (o que a gente adicionou recentemente).
const MARKERS = [
  'LIQUIDITY FILTER',
  'ELLIOTT FLAT',
  'EXTENDED-PRICE RULE',
  'COHERENCE RULE',
  'v7.1',
];

function report(label: string, text: string) {
  console.log(`\n=== ${label} ===`);
  console.log('tamanho (chars):', text.length);
  for (const m of MARKERS) {
    console.log(`  contém "${m}": ${text.includes(m) ? 'SIM' : 'NÃO'}`);
  }
}

async function main() {
  const code = TRADING_SYSTEM_PROMPT.trim();
  report('PROMPT NO CÓDIGO (esperado — v7.1)', code);

  const active = await prisma.promptConfig.findFirst({
    where: { isActive: true },
    orderBy: { version: 'desc' },
  });

  if (!active) {
    console.log('\n=== PROMPT ATIVO NO BANCO ===');
    console.log('NENHUM ativo → o motor usa o prompt do CÓDIGO (v7.1).');
    console.log('\n>>> VEREDITO: EM DIA. Nada defasado.');
  } else {
    console.log('\n=== PROMPT ATIVO NO BANCO (o que REALMENTE vai pra IA) ===');
    console.log('versão:', active.version, '| isActive:', active.isActive);
    report('CONTEÚDO DO PROMPT ATIVO', active.prompt);

    const missing = MARKERS.filter((m) => !active.prompt.includes(m));
    console.log(
      '\n>>> VEREDITO:',
      missing.length === 0
        ? 'EM DIA ✅ — o banco já tem a v7.1.'
        : `DEFASADO ❌ — faltam no banco: ${missing.join(', ')}. A IA está usando um prompt ANTIGO.`,
    );
  }

  const all = await prisma.promptConfig.findMany({ orderBy: { version: 'desc' } });
  console.log('\n=== TODAS AS CONFIGS NO BANCO ===');
  for (const c of all) {
    console.log(`  v${c.version} | ativo=${c.isActive} | ${c.prompt.length} chars`);
  }
}

main()
  .catch((e) => {
    console.error('❌ Erro ao checar o prompt:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
