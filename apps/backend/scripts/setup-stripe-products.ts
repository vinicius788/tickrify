#!/usr/bin/env ts-node
/**
 * Script para criar produtos e preços no Stripe
 * Execute: npx ts-node scripts/setup-stripe-products.ts
 */

import Stripe from 'stripe';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Carregar .env
dotenv.config({ path: path.join(__dirname, '../.env') });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

// Definição dos planos
const plans = [
  {
    name: 'Pro',
    amount: 8000, // R$ 80.00 em centavos
    currency: 'brl',
    interval: 'month' as Stripe.PriceCreateParams.Recurring.Interval,
    features: [
      'Análises ilimitadas',
      'Análise avançada de IA',
      'Histórico ilimitado',
      'Indicadores personalizados',
      'Alertas em tempo real',
      'API de acesso',
      'Suporte prioritário 24/7',
    ],
  },
];

async function setupStripeProducts() {
  console.log('🚀 Configurando produtos no Stripe...\n');

  try {
    for (const plan of plans) {
      console.log(`📦 Criando produto: ${plan.name}`);

      // Criar produto
      const product = await stripe.products.create({
        name: `Tickrify ${plan.name}`,
        description: `Plano ${plan.name} - ${plan.features.join(', ')}`,
        metadata: {
          plan: plan.name.toLowerCase(),
          features: JSON.stringify(plan.features),
        },
      });

      console.log(`   ✅ Produto criado: ${product.id}`);

      // Criar preço
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.amount,
        currency: plan.currency,
        recurring: {
          interval: plan.interval,
        },
        metadata: {
          plan: plan.name.toLowerCase(),
        },
      });

      console.log(`   💰 Preço criado: ${price.id}`);
      console.log(`   💵 Valor: ${plan.currency.toUpperCase()} ${(plan.amount / 100).toFixed(2)}/${plan.interval}`);
      console.log('');

      // Mostrar variável de ambiente
      console.log(`   📝 Adicione ao .env:`);
      console.log(`   STRIPE_PRICE_${plan.name.toUpperCase()}=${price.id}`);
      console.log('');
    }

    console.log('✅ Todos os produtos foram criados com sucesso!');
    console.log('');
    console.log('📋 PRÓXIMOS PASSOS:');
    console.log('1. Copie os STRIPE_PRICE_* IDs acima');
    console.log('2. Adicione ao arquivo .env');
    console.log('3. Reinicie o servidor backend');
    console.log('4. Configure o webhook no Stripe Dashboard:');
    console.log('   - URL: https://seu-backend.railway.app/api/stripe/webhook');
    console.log('   - Eventos: checkout.session.completed, customer.subscription.*');
    console.log('');
  } catch (error) {
    console.error('❌ Erro ao criar produtos:', error);
    process.exit(1);
  }
}

// Executar
setupStripeProducts();

