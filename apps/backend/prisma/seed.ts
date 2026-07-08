import { PrismaClient } from '@prisma/client';
import TRADING_SYSTEM_PROMPT from '../src/common/prompts/trading-system-prompt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  await prisma.promptConfig.updateMany({
    where: { version: { lt: 3 } },
    data: { isActive: false },
  });

  const promptV3 = await prisma.promptConfig.upsert({
    where: { version: 3 },
    update: {
      prompt: TRADING_SYSTEM_PROMPT.trim(),
      isActive: true,
    },
    create: {
      version: 3,
      prompt: TRADING_SYSTEM_PROMPT.trim(),
      isActive: true,
    },
  });

  await prisma.promptConfig.updateMany({
    where: {
      version: { not: 3 },
      isActive: true,
    },
    data: { isActive: false },
  });

  console.log('✅ Prompt v3 ativo:', {
    id: promptV3.id,
    version: promptV3.version,
    isActive: promptV3.isActive,
    length: promptV3.prompt.length,
    description:
      'v3 - checklist binário, COMPRA/VENDA/AGUARDAR, regras matemáticas e reasoning estruturado',
  });

  console.log('🎉 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
