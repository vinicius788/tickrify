import { PrismaClient } from '@prisma/client';
import TRADING_SYSTEM_PROMPT from '../src/common/prompts/trading-system-prompt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Criar prompt inicial - Versão 1 (Production - Full Multi-Agent System)
  const defaultPrompt = await prisma.promptConfig.upsert({
    where: { version: 1 },
    update: {},
    create: {
      version: 1,
      isActive: true,
      prompt: TRADING_SYSTEM_PROMPT.trim(),
    },
  });

  console.log('✅ Prompt v1 (Production Multi-Agent) criado:', {
    id: defaultPrompt.id,
    version: defaultPrompt.version,
    isActive: defaultPrompt.isActive,
    length: defaultPrompt.prompt.length,
  });

  // Criar prompt alternativo - Versão 2 (Simplified para testes rápidos)
  const simplifiedPrompt = await prisma.promptConfig.upsert({
    where: { version: 2 },
    update: {},
    create: {
      version: 2,
      isActive: false,
      prompt: `
Analise o gráfico de trading fornecido e retorne APENAS um JSON válido no seguinte formato:

{
  "recommendation": "BUY" | "SELL" | "HOLD",
  "confidence": 85,
  "reasoning": "Explicação detalhada da análise técnica"
}

Instruções:
- recommendation: Use EXATAMENTE "BUY" para compra, "SELL" para venda, ou "HOLD" para aguardar
- confidence: Número entre 0 e 100 indicando confiança na recomendação
- reasoning: Explicação clara e objetiva baseada em análise técnica

Analise os seguintes aspectos:
1. Padrões de candlestick visíveis
2. Níveis de suporte e resistência
3. Tendências (alta, baixa, lateral)
4. Volume de negociação (se visível)
5. Indicadores técnicos visíveis no gráfico (RSI, MACD, Médias Móveis, etc)

Seja preciso, objetivo e baseie-se apenas no que é visível no gráfico.
      `.trim(),
    },
  });

  console.log('✅ Prompt v2 (Simplified) criado:', {
    id: simplifiedPrompt.id,
    version: simplifiedPrompt.version,
    isActive: simplifiedPrompt.isActive,
  });

  console.log('\n🎉 Seed completed successfully!');
  console.log('\n📝 Resumo:');
  console.log('   - Prompt v1: ATIVO - Sistema Multi-Agente Completo (Production)');
  console.log('   - Prompt v2: Inativo - Versão Simplificada (Testes)');
  console.log('\n💡 Para alternar versões:');
  console.log('   POST /api/prompts/2/activate (ativa v2)');
  console.log('   POST /api/prompts/1/activate (volta para v1)');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
