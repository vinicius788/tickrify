#!/usr/bin/env ts-node
/**
 * RELATÓRIO DE FUNIL — somente leitura (não altera NADA no banco).
 * Mostra onde os usuários caem entre cadastrar e pagar, usando os dados que a
 * plataforma JÁ guarda. Não toca em rotas, fluxos nem no app no ar.
 *
 * Como rodar (na pasta apps/backend):
 *   npx ts-node scripts/funnel-metrics.ts
 *   ou:  npm run metrics
 *
 * Lê DATABASE_URL do .env (mesma conexão do seed).
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

function pct(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

function bar(part: number, whole: number, width = 24): string {
  const filled = whole <= 0 ? 0 : Math.round((part / whole) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

function line(label: string, value: number, base: number): string {
  const lbl = label.padEnd(28);
  const val = String(value).padStart(4);
  return `${lbl} ${val}  ${bar(value, base)}  ${pct(value, base)}`;
}

async function main() {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  TICKRIFY — FUNIL DE CONVERSÃO  (somente leitura)');
  console.log(`  Gerado em ${new Date().toLocaleString('pt-BR')}`);
  console.log('════════════════════════════════════════════════════════════\n');

  // ── Coleta (tudo SELECT/COUNT — nenhuma escrita) ──────────────────────────
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      plan: true,
      createdAt: true,
      stripeCustomerId: true,
      subscriptionStatus: true,
      _count: { select: { analyses: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Análises reais (não-demo) por usuário, para medir ativação/engajamento.
  const analysesByUser = await prisma.analysis.groupBy({
    by: ['userId'],
    where: { isDemo: false },
    _count: { _all: true },
  });
  const realAnalyses = new Map<string, number>();
  for (const a of analysesByUser) realAnalyses.set(a.userId, a._count._all);

  // Compras de ticks (pagamento avulso) — usuários distintos com PURCHASE.
  let tickBuyers = new Set<string>();
  try {
    const purchases = await prisma.tickTransaction.findMany({
      where: { type: 'PURCHASE', stripePaymentIntentId: { not: null } },
      select: { userId: true },
    });
    tickBuyers = new Set(purchases.map((p) => p.userId));
  } catch {
    // tabela pode não existir em ambientes antigos — ignora com segurança
  }

  // ── Métricas do funil ─────────────────────────────────────────────────────
  const totalUsers = users.length;
  const realUsers = users.filter((u) => u.role !== 'admin'); // tira contas admin/suas
  const base = realUsers.length || totalUsers;

  const activated = realUsers.filter((u) => (realAnalyses.get(u.id) ?? 0) >= 1).length;
  const hitFreeLimit = realUsers.filter((u) => (realAnalyses.get(u.id) ?? 0) >= 3).length;
  const startedCheckout = realUsers.filter((u) => !!u.stripeCustomerId).length;
  const paidSub = realUsers.filter(
    (u) => u.subscriptionStatus === 'active' || (u.plan && u.plan !== 'FREE'),
  ).length;
  const paidTicks = realUsers.filter((u) => tickBuyers.has(u.id)).length;
  const anyPaid = realUsers.filter(
    (u) =>
      u.subscriptionStatus === 'active' ||
      (u.plan && u.plan !== 'FREE') ||
      tickBuyers.has(u.id),
  ).length;

  const now = Date.now();
  const signups7d = realUsers.filter(
    (u) => now - new Date(u.createdAt).getTime() <= 7 * 24 * 3600 * 1000,
  ).length;

  console.log(`Total de contas: ${totalUsers}  (admin/suas: ${totalUsers - realUsers.length})`);
  console.log(`Cadastros nos últimos 7 dias: ${signups7d}\n`);

  console.log('FUNIL (base = usuários reais)\n');
  console.log(line('1. Cadastraram (login)', base, base));
  console.log(line('2. Ativaram (≥1 análise)', activated, base));
  console.log(line('3. Bateram no paywall (≥3)', hitFreeLimit, base));
  console.log(line('4. Começaram checkout', startedCheckout, base));
  console.log(line('5. Pagaram (assinatura)', paidSub, base));
  console.log(line('5. Pagaram (ticks avulsos)', paidTicks, base));
  console.log(line('★ Pagaram (qualquer)', anyPaid, base));

  // ── Quedas entre etapas (onde o dinheiro escapa) ─────────────────────────
  console.log('\nONDE CAEM (queda entre etapas):');
  const drop = (from: number, to: number, fromL: string, toL: string) => {
    const lost = from - to;
    console.log(
      `  ${fromL} → ${toL}: caíram ${lost} de ${from}  (${pct(lost, from)} de perda)`,
    );
  };
  drop(base, activated, 'cadastro', 'ativação');
  drop(activated, hitFreeLimit, 'ativação', 'paywall');
  drop(hitFreeLimit, startedCheckout, 'paywall', 'checkout');
  drop(startedCheckout, anyPaid, 'checkout', 'pagamento');

  // ── Tabela por usuário (os cadastros, 1 por linha) ───────────────────────
  console.log('\nDETALHE POR USUÁRIO (mais recente primeiro):\n');
  console.log(
    `${'EMAIL'.padEnd(30)} ${'PLANO'.padEnd(8)} ${'ANÁL'.padStart(4)} ${'CHECKOUT'.padEnd(9)} ${'ASSIN'.padEnd(10)} CRIADO`,
  );
  console.log('─'.repeat(86));
  for (const u of users) {
    const email = (u.email ?? '(sem email)').slice(0, 29).padEnd(30);
    const plan = (u.plan ?? 'FREE').padEnd(8);
    const nA = String(realAnalyses.get(u.id) ?? 0).padStart(4);
    const checkout = (u.stripeCustomerId ? 'sim' : '—').padEnd(9);
    const sub = (u.subscriptionStatus ?? '—').slice(0, 9).padEnd(10);
    const created = new Date(u.createdAt).toLocaleDateString('pt-BR');
    const tag = u.role === 'admin' ? ' (admin)' : '';
    console.log(`${email} ${plan} ${nA} ${checkout} ${sub} ${created}${tag}`);
  }

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('Leitura rápida:');
  if (activated < base * 0.7) {
    console.log('• Muita gente cadastra e NÃO usa → problema de ativação/onboarding.');
  }
  if (activated > 0 && startedCheckout === 0) {
    console.log('• Usam, mas NINGUÉM chega ao checkout → o paywall/oferta não converte.');
  }
  if (startedCheckout > anyPaid) {
    console.log('• Começam o checkout e abandonam → atrito no pagamento (preço/cartão).');
  }
  console.log('• Para ver o PORQUÊ (telas vistas, cliques, abandono), o próximo passo é o PostHog.');
  console.log('────────────────────────────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error('Erro ao gerar o relatório:', e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
